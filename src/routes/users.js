import { Router } from 'express'

import { prisma } from '..'
import { createService, getLogDescriptions, LOG_TYPES } from '../utils'
import { parsePhoneForSms } from './inscriptionsUtils'

export const usersRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
        const users = await prisma.claro_user.findMany({
            where: {
                is_removed: false,
            },
            select: {
                id: true,
                uuid: true,
                first_name: true,
                last_name: true,
                mail: true,
                claro_user_role: {
                    select: {
                        claro_role: {
                            select: {
                                translation_key: true,
                            },
                        },
                    },
                },
                user_organization: {
                    where: {
                        is_main: true,
                    },
                    select: {
                        claro__organization: {
                            select: {
                                name: true,
                            },
                        },
                    },
                },
                phone: true,
            },
        })

        const usersSettings = await prisma.former22_user.findMany()

        const enrichedUsersData = users.map((current) => {
            const currentUserSettings = usersSettings.find(({ userId }) => userId === current.uuid)

            let enrichedUser = {
                id: current.uuid,
                firstName: current.first_name,
                lastName: current.last_name,
                email: current.mail,
                mainOrganizationName: current['user_organization'][0]?.['claro__organization'].name,
                phone: current.phone,
                phoneForSms: parsePhoneForSms({ phone: current.phone }),
                roles: current.claro_user_role.map(({ claro_role: { translation_key } }) => translation_key),
            }

            if (currentUserSettings) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { userId, ...settings } = currentUserSettings

                enrichedUser = { ...enrichedUser, ...settings }
            }

            return enrichedUser
        })

        res.json(enrichedUsersData)
    },
    null,
    usersRouter
)

createService(
    'put',
    '/:userId',
    async (req, res) => {
        const { userId } = req.params
        const { shouldReceiveSms, colorCode } = req.body

        await prisma.former22_user.upsert({
            where: { userId },
            update: { shouldReceiveSms, colorCode },
            create: { shouldReceiveSms, colorCode, userId },
        })

        res.json("L'utilisateur a été modifié")

        const [{ first_name, last_name }] = await prisma.claro_user.findMany({
            where: {
                uuid: req.params.userId,
            },
            select: {
                first_name: true,
                last_name: true,
            },
        })

        const userFullName = `${first_name} ${last_name}`

        return {
            entityName: userFullName,
            entityId: req.params.userId,
            actionName: getLogDescriptions.user({
                shouldReceiveSms: req.body.shouldReceiveSms,
                fullName: userFullName,
            }),
        }
    },
    { entityType: LOG_TYPES.USER },
    usersRouter
)

createService(
    'get',
    '/admins',
    async (req, res) => {
        const usersPrisma = await prisma.claro_user.findMany({
            where: {
                OR: [
                    {
                        is_removed: false,
                        claro_user_role: {
                            some: {
                                claro_role: {
                                    name: 'ROLE_ADMIN',
                                },
                            },
                        },
                    },
                    {
                        claro_user_group: {
                            some: {
                                claro_group: {
                                    claro_group_role: {
                                        some: {
                                            claro_role: {
                                                name: 'ROLE_ADMIN',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                ],
            },
            select: {
                id: true,
                first_name: true,
                last_name: true,
            },
        })

        res.json(usersPrisma)
    },
    null,
    usersRouter
)
