import fetch from 'node-fetch'
import { URL, URLSearchParams } from 'url'

import { smsSenderToken, smsSenderUrl } from './credentialsConfig'

//TODO add winston
export const sendSms = async ({ to, content }) => {
    const params = {
        to,
        text: content,
        pushtype: 'alert',
        sender: 'CEP',
    }
    const url = new URL(smsSenderUrl)
    url.search = new URLSearchParams(params).toString()

    const result = await fetch(url, {
        headers: {
            Authorization: `Bearer ${smsSenderToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
        },
    })

    console.info(`Sent SMS to ${to} with content "${content}"`)

    try {
        const resultJson = await result.json()

        console.info(resultJson)

        return { success: resultJson.status === 1 }
    } catch (error) {
        console.error(error)
    }
}
