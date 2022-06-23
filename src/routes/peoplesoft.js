import { Router } from 'express'
import convert from 'xml-js'

import { callApi, CLAROLINE_TOKEN, PEOPLESOFT_TOKEN } from '../callApi'
import { createService } from '../utils'
import { prisma } from '..'

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
 *       <br>Pour le premier appel de PeopleSoft (juillet 2022), ce filtre doit être vide, pour que le système retourne toutes les inscriptions.
 *       <br>Ce filtre est appliqué <em>uniquement</em> sur les <strong>inscriptions</strong>.
 *       <br>Toutes les <strong>formations</strong> <em>non-cachées</em> et leurs <strong>sessions</strong> <em>non-cachées</em> sont toujours retournées, même s'il n'y a aucune <strong>inscription</strong> dedans.
 *       <br>Si une <strong>formation</strong> n'est plus retournée, elle a probablement été cachée/archivée/supprimée.
 *       <br>Si une <strong>session</strong> n'est plus retournée, elle (ou sa formation parente) a probablement été cachée/archivée/supprimée.
 *       <br>Si une <strong>inscription</strong> n'est plus retournée, elle a probablement été annulée ou sa session parente (ou sa formation parente) a probablement été cachée/archivée/supprimée.
 *       <br>Si une <strong>formation</strong> ou <strong>session</strong> a été renommée, normalement son <strong>id</strong> reste le même.
 *       <br>Quand une <strong>inscription</strong> est annulée et ensuite elle est refaite (même <strong>utilisateur</strong> et même <strong>session</strong>), l'<strong>id</strong> de la nouvelle <strong>inscription</strong> est <em>different</em>.
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

        console.log('statusUpdatedSince', statusUpdatedSince)

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
                const isAdmin = currentAuth[0]?.user?.permissions.administrate

                if (!isAdmin) {
                    respondToPeopleSoft(res, "Vous n'êtes pas admin")
                } else {
                    const courses = await prisma.claro_cursusbundle_course.findMany({
                        where: { hidden: false }, // TODO: ask CEP about other filters except hidden: false
                        select: {
                            // TODO: ask CEP if we should send the poster and thumbnail URLs
                            uuid: true,
                            code: true,
                            course_name: true,
                            createdAt: true,
                            session_days: true,
                            session_hours: true,
                            plainDescription: true,
                            claro_cursusbundle_course_session: {
                                where: { hidden: false }, // TODO: ask CEP about other filters except hidden: false
                                select: {
                                    uuid: true,
                                    code: true,
                                    createdAt: true,
                                    max_users: true,
                                    claro_cursusbundle_course_session_user: {
                                        where: {
                                            registration_type: 'learner',
                                        },
                                        select: {
                                            uuid: true,
                                            registration_date: true,
                                            claro_user: {
                                                select: {
                                                    mail: true,
                                                    uuid: true,
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
                                },
                            },
                        },
                    })

                    const coursesAdditionalData = await prisma.former22_course.findMany({
                        select: {
                            courseId: true,
                            typeStage: true,
                            teachingMethod: true,
                            codeCategory: true,
                            isRecurrent: true,
                            // note: we don't send coordinator and responsible to peoplesoft
                            coordinator: false,
                            responsible: false,
                        },
                    })

                    const sessionsAdditionalData = await prisma.former22_session.findMany({
                        select: {
                            sessionId: true,
                            sessionFormat: true,
                            sessionLocation: true,
                        },
                    })

                    const inscriptionsAdditionalData = await prisma.former22_inscription.findMany()

                    const fullCoursesData = courses.map((course) => ({
                        ...course,
                        ...coursesAdditionalData.find(({ courseId }) => courseId === course.uuid),
                        sessions: course.claro_cursusbundle_course_session.map((session) => ({
                            ...session,
                            ...sessionsAdditionalData.find(({ sessionId }) => sessionId === session.uuid),
                            inscriptions: session.claro_cursusbundle_course_session_user
                                .map((inscription) => ({
                                    ...inscription,
                                    ...inscriptionsAdditionalData.find(
                                        ({ inscriptionId }) => inscriptionId === inscription.uuid
                                    ),
                                    // eslint-disable-next-line no-undefined -- unset inscriptionId
                                    inscriptionId: undefined,
                                }))
                                .filter(
                                    ({ updatedAt }) =>
                                        console.log(
                                            process.env.TZ,
                                            new Date(updatedAt),
                                            new Date(updatedAt).getTime(),
                                            new Date(statusUpdatedSince),
                                            new Date(statusUpdatedSince).getTime()
                                        ) || new Date(updatedAt).getTime() > new Date(statusUpdatedSince).getTime()
                                ),
                            // eslint-disable-next-line no-undefined -- unset sessionId
                            sessionId: undefined,
                            // eslint-disable-next-line no-undefined -- renamed to inscriptions
                            claro_cursusbundle_course_session_user: undefined,
                        })),
                        // eslint-disable-next-line no-undefined -- unset courseId
                        courseId: undefined,
                        // eslint-disable-next-line no-undefined -- renamed to sessions
                        claro_cursusbundle_course_session: undefined,
                    }))

                    // TODO: ask CEP about other filters based on business logic
                    // const filteredCoursesData = fullCoursesData.filter(({ restrictions: { hidden } }) => !hidden)
                    const filteredCoursesData = fullCoursesData

                    // TODO sessions - dates only, not hours

                    // note: we rename some fields here for clarity and consistency
                    const renamedFieldsCoursesData = filteredCoursesData.map(
                        ({
                            uuid: id,
                            code,
                            course_name: name,
                            createdAt: creationDate,
                            typeStage = null,
                            teachingMethod = null,
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
                            codeCategory,
                            isCertifying: typeStage === 'Certificat', // TODO constant
                            isRecurrent,
                            durationHours: session_days * 7.5 + session_hours,
                            summary,
                            sessions: sessions.map(
                                ({
                                    uuid: sessionId,
                                    code: sessionCode,
                                    course_name: sessionName,
                                    createdAt: sessionCreationDate,
                                    claro_cursusbundle_session_event,
                                    max_users: maxParticipants,
                                    sessionFormat = null,
                                    sessionLocation = null,
                                    inscriptions,
                                    ...restSessionData
                                }) => ({
                                    ...restSessionData,
                                    id: sessionId,
                                    code: sessionCode,
                                    name: sessionName,
                                    creationDate: sessionCreationDate,
                                    eventDates: claro_cursusbundle_session_event.map(
                                        ({ claro_planned_object: { start_date } }) => start_date
                                    ),
                                    maxParticipants,
                                    sessionFormat,
                                    sessionLocation,
                                    inscriptions: inscriptions.map(
                                        ({
                                            uuid: inscriptionId,
                                            registration_date,
                                            inscriptionStatus,
                                            updatedAt = null,
                                            claro_user: { mail, uuid: userId },
                                            ...restInscriptionData
                                        }) => ({
                                            ...restInscriptionData,
                                            id: inscriptionId,
                                            status: inscriptionStatus,
                                            statusUpdatedAt: updatedAt,
                                            inscriptionDate: registration_date,
                                            user: {
                                                id: userId,
                                                email: mail,
                                            },
                                        })
                                    ),
                                })
                            ),
                        })
                    )

                    // lastStatusChangeDate

                    respondToPeopleSoft(res, renamedFieldsCoursesData ?? 'Aucun cours trouvé')
                }
            }
        }
    },
    null,
    peoplesoftRouter
)
