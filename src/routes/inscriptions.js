import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'

import { prisma } from '..'
import { callApi } from '../callApi'
import { sendEmail } from '../sendEmail'
import { sendSms } from '../sendSms'
import { createService, getLogDescriptions, LOG_TYPES } from '../utils'
import {
    deriveInscriptionStatus,
    fetchInscriptionsWithStatuses,
    finalStatuses,
    lockGroups,
    parsePhoneForSms,
    STATUSES,
    statusesForAnnulation,
    transformFlagsToStatus,
} from './inscriptionsUtils'
import { getTemplatePreviews } from './templatesUtils'
import { createInvoice } from './manualInvoicesUtils'
import { generateAttestation } from '../helpers/attestations'
import { invoiceReasonsFromPrisma, invoiceStatusesFromPrisma, invoiceTypesFromPrisma } from '../constants'

export const inscriptionsRouter = Router()

const getParentWithQuota = async (organization) => {
    if (organization == null || organization.parent_id == null) return null
    return organization.claro_cursusbundle_quota
        ? organization
        : getParentWithQuota(
              await prisma.claro__organization.findUnique({
                  include: {
                      claro_cursusbundle_quota: true,
                  },
                  where: {
                      id: organization.parent_id,
                  },
              })
          )
}

createService(
    'get',
    '/',
    async (req, res) => {
        const result = await fetchInscriptionsWithStatuses()
        if (result === -1) {
            res.status(500).json('Erreur')
        }

        const participations = result.filter(({ status }) => status !== STATUSES.REFUSEE_PAR_RH)
        if (participations.length > 0) {
            res.json(participations)
        } else {
            res.json('Aucune participation trouvée')
        }
    },
    null,
    inscriptionsRouter
)

createService(
    'get',
    '/formateurs',
    async (req, res) => {
        const tutors = await fetchInscriptionsWithStatuses({ shouldFetchTutors: true })

        if (tutors.length > 0) {
            res.json(tutors)
        } else if (tutors === -1) {
            res.status(500).json('Erreur')
        } else {
            res.json('Aucun formateur trouvé')
        }
    },
    null,
    inscriptionsRouter
)

createService(
    'get',
    '/cancellations',
    async (req, res) => {
        const cancellations = await fetchInscriptionsWithStatuses({ shouldFetchCancellations: true })

        if (cancellations.length > 0) {
            res.json(cancellations)
        } else if (cancellations === -1) {
            res.status(500).json('Erreur')
        } else {
            res.json('Aucune annulation trouvée')
        }
    },
    null,
    inscriptionsRouter
)

createService(
    'get',
    '/refused-by-hr',
    async (req, res) => {
        const result = await fetchInscriptionsWithStatuses()
        if (result === -1) {
            res.status(500).json('Erreur')
        }

        const hrRefusals = result.filter(({ status }) => status === STATUSES.REFUSEE_PAR_RH)
        if (hrRefusals.length > 0) {
            res.json(hrRefusals)
        } else {
            res.json('Aucun refus RH trouvé')
        }
    },
    null,
    inscriptionsRouter
)

createService(
    'put',
    '/:inscriptionId/organization',
    async (req, res) => {
        const organization = await prisma.former22_organization.findUnique({
            select: {
                id: true,
            },
            where: {
                organizationUuid: req.body.organizationId,
            },
        })
        await prisma.former22_inscription.update({
            where: { inscriptionId: req.params.inscriptionId },
            data: {
                organizationId: organization.id,
            },
        })

        res.json({
            message: "L'organisation a été modifiée avec succès.",
        })

        return {
            entityName: 'Inscription',
            entityId: req.params.inscriptionId,
            actionName: `update organization (${req.body.organizationId})`,
        }
    },
    null,
    inscriptionsRouter
)

