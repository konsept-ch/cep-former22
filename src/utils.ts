import { v4 as uuidv4 } from 'uuid'

import { app, prisma } from '.'
import { callApi } from './callApi'
import { winstonLogger } from './winston'
import { NextFunction, Request, Response, Router } from 'express'

export const attestationTemplateFilesDest = '/data/uploads/attestation-templates'
export const contractTemplateFilesDest = '/data/uploads/contract-templates'
export const contractFilesDest = '/data/uploads/contracts'

// for testing/development purposes only
export const delay = (ms: number) => new Promise((res) => setTimeout(res, ms))

export const formatDate = ({ dateString, dateObject, isTimeVisible, isFullTimeVisible, isDateVisible }: any) => {
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
    method: keyof Router,
    url: string,
    handlerFunction: any,
    logHelper: any,
    router: Router = app,
    middlewareFunction = (req: Request, res: Response, next: NextFunction) => {
        next()
    }
) => {
    ;(router as any)[method](url, middlewareFunction, async (req: Request, res: Response) => {
        let logId
        try {
            if (logHelper) {
                const userDetails = (await callApi({
                    req,
                    path: 'user/find',
                    params: `filters[email]=${req.headers['x-login-email-address']}`,
                })) as { name: string; email: string }

                const log = await prisma.former22_log.create({
                    data: {
                        logId: uuidv4(),
                        userEmail: `${userDetails.name} <${userDetails.email}>`,
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

            if (logHelper) {
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
        } catch (error: any) {
            // eslint-disable-next-line no-console
            console.error(error)
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
    formation: ({ isUpdatedDetails }: { isUpdatedDetails: boolean }) =>
        isUpdatedDetails ? `Updated course details` : 'Updated description',
    inscription: ({ originalStatus, newStatus }: { originalStatus: string; newStatus: string }) =>
        `Changed status from "${originalStatus}" to "${newStatus}"`,
    user: ({ shouldReceiveSms, fullName }: { shouldReceiveSms: boolean; fullName: string }) =>
        shouldReceiveSms ? `${fullName} will receive SMSes` : `${fullName} will not receive SMSes`,
}

export const addHours = ({ numOfHours, oldDate }: { numOfHours: number; oldDate: Date }) =>
    new Date(oldDate.getTime() + numOfHours * 60 * 60 * 1000)

export const checkAuth = async ({ email, code, token }: { email: string; code: string; token: string }) => {
    const authPair = await prisma.former22_auth_codes.findUnique({
        where: { email },
        select: {
            code: true,
        },
    })

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

    const doesCodeMatch = process.env.NODE_ENV !== 'production' || authPair?.code === code
    const doesMatchingAdminUnlockedTokenExist =
        userApiToken.find(
            (apiToken) =>
                apiToken.token === token &&
                !apiToken.is_locked &&
                (apiToken.claro_user?.claro_user_role.some((role) => role.claro_role.translation_key === 'admin') ||
                    apiToken.claro_user?.claro_user_group.some((group) =>
                        group.claro_group.claro_group_role.some((role) => role.claro_role.translation_key === 'admin')
                    ))
        ) != null

    return doesCodeMatch && doesMatchingAdminUnlockedTokenExist
}

export const mapStatusToValidationType = {
    '0': 'En attente',
    '1': 'Refusée par RH',
    '2': 'Validée par RH',
    '3': 'Validée sur quota par RH',
    '4': 'Annulé',
} as const
export type ValidationTypesKeys = keyof typeof mapStatusToValidationType

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    if (
        !['x-login-email-address', 'x-login-email-code', 'x-login-token'].every((property) =>
            Object.hasOwn(req.headers, property)
        )
    ) {
        res.status(401).send({ error: "Vous n'avez pas les droits nécessaires" })
        return
    }

    const email = (req.headers['x-login-email-address'] as string).trim()
    const code = (req.headers['x-login-email-code'] as string).trim()
    const token = (req.headers['x-login-token'] as string).trim()
    const isAuthenticated = await checkAuth({ email, code, token })

    if (isAuthenticated) {
        next()
    } else {
        res.status(401).send({ error: "Vous n'avez pas les droits nécessaires" })
        return
        // throw new Error('Incorrect token and code for this email')
    }
}
