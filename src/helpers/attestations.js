import { v4 as uuidv4 } from 'uuid'
import { File, FormData } from 'node-fetch'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import fs from 'fs'
import path from 'path'
import libre from 'libreoffice-convert'
import util from 'util'
import { prisma } from '..'
import { callApi } from '../callApi'
import { attestationTemplateFilesDest } from '../utils'
import { winstonLogger } from '../winston'

libre.convertAsync = util.promisify(libre.convert)

export class AttestationGenerationError extends Error {
    constructor(message, context = {}) {
        super(message)
        this.name = 'AttestationGenerationError'
        this.context = context
    }
}

const getDurationText = ({ days, hours }) =>
    [
        ...(days !== 0 ? [`${days} ${days < 2 ? 'jour' : 'jours'}`] : []),
        ...(hours !== 0 ? [`${hours} ${hours < 2 ? 'heure' : 'heures'}`] : []),
    ].join(' + ')

export async function generateAttestation(selectedTemplateUuid, req, params) {
    if (!selectedTemplateUuid) {
        return
    }

    const {
        courseDurationDays,
        courseDurationHours,
        user,
        courseName,
        sessionName,
        sessionDates,
        former22_course,
        tutors,
        currentInscription,
    } = params

    const logContext = {
        selectedTemplateUuid,
        inscriptionUuid: currentInscription.uuid,
        userUuid: user.uuid,
        userMail: user.mail,
        userFullName: `${user.first_name} ${user.last_name}`,
        sessionName,
    }
    const logStep = (step, details = {}) => {
        winstonLogger.http(`Attestation generation ${step}: ${JSON.stringify({ ...logContext, ...details })}`)
    }

    logStep('started')

    const attestation = await prisma.former22_attestation.findUnique({
        where: {
            uuid: selectedTemplateUuid,
        },
        select: {
            id: true,
            fileOriginalName: true,
            fileStoredName: true,
        },
    })

    if (!attestation) {
        throw new AttestationGenerationError("Le modÃ¨le d'attestation demandÃ© est introuvable.", {
            selectedTemplateUuid,
            inscriptionUuid: currentInscription.uuid,
        })
    }

    const templatePath = path.resolve(attestationTemplateFilesDest, attestation.fileStoredName)

    logStep('template-loaded-from-db', {
        attestationId: attestation.id,
        fileOriginalName: attestation.fileOriginalName,
        fileStoredName: attestation.fileStoredName,
        templatePath,
    })

    if (!fs.existsSync(templatePath)) {
        throw new AttestationGenerationError("Le fichier du modÃ¨le d'attestation est introuvable sur le serveur.", {
            selectedTemplateUuid,
            inscriptionUuid: currentInscription.uuid,
            fileOriginalName: attestation.fileOriginalName,
            fileStoredName: attestation.fileStoredName,
            templatePath,
        })
    }

    const content = fs.readFileSync(templatePath, 'binary')
    logStep('template-file-read', {
        templateSize: content.length,
    })

    const zip = new PizZip(content)

    const doc = new Docxtemplater(zip, {
        delimiters: { start: '[', end: ']' },
        paragraphLoop: true,
        linebreaks: true,
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
                Intl.DateTimeFormat('fr-CH', { year: 'numeric', month: 'long', day: 'numeric' }).format(start_date)
            )
            .join(', '),
        OBJECTIFS: former22_course.goals?.split('\n').map((goal) => ({ OBJECTIF: goal })) ?? '',
        FORMATEURS:
            tutors?.map(({ claro_user: { first_name, last_name } }) => `${first_name} ${last_name}`).join(', ') ??
            'Aucun formateur',
    })
    logStep('docx-rendered')

    const docxBuf = doc.getZip().generate({
        type: 'nodebuffer',
        // compression: DEFLATE adds a compression step.
        // For a 50MB output document, expect 500ms additional CPU time
        // compression: 'DEFLATE',
    })

    const ext = '.pdf'

    // Convert it to pdf format with undefined filter (see Libreoffice docs about filter)
    const pdfBuf = await libre.convertAsync(docxBuf, ext, undefined)
    logStep('pdf-converted', {
        pdfSize: pdfBuf.length,
    })

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

    if (!Array.isArray(uploadedFile) || !uploadedFile[0]?.size || !uploadedFile[0]?.url) {
        throw new AttestationGenerationError("L'upload du PDF dans Claroline a Ã©chouÃ©.", {
            selectedTemplateUuid,
            inscriptionUuid: currentInscription.uuid,
        })
    }
    logStep('claroline-public-file-uploaded', {
        uploadedFileSize: uploadedFile[0].size,
        uploadedFileUrl: uploadedFile[0].url,
    })

    const workspace = currentInscription.claro_user.claro_workspace_claro_user_workspace_idToclaro_workspace
    const rootResource = workspace?.claro_resource_node

    logStep('personal-workspace-resolved', {
        workspaceId: workspace?.id,
        workspaceUuid: workspace?.uuid,
        rootResourceUuid: rootResource?.[0]?.uuid,
    })

    const resources =
        rootResource != null
            ? await callApi({
                  req,
                  path: `resource/${rootResource[0]?.uuid}`,
              })
            : null

    if (!rootResource?.[0]?.uuid) {
        throw new AttestationGenerationError("L'espace personnel Claroline de l'utilisateur est incomplet.", {
            selectedTemplateUuid,
            inscriptionUuid: currentInscription.uuid,
            userUuid: user.uuid,
        })
    }

    if (!Array.isArray(resources)) {
        throw new AttestationGenerationError('La lecture des ressources personnelles Claroline a Ã©chouÃ©.', {
            selectedTemplateUuid,
            inscriptionUuid: currentInscription.uuid,
            rootResourceUuid: rootResource[0].uuid,
        })
    }
    logStep('personal-resources-loaded', {
        rootResourceUuid: rootResource[0].uuid,
        resourcesCount: resources.length,
        hasAttestationsFolder: resources.some(({ name }) => name === 'Mes attestations'),
    })

    const createResource = async ({ uuid }) => {
        logStep('claroline-file-resource-create-started', {
            parentResourceUuid: uuid,
        })
        const createdResource = await callApi({
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

        if (!createdResource?.resourceNode?.id) {
            throw new AttestationGenerationError("La crÃ©ation de la ressource d'attestation Claroline a Ã©chouÃ©.", {
                selectedTemplateUuid,
                inscriptionUuid: currentInscription.uuid,
                parentResourceUuid: uuid,
            })
        }
        logStep('claroline-file-resource-created', {
            parentResourceUuid: uuid,
            resourceUuid: createdResource.resourceNode.id,
        })
    }

    const ATTESTATIONS_FOLDER_NAME = 'Mes attestations'

    const foundAttestationsFolder = resources.find(({ name }) => name === ATTESTATIONS_FOLDER_NAME)

    if (foundAttestationsFolder != null) {
        logStep('attestations-folder-found', {
            attestationsFolderUuid: foundAttestationsFolder.id,
        })
        await createResource({ uuid: foundAttestationsFolder?.id })
    } else {
        logStep('attestations-folder-create-started', {
            rootResourceUuid: rootResource[0]?.uuid,
        })
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

        if (!newAttestationsFolder?.resourceNode?.id) {
            throw new AttestationGenerationError(
                'La crÃ©ation du dossier Mes attestations dans Claroline a Ã©chouÃ©.',
                {
                    selectedTemplateUuid,
                    inscriptionUuid: currentInscription.uuid,
                    rootResourceUuid: rootResource[0].uuid,
                }
            )
        }
        logStep('attestations-folder-created', {
            attestationsFolderUuid: newAttestationsFolder.resourceNode.id,
        })

        await createResource({ uuid: newAttestationsFolder.resourceNode.id })
    }

    await prisma.former22_inscription.update({
        where: {
            inscriptionId: currentInscription.uuid,
        },
        data: {
            attestationId: attestation.id,
        },
    })
    logStep('completed', {
        attestationId: attestation.id,
    })
}
