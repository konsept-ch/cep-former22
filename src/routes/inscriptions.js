import { Router } from 'express'
import fetch from 'node-fetch'
import { v4 as uuidv4 } from 'uuid'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import fs from 'fs'
import path from 'path'
import libre from 'libreoffice-convert'
import util from 'util'

import { prisma } from '..'
import { callApi } from '../callApi'
import { MIDDLEWARE_URL } from '../credentialsConfig'
import { sendEmail } from '../sendEmail'
import { sendSms } from '../sendSms'
import {
    createService,
    getLogDescriptions,
    LOG_TYPES,
    attestationTemplateFilesDest,
    attestationFilesDest,
} from '../utils'
import {
    fetchInscriptionsWithStatuses,
    FINAL_STATUSES,
    parsePhoneForSms,
    REGISTRATION_TYPES,
    STATUSES,
    transformFlagsToStatus,
} from './inscriptionsUtils'
import { getTemplatePreviews } from './templatesUtils'

libre.convertAsync = util.promisify(libre.convert)

export const inscriptionsRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
        const inscriptions = await fetchInscriptionsWithStatuses()
        const participants = inscriptions.filter(({ type }) => type === REGISTRATION_TYPES.LEARNER)

        if (participants.length > 0) {
            res.json(participants)
        } else {
            res.json('Aucunes inscriptions trouvées')
        }
    },
    null,
    inscriptionsRouter
)

createService(
    'get',
    '/annulations',
    async (req, res) => {
        const inscriptions = await fetchInscriptionsWithStatuses()

        const inscriptionCancellationsRecords = inscriptions.reduce((acc, inscription) => {
            if (inscription) {
                if (inscription.type === REGISTRATION_TYPES.CANCELLATION) {
                    return [...acc, inscription]
                } else {
                    return [...acc]
                }
            } else {
                return [...acc]
            }
        }, [])

        if (inscriptionCancellationsRecords.length > 0) {
            res.json(inscriptionCancellationsRecords)
        } else {
            res.json('Aucunes inscriptions trouvées')
        }
    },
    null,
    inscriptionsRouter
)

