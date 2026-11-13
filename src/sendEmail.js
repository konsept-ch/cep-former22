import fetch from 'node-fetch'
import FormData from 'form-data'
import Mailgun from 'mailgun.js'

import {
    mailerHostUrl,
    mailerApiKey,
    mailerTag,
    mailerFrom,
    mailerApiKeyClaroline,
    mailgunApiKey,
    mailgunDomain,
    mailgunWhitelist,
    hasMailerHostUrlOverride,
    isProduction,
} from './credentialsConfig'
import { normalizePostalAttachments, toMailgunAttachments } from './helpers/postalAttachments'

const mailgun = new Mailgun(FormData)

const postalSuppressedDomains = mailgunWhitelist.split(',')

const buildMockEmailResponse = ({ from, to, cc, bcc, subject, tag, attachments }) => ({
    mock: true,
    accepted: true,
    from,
    to,
    cc,
    bcc,
    subject,
    tag,
    attachments: attachments.map(({ name }) => name),
})

export const sendEmail = async ({
    to,
    cc,
    bcc,
    from = mailerFrom,
    tag = mailerTag,
    subject,
    html_body,
    attachments: rawAttachments,
    isFromClaroline = false,
}) => {
    const attachments = normalizePostalAttachments(rawAttachments)
    // destination will always be only one e-mail address, so it's an array of 1 string,
    // but Claroline sends it as a nested array, so we flatten it here
    const destinations = typeof to === 'string' ? [to] : to?.flat()
    const destinationsCc = typeof cc === 'string' ? [cc] : cc?.flat()
    const destinationsBcc = typeof bcc === 'string' ? [bcc] : bcc?.flat()

    if (!isProduction && !hasMailerHostUrlOverride) {
        const emailResponse = buildMockEmailResponse({
            from,
            to: destinations,
            cc: destinationsCc,
            bcc: destinationsBcc,
            subject,
            tag,
            attachments,
        })

        const attachmentNames = attachments.length > 0 ? ` [${emailResponse.attachments.join(', ')}]` : ''

        // eslint-disable-next-line no-console
        console.info(
            `[mailer:mock] ${subject ?? '(no subject)'} -> ${
                destinations?.join(', ') ?? '(no recipient)'
            }${attachmentNames}`
        )

        return { emailResponse }
    }

    let emailResponse

    try {
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
                attachments: attachments.length > 0 ? attachments : undefined,
            }),
        })

        emailResponse = await result.json()
    } catch (error) {
        if (!isProduction) {
            // eslint-disable-next-line no-console
            console.warn(`[mailer:mock-fallback] ${error.message}`)

            return {
                emailResponse: buildMockEmailResponse({
                    from,
                    to: destinations,
                    cc: destinationsCc,
                    bcc: destinationsBcc,
                    subject,
                    tag,
                    attachments,
                }),
            }
        }

        throw error
    }

    // TODO use debug logging instead of console.log

    // TODO: refactor to split logic between to, cc and bcc
    if (
        postalSuppressedDomains.some(
            (domain) =>
                destinations?.some((destination) => destination.includes(domain)) ||
                destinationsCc?.some((destination) => destination.includes(domain)) ||
                destinationsBcc?.some((destination) => destination.includes(domain))
        )
    ) {
        if (!mailgunApiKey) {
            return {
                emailResponse,
                mailgunResult: 'MAILGUN_API_KEY is not set; skipping Mailgun send in this environment.',
            }
        }

        try {
            const mailgunClient = mailgun.client({
                username: 'api',
                key: mailgunApiKey,
                url: 'https://api.eu.mailgun.net',
            })
            const mailgunResult = await mailgunClient.messages.create(mailgunDomain, {
                from,
                to: destinations,
                cc: destinationsCc,
                bcc: destinationsBcc,
                subject,
                html: html_body,
                ...(attachments.length > 0 && { attachment: toMailgunAttachments(attachments) }),
            })

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
