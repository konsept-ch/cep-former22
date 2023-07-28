import { checkAuth } from '../helpers/core.js'

function hasAllProperties (object, properties) {
    return properties.every((property) => Object.hasOwn(object, property))
}

export default async function(req, res, next) {
    if (!hasAllProperties(req.headers, ['x-login-email-address', 'x-login-email-code', 'x-login-token'])) {
        res.status(401).send({ error: "Vous n'avez pas les droits nécessaires" })
        return
    }

    const email = req.headers['x-login-email-address'].trim()
    const code = req.headers['x-login-email-code'].trim()
    const token = req.headers['x-login-token'].trim()
    const isAuthenticated = await checkAuth({ email, code, token })

    if (isAuthenticated) {
        next()
    } else {
        res.status(401).send({ error: "Vous n'avez pas les droits nécessaires" })
        return
        // throw new Error('Incorrect token and code for this email')
    }
}
