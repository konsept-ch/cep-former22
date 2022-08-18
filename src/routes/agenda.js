import { Router } from 'express'

import { prisma } from '..'
import { createService } from '../utils'

export const agendaRouter = Router()

createService(
    'get',
    '/',
    async (_req, res) => {
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
                    claro__location: {
                        select: {
                            name: true,
                        },
                    },
                    claro_user: {
                        select: {
                            first_name: true,
                            last_name: true,
                            mail: true,
                        },
                    },
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
                                    max_users: true,
                                    claro_cursusbundle_course: {
                                        select: {
                                            uuid: true,
                                        },
                                    },
                                    claro_cursusbundle_course_session_user: {
                                        where: {
                                            validated: true,
                                            registration_type: 'learner',
                                        },
                                        select: {
                                            uuid: true,
                                        },
                                    },
                                    claro_cursusbundle_session_event: {
                                        include: {
                                            claro_planned_object: {
                                                select: {
                                                    entity_name: true,
                                                    start_date: true,
                                                    claro__location: {
                                                        select: {
                                                            name: true,
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            })

            // TODO: use foreign key for courses instead of additional request
            const coursesFormer22Data = await prisma.former22_course.findMany({
                select: {
                    courseId: true,
                    coordinator: true, // TODO: use user uuid to save coordinator, perhaps foreign key
                },
            })

            const usersFormer22Data = await prisma.former22_user.findMany({
                select: {
                    userId: true,
                    colorCode: true,
                },
            })

            // TODO: foreign keys
            const allUsers = await prisma.claro_user.findMany({
                select: {
                    uuid: true,
                    first_name: true,
                    last_name: true,
                    claro_user_role: {
                        select: {
                            claro_role: {
                                select: {
                                    translation_key: true,
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
                    claro_user: { first_name: firstName, last_name: lastName, mail: email },
                    uuid,
                    // eslint-disable-next-line no-unused-vars
                    // claro__location: _claro__location,
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

                    const coordinator = coursesFormer22Data.find(
                        ({ courseId }) =>
                            courseId ===
                            claro_cursusbundle_session_event?.claro_cursusbundle_course_session
                                ?.claro_cursusbundle_course?.uuid
                    )?.coordinator

                    const coordinatorUuid = allUsers.find(
                        ({ first_name, last_name, claro_user_role }) =>
                            `${first_name} ${last_name}` === coordinator &&
                            claro_user_role.some(({ claro_role: { translation_key } }) => translation_key === 'admin')
                    )?.uuid

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
                        sessionInscriptionsCount:
                            claro_cursusbundle_session_event?.claro_cursusbundle_course_session
                                ?.claro_cursusbundle_course_session_user.length,
                        sessionMaxUsers: claro_cursusbundle_session_event?.claro_cursusbundle_course_session?.max_users,
                        start: start_date,
                        end: end_date,
                        description: description?.replace(/(<([^>]+)>)/gi, ''),
                        studentsCount,
                        teachers,
                        seances,
                        isFirstPhysical:
                            // TODO: can we optimize calculating isFirstPhysical?
                            claro_cursusbundle_session_event?.claro_cursusbundle_course_session?.claro_cursusbundle_session_event
                                .sort(
                                    (
                                        { claro_planned_object: { start_date: a } },
                                        { claro_planned_object: { start_date: b } }
                                    ) => a - b
                                )
                                .find(
                                    ({ claro_planned_object: { claro__location } }) => claro__location?.name === 'CEP'
                                )?.claro_planned_object?.entity_name === entity_name,
                        creator: { firstName, lastName, email },
                        coordinator,
                        coordinatorColorCode: usersFormer22Data.find(({ userId }) => userId === coordinatorUuid)
                            ?.colorCode,
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
