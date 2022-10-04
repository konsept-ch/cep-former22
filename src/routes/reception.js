import { Router } from 'express'

import { prisma } from '..'
import { createService, addHours } from '../utils'

export const receptionRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
        const currentDateTime = new Date() // pass '2022-09-29T11:00:00' to show events, if none are displayed

        const eventsPrisma = await prisma.claro_planned_object.findMany({
            where: {
                start_date: {
                    lte: addHours({
                        numOfHours: 1.5, // start showing events an hour and a half before they start
                        oldDate: currentDateTime,
                    }).toISOString(),
                },
                end_date: {
                    gte: currentDateTime.toISOString(),
                },
                claro__location: {
                    name: {
                        equals: 'CEP',
                    },
                },
                NOT: {
                    claro_location_room: null,
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
                entity_name: true,
                description: true,
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
                ({
                    uuid,
                    entity_name,
                    description,
                    start_date,
                    end_date,
                    claro_location_room,
                    claro_cursusbundle_session_event,
                    ...rest
                }) => ({
                    ...rest,
                    id: uuid,
                    start: start_date,
                    end: end_date,
                    roomName: claro_location_room?.event_name,
                    roomFloor: claro_location_room?.description?.replace(/(<([^>]+)>)/gi, ''),
                    tutors: claro_cursusbundle_session_event?.claro_cursusbundle_session_event_user?.map(
                        ({ claro_user: { first_name, last_name } }) => ({
                            firstName: first_name,
                            lastName: last_name,
                        })
                    ),
                    name:
                        claro_cursusbundle_session_event?.claro_cursusbundle_course_session?.claro_cursusbundle_course
                            ?.course_name ?? entity_name,
                    description: description?.replace(/(<([^>]+)>)/gi, ''),
                })
            )

            res.json(events)
        } else {
            res.json('Aucunes sessions trouvées')
        }
    },
    null,
    receptionRouter
)
