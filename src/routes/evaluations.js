import { Router } from 'express'

import { prisma } from '..'
import { createService } from '../utils'

export const evaluationsRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
        try {
            const evaluations = await prisma.former22_evaluation.findMany({
                select: {
                    uuid: true,
                    claro_cursusbundle_course_session: {
                        select: {
                            uuid: true,
                            course_name: true,
                            start_date: true,
                            claro_cursusbundle_course: {
                                select: {
                                    uuid: true,
                                    course_name: true,
                                },
                            },
                        },
                    },
                },
            })

            res.json(
                evaluations.map(({ uuid, claro_cursusbundle_course_session: session }) => {
                    const course = session.claro_cursusbundle_course

                    const year = Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', year: 'numeric' }).format(
                        session.start_date
                    )

                    return {
                        uuid,
                        courseUuid: course.uuid,
                        sessionUuid: session.uuid,
                        year,
                        sessionName: session.course_name,
                        courseName: course.course_name,
                    }
                })
            )
        } catch (error) {
            console.error(error)
            return -1
        }
    },
    null,
    evaluationsRouter
)
