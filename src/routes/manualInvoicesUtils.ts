import { v4 as uuidv4 } from 'uuid'

import { prisma } from '..'
import {
    invoiceReasonsKeys,
    invoiceReasonsValues,
    invoiceStatusesKeys,
    invoiceStatusesValues,
    invoiceTypesKeys,
    invoiceTypesValues,
} from '../constants'

export type InvoiceData = {
    client: { uuid: string; value: string; label: string }
    customClientEmail: string
    customClientAddress: string
    customClientTitle: string
    customClientFirstname: string
    customClientLastname: string
    invoiceDate: string
    courseYear: number
    items: {
        number: string
        designation: string
        unit: { value: string; label: string }
        amount: string
        price: string
        vatCode: { value: string; label: string }
        inscriptionId?: number
        inscriptionUuid?: string
        cancellationId?: number
    }[]
    selectedUserUuid: string | null
    concerns: string
    codeCompta: string
    status: { value: invoiceStatusesKeys; label: invoiceStatusesValues }
    invoiceType: { value: invoiceTypesKeys; label: invoiceTypesValues }
    reason: { value: invoiceReasonsKeys; label: invoiceReasonsValues }
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
        codeCompta,
        invoiceType,
        reason,
    },
    cfEmail,
}: {
    invoiceData: InvoiceData
    cfEmail?: string | string[]
}) => {
    const [{ invoiceNumberForCurrentYear: invoiceNumberForLastYear = undefined } = {}] =
        await prisma.former22_manual_invoice.findMany({
            where: {
                courseYear,
            },
            orderBy: {
                invoiceNumberForCurrentYear: 'desc',
            },
        })

    const creator = await prisma.claro_user.findUnique({
        select: {
            uuid: true,
        },
        where: {
            mail: typeof cfEmail === 'string' ? cfEmail : cfEmail?.join(),
        },
    })

    const cf = await prisma.former22_user.findUnique({
        select: {
            cfNumber: true,
        },
        where: {
            userId: creator?.uuid,
        },
    })

    const invoiceNumberForCurrentYear = invoiceNumberForLastYear ? invoiceNumberForLastYear + 1 : 1

    // TODO handle foreign keys from uuid to id
    const { uuid } = await prisma.former22_manual_invoice.create({
        data: {
            uuid: uuidv4(),
            number: `${`${courseYear}`.slice(-2)}${`${cf?.cfNumber}`.padStart(
                2,
                '0'
            )}${`${invoiceNumberForCurrentYear}`.padStart(4, '0')}`,
            invoiceNumberForCurrentYear,
            customClientEmail,
            customClientAddress,
            customClientTitle,
            customClientFirstname,
            customClientLastname,
            invoiceDate,
            courseYear,
            concerns,
            codeCompta,
            former22_invoice_item: {
                create: items.map(
                    ({
                        designation,
                        unit: { value: unit },
                        amount,
                        price,
                        vatCode: { value: vatCode },
                        inscriptionId,
                        cancellationId,
                        number,
                    }) => ({
                        uuid: uuidv4(),
                        designation,
                        unit,
                        amount,
                        price,
                        vatCode,
                        inscriptionId,
                        cancellationId,
                        number,
                    })
                ),
            },
            status: status?.value,
            invoiceType: invoiceType?.value,
            reason: reason?.value,
            claro_user: {
                connect: {
                    uuid: creator?.uuid,
                },
            },
            claro__organization: {
                connect: {
                    uuid: client.uuid,
                },
            },
            claro_user_former22_manual_invoice_selectedUserIdToclaro_user:
                selectedUserUuid != null
                    ? {
                          connect: {
                              uuid: selectedUserUuid,
                          },
                      }
                    : undefined,
        },
    })

    return uuid
}
