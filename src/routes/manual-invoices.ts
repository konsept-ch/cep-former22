import { Router } from 'express'
import type { Request, Response } from 'express'

import { prisma } from '..'
import { createService } from '../utils'
import { invoiceReasonsFromPrisma, invoiceStatusesFromPrisma, invoiceTypesFromPrisma } from '../constants'
import { createInvoice } from './manualInvoicesUtils'

export const manualInvoicesRouter = Router()

createService(
    'get',
    '/enums',
    async (_req: Request, res: Response) => {
        res.json({
            invoiceStatuses: invoiceStatusesFromPrisma,
            invoiceReasons: invoiceReasonsFromPrisma,
            invoiceTypes: invoiceTypesFromPrisma,
        })
    },
    null,
    manualInvoicesRouter
)

createService(
    'put',
    '/statuses',
    async (req: Request, res: Response) => {
        const { uuids, status } = req.body

        await prisma.former22_manual_invoice.updateMany({
            where: {
                uuid: {
                    in: uuids,
                },
            },
            data: {
                status,
            },
        })

        res.json({
            message: 'Le status a été correctement mis à jour',
        })
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
                customClientTitle: true,
                customClientFirstname: true,
                customClientLastname: true,
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
                invoiceType: true,
                reason: true,
            },
        })

        const usersAdditionalData = await prisma.former22_user.findMany({
            select: {
                userId: true,
                cfNumber: true,
            },
        })

        res.json(
            invoices.map(
                ({
                    uuid,
                    claro_user: { uuid: userUuid, first_name: firstName, last_name: lastName },
                    claro__organization: { uuid: organizationUuid, name: organizationName, former22_organization },
                    claro_user_former22_manual_invoice_selectedUserIdToclaro_user,
                    customClientTitle,
                    customClientFirstname,
                    customClientLastname,
                    status,
                    invoiceType,
                    reason,
                    ...rest
                }) => ({
                    ...rest,
                    id: uuid,
                    user: {
                        uuid: userUuid,
                        firstName,
                        lastName,
                        cfNumber: usersAdditionalData.find(({ userId }) => userId === userUuid)?.cfNumber,
                    },
                    clientNumber: former22_organization?.clientNumber,
                    selectedUserUuid: claro_user_former22_manual_invoice_selectedUserIdToclaro_user?.uuid,
                    status: invoiceStatusesFromPrisma[status],
                    invoiceType: invoiceTypesFromPrisma[invoiceType],
                    reason: invoiceReasonsFromPrisma[reason],
                    organizationUuid,
                    organizationName,
                    customClientTitle,
                    customClientFirstname,
                    customClientLastname,
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
        createInvoice({ invoiceData: req.body, cfEmail: req.headers['x-login-email-address'], res })
    },
    null,
    manualInvoicesRouter
)

createService(
    'post',
    '/grouped',
    async (req: Request, res: Response) => {
        const { type } = req.body

        // TODO generate for all inscriptions whose organisation mode is semestrial or annual.
        // One invoice per organisation.
        // One item per inscription.

        if (type === 'semestrial') {
            // createInvoice({ invoiceData: req.body, cfEmail: req.headers['x-login-email-address'], res })
            res.json('semestrial')
        } else if (type === 'annual') {
            // createInvoice({ invoiceData: req.body, cfEmail: req.headers['x-login-email-address'], res })
            res.json('annual')
        } else {
            res.status(400).json('You need to pass a type, it should be annual or semestrial')
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
                customClientTitle,
                customClientFirstname,
                customClientLastname,
                invoiceDate,
                courseYear,
                items,
                selectedUserUuid,
                status,
                concerns,
                invoiceType,
                reason,
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
                    customClientTitle,
                    customClientFirstname,
                    customClientLastname,
                    invoiceDate,
                    courseYear,
                    concerns,
                    items,
                    status: status?.value,
                    invoiceType: invoiceType?.value,
                    reason: reason?.value,
                    creatorUserId,
                    organizationId,
                    selectedUserId,
                },
            })

            res.json(uuid)
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(error)
            res.status(500).send({ error: 'Erreur de modification de facture' })
        }
    },
    null,
    manualInvoicesRouter
)
