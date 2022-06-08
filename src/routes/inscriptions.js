import { Router } from 'express'
import fetch from 'node-fetch'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '..'
import { callApi } from '../callApi'
import { MIDDLEWARE_URL } from '../credentialsConfig'
import { sendEmail } from '../sendEmail'
import { sendSms } from '../sendSms'
import { createService, getLogDescriptions, LOG_TYPES } from '../utils'
import {
    fetchInscriptionsWithStatuses,
    FINAL_STATUSES,
    parsePhoneForSms,
    STATUSES,
    transformFlagsToStatus,
} from './inscriptionsUtils'
import { getTemplatePreviews } from './templatesUtils'

export const inscriptionsRouter = Router()

// inscriptions START
createService(
    'get',
    '/',
    async (req, res) => {
        const inscriptions = await fetchInscriptionsWithStatuses()

        if (inscriptions.length > 0) {
            res.json(inscriptions)
        } else {
            res.json('Aucune inscription trouvée')
        }
    },
    null,
    inscriptionsRouter
)

createService(
    'post',
    '/:inscriptionId',
    async (req, res) => {
        const { emailTemplateId, shouldSendSms, status: newStatus } = req.body

        const currentInscription = await prisma.claro_cursusbundle_course_session_user.findUnique({
            where: { uuid: req.params.inscriptionId },
            select: {
                id: true,
                uuid: true,
                validated: true,
                confirmed: true,
                registration_type: true,
                claro_cursusbundle_course_session: {
                    select: {
                        uuid: true,
                        course_name: true,
                    },
                },
                claro_user: {
                    select: {
                        mail: true,
                        username: true,
                        phone: true,
                        uuid: true,
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
        })

        const session = currentInscription.claro_cursusbundle_course_session
        const user = currentInscription.claro_user
        const mainOrganization = user.user_organization[0]?.claro__organization

        const organization = await prisma.former22_organization.findUnique({
            where: { organizationUuid: mainOrganization?.uuid },
        })

        if (
            organization?.billingMode === 'Directe' &&
            (newStatus === STATUSES.PARTICIPATION || newStatus === STATUSES.PARTICIPATION_PARTIELLE)
        ) {
            await prisma.former22_invoice.create({
                data: {
                    invoiceId: uuidv4(),
                    inscriptionId: currentInscription.id,
                },
            })
        }

        const inscriptionStatusForId = await prisma.former22_inscription.findUnique({
            where: { inscriptionId: currentInscription.uuid },
        })

        const currentInscriptionStatus =
            inscriptionStatusForId?.inscriptionStatus ??
            transformFlagsToStatus({
                validated: currentInscription.validated,
                confirmed: currentInscription.confirmed,
                registrationType: currentInscription.registration_type,
            })

        if (Object.values(FINAL_STATUSES).includes(currentInscriptionStatus)) {
            res.json('Ce statut ne peut pas être modifié')

            return {
                entityName: `${user.username} => ${session.course_name}`,
                actionDescription: getLogDescriptions.inscription({
                    originalStatus: currentInscriptionStatus,
                    newStatus: req.body.status,
                }),
            }
        }

        const statusesForRefusalRh = [STATUSES.REFUSEE_PAR_RH]
        const statusesForValidation = [STATUSES.A_TRAITER_PAR_RH, STATUSES.ENTREE_WEB, STATUSES.ACCEPTEE_PAR_CEP]
        const statusesForAnnulation = [STATUSES.REFUSEE_PAR_CEP, STATUSES.ANNULEE, STATUSES.ECARTEE]

        if (typeof currentInscription !== 'undefined') {
            if (emailTemplateId) {
                const { emailContent, emailSubject, smsContent } = await getTemplatePreviews({
                    req,
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
                        content: smsContent,
                    })
                }
            }

            if (statusesForRefusalRh.includes(newStatus)) {
                await callApi({
                    req,
                    path: `cursus_session/${session.uuid}/pending`,
                    params: { 'ids[0]': user.uuid },
                    method: 'patch',
                })
            } else if (statusesForValidation.includes(newStatus)) {
                await callApi({
                    req,
                    path: `cursus_session/${session.uuid}/pending/validate`,
                    params: { 'ids[0]': currentInscription.uuid },
                    method: 'put',
                })
            } else if (statusesForAnnulation.includes(newStatus)) {
                await callApi({
                    req,
                    path: `cursus_session/${session.uuid}/users/learner`,
                    params: { 'ids[0]': currentInscription.uuid },
                    method: 'delete',
                })
            }

            await prisma.former22_inscription.upsert({
                where: { inscriptionId: req.params.inscriptionId },
                update: { inscriptionStatus: req.body.status },
                create: { inscriptionStatus: req.body.status, inscriptionId: req.params.inscriptionId },
            })

            res.json('Le statut a été modifié')

            return {
                entityName: `${user.username} => ${session.course_name}`,
                actionDescription: getLogDescriptions.inscription({
                    originalStatus: currentInscriptionStatus,
                    newStatus: req.body.status,
                }),
            }
        } else {
            res.json('Aucune inscription trouvée')
        }
    },
    { entityType: LOG_TYPES.INSCRIPTION },
    inscriptionsRouter
)

createService(
    'post',
    '/mass/update',
    async (req, res) => {
        const { emailTemplateId, status: newStatus, inscriptionsIds } = req.body

        inscriptionsIds.forEach(
            async (id) =>
                // TODO: create a separate callOwnService function
                await fetch(`${MIDDLEWARE_URL}/inscriptions/${id}`, {
                    method: 'post',
                    headers: req.headers,
                    body: JSON.stringify({
                        emailTemplateId,
                        status: newStatus,
                    }),
                })
        )

        res.json('Les statuts ont été modifiés')
    },
    null,
    inscriptionsRouter
)
// inscriptions END