createService(
    'post',
    '/:inscriptionId',
    async (req, res) => {
        const { emailTemplateId, selectedAttestationTemplateUuid, shouldSendSms, status: newStatus } = req.body

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

        if (FINAL_STATUSES.includes(currentInscriptionStatus)) {
            res.json('Ce statut ne peut pas être modifié')

            return {
                entityName: 'Inscription',
                entityId: req.params.inscriptionId,
                actionName: getLogDescriptions.inscription({
                    originalStatus: currentInscriptionStatus,
                    newStatus,
                }),
            }
        }

        // const statusesForRefusalRh = [STATUSES.REFUSEE_PAR_RH]
        // const statusesForValidation = [STATUSES.A_TRAITER_PAR_RH, STATUSES.ENTREE_WEB, STATUSES.ACCEPTEE_PAR_CEP]
        const statusesForAnnulation = [STATUSES.ANNULEE, STATUSES.REFUSEE_PAR_CEP, STATUSES.ECARTEE]

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
                        content: smsContent.replace(/<br\s*\/?>/gi, '\n'),
                    })
                }
            }

            // if (statusesForRefusalRh.includes(newStatus)) {
            //     await callApi({
            //         req,
            //         path: `cursus_session/${session.uuid}/pending`,
            //         params: { 'ids[0]': user.uuid },
            //         method: 'patch',
            //     })
            // } else if (statusesForValidation.includes(newStatus)) {
            //     await callApi({
            //         req,
            //         path: `cursus_session/${session.uuid}/pending/validate`,
            //         params: { 'ids[0]': currentInscription.uuid },
            //         method: 'put',
            //     })
            // } else
            if (statusesForAnnulation.includes(newStatus)) {
                await callApi({
                    req,
                    path: `cursus_session/${session.uuid}/users/learner`,
                    params: { 'ids[0]': currentInscription.uuid },
                    method: 'delete',
                })
            }

            await prisma.former22_inscription.upsert({
                where: { inscriptionId: req.params.inscriptionId },
                update: { inscriptionStatus: newStatus, updatedAt: new Date() },
                create: { inscriptionStatus: newStatus, inscriptionId: req.params.inscriptionId },
            })

            if (selectedAttestationTemplateUuid) {
                const attestation = await prisma.former22_attestation.findUnique({
                    where: {
                        uuid: selectedAttestationTemplateUuid,
                    },
                    select: {
                        id: true,
                        fileOriginalName: true,
                        fileStoredName: true,
                    },
                })

                await prisma.former22_inscription.update({
                    where: {
                        inscriptionId: req.params.inscriptionId,
                    },
                    data: {
                        attestationId: attestation.id,
                    },
                })

                const content = fs.readFileSync(
                    path.resolve(attestationTemplateFilesDest, attestation.fileStoredName),
                    'binary'
                )

                const zip = new PizZip(content)

                const doc = new Docxtemplater(zip, {
                    delimiters: { start: '[', end: ']' },
                    paragraphLoop: true,
                    linebreaks: true,
                })

                doc.render({
                    SESSION_NOM: currentInscription.claro_cursusbundle_course_session.course_name,
                })

                const docxBuf = doc.getZip().generate({
                    type: 'nodebuffer',
                    // compression: DEFLATE adds a compression step.
                    // For a 50MB output document, expect 500ms additional CPU time
                    compression: 'DEFLATE',
                })

                const ext = '.pdf'

                // Convert it to pdf format with undefined filter (see Libreoffice docs about filter)
                const pdfBuf = await libre.convertAsync(docxBuf, ext, undefined)

                // Here in done you have pdf file which you can save or transfer in another stream
                fs.writeFileSync(path.join(attestationFilesDest, `${attestation.fileStoredName}${ext}`), pdfBuf)

                // TODO: upload to personal workspace
                const workspace = await prisma.claro_workspace.findMany({
                    where: {
                        is_personal: true,
                        creator_id: currentInscription.id,
                    },
                    select: {
                        uuid: true,
                        claro_resource_node: true,
                    },
                })

                console.error(workspace[0]?.uuid)
                console.error(workspace[0]?.claro_resource_node)
            }

            const mainOrganization = user.user_organization[0]?.claro__organization

            const organization = await prisma.former22_organization.findUnique({
                where: { organizationUuid: mainOrganization?.uuid },
            })

            const conditionForInvoiceCreation =
                organization?.billingMode === 'Directe' &&
                [STATUSES.PARTICIPATION, STATUSES.PARTICIPATION_PARTIELLE].includes(newStatus)

            let isInvoiceCreated = false

            if (newStatus === STATUSES.NON_PARTICIPATION || conditionForInvoiceCreation) {
                await prisma.former22_invoice.create({
                    data: {
                        invoiceId: uuidv4(),
                        inscriptionId: currentInscription.id,
                        inscriptionStatus: newStatus,
                        createdAt: new Date(),
                    },
                })

                isInvoiceCreated = true
            }

            res.json({ isInvoiceCreated })

            return {
                entityName: 'Inscription',
                entityId: req.params.inscriptionId,
                actionName: getLogDescriptions.inscription({
                    originalStatus: currentInscriptionStatus,
                    newStatus,
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
        let createdInvoicesCount = 0

        for (const id of inscriptionsIds) {
            // TODO: create a separate callOwnService function
            const response = await fetch(`${MIDDLEWARE_URL}/inscriptions/${id}`, {
                method: 'post',
                headers: req.headers,
                body: JSON.stringify({
                    emailTemplateId,
                    status: newStatus,
                }),
            })

            const { isInvoiceCreated } = await response.json()

            if (isInvoiceCreated) {
                createdInvoicesCount += 1
            }
        }

        if (createdInvoicesCount > 0) {
            res.json({ createdInvoicesCount })
        } else {
            res.json('Les statuts ont été modifiés')
        }
    },
    null,
    inscriptionsRouter
)
