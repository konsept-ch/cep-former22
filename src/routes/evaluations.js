import { Router } from 'express'

import { v4 as uuidv4 } from 'uuid'
import { prisma } from '..'
import { authMiddleware, createService } from '../utils'
import { getTemplatePreviews } from './templatesUtils'
import { sendEmail } from '../sendEmail'
import { PDFDocument, rgb, StandardFonts, breakTextIntoLines } from 'pdf-lib'

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
    '/:uuid/export',
    async (req, res) => {
        const {
            id,
            former22_evaluation_template: { struct },
        } = await prisma.former22_evaluation.findUnique({
            select: {
                id: true,
                former22_evaluation_template: {
                    select: {
                        struct: true,
                    },
                },
            },
            where: {
                uuid: req.params.uuid,
            },
        })

        const results = await prisma.former22_evaluation_result.findMany({
            select: {
                result: true,
            },
            where: {
                former22_evaluation: {
                    id,
                },
            },
        })

        const notes = struct.filter((block) => block.type === 'notes')

        const statistics = results.reduce((acc, result) => {
            //eslint-disable-next-line no-plusplus
            for (const key in result.result) if (acc[key]) ++acc[key][result.result[key]]
            return acc
        }, Object.fromEntries(notes.map((block) => [block.identifier, Object.fromEntries(block.notes.map((note) => [note, 0]))])))

        // ##############################################
        // GENERATE PDF
        const doc = await PDFDocument.create({})
        const font = await doc.embedFont(StandardFonts.Helvetica)

        let page = doc.addPage()

        const margin = { x: 50, y: 30 }
        const maxWidth = page.getWidth() - (margin.x << 1)

        const countLines = (text, size) =>
            breakTextIntoLines(text, doc.defaultWordBreaks, maxWidth, (t) => font.widthOfTextAtSize(t, size)).length

        const checkAddingPage = (dy) => {
            if (page.getY() - dy > margin.y) return false
            page = doc.addPage()
            page.moveTo(margin.x, page.getHeight() - margin.y)
            return true
        }

        const moveDown = (dy) => {
            checkAddingPage(dy)
            page.moveDown(dy)
        }

        const leftChart =
            margin.x +
            Math.max(
                ...notes
                    .reduce((acc, block) => [...acc, ...block.notes], [])
                    .map((note) => font.widthOfTextAtSize(note, 12))
            ) +
            20

        const cellWidth = (maxWidth - leftChart) / results.length

        const drawText = (
            text,
            marginBottom = 0,
            lineHeight = 18,
            size = 12,
            color = rgb(106 / 255, 97 / 255, 91 / 255)
        ) => {
            const dy0 = font.heightAtSize(size)
            moveDown(dy0)
            const dy1 = countLines(text, size) * font.heightAtSize(lineHeight) + marginBottom
            if (checkAddingPage(dy1)) page.moveDown(dy0)
            page.drawText(text, {
                size,
                lineHeight,
                color,
                maxWidth,
            })
            page.moveDown(dy1)
        }

        const blockRenders = {
            title: (block) => {
                const style = {
                    h1: { size: 24, color: rgb(165 / 255, 159 / 255, 155 / 255) },
                    h2: { size: 20, color: rgb(120 / 255, 165 / 255, 182 / 255) },
                    h3: { size: 18, color: rgb(120 / 255, 165 / 255, 182 / 255) },
                    h4: { size: 16, color: rgb(120 / 255, 159 / 255, 155 / 255) },
                    h5: { size: 14, color: rgb(120 / 255, 165 / 255, 182 / 255) },
                    h6: { size: 12, color: rgb(120 / 255, 165 / 255, 182 / 255) },
                }[block.tag]
                drawText(block.text, 0, style.size, style.size, style.color)
            },
            paragraph: (block) => {
                drawText(block.text, 20)
            },
            notes: (block) => {
                drawText(block.text)

                const t = page.getY()

                const h = font.heightAtSize(12)
                const hh = h << 1

                let b = t + h

                checkAddingPage(t + h - block.notes.length * hh)

                for (const note of block.notes) {
                    drawText(note, 0, 12)

                    b -= hh

                    page.drawRectangle({
                        x: leftChart,
                        y: b,
                        width: cellWidth * statistics[block.identifier][note],
                        height: h,
                        color: rgb(Math.random(), Math.random(), Math.random()),
                    })
                }

                //eslint-disable-next-line no-plusplus
                for (let i = 0, x = leftChart; i <= results.length; ++i, x += cellWidth) {
                    page.drawLine({
                        start: { x, y: t },
                        end: { x, y: b },
                        thickness: 1,
                        color: rgb(106 / 255, 97 / 255, 91 / 255),
                        opacity: 0.25,
                    })
                    const label = `${i}`
                    page.drawText(label, {
                        x: x - (font.widthOfTextAtSize(label, 12) >> 1),
                        y: b - h - 5,
                        size: 12,
                        color: rgb(106 / 255, 97 / 255, 91 / 255),
                    })
                }

                page.drawLine({
                    start: { x: leftChart, y: b },
                    end: { x: maxWidth, y: b },
                    thickness: 1,
                    color: rgb(106 / 255, 97 / 255, 91 / 255),
                    opacity: 0.25,
                })

                moveDown(20)
            },
            remark: (block) => {
                drawText(block.text, 20)
            },
        }

        page.moveTo(margin.x, page.getHeight() - margin.y)

        drawText(`Date de création: ${new Date().toLocaleString()}`)
        page.drawLine({
            start: { x: margin.x, y: page.getY() },
            end: { x: margin.x + maxWidth, y: page.getY() },
            thickness: 1,
            color: rgb(120 / 255, 165 / 255, 182 / 255),
            opacity: 1,
        })
        page.moveDown(20)

        for (const block of struct) {
            blockRenders[block.type](block)
        }

        res.type('pdf')
        res.set('Content-disposition', `filename=${req.params.uuid}`)
        res.send(Buffer.from(await doc.save(), 'binary'))
        // ##############################################
    },
    null,
    evaluationsRouter
    //authMiddleware
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

        const evaluationLink = new URL(`/evaluations/${evaluation.uuid}`, process.env.EVALUATIONS_URL).href

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
    '/:uuid/result',
    async (req, res) => {
        const evaluation = await prisma.former22_evaluation.findUnique({
            select: {
                id: true,
            },
            where: {
                uuid: req.params.uuid,
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
    evaluationsRouter
)
