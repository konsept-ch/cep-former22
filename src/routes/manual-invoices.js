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
                    uuid,
                    user: {
                        uuid: userUuid,
                        firstName,
                        lastName,
                    },
                    organizationUuid,
                    organizationName,
                    clientNumber,
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
            const { invoice } = req.body

            // TODO handle foreign keys from uuid to id
            const { uuid } = await prisma.former22_manual_invoice.create({
                data: { ...invoice, uuid: uuidv4() },
            })

            res.json(uuid)
        } catch (error) {
            console.error(error)
            res.status(500).send({ error: 'Error' })
        }
    },
    null,
    manualInvoicesRouter
)
