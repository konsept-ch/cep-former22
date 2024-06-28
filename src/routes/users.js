import { Router } from 'express'

import { prisma } from '..'
import { createService, getLogDescriptions, LOG_TYPES } from '../utils'
import { getProfessionFacetsValues, getUserProfession, parsePhoneForSms } from './inscriptionsUtils'

export const usersRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
        const professionFacetsValues = await getProfessionFacetsValues()

        const users = (
            await prisma.claro_user.findMany({
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
                        select: {
                            claro__organization: {
                                select: {
                                    name: true,
                                },
                            },
                        },
                        where: {
                            is_main: true,
                        },
                    },
                    former22_user: {
                        select: {
                            shouldReceiveSms: true,
                            colorCode: true,
                            cfNumber: true,
                        },
                    },
                    phone: true,
                },
                where: {
                    is_removed: false,
                },
            })
        ).map((user) => {
            const profession = getUserProfession({
                userId: user.id,
                professionFacetsValues,
            })

            return {
                id: user.uuid,
                firstName: user.first_name,
                lastName: user.last_name,
                email: user.mail,
                mainOrganizationName: user['user_organization'][0]?.['claro__organization'].name,
                phone: user.phone,
                phoneForSms: parsePhoneForSms({ phone: user.phone }),
                roles: user.claro_user_role.map(({ claro_role: { translation_key } }) => translation_key),
                ...(profession ? { profession } : {}),
                ...user.former22_user,
            }
        })

        res.json(users)
    },
    null,
    usersRouter
)

createService(
    'put',
    '/:userId',
    async (req, res) => {
        const user = await prisma.claro_user.update({
            select: {
                first_name: true,
                last_name: true,
            },
            data: {
                former22_user: {
                    upsert: {
                        create: req.body,
                        update: req.body,
                    },
                },
            },
            where: {
                uuid: req.params.userId,
            },
        })

        res.json("L'utilisateur a été modifié")

        const userFullName = `${user.first_name} ${user.last_name}`
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
        const users = await prisma.claro_user.findMany({
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

        res.json(users)
    },
    null,
    usersRouter
)
