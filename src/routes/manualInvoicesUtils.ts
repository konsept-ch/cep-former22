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
    }[]
    selectedUserUuid: string
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
                        number,
                    }) => ({
                        uuid: uuidv4(),
                        designation,
                        unit,
                        amount,
                        price,
                        vatCode,
                        inscriptionId,
                        number,
                    })
                ),
            },
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

    return uuid
}
