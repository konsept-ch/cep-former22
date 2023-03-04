import { Router } from 'express'
import { File, FormData } from 'node-fetch'
import { v4 as uuidv4 } from 'uuid'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import fs from 'fs'
import path from 'path'
import libre from 'libreoffice-convert'
import util from 'util'

import { prisma } from '..'
import { callApi } from '../callApi'
// import { MIDDLEWARE_URL } from '../credentialsConfig'
import { sendEmail } from '../sendEmail'
import { sendSms } from '../sendSms'
import { createService, getLogDescriptions, LOG_TYPES, attestationTemplateFilesDest } from '../utils'
import {
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
import { invoiceReasonsFromPrisma, invoiceStatusesFromPrisma, invoiceTypesFromPrisma } from '../constants'

libre.convertAsync = util.promisify(libre.convert)

export const inscriptionsRouter = Router()

const getDurationText = ({ days, hours }) =>
    [
        ...(days !== 0 ? [`${days} ${days < 2 ? 'jour' : 'jours'}`] : []),
        ...(hours !== 0 ? [`${hours} ${hours < 2 ? 'heure' : 'heures'}`] : []),
    ].join(' + ')

createService(
    'get',
    '/',
    async (req, res) => {
        const participations = (await fetchInscriptionsWithStatuses()).filter(
            ({ status }) => status !== STATUSES.REFUSEE_PAR_RH
        )

        if (participations.length > 0) {
            res.json(participations)
        } else if (participations === -1) {
            res.status(500).json('Erreur')
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
        const hrRefusals = (await fetchInscriptionsWithStatuses()).filter(
            ({ status }) => status === STATUSES.REFUSEE_PAR_RH
        )

        if (hrRefusals.length > 0) {
            res.json(hrRefusals)
        } else if (hrRefusals === -1) {
            res.status(500).json('Erreur')
        } else {
            res.json('Aucun refus RH trouvé')
        }
    },
    null,
    inscriptionsRouter
)

createService(
    'put',
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
                        price: true,
                        claro_cursusbundle_course: {
                            select: {
                                uuid: true,
                                course_name: true,
                                session_days: true,
                                session_hours: true,
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
            price: sessionPrice,
            claro_cursusbundle_course: {
                uuid: courseUuid,
                course_name: courseName,
                session_days: courseDurationDays,
                session_hours: courseDurationHours,
            },
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

        const arePrevAndNextStatusesPartOfSameLockGroup = lockGroups.some(
            (lockGroup) => lockGroup.includes(currentInscriptionStatus) && lockGroup.includes(newStatus)
        )

        if (finalStatuses.includes(currentInscriptionStatus) && !arePrevAndNextStatusesPartOfSameLockGroup) {
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

            if (selectedAttestationTemplateUuid && selectedAttestationTemplateUuid !== 'no-attestation') {
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

                const courseDurationText = getDurationText({ days: courseDurationDays, hours: courseDurationHours })

                doc.render({
                    PARTICIPANT_NOM: `${user.first_name} ${user.last_name}`,
                    FORMATION_NOM: courseName,
                    SESSION_DATE_FIN: Intl.DateTimeFormat('fr-CH', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    }).format(sessionDates.at(-1)?.claro_planned_object?.start_date),
                    SESSION_DURÉE: courseDurationText.length > 0 ? courseDurationText : 'non renseigné',
                    SESSION_DATES: sessionDates
                        .map(({ claro_planned_object: { start_date } }) =>
                            Intl.DateTimeFormat('fr-CH', { year: 'numeric', month: 'long', day: 'numeric' }).format(
                                start_date
                            )
                        )
                        .join(', '),
                    OBJECTIFS: additionalCourseData.goals.split('\n').map((goal) => ({ OBJECTIF: goal })),
                    FORMATEURS:
                        tutors
                            ?.map(({ claro_user: { first_name, last_name } }) => `${first_name} ${last_name}`)
                            .join(', ') ?? 'Aucun formateur',
                })

                const docxBuf = doc.getZip().generate({
                    type: 'nodebuffer',
                    // compression: DEFLATE adds a compression step.
                    // For a 50MB output document, expect 500ms additional CPU time
                    // compression: 'DEFLATE',
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
                // const workspace = await prisma.claro_workspace.findMany({
                //     where: {
                //         is_personal: true,
                //         creator_id: currentInscription.claro_user.id,
                //     },
                //     select: {
                //         id: true,
                //         uuid: true,
                //         slug: true,
                //         entity_name: true,
                //         code: true,
                //         claro_resource_node: true,
                //     },
                // })

                const workspace = currentInscription.claro_user.claro_workspace_claro_user_workspace_idToclaro_workspace
                const rootResource = workspace?.claro_resource_node

                const resources =
                    rootResource != null
                        ? await callApi({
                              req,
                              path: `resource/${rootResource[0]?.uuid}`,
                          })
                        : null

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
                                    id: workspace?.uuid,
                                    autoId: workspace?.id,
                                    slug: workspace?.slug,
                                    name: workspace?.entity_name,
                                    code: workspace?.code,
                                },
                                rights: [
                                    {
                                        // id: 8783,
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
                                        // id: 8784,
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
                                        // id: 8785,
                                        name: `ROLE_WS_COLLABORATOR_${workspace?.uuid}`,
                                        translationKey: 'collaborator',
                                        permissions: {
                                            open: true,
                                            copy: false,
                                            export: true,
                                            delete: false,
                                            edit: false,
                                            administrate: false,
                                            create: [],
                                        },
                                        workspace: {
                                            id: workspace?.uuid,
                                            name: workspace?.entity_name,
                                            code: workspace?.code,
                                        },
                                    },
                                    {
                                        // id: 8786,
                                        name: `ROLE_WS_MANAGER_${workspace?.uuid}`,
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
                                            id: workspace?.uuid,
                                            name: workspace?.entity_name,
                                            code: workspace?.code,
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
                                        id: workspace?.uuid,
                                        autoId: workspace?.id,
                                        slug: workspace?.slug,
                                        name: workspace?.entity_name,
                                        code: workspace?.code,
                                    },
                                    rights: [
                                        {
                                            // id: 6161,
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
                                            // id: 6160,
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
                                            // id: 6159,
                                            name: `ROLE_WS_COLLABORATOR_${workspace?.uuid}`,
                                            translationKey: 'collaborator',
                                            permissions: {
                                                open: true,
                                                copy: false,
                                                export: true,
                                                delete: false,
                                                edit: false,
                                                administrate: false,
                                                create: [],
                                            },
                                            workspace: {
                                                id: workspace?.uuid,
                                                name: workspace?.entity_name,
                                                code: workspace?.code,
                                            },
                                        },
                                        {
                                            // id: 8545,
                                            name: `ROLE_WS_MANAGER_${workspace?.uuid}`,
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
                                                id: workspace?.uuid,
                                                name: workspace?.entity_name,
                                                code: workspace?.code,
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
            } else {
                // TODO throw error?
            }

            const mainOrganization = user.user_organization[0]?.claro__organization

            const organization = await prisma.former22_organization.findUnique({
                where: { organizationUuid: mainOrganization?.uuid },
            })

            let config = null

            // TODO: const statusesThatAlwaysGenerateDirectInvoiceOnly = [STATUSES.NON_PARTICIPATION, STATUSES.ANNULEE_FACTURABLE]
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
                    concerns: 'Annulation/report hors-délai',
                    unit: { value: 'forfait(s)', label: 'forfait(s)' },
                    reason: 'Annulation',
                    price: '50',
                }
            }

            if (
                organization?.billingMode === 'Directe' &&
                [STATUSES.PARTICIPATION, STATUSES.PARTICIPATION_PARTIELLE].includes(newStatus)
            ) {
                config = {
                    unit: { value: 'part.', label: 'part.' },
                    reason: 'Participation',
                    price: `${sessionPrice}`,
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
                } = mainOrganization ?? {}

                await createInvoice({
                    invoiceData: {
                        status: { value: 'A_traiter', label: invoiceStatusesFromPrisma.A_traiter },
                        invoiceType: { value: 'Directe', label: invoiceTypesFromPrisma.Directe },
                        reason: { value: config.reason, label: invoiceReasonsFromPrisma[config.reason] },
                        client: {
                            value: code,
                            label: name,
                            uuid,
                        },
                        customClientAddress: `${name}\n${addressTitle ? `${addressTitle}\n` : ''}${
                            postalAddressDepartment ? `${postalAddressDepartment}\n` : ''
                        }${postalAddressStreet ? `${postalAddressStreet}\n` : ''}${
                            postalAddressCode ? `${postalAddressCode} ` : ''
                        }${postalAddressLocality ? `${postalAddressLocality}\n` : ''}${postalAddressCountry ?? ''}`,
                        customClientEmail: mainOrganization.email,
                        selectedUserUuid: '',
                        customClientTitle: '',
                        customClientFirstname: '',
                        customClientLastname: '',
                        courseYear: new Date().getFullYear(),
                        invoiceDate: new Date().toISOString(),
                        concerns: config.concerns,
                        items: [
                            {
                                designation: `${user.first_name} ${user.last_name} - ${sessionName}`,
                                unit: config.unit,
                                price: config.price, // Prix TTC (coût affiché sur le site Claroline)
                                amount: '1',
                                vatCode: { value: 'EXONERE', label: 'EXONERE' },
                                inscriptionId: currentInscription.id,
                            },
                        ],
                        // TODO probably keep the inscription ids as a foreign key for direct and grouped
                        // inscriptionId: currentInscription.id,
                        // inscriptionStatus: newStatus,
                    },
                    cfEmail: req.headers['x-login-email-address'],
                })
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
        } else {
            res.json('Aucune inscription trouvée')
        }
    },
    { entityType: LOG_TYPES.INSCRIPTION },
    inscriptionsRouter
)
