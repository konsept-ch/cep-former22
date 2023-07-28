import { v4 as uuidv4 } from 'uuid'

import { prisma } from '../index.js'

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
