import { Router } from 'express'
import convert from 'xml-js'

import { callApi, CLAROLINE_TOKEN, PEOPLESOFT_TOKEN } from '../callApi'
import { createService } from '../utils'
import { prisma } from '..'
import { fetchInscriptionsWithStatuses } from './inscriptionsUtils'

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
 *     summary: Retourne la liste des formations
 *     tags: [Formations]
 *     description: Liste des formations proposées par le CEP
 *     parameters:
 *       - name: X-Former22-API-Key
 *         in: header
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: La liste des formations a été retourné avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Course'
 *           application/xml:
 *             schema:
 *               type: object
 *               xml:
 *                 name: formations
 *               properties:
 *                 formation:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Course'
 */
createService(
    'get',
    '/formations',
    async (req, res) => {
        const token = req.header(PEOPLESOFT_TOKEN) ?? req.query.apitoken

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

                    const fullCoursesData = courses.map((course) => ({
                        ...course,
                        ...coursesAdditionalData.find(({ courseId }) => courseId === course.uuid),
                        sessions: course.claro_cursusbundle_course_session.map((session) => ({
                            ...session,
                            ...sessionsAdditionalData.find(({ sessionId }) => sessionId === session.uuid),
                            // eslint-disable-next-line no-undefined -- unset courseId
                            sessionId: undefined,
                        })),
                        // eslint-disable-next-line no-undefined -- unset courseId
                        courseId: undefined,
                        // eslint-disable-next-line no-undefined -- unset courseId
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
                            isCertifying: typeStage === 'Certificat',
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
                                    claro_cursusbundle_course_session_user: inscriptions,
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
                                            claro_user: { mail, uuid: userId },
                                            ...restInscriptionData
                                        }) => ({
                                            ...restInscriptionData,
                                            id: inscriptionId,
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
