import fetch from 'node-fetch'

import { clarolineApiUrl } from './credentialsConfig'

export const PEOPLESOFT_TOKEN = 'X-Former22-API-Key'
export const CLAROLINE_TOKEN = 'CLAROLINE-API-TOKEN'

export const callApi = async ({
    req,
    body,
    isFormData = false, // TODO: deprecated, check if body is instance of FormData
    path = '',
    params = {},
    headers = {},
    method = 'GET',
    predicate = () => true,
}) => {
    const url = `${new URL(path, clarolineApiUrl)}?${new URLSearchParams(params)}`

    // if (isFormData) {
    //     for (const pair of body.entries()) {
    //         console.log(pair[0] + ', ' + pair[1])
    //     }
    // }

    const response = await fetch(url, {
        method,
        headers: { [CLAROLINE_TOKEN]: req.headers['x-login-token'], ...headers },
        body: isFormData ? body : JSON.stringify(body),
    })

    // if (isFormData) {
    //     // console.log(response)
    //     return await response.json()
    // }

    try {
        if (method.toLowerCase() !== 'delete') {
            const responseJson = await response.json()

            return responseJson?.data ? responseJson?.data?.filter(predicate) : responseJson
        } else {
            const responseText = await response.text()

            return responseText
        }
    } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(response)
        // eslint-disable-next-line no-console
        console.error(error)

        return response
    }
}
