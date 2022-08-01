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
// invoices END
