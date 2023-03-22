import { Router } from 'express'

import { v4 as uuidv4 } from 'uuid'
import { prisma } from '..'
import { authMiddleware, createService } from '../utils'
import { getTemplatePreviews } from './templatesUtils'
import { STATUSES } from './inscriptionsUtils'
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
                    link: new URL(`/evaluations/${uuid}`, process.env.EVALUATIONS_URL).href,
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
            claro_cursusbundle_course_session: session,
            former22_evaluation_template: { struct },
            former22_evaluation_result: results,
        } = await prisma.former22_evaluation.findUnique({
            select: {
                claro_cursusbundle_course_session: {
                    select: {
                        id: true,
                        course_name: true,
                        claro_cursusbundle_course_session_user: {
                            select: {
                                uuid: true,
                            },
                            where: {
                                registration_type: 'learner',
                            },
                        },
                    },
                },
                former22_evaluation_template: {
                    select: {
                        struct: true,
                    },
                },
                former22_evaluation_result: {
                    select: {
                        result: true,
                    },
                },
            },
            where: {
                uuid: req.params.uuid,
            },
        })

        const participantCount = (
            await prisma.former22_inscription.findMany({
                select: {
                    inscriptionId: true,
                },
                where: {
                    inscriptionId: {
                        in: session.claro_cursusbundle_course_session_user.map((su) => su.uuid),
                    },
                    inscriptionStatus: STATUSES.PARTICIPATION,
                },
            })
        ).length

        const statistics = results.reduce((acc, result) => {
            //eslint-disable-next-line no-plusplus
            for (const key in result.result) if (acc[key]) ++acc[key][result.result[key]]
            return acc
        }, Object.fromEntries(struct.filter((block) => block.type === 'notes').map((block) => [block.identifier, Object.fromEntries(block.notes.map((note) => [note, 0]))])))

        // ##############################################
        // GENERATE PDF
        const doc = await PDFDocument.create({})
        const font = await doc.embedFont(StandardFonts.Helvetica)

        let page = doc.addPage()

        const margin = { x: 50, y: 30 }
        const maxWidth = page.getWidth() - (margin.x << 1)
        const mr = margin.x + maxWidth

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

        const drawHLine = (y, x0, x1) => {
            page.drawLine({
                start: { x: x0, y },
                end: { x: x1, y },
                thickness: 1,
                color: rgb(106 / 255, 97 / 255, 91 / 255),
                opacity: 0.25,
            })
        }

        const drawVLine = (x, y0, y1) => {
            page.drawLine({
                start: { x, y: y0 },
                end: { x, y: y1 },
                thickness: 1,
                color: rgb(106 / 255, 97 / 255, 91 / 255),
                opacity: 0.25,
            })
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
                const h = font.heightAtSize(12),
                    h1 = h >> 1,
                    h2 = h << 1,
                    h4 = h2 << 1

                checkAddingPage(countLines(block.text, 12) * font.heightAtSize(18) + h + block.notes.length * h2)
                drawText(block.text)

                const t = page.getY(),
                    th1 = t - h1,
                    th3 = th1 - h2,
                    b = t - h4

                page.drawRectangle({
                    x: margin.x,
                    y: t - h2,
                    width: maxWidth,
                    height: h2,
                    color: rgb(0.9, 0.9, 0.9),
                })

                //eslint-disable-next-line no-plusplus
                for (let i = 0; i < 3; ++i) drawHLine(t - h2 * i, margin.x, mr)
                drawVLine(mr, t, b)
                page.moveTo(mr, th1)

                const extra = {
                    'Nbr participants': `${participantCount}`,
                    'Total réponses': `${Object.values(statistics[block.identifier]).reduce((sum, n) => sum + n, 0)}`,
                }
                for (const key in extra) {
                    const value = extra[key]
                    const kw = font.widthOfTextAtSize(key, 12)
                    const fw = kw + h2
                    const vcw = font.widthOfTextAtSize(value, 12) >> 1
                    const fcw = fw >> 1
                    const x = page.getX() - fw

                    page.moveTo(x + fcw - (kw >> 1), th1)
                    drawText(key)

                    page.moveTo(x + fcw - vcw, th3)
                    drawText(value)

                    page.moveTo(x, th3)
                    drawVLine(x, t, b)
                }

                const cw = (page.getX() - margin.x) / block.notes.length
                const ccw = cw >> 1
                //eslint-disable-next-line no-plusplus
                for (let i = 0; i < block.notes.length; ++i) drawVLine(margin.x + cw * i, t, b)

                //eslint-disable-next-line no-plusplus
                for (let i = 0; i < block.notes.length; ++i) {
                    const note = block.notes[i]
                    page.moveTo(margin.x + cw * i + ccw - (font.widthOfTextAtSize(note, 12) >> 1), th1)
                    drawText(note)
                }

                //eslint-disable-next-line no-plusplus
                for (let i = 0; i < block.notes.length; ++i) {
                    const result = `${statistics[block.identifier][block.notes[i]]}`
                    page.moveTo(margin.x + cw * i + ccw - (font.widthOfTextAtSize(result, 12) >> 1), th3)
                    drawText(result)
                }

                page.moveTo(margin.x, t)
                moveDown(h4 + 20)
            },
            remark: (block) => {
                const responses = results
                    .filter(({ result }) => result[block.identifier])
                    .map(({ result }) => ` -\t${result[block.identifier]}`)
                    .join('\n')
                const h = font.heightAtSize(12),
                    h2 = h << 1,
                    hl = font.heightAtSize(18),
                    hb = (countLines(responses, 12) + 1) * hl

                checkAddingPage(countLines(block.text, 12) * hl + hb + h)
                drawText(block.text, 0, 18)

                const t = page.getY()
                page.drawRectangle({
                    x: margin.x,
                    y: t,
                    width: maxWidth,
                    height: -hb,
                    color: rgb(0.98, 0.98, 0.98),
                })
                drawText(responses)
                moveDown(h2)
            },
        }

        page.moveTo(margin.x, page.getHeight() - margin.y)

        drawText(`Date de création: ${new Date().toLocaleString('fr', { timeZone: 'Europe/Zurich' })}`)
        page.drawLine({
            start: { x: margin.x, y: page.getY() },
            end: { x: margin.x + maxWidth, y: page.getY() },
            thickness: 1,
            color: rgb(120 / 255, 165 / 255, 182 / 255),
            opacity: 1,
        })
        page.moveDown(20)

        drawText(session.course_name, 20, 24, 24, rgb(165 / 255, 159 / 255, 155 / 255))

        for (const block of struct) blockRenders[block.type](block)

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
