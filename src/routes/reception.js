import { Router } from 'express'

import { prisma } from '..'
import { createService } from '../utils'

export const receptionRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
        // const getTomorrow = () => {
        //     const tomorrow = new Date()

        //     const tomorrowMs = tomorrow.setDate(tomorrow.getDate() + 1)

        //     return new Date(tomorrowMs).toISOString()
        // }

        const eventsPrisma = await prisma.claro_planned_object.findMany({
            where: {
                start_date: {
                    // gte: new Date().toISOString(),
                    // lte: getTomorrow(),
                    gte: new Date('2022-08-23').toISOString(),
                    lte: new Date('2022-08-24').toISOString(),
                },
            },
            orderBy: [
                {
                    start_date: 'asc',
                },
                {
                    claro_cursusbundle_session_event: {
                        claro_cursusbundle_course_session: {
                            claro_cursusbundle_course: {
                                course_name: 'asc',
                            },
                        },
                    },
                },
            ],
            select: {
                uuid: true,
                start_date: true,
                end_date: true,
                claro_location_room: {
                    select: {
                        event_name: true,
                        description: true,
                    },
                },
                claro_cursusbundle_session_event: {
                    select: {
                        claro_cursusbundle_session_event_user: {
                            where: { registration_type: 'tutor' },
                            select: {
                                claro_user: {
                                    select: {
                                        first_name: true,
                                        last_name: true,
                                    },
                                },
                            },
                        },
                        claro_cursusbundle_course_session: {
                            select: {
                                claro_cursusbundle_course: {
                                    select: {
                                        course_name: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        })
        if (typeof eventsPrisma !== 'undefined') {
            const events = eventsPrisma.map(
                ({ uuid, start_date, end_date, claro_location_room, claro_cursusbundle_session_event, ...rest }) => {
                    let teachers

                    if (claro_cursusbundle_session_event?.claro_cursusbundle_session_event_user) {
                        const { claro_cursusbundle_session_event_user: users } = claro_cursusbundle_session_event

                        teachers = users.map(
                            ({ claro_user: { first_name, last_name } }) => `${first_name} ${last_name}`
                        )
                    }

                    const courseName =
                        claro_cursusbundle_session_event?.claro_cursusbundle_course_session?.claro_cursusbundle_course
                            ?.course_name

                    return {
                        ...rest,
                        id: uuid,
                        start: start_date,
                        end: end_date,
                        roomName: claro_location_room?.event_name,
                        roomFloor: claro_location_room?.description?.replace(/(<([^>]+)>)/gi, ''),
                        teachers,
                        name: courseName,
                    }
                }
            )

            res.json(events)
        } else {
            res.json('Aucunes sessions trouvées')
        }
    },
    null,
    receptionRouter
)
