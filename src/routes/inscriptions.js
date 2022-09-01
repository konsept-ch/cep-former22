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
                                uuid: true,
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
            claro_cursusbundle_course: { uuid: courseUuid, course_name: courseName, session_days: sessionDuration },
            claro_cursusbundle_course_session_user: tutors,
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

                const additionalCourseData = await prisma.former22_course.findUnique({
                    where: { courseId: courseUuid },
                    select: {
                        goals: true,
                    },
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
                    OBJECTIFS: additionalCourseData.goals,
                    FORMATEURS:
                        tutors
                            ?.map(({ claro_user: { first_name, last_name } }) => `${first_name} ${last_name}`)
                            .join(', ') ?? 'Aucun formateur',
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

                const createResource = async ({ uuid }) => {
                    const fileResource = await callApi({
                        req,
                        path: `/resources/add/${uuid}`,
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

                if (resources) {
                    const ATTESTATIONS_FOLDER_NAME = 'Mes attestations'

                    const foundAttestationsFolder = resources.find(({ name }) => name === ATTESTATIONS_FOLDER_NAME)

                    if (foundAttestationsFolder != null) {
                        await createResource({ uuid: foundAttestationsFolder?.id })
                    } else {
                        const newAttestationsFolder = await callApi({
                            req,
                            path: `/resources/add/${rootResource[0]?.uuid}`,
                            method: 'post',
                            body: {
                                resource: null,
                                resourceNode: {
                                    autoId: 0,
                                    id: uuidv4(),
                                    name: 'Mes attestations',
                                    meta: {
                                        published: true,
                                        active: true,
                                        views: 0,
                                        mimeType: 'custom/directory',
                                        type: 'directory',
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
                                                lastActivity: '2022-08-31T11:04:37',
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
                                        id: '5f61e20b-297f-4007-a8d7-dbb6879a7405',
                                        autoId: 1863,
                                        slug: 'paul-henri-hons-unil-ch',
                                        name: 'paul-henri.hons@unil.ch',
                                        code: 'paul-henri.hons@unil.ch',
                                    },
                                    rights: [
                                        {
                                            id: 6161,
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
                                            id: 6160,
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
                                            id: 6159,
                                            name: 'ROLE_WS_COLLABORATOR_5f61e20b-297f-4007-a8d7-dbb6879a7405',
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
                                                id: '5f61e20b-297f-4007-a8d7-dbb6879a7405',
                                                code: 'paul-henri.hons@unil.ch',
                                                name: 'paul-henri.hons@unil.ch',
                                            },
                                        },
                                        {
                                            id: 8545,
                                            name: 'ROLE_WS_MANAGER_5f61e20b-297f-4007-a8d7-dbb6879a7405',
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
                                                id: '5f61e20b-297f-4007-a8d7-dbb6879a7405',
                                                code: 'paul-henri.hons@unil.ch',
                                                name: 'paul-henri.hons@unil.ch',
                                            },
                                        },
                                    ],
                                },
                            },
                        })

                        console.log(newAttestationsFolder)

                        await createResource({ uuid: newAttestationsFolder?.resourceNode?.id })
                    }
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
