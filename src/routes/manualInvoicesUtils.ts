import { v4 as uuidv4 } from 'uuid'

import type { Response } from 'express'

import { prisma } from '..'
import { invoiceReasonsKeys, invoiceStatusesKeys, invoiceTypesKeys } from '../constants'

type InvoiceData = {
    client: { uuid: string }
    customClientEmail: string
    customClientAddress: string
    customClientTitle: string
    customClientFirstname: string
    customClientLastname: string
    invoiceDate: string
    courseYear: number
    items: Record<string, string | number>
    selectedUserUuid: string
    concerns: string
    status: { value: invoiceStatusesKeys }
    invoiceType: { value: invoiceTypesKeys }
    reason: { value: invoiceReasonsKeys }
}

export const createInvoice = async ({
    invoiceData: {
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
    },
    cfEmail,
    res,
}: {
    invoiceData: InvoiceData
    cfEmail?: string | string[]
    res: Response
}) => {
    try {
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
        res.status(500).send({ error: 'Erreur de création de facture' })
    }
}
