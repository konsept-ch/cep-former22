import { Router } from 'express'
import fetch, { File, FormData } from 'node-fetch'
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
import { createService, getLogDescriptions, LOG_TYPES, attestationTemplateFilesDest } from '../utils'
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
                        claro_cursusbundle_course: {
                            select: {
                                course_name: true,
                                session_days: true,
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
                        phone: true,
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
        const {
            course_name: sessionName,
            claro_cursusbundle_course: { course_name: courseName, session_days: sessionDuration },
            claro_cursusbundle_course_session_user: { claro_user: tutors },
            claro_cursusbundle_session_event: sessionDates,
        } = session
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
                    FORMATION_NOM: courseName,
                    SESSION_DATE_FIN: Intl.DateTimeFormat('fr-CH', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    }).format(sessionDates.at(-1)?.claro_planned_object?.start_date),
                    SESSION_DURÉE: sessionDuration,
                    SESSION_DATES: sessionDates
                        .map(({ claro_planned_object: { start_date } }) =>
                            Intl.DateTimeFormat('fr-CH', { year: 'numeric', month: 'long', day: 'numeric' }).format(
                                start_date
                            )
                        )
                        .join(', '),
                    OBJECTIFS: '', // TODO use from former22_course once implemented
                    FORMATEURS:
                        tutors?.map(({ first_name, last_name }) => `${first_name} ${last_name}`).join(', ') ??
                        'Aucun formateur',
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

                const pdfFileName = `${attestation.fileStoredName}${ext}`

                const originalPdfName = `${attestation.fileOriginalName}${ext}`

                const formData = new FormData()
                const fileBinary = new File([pdfBuf], originalPdfName, {
                    type: 'application/pdf',
                })
                formData.append('file', fileBinary, originalPdfName)
                formData.append('fileName', pdfFileName)
                formData.append('sourceType', 'uploadedfile')

                const uploadedFile = await callApi({
                    req,
                    path: 'public_file/upload',
                    method: 'post',
                    body: formData,
                    isFormData: true,
                })

                // TODO: upload to personal workspace
                const workspace = await prisma.claro_workspace.findMany({
                    where: {
                        is_personal: true,
                        creator_id: currentInscription.claro_user.id,
                    },
                    select: {
                        id: true,
                        uuid: true,
                        slug: true,
                        entity_name: true,
                        code: true,
                        claro_resource_node: true,
                    },
                })

                const rootResource = workspace[0]?.claro_resource_node

                const resources = await callApi({
                    req,
                    path: `resource/${rootResource[0]?.uuid}`,
                })

                if (resources) {
                    const ATTESTATIONS_FOLDER_NAME = 'Mes attestations'

                    const foundAttestationsFolder = resources.find(({ name }) => name === ATTESTATIONS_FOLDER_NAME)

                    const destinationParentResource = foundAttestationsFolder?.id ?? rootResource[0]?.uuid

                    const fileResource = await callApi({
                        req,
                        path: `/resources/add/${destinationParentResource}`,
                        method: 'post',
                        body: {
                            resource: {
                                file: uploadedFile[0],
                                size: uploadedFile[0].size,
                                hashName: uploadedFile[0].url,
                            },
                            resourceNode: {
                                autoId: 0,
                                id: uuidv4(),
                                name: sessionName,
                                meta: {
                                    published: true,
                                    active: true,
                                    views: 0,
                                    mimeType: 'application/pdf',
                                    type: 'file',
                                    creator: {
                                        autoId: 2,
                                        id: 'b344ea3b-d492-4f50-af7b-d17e752e50a7',
                                        name: 'John Doe',
                                        firstName: 'John',
                                        lastName: 'Doe',
                                        username: 'root',
                                        picture: null,
                                        thumbnail: null,
                                        email: 'claroline@example.com',
                                        administrativeCode: null,
                                        phone: null,
                                        meta: {
                                            acceptedTerms: true,
                                            lastActivity: '2022-08-31T08:31:34',
                                            created: '2021-05-31T13:37:16',
                                            description: null,
                                            mailValidated: false,
                                            mailNotified: false,
                                            personalWorkspace: true,
                                            locale: 'fr',
                                        },
                                        permissions: {
                                            open: true,
                                            contact: false,
                                            edit: true,
                                            administrate: true,
                                            delete: true,
                                        },
                                        restrictions: {
                                            locked: false,
                                            disabled: false,
                                            removed: false,
                                            dates: [null, '2100-01-01T00:00:00'],
                                        },
                                        poster: null,
                                        roles: [
                                            {
                                                id: 'cde9f187-50ba-417b-93c7-fae555dffc13',
                                                type: 1,
                                                name: 'ROLE_USER',
                                                translationKey: 'user',
                                                workspace: null,
                                                context: 'user',
                                            },
                                            {
                                                id: '0a51a59f-6d37-4927-97d3-a068e95d7091',
                                                type: 1,
                                                name: 'ROLE_ADMIN',
                                                translationKey: 'admin',
                                                workspace: null,
                                                context: 'user',
                                            },
                                            {
                                                id: 'a4a0f69b-1ada-4cb1-a8d9-74943c6123f3',
                                                type: 4,
                                                name: 'ROLE_USER_ROOT',
                                                translationKey: 'root',
                                                workspace: null,
                                                context: 'user',
                                            },
                                            {
                                                id: '6120748d-98f6-4da8-8e77-d577e253f956',
                                                type: 2,
                                                name: 'ROLE_WS_MANAGER_8b19a992-8088-4fbc-aaaf-16ca29e7e8fb',
                                                translationKey: 'manager',
                                                workspace: {
                                                    id: '8b19a992-8088-4fbc-aaaf-16ca29e7e8fb',
                                                },
                                                context: 'user',
                                            },
                                            {
                                                id: '34e239ec-01c4-4e1c-beec-c87a063cc67c',
                                                type: 2,
                                                name: 'ROLE_WS_COLLABORATOR_82f3b5fc-d31e-436b-b09d-4443afc9a839',
                                                translationKey: 'collaborator',
                                                workspace: {
                                                    id: '82f3b5fc-d31e-436b-b09d-4443afc9a839',
                                                },
                                                context: 'user',
                                            },
                                            {
                                                id: '10d5f5f5-5360-4922-a802-d319af52094e',
                                                type: 2,
                                                name: 'ROLE_WS_MANAGER_6de368ef-cc1a-4d51-bee0-9260a269c455',
                                                translationKey: 'manager',
                                                workspace: {
                                                    id: '6de368ef-cc1a-4d51-bee0-9260a269c455',
                                                },
                                                context: 'user',
                                            },
                                            {
                                                id: '179179d2-792e-47e8-a048-44a9df2445de',
                                                type: 2,
                                                name: 'ROLE_WS_MANAGER_916c446c-f6d5-4ff4-9cf0-709713560cbe',
                                                translationKey: 'manager',
                                                workspace: {
                                                    id: '916c446c-f6d5-4ff4-9cf0-709713560cbe',
                                                },
                                                context: 'user',
                                            },
                                            {
                                                id: '3e533000-62a2-4b82-a264-94df041083bd',
                                                type: 2,
                                                name: 'ROLE_WS_MANAGER_c3f27b39-5884-4515-b989-21d222a920aa',
                                                translationKey: 'manager',
                                                workspace: {
                                                    id: 'c3f27b39-5884-4515-b989-21d222a920aa',
                                                },
                                                context: 'user',
                                            },
                                            {
                                                id: '54b5b7ad-7177-4ef5-ae84-032560a5cc01',
                                                type: 2,
                                                name: 'ROLE_WS_MANAGER_4bbcf857-c7da-41b7-b842-d796a212f4ab',
                                                translationKey: 'manager',
                                                workspace: {
                                                    id: '4bbcf857-c7da-41b7-b842-d796a212f4ab',
                                                },
                                                context: 'user',
                                            },
                                            {
                                                id: 'eb3dcf62-83e6-4879-9518-cfe0badecc23',
                                                type: 2,
                                                name: 'ROLE_WS_MANAGER_13ffc9bf-8767-4c09-9658-dcfbc6fd478f',
                                                translationKey: 'manager',
                                                workspace: {
                                                    id: '13ffc9bf-8767-4c09-9658-dcfbc6fd478f',
                                                },
                                                context: 'user',
                                            },
                                            {
                                                id: '2e3bd01e-087e-4123-a288-dce0356c0d5f',
                                                type: 2,
                                                name: 'ROLE_WS_MANAGER_70010fa9-b9ff-4f6f-8f5c-4cb26d16712d',
                                                translationKey: 'manager',
                                                workspace: {
                                                    id: '70010fa9-b9ff-4f6f-8f5c-4cb26d16712d',
                                                },
                                                context: 'user',
                                            },
                                            {
                                                id: '77b1d738-4c6e-4661-a504-7ae5d2628704',
                                                type: 2,
                                                name: 'ROLE_WS_MANAGER_9e897371-79a0-48e5-8a9c-558753775fba',
                                                translationKey: 'manager',
                                                workspace: {
                                                    id: '9e897371-79a0-48e5-8a9c-558753775fba',
                                                },
                                                context: 'user',
                                            },
                                            {
                                                id: '8610ae9b-151e-4f25-9340-afc041f5cb45',
                                                type: 2,
                                                name: 'ROLE_WS_MANAGER_a89d6f24-826a-4807-9111-6904ded81824',
                                                translationKey: 'manager',
                                                workspace: {
                                                    id: 'a89d6f24-826a-4807-9111-6904ded81824',
                                                },
                                                context: 'user',
                                            },
                                            {
                                                id: '70d1bb36-cde4-4324-b765-7a1acb037e28',
                                                type: 2,
                                                name: 'ROLE_WS_MANAGER_ed8f9853-908d-4316-af2b-b4598db41769',
                                                translationKey: 'manager',
                                                workspace: {
                                                    id: 'ed8f9853-908d-4316-af2b-b4598db41769',
                                                },
                                                context: 'user',
                                            },
                                            {
                                                id: 'cde9f187-50ba-417b-93c7-fae555dffc13',
                                                type: 1,
                                                name: 'ROLE_USER',
                                                translationKey: 'user',
                                                workspace: null,
                                                context: 'group',
                                            },
                                        ],
                                        groups: [
                                            {
                                                id: '47ae96f5-6cd0-4469-923b-54e0306138a7',
                                                name: 'ROLE_USER',
                                            },
                                        ],
                                        mainOrganization: {
                                            id: 'a4278ecb-9155-446b-b82e-2fb936e6eb07',
                                            name: "Centre d'éducation permanente",
                                            code: 'CEP',
                                            email: null,
                                            type: 'internal',
                                            meta: {
                                                default: false,
                                                position: null,
                                            },
                                            restrictions: {
                                                public: false,
                                                users: -1,
                                            },
                                            parent: {
                                                id: '479b8348-5a39-4c68-86db-a99ef69b759c',
                                                name: 'Organisations (para)publiques et autres entreprises clientes enregistrées',
                                                code: 'AUTRES',
                                                meta: {
                                                    default: false,
                                                },
                                            },
                                            locations: [],
                                        },
                                    },
                                },
                                display: {
                                    fullscreen: false,
                                    showIcon: true,
                                },
                                restrictions: {
                                    dates: [],
                                    hidden: false,
                                    code: null,
                                    allowedIps: [],
                                },
                                notifications: {
                                    enabled: false,
                                },
                                workspace: {
                                    id: workspace[0]?.uuid,
                                    autoId: workspace[0]?.id,
                                    slug: workspace[0]?.slug,
                                    name: workspace[0]?.entity_name,
                                    code: workspace[0]?.code,
                                },
                                rights: [
                                    {
                                        id: 8783,
                                        name: 'ROLE_USER',
                                        translationKey: 'user',
                                        permissions: {
                                            open: false,
                                            copy: false,
                                            export: false,
                                            delete: false,
                                            edit: false,
                                            administrate: false,
                                            create: [],
                                        },
                                        workspace: null,
                                    },
                                    {
                                        id: 8784,
                                        name: 'ROLE_ANONYMOUS',
                                        translationKey: 'anonymous',
                                        permissions: {
                                            open: false,
                                            copy: false,
                                            export: false,
                                            delete: false,
                                            edit: false,
                                            administrate: false,
                                            create: [],
                                        },
                                        workspace: null,
                                    },
                                    {
                                        id: 8785,
                                        name: `ROLE_WS_COLLABORATOR_${workspace[0]?.uuid}`,
                                        translationKey: 'collaborator',
                                        permissions: {
                                            open: true,
                                            copy: false,
                                            export: false,
                                            delete: false,
                                            edit: false,
                                            administrate: false,
                                            create: [],
                                        },
                                        workspace: {
                                            id: workspace[0]?.uuid,
                                            name: workspace[0]?.entity_name,
                                            code: workspace[0]?.code,
                                        },
                                    },
                                    {
                                        id: 8786,
                                        name: `ROLE_WS_MANAGER_${workspace[0]?.uuid}`,
                                        translationKey: 'manager',
                                        permissions: {
                                            open: true,
                                            copy: true,
                                            export: true,
                                            delete: true,
                                            edit: true,
                                            administrate: true,
                                            create: [
                                                'file',
                                                'directory',
                                                'text',
                                                'claroline_forum',
                                                'rss_feed',
                                                'claroline_announcement_aggregate',
                                                'claroline_scorm',
                                                'claroline_web_resource',
                                                'hevinci_url',
                                                'icap_blog',
                                                'icap_wiki',
                                                'innova_path',
                                                'ujm_exercise',
                                                'icap_lesson',
                                                'claroline_claco_form',
                                                'ujm_lti_resource',
                                                'icap_bibliography',
                                                'claroline_dropzone',
                                                'shortcut',
                                                'claro_slideshow',
                                                'claroline_big_blue_button',
                                            ],
                                        },
                                        workspace: {
                                            id: workspace[0]?.uuid,
                                            name: workspace[0]?.entity_name,
                                            code: workspace[0]?.code,
                                        },
                                    },
                                ],
                            },
                        },
                    })

                    // TODO do something with the response? Verify that it worked?

                    console.log(fileResource)
                }
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
