import { Router } from 'express'
import fetch from 'node-fetch'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '..'
import { callApi } from '../callApi'
import { MIDDLEWARE_URL } from '../credentialsConfig'
import { sendEmail } from '../sendEmail'
import { sendSms } from '../sendSms'
import { createService, getLogDescriptions, LOG_TYPES } from '../utils'
import { fetchInscriptionsWithStatuses, FINAL_STATUSES, parsePhoneForSms, STATUSES } from './inscriptionsUtils'
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

        const inscriptions = await fetchInscriptionsWithStatuses()

        const currentInscription = inscriptions.find(({ id }) => id === req.params.inscriptionId)

        const organization = await prisma.former22_organization.findUnique({
            where: { organizationUuid: currentInscription.user.organizationId },
        })

        if (
            organization?.billingMode === 'Directe' &&
            (newStatus === STATUSES.PARTICIPATION || newStatus === STATUSES.PARTICIPATION_PARTIELLE)
        ) {
            await prisma.former22_invoice.create({
                data: {
                    invoiceId: uuidv4(),
                    inscriptionId: currentInscription.id, // TODO: use inscription id not uuid
                },
            })
        }

        if (Object.values(FINAL_STATUSES).includes(currentInscription?.status)) {
            res.json('Ce statut ne peut pas être modifié')

            return {
                entityName: `${currentInscription.user.username} => ${currentInscription.session.name}`,
                actionDescription: getLogDescriptions.inscription({
                    originalStatus: currentInscription.status,
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
                    sessionId: currentInscription.session.id,
                    inscriptionId: currentInscription.id,
                })

                await sendEmail({
                    to: currentInscription.user.email,
                    subject: emailSubject,
                    html_body: emailContent,
                })

                if (shouldSendSms) {
                    await sendSms({
                        to: parsePhoneForSms({ phone: currentInscription.user.phone }),
                        content: smsContent,
                    })
                }

                // res.json({ emailResponse })
                // } else {
                // res.json('Le statut a été modifié')
            }

            if (statusesForRefusalRh.includes(newStatus)) {
                await callApi({
                    req,
                    path: `cursus_session/${currentInscription.session.id}/pending`,
                    params: { 'ids[0]': currentInscription.user.id },
                    method: 'patch',
                })
            } else if (statusesForValidation.includes(newStatus)) {
                await callApi({
                    req,
                    path: `cursus_session/${currentInscription.session.id}/pending/validate`,
                    params: { 'ids[0]': currentInscription.id },
                    method: 'put',
                })
            } else if (statusesForAnnulation.includes(newStatus)) {
                await callApi({
                    req,
                    path: `cursus_session/${currentInscription.session.id}/users/learner`,
                    params: { 'ids[0]': currentInscription.id },
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
                entityName: `${currentInscription.user.username} => ${currentInscription.session.name}`,
                actionDescription: getLogDescriptions.inscription({
                    originalStatus: currentInscription.status,
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
