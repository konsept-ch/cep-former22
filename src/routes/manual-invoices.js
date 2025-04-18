import { v4 as uuidv4 } from 'uuid'
import { Router } from 'express'

import { prisma } from '..'
import { createService, mapStatusToValidationType } from '../utils'
import { invoiceReasonsFromPrisma, invoiceStatusesFromPrisma, invoiceTypesFromPrisma } from '../constants'
import { createInvoice } from './manualInvoicesUtils'
import { STATUSES } from './inscriptionsUtils'

export const manualInvoicesRouter = Router()

createService(
    'get',
    '/enums',
    async (_req, res) => {
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
    async (req, res) => {
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
    async (_req, res) => {
        const invoices = await prisma.former22_manual_invoice.findMany({
            select: {
                uuid: true,
                number: true,
                claro_user: {
                    select: {
                        uuid: true,
                        first_name: true,
                        last_name: true,
                        former22_user: {
                            select: {
                                cfNumber: true,
                            },
                        },
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
                former22_invoice_item: {
                    select: {
                        designation: true,
                        unit: true,
                        amount: true,
                        price: true,
                        vatCode: true,
                        number: true,
                        claro_cursusbundle_course_session_user: {
                            select: {
                                uuid: true,
                                status: true,
                                claro_cursusbundle_course_session: {
                                    select: {
                                        code: true,
                                    },
                                },
                                claro_user: {
                                    select: { first_name: true, last_name: true },
                                },
                            },
                        },
                        claro_cursusbundle_course_session_cancellation: {
                            select: {
                                uuid: true,
                                claro_cursusbundle_course_session: {
                                    select: {
                                        code: true,
                                    },
                                },
                                claro_user: {
                                    select: { first_name: true, last_name: true },
                                },
                            },
                        },
                    },
                },
                claro_user_former22_manual_invoice_selectedUserIdToclaro_user: {
                    select: {
                        uuid: true,
                    },
                },
                status: true,
                concerns: true,
                invoiceType: true,
                reason: true,
                codeCompta: true,
            },
        })

        res.json(
            invoices.map(
                ({
                    uuid,
                    claro_user: { uuid: userUuid, first_name: firstName, last_name: lastName, former22_user },
                    claro__organization: { uuid: organizationUuid, name: organizationName, former22_organization },
                    claro_user_former22_manual_invoice_selectedUserIdToclaro_user,
                    customClientTitle,
                    customClientFirstname,
                    customClientLastname,
                    status,
                    invoiceType,
                    reason,
                    former22_invoice_item,
                    ...rest
                }) => ({
                    ...rest,
                    id: uuid,
                    user: {
                        uuid: userUuid,
                        firstName,
                        lastName,
                        cfNumber: former22_user?.cfNumber,
                    },
                    clientNumber: former22_organization?.clientNumber,
                    selectedUserUuid: claro_user_former22_manual_invoice_selectedUserIdToclaro_user?.uuid,
                    status: invoiceStatusesFromPrisma[status],
                    invoiceType: invoiceTypesFromPrisma[invoiceType],
                    reason: invoiceReasonsFromPrisma[reason],
                    items: former22_invoice_item.map(
                        ({
                            claro_cursusbundle_course_session_user,
                            claro_cursusbundle_course_session_cancellation,
                            ...itemsRest
                        }) => {
                            const inscription =
                                claro_cursusbundle_course_session_user ?? claro_cursusbundle_course_session_cancellation
                            return {
                                ...itemsRest,
                                inscriptionUuid: inscription?.uuid,
                                validationType: mapStatusToValidationType[`${inscription?.status ?? 4}`],
                                sessionCode: inscription?.claro_cursusbundle_course_session.code,
                                participantName:
                                    inscription != null
                                        ? `${inscription.claro_user.last_name} ${inscription.claro_user.first_name}`
                                        : undefined,
                            }
                        }
                    ),
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
    async (req, res) => {
        try {
            res.json(await createInvoice({ invoiceData: req.body, cfEmail: req.headers['x-login-email-address'] }))
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(error)
            res.status(500).send({ error: 'Erreur de création de facture' })
        }
    },
    null,
    manualInvoicesRouter
)

createService(
    'post',
    '/direct',
    async (req, res) => {
        await prisma.former22_invoice_item.deleteMany({
            where: {
                former22_manual_invoice: {
                    status: 'A_traiter',
                },
                claro_cursusbundle_course_session_user: {
                    claro_cursusbundle_course_session: {
                        claro_cursusbundle_course: {
                            generateInvoice: true,
                        },
                    },
                },
            },
        })

        await prisma.former22_manual_invoice.deleteMany({
            where: {
                status: 'A_traiter',
                former22_invoice_item: {
                    none: {},
                },
            },
        })

        try {
            const startYear = new Date(`${new Date().getFullYear()}-01-01`)

            const inscriptionsAdditionalData = await prisma.former22_inscription.findMany()

            const inscriptions = (
                await prisma.claro_cursusbundle_course_session_user.findMany({
                    select: {
                        id: true,
                        uuid: true,
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
                                user_organization: {
                                    where: {
                                        is_main: true,
                                    },
                                    select: {
                                        claro__organization: true,
                                    },
                                },
                            },
                        },
                    },
                    where: {
                        claro_cursusbundle_course_session: {
                            claro_cursusbundle_course: {
                                generateInvoice: false,
                            },
                            start_date: {
                                gte: startYear,
                            },
                        },
                        former22_invoice_item: {
                            none: {},
                        },
                    },
                })
            )
                .concat(
                    (
                        await prisma.claro_cursusbundle_course_session_cancellation.findMany({
                            select: {
                                id: true,
                                uuid: true,
                                inscription_uuid: true,
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
                                        user_organization: {
                                            where: {
                                                is_main: true,
                                            },
                                            select: {
                                                claro__organization: true,
                                            },
                                        },
                                    },
                                },
                            },
                            where: {
                                claro_cursusbundle_course_session: {
                                    claro_cursusbundle_course: {
                                        generateInvoice: false,
                                    },
                                    start_date: {
                                        gte: startYear,
                                    },
                                },
                                former22_invoice_item: {
                                    none: {},
                                },
                            },
                        })
                    ).map((c) => ({ ...c, uuid: c.inscription_uuid }))
                )
                .filter(({ uuid }) =>
                    inscriptionsAdditionalData.some(
                        ({ inscriptionId, inscriptionStatus }) =>
                            inscriptionId === uuid &&
                            (inscriptionStatus == null ||
                                [
                                    STATUSES.ANNULEE_FACTURABLE,
                                    STATUSES.NON_PARTICIPATION,
                                    STATUSES.PARTICIPATION,
                                    STATUSES.PARTICIPATION_PARTIELLE,
                                ].includes(inscriptionStatus))
                    )
                )

            const organizationsAdditionalData = await prisma.former22_organization.findMany()

            for (const {
                id,
                uuid: inscriptionUuid,
                claro_cursusbundle_course_session: { course_name: sessionName, price: sessionPrice },
                claro_user: { first_name, last_name, user_organization },
                inscription_uuid,
            } of inscriptions) {
                const mainOrganization = user_organization[0]?.claro__organization

                const organization = organizationsAdditionalData.find(
                    ({ organizationUuid }) => organizationUuid === mainOrganization.uuid
                )

                const { inscriptionStatus } = inscriptionsAdditionalData.find(
                    ({ inscriptionId }) => inscriptionId === inscriptionUuid
                ) ?? {
                    status: '',
                }

                let config = null

                // TODO: const statusesThatAlwaysGenerateDirectInvoiceOnly = [STATUSES.NON_PARTICIPATION, STATUSES.ANNULEE_FACTURABLE]
                if (inscriptionStatus === STATUSES.NON_PARTICIPATION) {
                    config = {
                        concerns: 'Absence non annoncée',
                        unit: { value: 'part.', label: 'part.' },
                        reason: 'Non_participation',
                        price: `${sessionPrice}`,
                    }
                }

                if (inscriptionStatus === STATUSES.ANNULEE_FACTURABLE) {
                    config = {
                        concerns: 'Annulation ou report hors-délai',
                        unit: { value: 'forfait(s)', label: 'forfait(s)' },
                        reason: 'Annulation',
                        price: '50',
                    }
                }

                if (
                    organization?.billingMode === 'Directe' &&
                    [STATUSES.PARTICIPATION, STATUSES.PARTICIPATION_PARTIELLE].includes(inscriptionStatus)
                ) {
                    config = {
                        concerns: 'Participation formation CEP',
                        unit: { value: 'part.', label: 'part.' },
                        reason: 'Participation',
                        price: `${sessionPrice}`,
                    }
                }

                if (config !== null) {
                    const {
                        uuid,
                        name,
                        code,
                        addressTitle,
                        postalAddressStreet,
                        postalAddressCode,
                        postalAddressCountry,
                        // postalAddressCountryCode,
                        postalAddressDepartment,
                        // postalAddressDepartmentCode,
                        postalAddressLocality,
                    } = { ...mainOrganization, ...organization }

                    await createInvoice({
                        invoiceData: {
                            status: { value: 'A_traiter', label: invoiceStatusesFromPrisma.A_traiter },
                            invoiceType: { value: 'Directe', label: invoiceTypesFromPrisma.Directe },
                            reason: { value: config.reason, label: invoiceReasonsFromPrisma[config.reason] },
                            client: {
                                value: code,
                                label: name,
                                uuid,
                            },
                            customClientAddress: `${name}\n${addressTitle ? `${addressTitle}\n` : ''}${
                                postalAddressDepartment ? `${postalAddressDepartment}\n` : ''
                            }${postalAddressStreet ? `${postalAddressStreet}\n` : ''}${
                                postalAddressCode ? `${postalAddressCode} ` : ''
                            }${postalAddressLocality ? `${postalAddressLocality}\n` : ''}${postalAddressCountry ?? ''}`,
                            customClientEmail: organization?.email ?? '',
                            selectedUserUuid: null,
                            customClientTitle: '',
                            customClientFirstname: '',
                            customClientLastname: '',
                            codeCompta: '',
                            courseYear: new Date().getFullYear(),
                            invoiceDate: new Date().toISOString(),
                            concerns: config.concerns,
                            items: [
                                {
                                    number: '',
                                    designation: `${last_name} ${first_name} - ${sessionName}`,
                                    unit: config.unit,
                                    price: config.price, // Prix TTC (coût affiché sur le site Claroline)
                                    amount: '1',
                                    vatCode: { value: 'EXONERE', label: 'EXONERE' },
                                    ...(inscription_uuid ? { cancellationId: id } : { inscriptionId: id }),
                                },
                            ],
                        },
                        cfEmail: req.headers['x-login-email-address'],
                    })
                }
            }

            res.json('Factures directes générées')
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error(error)
            res.status(500).send({ error: 'Erreur de création de facture' })
        }
    },
    null,
    manualInvoicesRouter
)

createService(
    'post',
    '/grouped',
    async (req, res) => {
        await prisma.former22_invoice_item.deleteMany({
            where: {
                former22_manual_invoice: {
                    status: 'A_traiter',
                },
                claro_cursusbundle_course_session_user: {
                    claro_cursusbundle_course_session: {
                        claro_cursusbundle_course: {
                            generateInvoice: true,
                        },
                    },
                },
            },
        })

        await prisma.former22_manual_invoice.deleteMany({
            where: {
                status: 'A_traiter',
                former22_invoice_item: {
                    none: {},
                },
            },
        })

        const now = new Date()

        const organizationMap = (
            await prisma.former22_organization.findMany({
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
            })
        ).reduce((map, o) => map.set(o.organizationId, o), new Map())
        const inscriptionMap = (await prisma.former22_inscription.findMany()).reduce(
            (map, i) => map.set(i.inscriptionId, i),
            new Map()
        )
        const sessionUsers = (
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
                            user_organization: {
                                select: {
                                    oganization_id: true,
                                },
                                where: {
                                    is_main: true,
                                },
                            },
                        },
                    },
                },
                where: {
                    claro_user: {
                        user_organization: {
                            some: {
                                claro__organization: {
                                    former22_organization: {
                                        billingMode: 'Groupée',
                                    },
                                },
                                is_main: true,
                            },
                        },
                    },
                    claro_cursusbundle_course_session: {
                        claro_cursusbundle_course: {
                            generateInvoice: false,
                        },
                        start_date: {
                            gte: new Date(`${now.getFullYear()}-01-01`),
                        },
                    },
                    former22_invoice_item: {
                        none: {},
                    },
                },
            })
        ).filter(({ uuid }) => {
            const i = inscriptionMap.get(uuid)
            return (
                i &&
                (i.inscriptionStatus === STATUSES.PARTICIPATION ||
                    i.inscriptionStatus === STATUSES.PARTICIPATION_PARTIELLE)
            )
        })

        const mappedInscriptions = new Map()

        for (const inscription of sessionUsers) {
            const organizationId = inscription.claro_user.user_organization[0].oganization_id

            let parentWithQuota = organizationId
            for (; parentWithQuota != null; ) {
                const orga = organizationMap.get(parentWithQuota).claro__organization
                if (orga.claro_cursusbundle_quota) break
                parentWithQuota = orga.parent_id
            }
            const parentUseQuota = parentWithQuota === null ? 0 : 0.5
            const key = inscription.status === 3 ? (parentWithQuota ?? organizationId) + parentUseQuota : organizationId
            mappedInscriptions.set(key, [...(mappedInscriptions.get(key) ?? []), inscription])
        }

        for (const [key, inscriptions] of mappedInscriptions) {
            const organizationId = key | 0

            const {
                organizationUuid,
                addressTitle,
                postalAddressStreet,
                postalAddressCode,
                postalAddressCountry,
                postalAddressDepartment,
                postalAddressLocality,
                claro__organization: { name, email, code },
            } = organizationMap.get(organizationId)

            await createInvoice({
                invoiceData: {
                    client: {
                        value: code ?? '',
                        label: name ?? '',
                        uuid: organizationUuid,
                    },
                    customClientEmail: email ?? '',
                    customClientAddress: `${name}\n${addressTitle ? `${addressTitle}\n` : ''}${
                        postalAddressDepartment ? `${postalAddressDepartment}\n` : ''
                    }${postalAddressStreet ? `${postalAddressStreet}\n` : ''}${
                        postalAddressCode ? `${postalAddressCode} ` : ''
                    }${postalAddressLocality ? `${postalAddressLocality}\n` : ''}${postalAddressCountry ?? ''}`,
                    customClientTitle: '',
                    customClientFirstname: '',
                    customClientLastname: '',
                    courseYear: now.getFullYear(),
                    invoiceDate: now.toISOString(),
                    selectedUserUuid: null,
                    concerns: '',
                    codeCompta: '',
                    status: { value: 'A_traiter', label: invoiceStatusesFromPrisma.A_traiter },
                    invoiceType:
                        organizationId !== key
                            ? { value: 'Quota', label: invoiceTypesFromPrisma.Quota }
                            : { value: 'Group_e', label: invoiceTypesFromPrisma.Group_e },
                    reason: { value: 'Participation', label: invoiceReasonsFromPrisma.Participation },
                    items: inscriptions.map(
                        ({ id, claro_cursusbundle_course_session, claro_user: { first_name, last_name } }) => ({
                            designation: `${last_name} ${first_name} - ${claro_cursusbundle_course_session.course_name}`,
                            unit: { value: 'part.', label: 'part.' },
                            price: `${claro_cursusbundle_course_session.price ?? ''}`,
                            amount: '1',
                            vatCode: { value: 'EXONERE', label: 'EXONERE' },
                            inscriptionId: id,
                            number: '',
                        })
                    ),
                },
                cfEmail: req.headers['x-login-email-address'],
            })
        }

        res.json({
            message: 'Les factures groupées ont été générées avec succès.',
        })
    },
    null,
    manualInvoicesRouter
)

createService(
    'put',
    '/:id',
    async (req, res) => {
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
                codeCompta,
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

            for (const item of items) {
                if (!item.inscriptionUuid) continue

                item.inscriptionId = (
                    await prisma.claro_cursusbundle_course_session_user.findUnique({
                        select: {
                            id: true,
                        },
                        where: {
                            uuid: item.inscriptionUuid,
                        },
                    })
                )?.id
                item.cancellationId = (
                    await prisma.claro_cursusbundle_course_session_cancellation.findUnique({
                        select: {
                            id: true,
                        },
                        where: {
                            uuid: item.inscriptionUuid,
                        },
                    })
                )?.id
            }

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
                    codeCompta,
                    status: status?.value,
                    creatorUserId,
                    organizationId,
                    selectedUserId,
                    former22_invoice_item: {
                        deleteMany: {},
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

createService(
    'delete',
    '/all',
    async (_req, res) => {
        await prisma.former22_invoice_item.deleteMany()
        await prisma.former22_manual_invoice.deleteMany()

        res.json('Toutes factures et articles ont été supprimés')
    },
    null,
    manualInvoicesRouter
)
