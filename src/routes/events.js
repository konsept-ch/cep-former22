import { Router } from 'express'
import libre from 'libreoffice-convert'
import util from 'util'

import { prisma } from '..'
import { createService } from '../utils'

libre.convertAsync = util.promisify(libre.convert)

export const eventsRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
        try {
            const events = await prisma.former22_event.findMany({
                select: {
                    eventId: true,
                    isFeesPaid: true,
                },
            })
            const sessions = await prisma.former22_session.findMany({
                select: {
                    sessionId: true,
                    fees: true,
                },
            })
            const courses = await prisma.former22_course.findMany({
                select: {
                    courseId: true,
                    former22_contract: true,
                },
            })

            const subscriptions = await prisma.claro_cursusbundle_session_event_user.findMany({
                where: {
                    registration_type: 'tutor',
                },
                select: {
                    id: true,
                    claro_cursusbundle_session_event: {
                        select: {
                            uuid: true,
                            claro_planned_object: {
                                select: {
                                    start_date: true,
                                    end_date: true,
                                    claro__location: {
                                        select: {
                                            name: true,
                                        },
                                    },
                                },
                            },
                            claro_cursusbundle_course_session: {
                                select: {
                                    id: true,
                                    uuid: true,
                                    course_name: true,
                                    claro_cursusbundle_course: {
                                        select: {
                                            id: true,
                                            uuid: true,
                                            course_name: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    claro_user: {
                        select: {
                            id: true,
                            first_name: true,
                            last_name: true,
                        },
                    },
                },
            })

            /*const eventMap = events.reduce((acc, event) => acc.set(event.eventId, event), new Map())
            const sessionMap = sessions.reduce((acc, session) => acc.set(session.sessionId, session), new Map())
            const courseMap = courses.reduce((acc, course) => acc.set(course.courseId, course), new Map())*/

            /*const relatedSessionMap = new Map()
            for (const {
                claro_cursusbundle_session_event: {
                    uuid,
                    claro_planned_object: { start_date, end_date },
                    claro_cursusbundle_course_session: session,
                },
            } of subscriptions) {
                if (!relatedSessionMap.has(session.id)) {
                    relatedSessionMap.set(session.id, {
                        uuid: session.uuid,
                        name: session.course_name,
                        events: [],
                    })
                }
                relatedSessionMap.get(session.id).events.push({
                    uuid,
                    start_date,
                    end_date,
                })
            }

            const relatedCourseMap = new Map()
            for (const {
                claro_cursusbundle_session_event: {
                    claro_cursusbundle_course_session: { id, claro_cursusbundle_course: course },
                },
            } of subscriptions) {
                if (!relatedCourseMap.has(course.id)) {
                    relatedCourseMap.set(course.id, {
                        uuid: course.uuid,
                        name: course.course_name,
                        sessions: [],
                    })
                }
                relatedCourseMap.get(course.id).sessions.push(relatedSessionMap.get(id))
            }

            const relatedUserMap = new Map()
            for (const {
                claro_user: user,
                claro_cursusbundle_session_event: {
                    claro_cursusbundle_course_session: { claro_cursusbundle_course: course },
                },
            } of subscriptions) {
                if (!relatedUserMap.has(user.id)) {
                    relatedUserMap.set(user.id, {
                        uuid: user.uuid,
                        firstname: user.first_name,
                        lastname: user.last_name,
                        courses: [],
                    })
                }
                relatedUserMap.get(user.id).courses.push(relatedCourseMap.get(course.id))
            }
            const result = Array.from(relatedUserMap.values())*/

            const result = subscriptions.map(({ id, claro_user: user, claro_cursusbundle_session_event: event }) => {
                const planned = event.claro_planned_object
                const session = event.claro_cursusbundle_course_session
                const course = session.claro_cursusbundle_course

                const extendEvent = events.find(({ eventId }) => eventId === event.uuid)
                const extendSession = sessions.find(({ sessionId }) => sessionId === session.uuid)
                const extendCourse = courses.find(({ courseId }) => courseId === course.uuid)

                const date = Intl.DateTimeFormat('fr-CH', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
                    planned.start_date
                )
                const startTime = Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit' }).format(
                    planned.start_date
                )
                const endTime = Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit' }).format(
                    planned.end_date
                )

                return {
                    id,
                    userUuid: user.uuid,
                    eventUuid: event.uuid,
                    courseUuid: course.uuid,
                    sessionUuid: session.uuid,
                    userName: `${user.last_name} ${user.first_name}`,
                    date,
                    startTime,
                    endTime,
                    locationName: planned.claro__location?.name,
                    sessionName: session.course_name,
                    courseName: course.course_name,
                    fees: extendSession ? extendSession.fees : 0,
                    isFeesPaid: extendEvent ? extendEvent.isFeesPaid : false,
                    contract: extendCourse ? extendCourse.former22_contract : null,
                }
            })

            if (result.length > 0) {
                res.json(result)
            } else if (result === -1) {
                res.status(500).json('Erreur')
            } else {
                res.json('Aucune inscription trouvée')
            }
        } catch (error) {
            console.error(error)
            return -1
        }
    },
    null,
    eventsRouter
)

createService(
    'put',
    '/:eventId',
    async (req, res) => {
        const eventId = req.params.eventId

        try {
            await prisma.former22_event.upsert({
                where: { eventId },
                update: { ...req.body },
                create: { eventId, ...req.body },
            })
            res.json(true)
        } catch (error) {
            console.error(error)
            return -1
        }
    },
    null,
    eventsRouter
)
