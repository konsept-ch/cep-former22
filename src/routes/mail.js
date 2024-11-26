import { Router } from 'express'

import { sendEmail } from '../sendEmail'
import { createService } from '../utils'

export const mailRouter = Router()

createService(
    'post',
    '/fail',
    async (req, res) => {
        const content = req.body

        console.info(content)

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
        const { to, cc, bcc, from, tag, subject, html_body } = req.body

        await sendEmail({
            to,
            cc,
            bcc,
            from,
            tag,
            subject,
            html_body,
            isFromClaroline: true,
        })

        res.json('email request received and logged, email sent')
    },
    null,
    mailRouter
)
