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
    from = mailerFrom,
    tag = mailerTag,
    subject,
    html_body,
    isFromClaroline = false,
}) => {
    // destination will always be only one e-mail address, so it's an array of 1 string
    const destinations = typeof to === 'string' ? [to] : to

    const result = await fetch(`${mailerHostUrl}/api/v1/send/message`, {
        method: 'post',
        headers: {
            'X-Server-API-Key': isFromClaroline ? mailerApiKeyClaroline : mailerApiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to: destinations,
            subject,
            html_body,
            tag,
        }),
    })

    const emailResponse = await result.json()

    if (postalSuppressedDomains.some((domain) => destinations.flatten()[0].includes(domain))) {
        try {
            const mailgunResult = await mailgunClient.messages.create(mailgunDomain, {
                from,
                to: destinations,
                subject,
                // text: 'Testing some Mailgun awesomness!',
                html: html_body,
            })

            console.log(`E-mail domain is in suppression list, mailgun used: ${to.join(', ')}`)
            console.log(mailgunResult)

            return { emailResponse, mailgunResult }
        } catch (error) {
            console.error(error)
            return { emailResponse, mailgunResult: error.message }
        }
    } else {
        return { emailResponse }
    }
}