createService(
    'put',
    '/:inscriptionId',
    async (req, res) => {
        const { emailTemplateId, selectedAttestationTemplateUuid, shouldSendSms, status: newStatus, remark } = req.body

        const currentInscription = await prisma.claro_cursusbundle_course_session_user.findUnique({
            select: {
                id: true,
                uuid: true,
                validated: true,
                confirmed: true,
                registration_type: true,
                status: true,
                claro_cursusbundle_course_session: {
                    select: {
                        id: true,
                        uuid: true,
                        course_name: true,
                        price: true,
                        claro_cursusbundle_course: {
                            select: {
                                uuid: true,
                                course_name: true,
                                session_days: true,
                                session_hours: true,
                                generateInvoice: true,
                                former22_course: {
                                    select: {
                                        goals: true,
                                    },
                                },
                            },
                        },
                        claro_cursusbundle_course_session_user: {
                            where: {
                                registration_type: 'tutor',
                            },
                            select: {
                                claro_user: {
                                    select: {
                                        first_name: true,
                                        last_name: true,
                                    },
                                },
                            },
                        },
                        claro_cursusbundle_session_event: {
                            orderBy: {
                                claro_planned_object: { start_date: 'asc' },
                            },
                            select: {
                                claro_planned_object: {
                                    select: {
                                        start_date: true,
                                        end_date: true,
                                    },
                                },
                            },
                        },
                    },
                },
                claro_user: {
                    select: {
                        id: true,
                        uuid: true,
                        mail: true,
                        username: true,
                        first_name: true,
                        last_name: true,
                        phone: true,
                        claro_workspace_claro_user_workspace_idToclaro_workspace: {
                            select: {
                                id: true,
                                uuid: true,
                                slug: true,
                                entity_name: true,
                                code: true,
                                claro_resource_node: true,
                            },
                        },
                        user_organization: {
                            where: {
                                is_main: true,
                            },
                            select: {
                                claro__organization: {
                                    include: {
                                        claro_cursusbundle_quota: {
                                            select: {
                                                id: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            where: { uuid: req.params.inscriptionId },
        })
        if (!currentInscription) {
            res.json({ error: 'Aucune inscription trouvée' })
            return
        }

        const user = currentInscription.claro_user
        const session = currentInscription.claro_cursusbundle_course_session
        const {
            course_name: sessionName,
            price: sessionPrice,
            claro_cursusbundle_course: {
                course_name: courseName,
                session_days: courseDurationDays,
                session_hours: courseDurationHours,
                former22_course,
            },
            claro_cursusbundle_course_session_user: tutors,
            claro_cursusbundle_session_event: sessionDates,
        } = session

        const mainOrganization = user.user_organization[0]?.claro__organization
        const mainOrganizationExtra = await prisma.former22_organization.findUnique({
            where: { organizationUuid: mainOrganization?.uuid },
        })

        const inscriptionStatusForId = await prisma.former22_inscription.findUnique({
            where: { inscriptionId: currentInscription.uuid },
        })

        const currentInscriptionStatus = deriveInscriptionStatus({
            savedStatus: inscriptionStatusForId?.inscriptionStatus,
            transformedStatus: transformFlagsToStatus({
                validated: currentInscription.validated,
                registrationType: currentInscription.registration_type,
                hrValidationStatus: currentInscription.status,
                isHrValidationEnabled: mainOrganization.claro_cursusbundle_quota != null,
            }),
        })

        if (
            finalStatuses.includes(currentInscriptionStatus) &&
            !lockGroups.some(
                (lockGroup) => lockGroup.includes(currentInscriptionStatus) && lockGroup.includes(newStatus)
            )
        ) {
            res.status(500).json('Ce statut ne peut pas être modifié')

            return {
                entityName: 'Inscription',
                entityId: req.params.inscriptionId,
                actionName: getLogDescriptions.inscription({
                    originalStatus: currentInscriptionStatus,
                    newStatus,
                }),
            }
        }

        let organization = mainOrganization
        let organizationExtra = mainOrganizationExtra
        let invoiceType = { value: 'Directe', label: invoiceTypesFromPrisma.Directe }
        let config = null

        if (newStatus === STATUSES.NON_PARTICIPATION) {
            config = {
                concerns: 'Absence non annoncée',
                unit: { value: 'part.', label: 'part.' },
                reason: 'Non_participation',
                price: `${sessionPrice}`,
            }
        }
        if (newStatus === STATUSES.ANNULEE_FACTURABLE) {
            config = {
                concerns: 'Annulation ou report hors-délai',
                unit: { value: 'forfait(s)', label: 'forfait(s)' },
                reason: 'Annulation',
                price: '50',
            }
        }

        if (
            (mainOrganizationExtra?.billingMode === 'Directe' || mainOrganizationExtra?.billingMode === 'Groupée') &&
            [STATUSES.PARTICIPATION, STATUSES.PARTICIPATION_PARTIELLE].includes(newStatus)
        ) {
            if (mainOrganizationExtra.billingMode === 'Groupée') {
                invoiceType = { value: 'Group_e', label: invoiceTypesFromPrisma.Group_e }

                if (currentInscription.status === 3) {
                    const parentWithQuota = await getParentWithQuota(mainOrganization)
                    if (parentWithQuota) {
                        organization = parentWithQuota
                        organizationExtra = await prisma.former22_organization.findUnique({
                            where: { organizationUuid: parentWithQuota.uuid },
                        })
                        invoiceType = { value: 'Quota', label: invoiceTypesFromPrisma.Quota }
                    }
                }
            }

            config = {
                unit: { value: 'part.', label: 'part.' },
                reason: 'Participation',
                price: `${sessionPrice}`,
            }
        }

        if (
            config !== null &&
            (await prisma.former22_invoice_item.count({
                where: {
                    OR: [
                        { inscriptionId: currentInscription.id },
                        {
                            claro_cursusbundle_course_session_cancellation: {
                                inscription_uuid: req.params.inscriptionId,
                            },
                        },
                    ],
                },
            })) > 0
        ) {
            res.status(400).json({
                message: 'Une facture est déjà liée à cette inscription',
            })
            return {
                entityName: 'Inscription',
                entityId: req.params.inscriptionId,
                actionName: getLogDescriptions.inscription({
                    originalStatus: currentInscriptionStatus,
                    newStatus,
                }),
            }
        }

        if (emailTemplateId) {
            const { emailContent, emailSubject, smsContent } = await getTemplatePreviews({
                templateId: emailTemplateId,
                sessionId: session.uuid,
                inscriptionId: currentInscription.uuid,
            })

            await sendEmail({
                to: user.mail,
                subject: emailSubject,
                html_body: emailContent,
            })

            if (shouldSendSms) {
                await sendSms({
                    to: parsePhoneForSms({ phone: user?.phone }),
                    content: smsContent.replace(/<br\s*\/?>/gi, '\n'),
                })
            }
        }

        generateAttestation(selectedAttestationTemplateUuid, req, {
            courseDurationDays,
            courseDurationHours,
            user,
            courseName,
            sessionName,
            sessionDates,
            former22_course,
            tutors,
            currentInscription,
        })

        let cancellationId = null

        if (statusesForAnnulation.includes(newStatus)) {
            await callApi({
                req,
                path: `cursus_session/${session.uuid}/users/learner`,
                params: { 'ids[0]': currentInscription.uuid },
                method: 'delete',
            })

            const cancellation = await prisma.claro_cursusbundle_course_session_cancellation.findFirst({
                select: {
                    id: true,
                },
                where: {
                    inscription_uuid: currentInscription.uuid,
                },
            })

            cancellationId = cancellation?.id
        }

        await prisma.former22_inscription.upsert({
            where: { inscriptionId: req.params.inscriptionId },
            update: { inscriptionStatus: newStatus, updatedAt: new Date(), ...(remark ? { remark } : {}) },
            create: {
                inscriptionStatus: newStatus,
                inscriptionId: req.params.inscriptionId,
                ...(remark ? { remark } : {}),
            },
        })

        if (finalStatuses.includes(newStatus) || lockGroups.some((lockGroup) => lockGroup.includes(newStatus))) {
            await prisma.former22_inscription.update({
                where: {
                    inscriptionId: req.params.inscriptionId,
                },
                data: {
                    organizationId: mainOrganizationExtra.id,
                },
            })
        }

        if (session.claro_cursusbundle_course.generateInvoice) {
            res.json({ isInvoiceCreated: false })
            return {
                entityName: 'Inscription',
                entityId: req.params.inscriptionId,
                actionName: getLogDescriptions.inscription({
                    originalStatus: currentInscriptionStatus,
                    newStatus,
                }),
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
            } = { ...organization, ...organizationExtra }

            const customClientAddress = `${name}\n${addressTitle ? `${addressTitle}\n` : ''}${
                postalAddressDepartment ? `${postalAddressDepartment}\n` : ''
            }${postalAddressStreet ? `${postalAddressStreet}\n` : ''}${
                postalAddressCode ? `${postalAddressCode} ` : ''
            }${postalAddressLocality ? `${postalAddressLocality}\n` : ''}${postalAddressCountry ?? ''}`

            const invoiceItem = {
                designation: `${user.last_name} ${user.first_name} - ${sessionName}`,
                unit: config.unit,
                price: config.price, // Prix TTC (coût affiché sur le site Claroline)
                amount: '1',
                vatCode: { value: 'EXONERE', label: 'EXONERE' },
                inscriptionId: cancellationId ? null : currentInscription.id,
                cancellationId,
            }

            let alreadyCreated = false

            if (!alreadyCreated && mainOrganizationExtra.billingMode === 'Groupée') {
                const invoice = await prisma.former22_manual_invoice.findFirst({
                    select: {
                        id: true,
                    },
                    where: {
                        status: 'A_traiter',
                        invoiceType: invoiceType.value,
                        claro__organization: {
                            is: {
                                uuid,
                            },
                        },
                    },
                })
                if (invoice) {
                    alreadyCreated = true

                    await prisma.former22_invoice_item.create({
                        data: {
                            uuid: uuidv4(),
                            invoiceId: invoice.id,
                            designation: invoiceItem.designation,
                            unit: config.unit.value,
                            price: config.price,
                            amount: '1',
                            vatCode: 'EXONERE',
                            inscriptionId: invoiceItem.inscriptionId,
                            cancellationId: invoiceItem.cancellationId,
                        },
                    })
                }
            }

            if (!alreadyCreated) {
                await createInvoice({
                    invoiceData: {
                        status: { value: 'A_traiter', label: invoiceStatusesFromPrisma.A_traiter },
                        invoiceType,
                        reason: { value: config.reason, label: invoiceReasonsFromPrisma[config.reason] },
                        client: {
                            value: code,
                            label: name,
                            uuid,
                        },
                        customClientAddress,
                        customClientEmail: organization.email,
                        selectedUserUuid: null,
                        customClientTitle: '',
                        customClientFirstname: '',
                        customClientLastname: '',
                        courseYear: new Date().getFullYear(),
                        invoiceDate: new Date().toISOString(),
                        concerns: config.concerns,
                        items: [invoiceItem],
                    },
                    cfEmail: req.headers['x-login-email-address'],
                })
            }
        }

        res.json({ isInvoiceCreated: config !== null })

        return {
            entityName: 'Inscription',
            entityId: req.params.inscriptionId,
            actionName: getLogDescriptions.inscription({
                originalStatus: currentInscriptionStatus,
                newStatus,
            }),
        }
    },
    { entityType: LOG_TYPES.INSCRIPTION },
    inscriptionsRouter
)
