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
} from './credentialsConfig'

// Lazily create Mailgun client only if an API key is configured.
let cachedMailgunClient = null
function getMailgunClient() {
    if (cachedMailgunClient) return cachedMailgunClient
    if (!mailgunApiKey) return null
    try {
        const mailgun = new Mailgun(FormData)
        cachedMailgunClient = mailgun.client({ username: 'api', key: mailgunApiKey, url: 'https://api.eu.mailgun.net' })
        return cachedMailgunClient
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[mailgun] disabled: ${e.message}`)
        return null
    }
}

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

    let emailResponse = { message: 'Email sending skipped (dev/no keys)' }
    const apiKeyToUse = isFromClaroline ? mailerApiKeyClaroline : mailerApiKey
    if (mailerHostUrl && apiKeyToUse) {
        try {
            const result = await fetch(`${mailerHostUrl}/api/v1/send/message`, {
                method: 'post',
                headers: {
                    'X-Server-API-Key': apiKeyToUse,
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
            emailResponse = await result.json()
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn(`[postal] send failed: ${e.message}. Continuing in dev.`)
        }
    } else {
        // eslint-disable-next-line no-console
        console.info('[postal] not configured; skipping email send (dev).')
    }

    // TODO use debug logging instead of console.log

    // TODO: refactor to split logic between to, cc and bcc
    const needsMailgun = postalSuppressedDomains.some(
        (domain) =>
            destinations?.some((destination) => destination.includes(domain)) ||
            destinationsCc?.some((destination) => destination.includes(domain)) ||
            destinationsBcc?.some((destination) => destination.includes(domain))
    )

    if (needsMailgun) {
        const mailgunClient = getMailgunClient()
        if (!mailgunClient) {
            // eslint-disable-next-line no-console
            console.info('[mailgun] not configured; skipping mailgun fallback.')
            return { emailResponse, mailgunResult: 'mailgun disabled' }
        }
        try {
            const mailgunResult = await mailgunClient.messages.create(mailgunDomain, {
                from,
                to: destinations,
                cc: destinationsCc,
                bcc: destinationsBcc,
                subject,
                html: html_body,
            })
            return { emailResponse, mailgunResult }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(error)
            return { emailResponse, mailgunResult: error.message }
        }
    }

    return { emailResponse }
}
