import { Router } from 'express'
import { sendEmail } from '../sendEmail'
import { createService } from '../utils'
import { winstonLogger } from '../winston'

export const mailRouter = Router()

createService(
    'post',
    '/fail',
    async (req, res) => {
        const content = req.body

        console.log(content)

        res.json(content)
    },
    null,
    mailRouter
)

// TODO send to postal by default - if in suppression list, send to mailgun as well
createService(
    'post',
    '/api/v1/send/message',
    async (req, res) => {
        const { to, from, tag, subject, html_body } = req.body
        const headers = req.headers

        console.info(req.body)
        console.info(req.headers)

        const { emailResponse, mailgunResult } = sendEmail({ to, from, tag, subject, html_body, isFromClaroline: true })

        winstonLogger.info(JSON.stringify(req.body))
        winstonLogger.info(JSON.stringify(headers))
        winstonLogger.info(JSON.stringify(emailResponse))
        winstonLogger.info(JSON.stringify(mailgunResult))

        res.json('email request received and logged, email sent')
    },
    null,
    mailRouter
)
