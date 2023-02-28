import { Router } from 'express'

import { v4 as uuidv4 } from 'uuid'
import { prisma } from '..'
import { authMiddleware, createService } from '../utils'
import { getTemplatePreviews } from './templatesUtils'
import { sendEmail } from '../sendEmail'

export const evaluationsRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
        const evaluations = await prisma.former22_evaluation.findMany({
            select: {
                uuid: true,
                former22_evaluation_template: {
                    select: {
                        uuid: true,
                    },
                },
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
            evaluations.map(({ uuid, former22_evaluation_template, claro_cursusbundle_course_session: session }) => {
                const course = session.claro_cursusbundle_course

                const year = Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', year: 'numeric' }).format(
                    session.start_date
                )

                return {
                    uuid,
                    courseUuid: course.uuid,
                    sessionUuid: session.uuid,
                    templateUuid: former22_evaluation_template.uuid,
                    year,
                    sessionName: session.course_name,
                    courseName: course.course_name,
                }
            })
        )
    },
    null,
    evaluationsRouter,
    authMiddleware
)

createService(
    'get',
    '/sessions',
    async (req, res) => {
        const sessions = await prisma.claro_cursusbundle_course_session.findMany({
            select: {
                uuid: true,
                course_name: true,
            },
            where: {
                former22_evaluation: null,
                hidden: false,
            },
        })

        res.json(sessions ?? 'Aucunes session trouvées')
    },
    null,
    evaluationsRouter,
    authMiddleware
)

createService(
    'get',
    '/:uuid',
    async (req, res) => {
        const evaluation = await prisma.former22_evaluation.findUnique({
            select: {
                uuid: true,
                former22_evaluation_template: {
                    select: {
                        struct: true,
                    },
                },
                claro_cursusbundle_course_session: {
                    select: {
                        course_name: true,
                        start_date: true,
                    },
                },
            },
            where: {
                uuid: req.params.uuid,
            },
        })

        res.json({
            uuid: evaluation.uuid,
            struct: evaluation.former22_evaluation_template.struct,
            sessionName: evaluation.claro_cursusbundle_course_session.course_name,
            date: evaluation.claro_cursusbundle_course_session.start_date,
        })
    },
    null,
    evaluationsRouter
)

createService(
    'post',
    '/',
    async (req, res) => {
        const session = await prisma.claro_cursusbundle_course_session.findUnique({
            select: {
                id: true,
                course_name: true,
                claro__location: {
                    select: {
                        name: true,
                        address_street1: true,
                        address_street2: true,
                        address_postal_code: true,
                        address_state: true,
                        address_city: true,
                        address_country: true,
                    },
                },
            },
            where: {
                uuid: req.body.session,
            },
        })

        const template = await prisma.former22_evaluation_template.findUnique({
            select: {
                id: true,
            },
            where: {
                uuid: req.body.template,
            },
        })

        const evaluation = await prisma.former22_evaluation.upsert({
            create: {
                uuid: uuidv4(),
                sessionId: session.id,
                templateId: template.id,
            },
            update: {
                templateId: template.id,
            },
            where: {
                sessionId: session.id,
            },
        })

        const evaluationLink = new URL(`/evaluations/${evaluation.uuid}`, 'https://localhost:3000').href

        // ##############################################
        // SEND MAILS
        const sessionUsers = await prisma.claro_cursusbundle_course_session_user.findMany({
            select: {
                uuid: true,
                claro_user: {
                    select: {
                        mail: true,
                    },
                },
            },
            where: {
                claro_cursusbundle_course_session: {
                    id: session.id,
                },
                claro_user: {
                    uuid: {
                        in: req.body.users,
                    },
                },
            },
        })

        await Promise.allSettled(
            sessionUsers.map(async (sessionUser) => {
                const { emailContent, emailSubject } = await getTemplatePreviews({
                    req,
                    templateId: req.body.email,
                    sessionId: req.body.session,
                    inscriptionId: sessionUser.uuid,
                    evaluationLink,
                })

                const { emailResponse } = await sendEmail({
                    to: sessionUser.claro_user.mail,
                    subject: emailSubject,
                    html_body: emailContent,
                })
                return { emailResponse }
            })
        )
        // ##############################################

        res.json({
            message: "L'évaluation à été généré avec succès.",
        })
    },
    null,
    evaluationsRouter,
    authMiddleware
)

createService(
    'post',
    '/results',
    async (req, res) => {
        const evaluation = await prisma.former22_evaluation.findUnique({
            select: {
                id: true,
            },
            where: {
                uuid: req.body.evaluation,
            },
        })

        await prisma.former22_evaluation_result.create({
            data: {
                uuid: uuidv4(),
                evaluationId: evaluation.id,
                result: req.body.result,
            },
        })

        res.json({
            message: 'Votre évaluation a bien été envoyée.',
        })
    },
    null,
    evaluationsRouter,
    authMiddleware
)
