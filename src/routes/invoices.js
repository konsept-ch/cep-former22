import { Router } from 'express'

import { prisma } from '..'
import { createService, formatDate, LOG_TYPES } from '../utils'

export const invoicesRouter = Router()

// invoices START
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
        const manualInvoices = [
            {
                id: '0-1-1', // primary key
                // -----> client address
                organizationId: 1, // is foreignkey
                customClientEmail: 'test@example.com',
                customClientAddress: `Adresse custom
multi-ligne`,
                // -----> vat code
                vatCode: 'TVA 7.7%', // can be also 'EXONERE'
                // -----> invoice date
                invoiceDate: '2022-06-22T21:15:21.000Z', // date is required and with no default value. FE will provide
                // -----> invoice number
                courseYear: 2022, //Front end field is called 'Exercice'
                creatorCode: 1,
                invoiceNumberForCurrentYear: 1,
                // -----> Concerne
                invoiceReason: 'Explication de la raison du document', // field Concerne
                items: [
                    {
                        designation: `Formation catalogue de M. Marc Pittet
Méconnaissance de soit
Dates: ...`, // multi-line
                        unit: 'jours', // heures ou jours, drop-down
                        amount: 2,
                        price: 130,
                    },
                    {
                        designation: `Formation sur mesure
Méconnaissance de soit
Dates: ...
14 participant.e.s`,
                        unit: 'heures',
                        amount: 1,
                        price: 60,
                    },
                ],
            },
            {
                id: '0-1-2',
                organizationId: 2,
                customClientAddress: 'Adresse du client custom 2',
                customClientEmail: 'test@example.com',
                vatCode: 'EXONERE',
                invoiceDate: '2024-06-22T21:15:21.000Z',
                courseYear: 2023,
                creatorCode: 1,
                invoiceNumberForCurrentYear: 1,
                invoiceReason: 'Explication de la raison du document',
                items: [
                    {
                        designation: `Formation catalogue`,
                        unit: 'jours',
                        amount: 2,
                        price: 130,
                    },
                    {
                        designation: `Formation sur mesure`,
                        unit: 'heures',
                        amount: 1,
                        price: 60,
                    },
                ],
            },
        ]

        res.json(manualInvoices)
    },
    null,
    invoicesRouter
)
// invoices END
