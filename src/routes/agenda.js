import { Router } from 'express'
import { prisma } from '..'
import { createService } from '../utils'

export const agendaRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
        const roomsPrisma = await prisma.claro_location_room.findMany({
            select: {
                event_name: true,
                uuid: true,
                claro__location: {
                    select: {
                        name: true,
                    },
                },
            },
        })

        if (typeof roomsPrisma !== 'undefined') {
            const rooms = roomsPrisma.map(({ event_name, uuid, claro__location }) => ({
                name: event_name,
                id: uuid,
                location: claro__location,
            }))

            const eventsPrisma = await prisma.claro_planned_object.findMany({
                select: {
                    entity_name: true,
                    start_date: true,
                    end_date: true,
                    description: true,
                    claro_location_room: {
                        select: {
                            uuid: true,
                            event_name: true,
                            description: true,
                            capacity: true,
                        },
                    },
                    claro_cursusbundle_session_event: {
                        select: {
                            claro_cursusbundle_session_event_user: {
                                include: {
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
                                    claro_cursusbundle_session_event: {
                                        include: {
                                            claro_planned_object: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            })

            const events = eventsPrisma.map(
                ({
                    entity_name,
                    start_date,
                    end_date,
                    description,
                    claro_location_room,
                    claro_cursusbundle_session_event,
                    uuid,
                    ...rest
                }) => {
                    let studentsCount
                    let teachers

                    if (claro_cursusbundle_session_event?.claro_cursusbundle_session_event_user) {
                        const { claro_cursusbundle_session_event_user: users } = claro_cursusbundle_session_event

                        studentsCount = users.filter(({ registration_type }) => registration_type === 'learner').length
                        teachers = users
                            .filter(({ registration_type }) => registration_type === 'tutor')
                            .map(({ claro_user: { first_name, last_name } }) => `${first_name} ${last_name}`)
                    }

                    const seances =
                        claro_cursusbundle_session_event?.claro_cursusbundle_course_session?.claro_cursusbundle_session_event
                            ?.filter(({ claro_planned_object }) => claro_planned_object.entity_name !== entity_name)
                            ?.map(({ claro_planned_object }) => claro_planned_object.entity_name)

                    return {
                        ...rest,
                        id: uuid,
                        name: entity_name,
                        room: {
                            id: claro_location_room?.uuid,
                            name: claro_location_room?.event_name,
                            description: claro_location_room?.description?.replace(/(<([^>]+)>)/gi, ''),
                            capacity: claro_location_room?.capacity,
                        },
                        start: start_date,
                        end: end_date,
                        description: description?.replace(/(<([^>]+)>)/gi, ''),
                        studentsCount,
                        teachers,
                        seances,
                    }
                }
            )

            res.json({ rooms, events })
        } else {
            res.json('Aucunes salle trouvées')
        }
    },
    null,
    agendaRouter
)
