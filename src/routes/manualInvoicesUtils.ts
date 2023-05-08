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
import { STATUSES } from './inscriptionsUtils'

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

export const getMappedInscriptions = async (billingMode: any): any => {
    // Get all organizations by billing mode
    const organizations = await prisma.former22_organization.findMany({
        select: {
            billingMode: true,
            organizationId: true,
            organizationUuid: true,
            addressTitle: true,
            postalAddressCountry: true,
            postalAddressCountryCode: true,
            postalAddressCode: true,
            postalAddressStreet: true,
            postalAddressDepartment: true,
            postalAddressDepartmentCode: true,
            postalAddressLocality: true,
            claro__organization: {
                select: {
                    name: true,
                    email: true,
                    code: true,
                    claro_cursusbundle_quota: true,
                    parent_id: true,
                },
            },
        },
        where: {
            billingMode,
        },
    })

    const organizationMap = organizations.reduce((map, o) => map.set(o.organizationId, o), new Map())
    const parentMap = new Map()

    const inscriptionMap = (await prisma.former22_inscription.findMany()).reduce(
        (map, i) => map.set(i.inscriptionId, i),
        new Map()
    )

    const mappedInscriptions = new Map()

    // create all invoices by organizations
    for (const { organizationId } of organizations) {
        const inscriptions = (
            await prisma.claro_cursusbundle_course_session_user.findMany({
                select: {
                    id: true,
                    uuid: true,
                    status: true,
                    claro_cursusbundle_course_session: {
                        select: {
                            course_name: true,
                            price: true,
                        },
                    },
                    claro_user: {
                        select: {
                            first_name: true,
                            last_name: true,
                        },
                    },
                },
                where: {
                    claro_user: {
                        user_organization: {
                            some: {
                                oganization_id: organizationId,
                            },
                        },
                    },
                    claro_cursusbundle_course_session: {
                        start_date: {
                            gte: new Date('2023-01-01'),
                        },
                    },
                },
            })
        ).filter(({ uuid }) => {
            const i: any = inscriptionMap.get(uuid)
            return (
                i &&
                (i.inscriptionStatus == null ||
                    i.inscriptionStatus === STATUSES.ANNULEE_FACTURABLE ||
                    i.inscriptionStatus === STATUSES.NON_PARTICIPATION)
            )
        })

        if (inscriptions.length === 0) continue

        for (const inscription of inscriptions) {
            if (inscription.status !== 3) continue

            const getParentWithQuota: any = (id: any) => {
                if (id == null) return null
                const orga: any = organizationMap.get(id)
                return orga.claro__organization.claro_cursusbundle_quota ? id : getParentWithQuota(orga.parent_id)
            }

            let parentId: any = parentMap.get(organizationId)
            if (!parentId) {
                parentId = getParentWithQuota(organizationId)
                parentMap.set(organizationId, parentId)
            }
            parentId = parentId ?? organizationId

            const list = mappedInscriptions.get(parentId) ?? []
            mappedInscriptions.set(parentId, [...list, inscription])
        }
    }

    return mappedInscriptions
}
