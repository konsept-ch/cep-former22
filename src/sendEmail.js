import fetch from 'node-fetch'

import {
    mailerHostUrl,
    mailerApiKey,
    mailerTag,
    mailerFrom,
    mailerApiKeyClaroline,
    mailgunApiKey,
} from './credentialsConfig'

const postalSuppressedDomains = [
    '@pragmaticmanagement.ch',
    '@ilavigny.ch',
    '@polouest.ch',
    '@lerepuis.ch',
    '@vd.educanet2.ch',
]

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

    if (postalSuppressedDomains.some((domain) => destinations[0].includes(domain))) {
        // TODO send to mailgun
        const clientIdAndSecret = `api:${mailgunApiKey}`
        const base64 = Buffer.from(clientIdAndSecret).toString('base64')

        // eslint-disable-next-line no-undef
        const formdata = new FormData()
        formdata.append('from', 'Excited User <mailgun@cep-val.ch>')
        // formdata.append('to', 'YOU@YOUR_DOMAIN_NAME')
        formdata.append('to', 'dan@konsept.ch')
        formdata.append('subject', 'Hello')
        formdata.append('text', 'Testing some Mailgun awesomeness!')

        const mailgunResult = await fetch(`https://api.eu.mailgun.net/v3/cep-val.ch/messages`, {
            method: 'post',
            headers: {
                // 'X-Server-API-Key': isFromClaroline ? mailerApiKeyClaroline : mailerApiKey,
                // 'Content-Type': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept-Language': 'en_US',
                Accept: 'application/json',
                Authorization: `Basic ${base64}`,
            },
            body: formdata,
        })

        return { emailResponse, mailgunResult }
    } else {
        return { emailResponse }
    }
}
