import { Router } from 'express'
import { customAlphabet } from 'nanoid'

import { prisma } from '..'
import { callApi, CLAROLINE_TOKEN } from '../callApi'
import { sendEmail } from '../sendEmail'
import { createService, delay } from '../utils'

const nanoid = customAlphabet('1234567890', 6)

export const authRouter = Router()

createService(
    'post',
    '/sendCode',
    async (req, res) => {
        await delay(200)

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
        await delay(200)

        const email = req.body.email?.trim()
        const token = req.body.token?.trim()
        const code = req.body.code?.trim()

        const authPair = await prisma.former22_auth_codes.findUnique({
            where: { email },
            select: { code: true },
        })
        const doesCodeMatch = authPair?.code === code

        if (doesCodeMatch) {
            const apitokenResponse = await callApi({ req, path: 'apitoken', headers: { [CLAROLINE_TOKEN]: token } })

            const doesTokenExist = apitokenResponse?.some?.(
                ({ token: existingToken, user: { email: associatedEmail } }) =>
                    existingToken === token && associatedEmail === email
            )

            res.json({ areCodeAndTokenCorrect: doesTokenExist })
        } else {
            res.json({ areCodeAndTokenCorrect: false })
        }
    },
    null,
    authRouter
)
