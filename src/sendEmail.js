import fetch from 'node-fetch'
import FormData from 'form-data'
import Mailgun from 'mailgun.js'
import nodemailer from 'nodemailer'

import {
    mailerHostUrl,
    mailerApiKey,
    mailerTag,
    mailerFrom,
    mailerApiKeyClaroline,
    mailgunApiKey,
    mailgunDomain,
    mailgunWhitelist,
    useMailhog,
    mailhogHost,
    mailhogPort,
} from './credentialsConfig'

const mailgun = new Mailgun(FormData)

const mailgunClient = mailgun.client({ username: 'api', key: mailgunApiKey, url: 'https://api.eu.mailgun.net' })

const postalSuppressedDomains = mailgunWhitelist.split(',')

export const sendEmail = async ({
    to,
    cc,
    bcc,
    from = mailerFrom,
    tag = mailerTag,
    subject,
    html_body,
    isFromClaroline = false,
}) => {
    // destination will always be only one e-mail address, so it's an array of 1 string,
    // but Claroline sends it as a nested array, so we flatten it here
    const destinations = typeof to === 'string' ? [to] : to?.flat()
    const destinationsCc = typeof cc === 'string' ? [cc] : cc?.flat()
    const destinationsBcc = typeof bcc === 'string' ? [bcc] : bcc?.flat()

    if (useMailhog) {
        // Use local MailHog SMTP so we don't call external services in development
        const transporter = nodemailer.createTransport({
            host: mailhogHost,
            port: mailhogPort,
            secure: false,
        })

        const mailhogResponse = await transporter.sendMail({
            from,
            to: destinations,
            cc: destinationsCc,
            bcc: destinationsBcc,
            subject,
            html: html_body,
            headers: { 'X-Tag': tag },
        })

        return { emailResponse: mailhogResponse }
    }

    const result = await fetch(`${mailerHostUrl}/api/v1/send/message`, {
        method: 'post',
        headers: {
            'X-Server-API-Key': isFromClaroline ? mailerApiKeyClaroline : mailerApiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to: destinations,
            cc: destinationsCc,
            bcc: destinationsBcc,
            subject,
            html_body,
            tag,
        }),
    })

    const responseText = await result.text()
    const contentType = result.headers.get('content-type') ?? ''
    let emailResponse

    if (responseText) {
        if (contentType.includes('application/json')) {
            try {
                emailResponse = JSON.parse(responseText)
            } catch (error) {
                throw new Error(
                    `Mailer returned invalid JSON. Status: ${
                        result.status
                    }. Content-Type: ${contentType}. Body: ${responseText.slice(0, 500)}`
                )
            }
        } else {
            emailResponse = {
                status: result.status,
                contentType,
                body: responseText,
            }
        }
    } else {
        emailResponse = {
            status: result.status,
            contentType,
            body: '',
        }
    }

    if (!result.ok) {
        throw new Error(
            `Mailer request failed. Status: ${result.status}. Content-Type: ${contentType}. Body: ${responseText.slice(
                0,
                500
            )}`
        )
    }

    // TODO use debug logging instead of console.log

    // eslint-disable-next-line no-console
    console.info(emailResponse)

    // TODO: refactor to split logic between to, cc and bcc
    if (
        postalSuppressedDomains.some(
            (domain) =>
                destinations?.some((destination) => destination.includes(domain)) ||
                destinationsCc?.some((destination) => destination.includes(domain)) ||
                destinationsBcc?.some((destination) => destination.includes(domain))
        )
    ) {
        try {
            const mailgunResult = await mailgunClient.messages.create(mailgunDomain, {
                from,
                to: destinations,
                cc: destinationsCc,
                bcc: destinationsBcc,
                subject,
                html: html_body,
            })

            // eslint-disable-next-line no-console
            console.info(`E-mail domain is in suppression list, mailgun used: ${to.join(', ')}`)
            // eslint-disable-next-line no-console
            console.info(mailgunResult)

            return { emailResponse, mailgunResult }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(error)
            return { emailResponse, mailgunResult: error.message }
        }
    } else {
        return { emailResponse }
    }
}
