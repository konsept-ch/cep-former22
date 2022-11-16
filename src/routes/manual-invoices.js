import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'

import { prisma } from '..'
import { createService } from '../utils'

export const manualInvoicesRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
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
                itemDesignations: true,
                itemUnits: true,
                itemAmounts: true,
                itemPrices: true,
                itemVatCodes: true,
            },
        })

        const usersAdditionalData = await prisma.former22_user.findMany({
            select: {
                userId: true,
                cfNumber: true,
            },
        })

        console.log(invoices)

        res.json(
            invoices.map(
                ({
                    uuid,
                    claro_user: { uuid: userUuid, first_name: firstName, last_name: lastName },
                    claro__organization: {
                        uuid: organizationUuid,
                        name: organizationName,
                        former22_organization: { clientNumber },
                    },
                    invoiceNumberForCurrentYear,
                    customClientEmail,
                    customClientAddress,
                    invoiceDate,
                    courseYear,
                    itemDesignations,
                    itemUnits,
                    itemAmounts,
                    itemPrices,
                    itemVatCodes,
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
                    clientNumber,
                    invoiceNumberForCurrentYear,
                    customClientEmail,
                    customClientAddress,
                    invoiceDate,
                    courseYear,
                    items: itemDesignations?.split('\\').map((designation, index) => ({
                        designation,
                        unit: itemUnits.split('\\').at(index),
                        amount: itemAmounts.split('\\').at(index),
                        price: itemPrices.split('\\').at(index),
                        vatCode: itemVatCodes.split('\\').at(index),
                    })),
                    // itemDesignations,
                    // itemUnits,
                    // itemAmounts,
                    // itemPrices,
                    // itemVatCodes,
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
            const { client, customClientEmail, customClientAddress, invoiceDate, courseYear, items } = req.body

            const itemDesignations = items.map(({ designation }) => designation).join('\\')
            const itemUnits = items.map(({ unit }) => unit.value).join('\\')
            const itemAmounts = items.map(({ amount }) => amount).join('\\')
            const itemPrices = items.map(({ price }) => price).join('\\')
            const itemVatCodes = items.map(({ vatCode }) => vatCode).join('\\')

            const { ['x-login-email-address']: cfEmail } = req.headers

            const [{ invoiceNumberForCurrentYear: invoiceNumberForLastYear } = {}] =
                await prisma.former22_manual_invoice.findMany({
                    where: {
                        courseYear,
                    },
                    orderBy: {
                        invoiceNumberForCurrentYear: 'desc',
                    },
                })

            const { id: organizationId } = await prisma.claro__organization.findUnique({
                where: {
                    uuid: client.uuid,
                },
            })

            const { id: creatorUserId } = await prisma.claro_user.findUnique({
                where: {
                    mail: cfEmail,
                },
            })

            // TODO handle foreign keys from uuid to id
            const { uuid } = await prisma.former22_manual_invoice.create({
                data: {
                    uuid: uuidv4(),
                    creatorUserId,
                    organizationId,
                    invoiceNumberForCurrentYear: invoiceNumberForLastYear ? invoiceNumberForLastYear + 1 : 1,
                    customClientEmail,
                    customClientAddress,
                    invoiceDate,
                    courseYear,
                    itemDesignations,
                    itemUnits,
                    itemAmounts,
                    itemPrices,
                    itemVatCodes,
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
    '/',
    async (req, res) => {
        try {
            const { client, customClientEmail, customClientAddress, invoiceDate, courseYear, items } = req.body

            const itemDesignations = items.map(({ designation }) => designation).join('\\')
            const itemUnits = items.map(({ unit }) => unit.value).join('\\')
            const itemAmounts = items.map(({ amount }) => amount).join('\\')
            const itemPrices = items.map(({ price }) => price).join('\\')
            const itemVatCodes = items.map(({ vatCode }) => vatCode).join('\\')

            const { ['x-login-email-address']: cfEmail } = req.headers

            const [{ invoiceNumberForCurrentYear: invoiceNumberForLastYear } = {}] =
                await prisma.former22_manual_invoice.findMany({
                    where: {
                        courseYear,
                    },
                    orderBy: {
                        invoiceNumberForCurrentYear: 'desc',
                    },
                })

            const { id: organizationId } = await prisma.claro__organization.findUnique({
                where: {
                    uuid: client.uuid,
                },
            })

            const { id: creatorUserId } = await prisma.claro_user.findUnique({
                where: {
                    mail: cfEmail,
                },
            })

            // TODO handle foreign keys from uuid to id
            const { uuid } = await prisma.former22_manual_invoice.create({
                data: {
                    uuid: uuidv4(),
                    creatorUserId,
                    organizationId,
                    invoiceNumberForCurrentYear: invoiceNumberForLastYear ? invoiceNumberForLastYear + 1 : 1,
                    customClientEmail,
                    customClientAddress,
                    invoiceDate,
                    courseYear,
                    itemDesignations,
                    itemUnits,
                    itemAmounts,
                    itemPrices,
                    itemVatCodes,
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
