import { Router } from 'express'
import { customAlphabet } from 'nanoid'

import { prisma } from '..'
import { sendEmail } from '../sendEmail'
import { checkAuth, createService, delay } from '../utils'

const nanoid = customAlphabet('1234567890', 6)

export const authRouter = Router()

createService(
    'post',
    '/sendCode',
    async (req, res) => {
        const email = req.body.email?.trim()

        const code = nanoid() //=> "123456"

        const sendTimestamp = Date.now()

        await prisma.former22_auth_codes.upsert({
            where: { email },
            update: { code, sendTimestamp },
            create: { email, code, sendTimestamp },
        })

        await sendEmail({
            to: email,
            subject: 'Auth code',
            html_body: `<h2>Auth code</h2><p>${code}</p>`,
        })

        res.json({ isCodeSendingSuccessful: true })
    },
    null,
    authRouter
)

createService(
    'post',
    '/checkCodeAndToken',
    async (req, res) => {
        await delay(50)

        const email = req.body.email?.trim()
        const token = req.body.token?.trim()
        const code = req.body.code?.trim()

        const isAuthenticated = await checkAuth({ email, code, token })

        res.json({ areCodeAndTokenCorrect: isAuthenticated })
    },
    null,
    authRouter
)
