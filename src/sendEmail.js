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

    const emailResponse = await result.json()

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

            console.info(`E-mail domain is in suppression list, mailgun used: ${to.join(', ')}`)
            console.info(mailgunResult)

            return { emailResponse, mailgunResult }
        } catch (error) {
            console.error(error)
            return { emailResponse, mailgunResult: error.message }
        }
    } else {
        return { emailResponse }
    }
}
