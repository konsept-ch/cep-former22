import { Router } from 'express'
import convert from 'xml-js'

import { callApi, CLAROLINE_TOKEN, PEOPLESOFT_TOKEN } from '../callApi'
import { createService } from '../utils'
import { prisma } from '..'
import { deriveInscriptionStatus, STATUSES, transformFlagsToStatus } from './inscriptionsUtils'

export const peoplesoftRouter = Router()

const respondToPeopleSoft = (res, data) =>
    res.format({
        'application/json': () => res.json(data),

        'application/xml': () => {
            const options = { compact: true, spaces: 4 }
            const result =
                typeof data === 'string'
                    ? convert.json2xml({ error: data }, options)
                    : convert.json2xml({ formations: { formation: data } }, options)
            res.send(result)
        },

        default: () => res.json(data),
    })

/**
 * @openapi
 *
 * /peoplesoft/formations:
 *   get:
 *     summary: Retourne l'arborescence des formations, sessions et inscriptions
 *     tags: [Formations]
 *     description: Liste des <strong>formations</strong> proposées par le CEP avec les <strong>sessions</strong> de chaque formation et les <strong>inscriptions</strong> dans chaque session.
 *       <br>Le filtre par date de dernière modification du statut d'inscription <strong>statusUpdatedSince</strong> retourne toutes les inscriptions qui ont été créées ou modifiées après la date du filtre.
 *       <br>Si le filtre est vide, toutes les inscriptions sont retournées.
 *       <br>Ce filtre est appliqué <em>uniquement</em> sur les <strong>inscriptions</strong>.
 *       <br>Toutes les <strong>formations</strong> <em>non-cachées</em> et leurs <strong>sessions</strong> <em>non-cachées</em> sont toujours retournées, même s'il n'y a aucune <strong>inscription</strong> dedans.
 *       <br>Si une <strong>formation</strong> n'est plus retournée, elle a probablement été cachée/archivée/supprimée.
 *       <br>Si une <strong>session</strong> n'est plus retournée, elle (ou sa formation parente) a probablement été cachée/archivée/supprimée.
 *       <br>Si une <strong>inscription</strong> n'est plus retournée, elle a probablement été annulée ou sa session parente (ou sa formation parente) a probablement été cachée/archivée/supprimée.
 *       <br>Si une <strong>formation</strong> ou <strong>session</strong> a été renommée, normalement son <strong>id</strong> reste le même.
 *       <br>Quand une <strong>inscription</strong> est annulée puis recréée (même <strong>utilisateur</strong> et même <strong>session</strong>), l'<strong>id</strong> de la nouvelle <strong>inscription</strong> est <em>différent</em>.
 *       <br>Les <strong>inscriptions</strong> sont filtrés par ceux qui contiennent "@lausanne.ch" dans l'e-mail de l'utilisateur qui est inscrit.
 *     parameters:
 *       - name: X-Former22-API-Key
 *         in: header
 *         required: false
 *         description: "La clé API fournie par le CEP. <strong>Format</strong> : 066775dba16dae057a8247e83864f93c71e9"
 *         schema:
 *           type: string
 *       - name: statusUpdatedSince
 *         in: query
 *         required: false
 *         description: "ISO Date, UTC. <strong>Format</strong> : 2022-06-22T21:15:21.000Z"
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Succès - l'arborescence des formations, sessions et inscriptions a été retournée
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Formation'
 *           application/xml:
 *             schema:
 *               type: object
 *               xml:
 *                 name: formations
 *               properties:
 *                 formation:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Formation'
 */
