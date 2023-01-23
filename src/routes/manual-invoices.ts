import { Router } from 'express'
import type { Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'

import { prisma } from '..'
import { createService } from '../utils'
import { invoiceStatusesFromPrisma } from '../constants'

export const manualInvoicesRouter = Router()

createService(
    'get',
    '/statuses',
    async (_req: Request, res: Response) => {
        res.json(invoiceStatusesFromPrisma)
    },
    null,
    manualInvoicesRouter
)

createService(
    'get',
    '/',
    async (_req: Request, res: Response) => {
        const invoices = await prisma.former22_manual_invoice.findMany({
            select: {
                uuid: true,
                claro_user: {
                    select: {
                        uuid: true,
                        first_name: true,
                        last_name: true,
                    },
                },
                claro__organization: {
                    select: {
                        uuid: true,
                        name: true,
                        code: true,
                        former22_organization: {
                            select: {
                                clientNumber: true,
                            },
                        },
                    },
                },
                invoiceNumberForCurrentYear: true,
                customClientEmail: true,
                customClientAddress: true,
                invoiceDate: true,
                courseYear: true,
                items: true,
                claro_user_former22_manual_invoice_selectedUserIdToclaro_user: {
                    select: {
                        uuid: true,
                    },
                },
                status: true,
                concerns: true,
            },
        })

        const usersAdditionalData = await prisma.former22_user.findMany({
            select: {
                userId: true,
                cfNumber: true,
            },
        })

        // console.log(invoices)

        res.json(
            invoices.map(
                ({
                    uuid,
                    claro_user: { uuid: userUuid, first_name: firstName, last_name: lastName },
                    claro__organization: { uuid: organizationUuid, name: organizationName, former22_organization },
                    invoiceNumberForCurrentYear,
                    customClientEmail,
                    customClientAddress,
                    invoiceDate,
                    courseYear,
                    items,
                    claro_user_former22_manual_invoice_selectedUserIdToclaro_user,
                    status,
                    concerns,
                }) => ({
                    id: uuid,
                    user: {
                        uuid: userUuid,
                        firstName,
                        lastName,
                        cfNumber: usersAdditionalData.find(({ userId }) => userId === userUuid)?.cfNumber,
                    },
                    organizationUuid,
                    organizationName,
                    clientNumber: former22_organization?.clientNumber,
                    invoiceNumberForCurrentYear,
                    customClientEmail,
                    customClientAddress,
                    invoiceDate,
                    courseYear,
                    items,
                    selectedUserUuid: claro_user_former22_manual_invoice_selectedUserIdToclaro_user?.uuid,
                    status: invoiceStatusesFromPrisma[status],
                    concerns,
                })
            )
        )
    },
    null,
    manualInvoicesRouter
)

createService(
    'post',
    '/',
    async (req: Request, res: Response) => {
        try {
            const {
                client,
                customClientEmail,
                customClientAddress,
                invoiceDate,
                courseYear,
                items,
                selectedUserUuid,
                status,
                concerns,
            } = req.body

            const { 'x-login-email-address': cfEmail } = req.headers

            const [{ invoiceNumberForCurrentYear: invoiceNumberForLastYear = undefined } = {}] =
                await prisma.former22_manual_invoice.findMany({
                    where: {
                        courseYear,
                    },
                    orderBy: {
                        invoiceNumberForCurrentYear: 'desc',
                    },
                })

            const { id: organizationId } =
                (await prisma.claro__organization.findUnique({
                    where: {
                        uuid: client.uuid,
                    },
                })) ?? {}

            const { id: creatorUserId } =
                (await prisma.claro_user.findUnique({
                    where: {
                        mail: typeof cfEmail === 'string' ? cfEmail : cfEmail?.join(),
                    },
                })) ?? {}

            const { id: selectedUserId } =
                (selectedUserUuid != null
                    ? await prisma.claro_user.findUnique({
                          where: {
                              uuid: selectedUserUuid,
                          },
                      })
                    : undefined) ?? {}

            // TODO handle foreign keys from uuid to id
            const { uuid } = await prisma.former22_manual_invoice.create({
                data: {
                    uuid: uuidv4(),
                    invoiceNumberForCurrentYear: invoiceNumberForLastYear ? invoiceNumberForLastYear + 1 : 1,
                    customClientEmail,
                    customClientAddress,
                    invoiceDate,
                    courseYear,
                    items,
                    status: status?.value,
                    concerns,
                    claro_user: {
                        connect: {
                            id: creatorUserId,
                        },
                    },
                    claro__organization: {
                        connect: {
                            id: organizationId,
                        },
                    },
                    claro_user_former22_manual_invoice_selectedUserIdToclaro_user:
                        selectedUserId != null
                            ? {
                                  connect: {
                                      id: selectedUserId,
                                  },
                              }
                            : undefined,
                },
            })

            res.json(uuid)
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(error)
            res.status(500).send({ error: 'Error' })
        }
    },
    null,
    manualInvoicesRouter
)

createService(
    'put',
    '/:id',
    async (req: Request, res: Response) => {
        const { id } = req.params

        try {
            const {
                client,
                customClientEmail,
                customClientAddress,
                invoiceDate,
                courseYear,
                items,
                selectedUserUuid,
                status,
                concerns,
            } = req.body

            const { ['x-login-email-address']: cfEmail } = req.headers

            const [{ invoiceNumberForCurrentYear: invoiceNumberForLastYear = 0 } = {}] =
                await prisma.former22_manual_invoice.findMany({
                    where: {
                        courseYear,
                    },
                    orderBy: {
                        invoiceNumberForCurrentYear: 'desc',
                    },
                })

            const { id: organizationId } =
                (await prisma.claro__organization.findUnique({
                    where: {
                        uuid: client.uuid,
                    },
                })) ?? {}

            const { id: creatorUserId } =
                (await prisma.claro_user.findUnique({
                    where: {
                        mail: typeof cfEmail === 'string' ? cfEmail : cfEmail?.join(),
                    },
                })) ?? {}

            const { id: selectedUserId } =
                (selectedUserUuid != null
                    ? await prisma.claro_user.findUnique({
                          where: {
                              uuid: selectedUserUuid,
                          },
                      })
                    : undefined) ?? {}

            // TODO handle foreign keys from uuid to id
            const { uuid } = await prisma.former22_manual_invoice.update({
                where: {
                    uuid: id,
                },
                data: {
                    invoiceNumberForCurrentYear: invoiceNumberForLastYear ? invoiceNumberForLastYear + 1 : 1,
                    customClientEmail,
                    customClientAddress,
                    invoiceDate,
                    courseYear,
                    items,
                    status: status?.value,
                    concerns,
                    creatorUserId,
                    // claro_user: {
                    //     connect: {
                    //         id: creatorUserId,
                    //     },
                    // },
                    organizationId,
                    // claro__organization: {
                    //     connect: {
                    //         id: organizationId,
                    //     },
                    // },
                    selectedUserId,
                    // claro_user_former22_manual_invoice_selectedUserIdToclaro_user: {
                    //     connect: {
                    //         id: selectedUserId,
                    //     },
                    // },
                },
            })

            res.json(uuid)
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(error)
            res.status(500).send({ error: 'Error' })
        }
    },
    null,
    manualInvoicesRouter
)
