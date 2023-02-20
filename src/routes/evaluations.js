import { Router } from 'express'

import { createService } from '../utils'

export const evaluationsRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
        try {
            /*const evaluations = await prisma.former22_evaluation.findMany({
                select: {
                    uuid: true,
                    claro_cursusbundle_course_session: {
                        select: {
                            uuid: true,
                            course_name: true,
                            start_date: true,
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
            })*/

            const result = []

            /*const result = subscriptions.map(({ id, claro_user: user, claro_cursusbundle_session_event: event }) => {
                const planned = event.claro_planned_object
                const session = event.claro_cursusbundle_course_session
                const course = session.claro_cursusbundle_course

                const year = Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', year: 'numeric' }).format(
                    session.start_date
                )
                const intYear = Number(year)

                const extendEvent = events.find(({ eventId }) => eventId === event.uuid)
                const contract = contracts.find(
                    ({ courseId, userId, year: _year }) =>
                        courseId === course.uuid && userId === user.uuid && _year === intYear
                )

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

                return {
                    id,
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
                    eventFees: extendEvent ? extendEvent.fees : 0,
                    isFeesPaid: extendEvent ? extendEvent.isFeesPaid : false,
                    contract: contract?.uuid || null,
                }
            })*/

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
    evaluationsRouter
)
