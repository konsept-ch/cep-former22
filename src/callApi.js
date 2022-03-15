import fetch from 'node-fetch'

import { clarolineApiUrl } from './credentialsConfig'

export const PEOPLESOFT_TOKEN = 'X-Former22-API-Key'
export const CLAROLINE_TOKEN = 'CLAROLINE-API-TOKEN'

export const callApi = async ({
    req,
    body,
    path = '',
    params = {},
    headers = {},
    method = 'GET',
    predicate = () => true,
}) => {
    const url = `${new URL(path, clarolineApiUrl)}?${new URLSearchParams(params)}`

    const response = await fetch(url, {
        method,
        headers: { [CLAROLINE_TOKEN]: req.headers['x-login-token'], ...headers },
        body: JSON.stringify(body),
    })

    try {
        const responseJson = await response.json()

        return responseJson?.data ? responseJson?.data?.filter(predicate) : responseJson
    } catch (error) {
        console.warn(response)
        console.error(error)

        return response
    }
}
