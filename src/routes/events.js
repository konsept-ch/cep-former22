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
            const contracts = await prisma.former22_contract.findMany({
                select: {
                    uuid: true,
                    userId: true,
                    courseId: true,
                    year: true,
                },
            })

            const courses = await prisma.claro_cursusbundle_course.findMany({
                select: {
                    uuid: true,
                    course_name: true,
                    claro_cursusbundle_course_session: {
                        select: {
                            uuid: true,
                            course_name: true,
                            start_date: true,
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
                                    former22_event: {
                                        select: {
                                            fees: true,
                                            isFeesPaid: true,
                                        },
                                    },
                                },
                            },
                            claro_cursusbundle_course_session_user: {
                                select: {
                                    claro_user: {
                                        select: {
                                            uuid: true,
                                            first_name: true,
                                            last_name: true,
                                        },
                                    },
                                },
                                where: {
                                    registration_type: 'tutor',
                                },
                            },
                        },
                    },
                },
            })

            const result = []

            for (const course of courses) {
                for (const session of course.claro_cursusbundle_course_session) {
                    const year = Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', year: 'numeric' }).format(
                        session.start_date
                    )
                    const intYear = Number(year)

                    for (const event of session.claro_cursusbundle_session_event) {
                        const planned = event.claro_planned_object
                        const date = Intl.DateTimeFormat('fr-CH', {
                            timeZone: 'Europe/Zurich',
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                        }).format(planned.start_date)
                        const startTime = Intl.DateTimeFormat('fr-CH', {
                            timeZone: 'Europe/Zurich',
                            hour: '2-digit',
                            minute: '2-digit',
                        }).format(planned.start_date)
                        const endTime = Intl.DateTimeFormat('fr-CH', {
                            timeZone: 'Europe/Zurich',
                            hour: '2-digit',
                            minute: '2-digit',
                        }).format(planned.end_date)

                        for (const inscription of session.claro_cursusbundle_course_session_user) {
                            const user = inscription.claro_user
                            const contract = contracts.find(
                                ({ courseId, userId, year: _year }) =>
                                    courseId === course.uuid && userId === user.uuid && _year === intYear
                            )

                            result.push({
                                id: result.length,
                                userUuid: user.uuid,
                                eventUuid: event.uuid,
                                courseUuid: course.uuid,
                                sessionUuid: session.uuid,
                                userName: `${user.last_name} ${user.first_name}`,
                                year,
                                date,
                                startTime,
                                endTime,
                                locationName: planned.claro__location?.name,
                                sessionName: session.course_name,
                                courseName: course.course_name,
                                eventFees: event.former22_event?.fees || 0,
                                isFeesPaid: event.former22_event?.isFeesPaid || false,
                                contract: contract?.uuid || null,
                            })
                        }
                    }
                }
            }

            res.json(result)
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
