import fetch from 'node-fetch'
import { smsSenderToken, smsSenderUrl } from './credentialsConfig'

//TODO add winston
export const sendSms = async ({ to, content }) => {
    const result = await fetch(`${smsSenderUrl}?text=${content}&to=${to}&pushtype=alert&sender=CEP`, {
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
