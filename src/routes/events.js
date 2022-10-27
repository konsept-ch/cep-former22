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
            const events = await prisma.former22_event.findMany()
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
                            code: true,
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
                                    uuid: true,
                                    course_name: true,
                                    claro_cursusbundle_course: {
                                        select: {
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
                            first_name: true,
                            last_name: true,
                        },
                    },
                },
            })

            /*const eventMap = events.reduce((acc, event) => {
                return {
                    ...acc,
                    [event.eventId]: event,
                }
            })

            const sessionMap = sessions.reduce((acc, session) => {
                return {
                    ...acc,
                    [session.sessionId]: session,
                }
            })

            const courseMap = courses.reduce((acc, course) => {
                return {
                    ...acc,
                    [course.sessionId]: course,
                }
            })

            const relatedSessionMap = subscriptions.reduce(
                (acc, { claro_cursusbundle_session_event: { claro_cursusbundle_course_session: session } }) => {
                    return {
                        ...acc,
                        [session.uuid]: {
                            session,
                        }
                    }
                },
                {}
            )

            const relatedCourseMap = subscriptions.reduce(
                (
                    acc,
                    {
                        claro_cursusbundle_session_event: {
                            claro_cursusbundle_course_session: { claro_cursusbundle_course: course },
                        },
                    }
                ) => {
                    return {
                        ...acc,
                        [course.uuid]: course,
                    }
                },
                {}
            )*/

            const result = subscriptions.map(({ id, claro_user: user, claro_cursusbundle_session_event: event }) => {
                const planned = event.claro_planned_object
                const session = event.claro_cursusbundle_course_session
                const course = session.claro_cursusbundle_course

                const extendEvent = events.find(({ eventId }) => eventId === event.id)
                const extendSession = sessions.find(({ sessionId }) => sessionId === session.id)
                const extendCourse = courses.find(({ courseId }) => courseId === course.id)

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
                    contract: extendCourse ? extendCourse.contract : null,
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
