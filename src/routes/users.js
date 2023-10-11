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
            select: {
                id: true,
                uuid: true,
                first_name: true,
                last_name: true,
                mail: true,
                claro_field_facet_value: {
                    select: {
                        field_value: true,
                    },
                    where: {
                        claro_field_facet: {
                            name: { contains: 'FONCTION PROFESSIONNELLE' },
                        },
                    },
                },
                claro_user_role: {
                    select: {
                        claro_role: {
                            select: {
                                translation_key: true,
                            },
                        },
                    },
                },
                former22_user: {
                    select: {
                        shouldReceiveSms: true,
                        colorCode: true,
                        cfNumber: true,
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
            where: {
                is_removed: false,
            },
        })

        return res.json(
            users.map((user) => ({
                id: user.uuid,
                firstName: user.first_name,
                lastName: user.last_name,
                email: user.mail,
                mainOrganizationName: user.user_organization[0]?.claro__organization.name,
                phone: user.phone,
                phoneForSms: parsePhoneForSms({ phone: user.phone }),
                roles: user.claro_user_role.map(({ claro_role: { translation_key } }) => translation_key),
                profession:
                    user.claro_field_facet_value.length > 0
                        ? JSON.parse(user.claro_field_facet_value[0].field_value).join(', ')
                        : null,
                ...user.former22_user,
            }))
        )
    },
    null,
    usersRouter
)

createService(
    'put',
    '/:userId',
    async (req, res) => {
        const { userId } = req.params
        const { shouldReceiveSms, colorCode, cfNumber } = req.body

        await prisma.claro_user.update({
            where: {
                uuid: userId,
            },
            data: {
                former22_user: {
                    upsert: {
                        create: { shouldReceiveSms, colorCode, cfNumber },
                        update: { shouldReceiveSms, colorCode, cfNumber },
                    },
                },
            },
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
