import { v4 as uuidv4 } from 'uuid'

import { app, prisma } from '.'
import { winstonLogger } from './winston'

export const attestationTemplateFilesDest = '/data/uploads/attestation-templates'
export const contractTemplateFilesDest = '/data/uploads/contract-templates'
export const contractFilesDest = '/data/uploads/contracts'

export const formatDate = ({ dateString, dateObject, isTimeVisible, isFullTimeVisible, isDateVisible }) => {
    const date = dateObject ?? (dateString ? new Date(dateString) : new Date())
    const getDay = () => (date.getDate() < 10 ? `0${date.getDate()}` : date.getDate())
    const getMonth = () => {
        const month = date.getMonth() + 1

        return month < 10 ? `0${month}` : month
    }
    const getMinutes = () => (date.getMinutes() < 10 ? `0${date.getMinutes()}` : date.getMinutes())

    const getSeconds = () => (date.getSeconds() < 10 ? `0${date.getSeconds()}` : date.getSeconds())

    const getDate = () => (isDateVisible === true ? `${getDay()}.${getMonth()}.${date.getFullYear()}` : null)
    // + 1 because of timezone offset
    const getTime = () =>
        isTimeVisible === true || isFullTimeVisible === true
            ? `${date.getHours() + 1}h${getMinutes()}${
                  isFullTimeVisible === true ? `m${getSeconds()}s${date.getMilliseconds()}ms` : ''
              }`
            : null

    return [getDate(), getTime()].filter(Boolean).join(', ')
}

export const yearMinusOne = () => new Date(new Date().getFullYear() - 1, 0, 1)

export const LOG_STATUSES = {
    PENDING: 'Pending',
    COMPLETE: 'Complete',
    FAIL: 'Fail',
}

export const LOG_TYPES = {
    FORMATION: 'Formation',
    INSCRIPTION: 'Inscription',
    SESSION: 'Session',
    TEMPLATE: 'Model',
    ORGANISATION: 'Organisation',
    USER: 'Utilisateur',
    INVOICE: 'Facture',
    ATTESTATION: 'Attestation',
    CONTRACT: 'Contrat',
    CONTRACT_TEMPLATE: 'ContratTemplate',
    EVALUATION_TEMPLATE: 'EvaluationTemplate',
}

// TODO: named params
export const createService = (
    method,
    url,
    handlerFunction,
    logHelper,
    router = app,
    middlewareFunction = (req, res, next) => {
        next()
    }
) => {
    router[method](url, middlewareFunction, async (req, res) => {
        let logId
        try {
            if (logHelper) {
                const email = req.headers['x-login-email-address']
                const user = await prisma.claro_user.findUnique({
                    select: {
                        first_name: true,
                        last_name: true,
                    },
                    where: {
                        mail: email,
                    },
                })

                const log = await prisma.former22_log.create({
                    data: {
                        logId: uuidv4(),
                        userEmail: `${user.first_name.trim()} ${user.last_name.trim()} <${email}>`,
                        entityType: logHelper.entityType,
                        // dateAndTime: new Date().toISOString().slice(0, 19).replace('T', ' '),
                        dateAndTime: new Date(),
                        actionStatus: LOG_STATUSES.PENDING,
                    },
                })

                logId = log.id
            }

            winstonLogger.http(
                `Request to path ${req.route.path}. Date and time: ${formatDate({
                    dateObject: new Date(),
                    isDateVisible: true,
                    isFullTimeVisible: true,
                })}. Time stamp: ${Date.now()}`
            )

            const logPayload = await handlerFunction(req, res)

            if (logHelper && logPayload) {
                await prisma.former22_log.update({
                    where: { id: logId },
                    data: {
                        entityName: logPayload.entityName,
                        entityId: logPayload.entityId || 'no-id',
                        actionName: logPayload.actionName,
                        actionStatus: LOG_STATUSES.COMPLETE,
                    },
                })
            }
        } catch (error) {
            winstonLogger.error(
                `${req.method} request to ${req.originalUrl} failed. IP: ${req.ip} Response code: ${
                    error.status || 500
                }, response message: ${error.message}. Date and time: ${formatDate({
                    dateObject: new Date(),
                    isDateVisible: true,
                    isFullTimeVisible: true,
                })}. Time stamp: ${Date.now()}`
            )
            winstonLogger.error(error.stack)

            if (logHelper) {
                await prisma.former22_log.update({
                    where: { id: logId },
                    data: {
                        actionStatus: LOG_STATUSES.FAIL,
                        entityName: error.message,
                        actionName: error.stack,
                    },
                })
            }

            res.status(500).send({ message: 'Erreur de serveur' })
        }
    })
}

export const getLogDescriptions = {
    formation: ({ isUpdatedDetails }) => (isUpdatedDetails ? `Updated course details` : 'Updated description'),
    inscription: ({ originalStatus, newStatus }) => `Changed status from "${originalStatus}" to "${newStatus}"`,
    user: ({ shouldReceiveSms, fullName }) =>
        shouldReceiveSms ? `${fullName} will receive SMSes` : `${fullName} will not receive SMSes`,
}

export const addHours = ({ numOfHours, oldDate }) => new Date(oldDate.getTime() + numOfHours * 60 * 60 * 1000)

export const checkAuth = async ({ email, code, token }) => {
    const authPair = await prisma.former22_auth_codes.findUnique({
        where: { email },
        select: {
            code: true,
        },
    })
    if (process.env.NODE_ENV === 'production' && authPair?.code !== code) return false

    const userApiToken = await prisma.claro_api_token.findMany({
        where: { claro_user: { mail: email } },
        select: {
            token: true,
            is_locked: true,
            claro_user: {
                select: {
                    claro_user_role: {
                        select: {
                            claro_role: {
                                select: {
                                    translation_key: true,
                                },
                            },
                        },
                    },
                    claro_user_group: {
                        select: {
                            claro_group: {
                                select: {
                                    claro_group_role: {
                                        select: {
                                            claro_role: {
                                                select: {
                                                    translation_key: true,
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    })

    return (
        userApiToken.find(
            (apiToken) =>
                apiToken.token === token &&
                !apiToken.is_locked &&
                (apiToken.claro_user?.claro_user_role.some((role) => role.claro_role.translation_key === 'admin') ||
                    apiToken.claro_user?.claro_user_group.some((group) =>
                        group.claro_group.claro_group_role.some((role) => role.claro_role.translation_key === 'admin')
                    ))
        ) != null
    )
}

export const mapStatusToValidationType = {
    0: 'En attente',
    1: 'Refusée par RH',
    2: 'Validée par RH',
    3: 'Validée sur quota par RH',
    4: 'Annulé',
}

export const authMiddleware = async (req, res, next) => {
    if (
        !['x-login-email-address', 'x-login-email-code', 'x-login-token'].every((property) =>
            Object.hasOwn(req.headers, property)
        )
    ) {
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