createService(
    'get',
    '/formations',
    async (req, res) => {
        const { statusUpdatedSince, apitoken } = req.query
        const token = req.header(PEOPLESOFT_TOKEN) ?? apitoken

        if (token == null) {
            respondToPeopleSoft(res, `Vous devez passer le header ${PEOPLESOFT_TOKEN}`)
        } else {
            const currentAuth = await callApi({
                req,
                path: '/apiv2/apitoken/list/current',
                headers: { [CLAROLINE_TOKEN]: token },
            })

            if (currentAuth === 'Access Denied.') {
                respondToPeopleSoft(res, "Votre token n'existe pas dans Claroline")
            } else {
                const isAdmin = currentAuth[0]?.permissions.edit

                if (!isAdmin) {
                    respondToPeopleSoft(res, "Vous n'êtes pas admin")
                } else {
                    //const generateParentOrgFilter = ({ orgName, levels = 5 }) => ({
                    const generateParentOrgFilter = ({ orgCode, levels = 5 }) => ({
                        claro__organization:
                            levels > 0
                                ? {
                                      OR: [
                                          {
                                              code: {
                                                  equals: orgCode,
                                              },
                                          },
                                          generateParentOrgFilter({ orgCode, levels: levels - 1 }),
                                      ],
                                  }
                                : {
                                      code: {
                                          equals: orgCode,
                                      },
                                  },
                    })

                    const registrationConditions = {
                        // reused in order to send only courses that have sessions that have inscriptions of Lausanne
                        claro_user: {
                            user_organization: {
                                some: {
                                    claro__organization: generateParentOrgFilter({
                                        orgCode: 'LAUSANNE',
                                        levels: 5,
                                    }),
                                },
                            },
                        },
                        registration_type: 'learner',
                    }

                    const courses = await prisma.claro_cursusbundle_course.findMany({
                        select: {
                            uuid: true,
                            code: true,
                            course_name: true,
                            createdAt: true,
                            session_days: true,
                            session_hours: true,
                            plainDescription: true,
                            claro_cursusbundle_course_session: {
                                where: {
                                    claro_cursusbundle_course_session_user: {
                                        some: registrationConditions,
                                    },
                                },
                                select: {
                                    uuid: true,
                                    code: true,
                                    createdAt: true,
                                    max_users: true,
                                    claro__location: {
                                        select: {
                                            address_city: true,
                                        },
                                    },
                                    claro_cursusbundle_course_session_user: {
                                        where: registrationConditions,
                                        select: {
                                            uuid: true,
                                            registration_date: true,
                                            validated: true,
                                            status: true,
                                            claro_user: {
                                                select: {
                                                    mail: true,
                                                    uuid: true,
                                                    first_name: true,
                                                    last_name: true,
                                                    user_organization: {
                                                        include: {
                                                            claro__organization: {
                                                                include: {
                                                                    claro_cursusbundle_quota: true,
                                                                },
                                                            },
                                                        },
                                                        where: {
                                                            is_main: true,
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                    claro_cursusbundle_session_event: {
                                        select: {
                                            claro_planned_object: {
                                                select: {
                                                    start_date: true,
                                                },
                                            },
                                        },
                                    },
                                    former22_session: {
                                        select: {
                                            sessionFormat: true,
                                        },
                                    },
                                },
                            },
                            former22_course: {
                                select: {
                                    typeStage: true,
                                    teachingMethod: true,
                                    codeCategory: true,
                                    isRecurrent: true,
                                    theme: true,
                                    // note: we don't send coordinator and responsible to peoplesoft
                                    coordinator: false,
                                    responsible: false,
                                },
                            },
                        },
                        where: {
                            hidden: false,
                            claro_cursusbundle_course_session: {
                                some: {
                                    hidden: false,
                                    claro_cursusbundle_course_session_user: {
                                        some: registrationConditions,
                                    },
                                },
                            },
                        },
                    })

                    const inscriptionsAdditionalData = await prisma.former22_inscription.findMany()

                    const fullCoursesData = courses.map(({ former22_course, ...course }) => ({
                        ...course,
                        ...former22_course,
                        sessions: course.claro_cursusbundle_course_session.map(({ former22_session, ...session }) => ({
                            ...session,
                            ...former22_session,
                            inscriptions: session.claro_cursusbundle_course_session_user
                                .map((inscription) => ({
                                    ...inscription,
                                    ...inscriptionsAdditionalData.find(
                                        ({ inscriptionId }) => inscriptionId === inscription.uuid
                                    ),
                                    inscriptionId: undefined,
                                }))
                                .filter(
                                    ({ updatedAt }) =>
                                        statusUpdatedSince == null ||
                                        updatedAt == null ||
                                        new Date(updatedAt).getTime() >= new Date(statusUpdatedSince).getTime()
                                ),
                            sessionId: undefined,
                            claro_cursusbundle_course_session_user: undefined,
                        })),
                        courseId: undefined,
                        claro_cursusbundle_course_session: undefined,
                    }))

                    // const filteredCoursesData = fullCoursesData.filter(({ restrictions: { hidden } }) => !hidden)
                    const filteredCoursesData = fullCoursesData

                    // TODO sessions - dates only, not hours?
                    // maybe better to return everything, in order to avoid timezone confusion?

                    // note: we rename some fields here for clarity and consistency
                    const renamedFieldsCoursesData = filteredCoursesData
                        .map(
                            ({
                                uuid: id,
                                code,
                                course_name: name,
                                createdAt: creationDate,
                                typeStage = null,
                                teachingMethod = null,
                                theme = null,
                                codeCategory = null,
                                isRecurrent = false,
                                session_days,
                                session_hours,
                                plainDescription: summary,
                                sessions,
                                ...restCourseData
                            }) => ({
                                ...restCourseData,
                                id,
                                code,
                                name,
                                isActive: true, // TODO: discuss: statut stage actif/inactif
                                creationDate,
                                typeStage,
                                teachingMethod,
                                theme,
                                codeCategory,
                                isCertifying: typeStage === 'Certificat', // TODO constant
                                isRecurrent,
                                durationHours: session_days * 8 + session_hours,
                                summary,
                                sessions: sessions
                                    .map(
                                        ({
                                            uuid: sessionId,
                                            code: sessionCode,
                                            course_name: sessionName,
                                            createdAt: sessionCreationDate,
                                            claro_cursusbundle_session_event,
                                            max_users: maxParticipants,
                                            claro__location,
                                            sessionFormat = null,
                                            inscriptions,
                                            ...restSessionData
                                        }) => ({
                                            ...restSessionData,
                                            id: sessionId,
                                            code: sessionCode,
                                            name: sessionName,
                                            creationDate: sessionCreationDate,
                                            eventDates: claro_cursusbundle_session_event
                                                .map(({ claro_planned_object: { start_date } }) =>
                                                    start_date?.toISOString()
                                                )
                                                .sort(),
                                            maxParticipants,
                                            sessionFormat,
                                            sessionLocation: claro__location?.address_city || null,
                                            inscriptions: inscriptions
                                                .map(
                                                    ({
                                                        uuid: inscriptionId,
                                                        registration_date,
                                                        validated,
                                                        status,
                                                        registration_type,
                                                        updatedAt = registration_date,
                                                        claro_user: {
                                                            mail,
                                                            uuid: userId,
                                                            first_name,
                                                            last_name,
                                                            user_organization,
                                                        },
                                                        inscriptionStatus,
                                                        ...restInscriptionData
                                                    }) => ({
                                                        attestationId: restInscriptionData.attestationId,
                                                        id: inscriptionId,
                                                        status: deriveInscriptionStatus({
                                                            savedStatus: inscriptionStatus,
                                                            transformedStatus: transformFlagsToStatus({
                                                                validated,
                                                                registrationType: registration_type,
                                                                hrValidationStatus: status,
                                                                isHrValidationEnabled:
                                                                    user_organization?.claro__organization
                                                                        ?.claro_cursusbundle_quota != null,
                                                            }),
                                                        }).replace('Réfusée par RH', 'Refusée par RH'), // patch typo until fixed in db
                                                        statusUpdatedAt: updatedAt,
                                                        inscriptionDate: registration_date,
                                                        user: {
                                                            id: userId,
                                                            email: mail,
                                                            firstName: first_name,
                                                            lastName: last_name,
                                                            organizations: user_organization.map(
                                                                ({ claro__organization: { name: orgName } }) => orgName
                                                            ),
                                                        },
                                                    })
                                                )
                                                .filter(
                                                    ({ status }) =>
                                                        ![
                                                            STATUSES.ENTREE_WEB,
                                                            STATUSES.EN_ATTENTE,
                                                            STATUSES.INVITEE,
                                                        ].includes(status)
                                                ),
                                        })
                                    )
                                    .filter(({ inscriptions }) => inscriptions.length > 0),
                            })
                        )
                        .filter(({ sessions }) => sessions.length > 0)

                    respondToPeopleSoft(
                        res,
                        renamedFieldsCoursesData ?? 'Aucun cours avec sessions avec inscription de la ville trouvé'
                    )
                }
            }
        }
    },
    null,
    peoplesoftRouter
)
