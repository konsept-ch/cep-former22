import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'

import { prisma } from '..'
import { createService, formatDate, LOG_TYPES } from '../utils'

export const invoicesRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
        const invoicesPrisma = await prisma.former22_invoice.findMany({
            include: {
                claro_cursusbundle_course_session_user: {
                    include: {
                        claro_user: true,
                        claro_cursusbundle_course_session: {
                            include: {
                                claro_cursusbundle_session_event: {
                                    select: {
                                        claro_planned_object: {
                                            select: {
                                                start_date: true,
                                            },
                                        },
                                    },
                                },
                                claro_cursusbundle_course_session_user: {
                                    include: {
                                        claro_user: true,
                                    },
                                },
                                claro_cursusbundle_course: {
                                    select: { course_name: true },
                                },
                            },
                        },
                    },
                },
            },
        })

        const invoices = invoicesPrisma.map(
            ({
                createdAt,
                invoiceId,
                inscriptionStatus,
                claro_cursusbundle_course_session_user: {
                    claro_cursusbundle_course_session: {
                        claro_cursusbundle_session_event,
                        claro_cursusbundle_course_session_user,
                        course_name: sessionName,
                        claro_cursusbundle_course: { course_name },
                    },
                    claro_user,
                },
                ...rest
            }) => {
                const formateurs = claro_cursusbundle_course_session_user
                    ?.filter(({ registration_type }) => registration_type === 'tutor')
                    ?.map(({ claro_user: { first_name, last_name } }) => `${last_name} ${first_name}`)
                    .join(', ')

                const seances = claro_cursusbundle_session_event
                    .map(({ claro_planned_object: { start_date } }) =>
                        formatDate({
                            dateObject: start_date,
                            isDateVisible: true,
                        })
                    )
                    .join(', ')

                return {
                    participantName: rest.participantName ?? `${claro_user.last_name} ${claro_user.first_name} `,
                    tutorsNames: rest.tutorsNames ?? formateurs,
                    sessionName: rest.sessionName ?? sessionName,
                    courseName: rest.courseName ?? course_name,
                    id: invoiceId,
                    seances,
                    createdAt,
                    inscriptionStatus,
                }
            }
        )

        res.json(invoices)
    },
    null,
    invoicesRouter
)

createService(
    'delete',
    '/:id',
    async (req, res) => {
        const { id } = req.params

        await prisma.former22_invoice.delete({
            where: { invoiceId: id },
        })

        res.json('La facturation a été modifié')

        return {
            entityName: 'Facture',
            entityId: id,
            actionName: 'Invoice deleted',
        }
    },
    { entityType: LOG_TYPES.INVOICE },
    invoicesRouter
)

createService(
    'put',
    '/:id',
    async (req, res) => {
        const invoiceData = req.body
        const { id } = req.params

        await prisma.former22_invoice.update({
            where: { invoiceId: id },
            data: { ...invoiceData },
        })

        res.json('La facturation a été modifié')

        return {
            entityName: 'Facture',
            entityId: id,
            actionName: 'Invoice updated',
        }
    },
    { entityType: LOG_TYPES.INVOICE },
    invoicesRouter
)

createService(
    'get',
    '/manual',
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
                    claro__organization: { uuid: organizationUuid, name: organizationName },
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
    invoicesRouter
)

createService(
    'post',
    '/manual',
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
    invoicesRouter
)
