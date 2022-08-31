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
        const { course_name: sessionName } = session
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
                    SESSION_NOM: sessionName,
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

                // Here in done you have pdf file which you can save or transfer in another stream
                // fs.writeFileSync(path.join(attestationFilesDest, pdfFileName), pdfBuf)

                const formData = new FormData()
                const fileBinary = new File([pdfBuf], `${originalPdfName}${ext}`, {
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

                // console.log(uploadedFile)

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

                // console.warn(workspace)
                // console.warn(workspace[0]?.uuid)
                const rootResource = workspace[0]?.claro_resource_node
                // console.warn(rootResource)
                // console.warn(rootResource[0]?.uuid)

                const resources = await callApi({
                    req,
                    path: `resource/${rootResource[0]?.uuid}`,
                })

                // console.warn(resources)

                if (resources) {
                    const ATTESTATIONS_FOLDER_NAME = 'Mes attestations'

                    const foundAttestationsFolder = resources.find(({ name }) => name === ATTESTATIONS_FOLDER_NAME)

                    // console.warn(foundAttestationsFolder)
                    // console.warn(foundAttestationsFolder.id)

                    // const filePath = `data/aaaaaaaaaaaaaaaaaaaa/${pdfFileName}`

                    const fileResource = await callApi({
                        req,
                        path: `/resources/add/${foundAttestationsFolder.id}`,
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
                                name: 'Attestation',
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
                                        administratedOrganizations: [
                                            {
                                                id: '091bb5c3-3308-452a-b652-a0075bc79673',
                                                name: "Commune d'Aclens",
                                                code: '1123',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '4912a797-470a-4627-bf01-b0d822dd9ce6',
                                                name: "Commune d'Agiez",
                                                code: '1352',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '65a3d9dc-0df1-4ca1-a924-f01ba7d15d2c',
                                                name: "Commune d'Aigle",
                                                code: '1860',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '3c9d4634-5900-4cbd-9e8d-cb1dee59a4f6',
                                                name: "Commune d'Allaman",
                                                code: '1165',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'e03aa042-e33b-4d8b-b941-d6df439b95dc',
                                                name: "Commune d'Arnex-sur-Nyon",
                                                code: '1277',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '315ee870-cf3a-4aed-b77c-c26dd9242416',
                                                name: "Commune d'Arnex-sur-Orbe",
                                                code: '1321',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '00c12b2c-087a-403d-a8c6-a1bd1e71e421',
                                                name: "Commune d'Arzier-Le Muids",
                                                code: '1273',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'be1ec440-d05d-4722-88c7-565952f0feed',
                                                name: "Commune d'Assens",
                                                code: '1042',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'fd969edc-ecd6-42c7-83f3-05f94d991f48',
                                                name: "Commune d'Aubonne",
                                                code: '1170',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd3553120-ee1e-4145-8968-a91a668cb3fc',
                                                name: "Commune d'Avenches",
                                                code: '1580',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'a6caa5f4-6024-41e6-8e7a-f0ca7871abd8',
                                                name: 'Commune de Ballaigues',
                                                code: '1338',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '364e52d4-3c38-4a13-b7c4-86db1def2a35',
                                                name: 'Commune de Ballens',
                                                code: '1144',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd9ca91c1-27d8-4cf7-89b5-ad0c4e3392c7',
                                                name: 'Commune de Bassins',
                                                code: '1269',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'e4117c08-eb46-4849-9312-aefdd14fe3aa',
                                                name: 'Commune de Baulmes',
                                                code: '1446',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'f3eeb771-8b7a-401c-948a-d24e63d23666',
                                                name: 'Commune de Bavois',
                                                code: '1372',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '3fb1fd12-7868-4598-a33b-86c18746b9de',
                                                name: 'Commune de Begnins',
                                                code: '1268',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'ddd12a76-2128-49bb-8c3d-c5897821e6ca',
                                                name: 'Commune de Belmont-sur-Lausanne',
                                                code: '1092',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'e137816a-b0d2-4937-9757-fd3495352fc7',
                                                name: 'Commune de Belmont-sur-Yverdon',
                                                code: '1432',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd0460dd9-e4c4-4534-acd1-0555f3100359',
                                                name: 'Commune de Bercher',
                                                code: '1038',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'ff286dba-0611-47f2-8559-1a3d01250b6d',
                                                name: 'Commune de Berolle',
                                                code: '1149',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd6c8b694-54ed-435d-8b98-f1b661451c46',
                                                name: 'Commune de Bettens',
                                                code: '1042a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '6f654c2a-85d1-4ce8-9bd5-f9f0c7ee7f36',
                                                name: 'Commune de Bex',
                                                code: '1880',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'ceabf619-9329-4c42-a6b0-5b6c32fcd79b',
                                                name: 'Commune de Bière',
                                                code: '1145',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '130fe39f-140e-4d9b-82c8-001285984c02',
                                                name: 'Commune de Bioley-Magnoux',
                                                code: '1407a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '0d6a51d0-a623-440c-9b5c-0632ef9f7b58',
                                                name: 'Commune de Blonay - Saint-Légier',
                                                code: '1807',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '74d10e42-b676-44d2-9458-2080911fb9d8',
                                                name: 'Commune de Bofflens',
                                                code: '1353',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '07fee161-2248-441e-a978-98461970033a',
                                                name: 'Commune de Bogis-Bossey',
                                                code: '1279a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'ac3ba591-a6be-475b-b8b8-2aa4d84cfbdd',
                                                name: 'Commune de Bonvillars',
                                                code: '1427',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'c6cdd839-a650-4cba-b28f-5f0943296790',
                                                name: 'Commune de Borex',
                                                code: '1277a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '928176a3-b118-4056-bf8d-93dab355bfc5',
                                                name: 'Commune de Bottens',
                                                code: '1041',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '4f252887-81dd-4c49-b16a-2b446c694919',
                                                name: 'Commune de Bougy-Villars',
                                                code: '1172',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd6f26d43-edb9-460d-8bd0-38c7c8237038',
                                                name: 'Commune de Boulens',
                                                code: '1063',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '2f1ce937-4923-4a83-a09a-6e0ee36c610e',
                                                name: 'Commune de Bourg-en-Lavaux',
                                                code: '1096',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '4e860913-b031-4590-ae5d-9da0f6dd86d6',
                                                name: 'Commune de Bournens',
                                                code: '1035',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '7710b6b1-871a-4239-afad-d8a795591820',
                                                name: 'Commune de Boussens',
                                                code: '1034',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd19e80f9-a98a-4756-aee1-1a67389bfe22',
                                                name: 'Commune de Bremblens',
                                                code: '1121',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '0c2b8c79-eb2a-49ce-884d-edd5293def24',
                                                name: 'Commune de Bretigny-sur-Morrens',
                                                code: '1053a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'f3dc10b7-7336-4198-8046-490e5802ecf7',
                                                name: 'Commune de Bretonnières',
                                                code: '1329',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'ac305376-b288-4a06-9abf-d046ab872f0d',
                                                name: 'Commune de Buchillon',
                                                code: '1164',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'be7236c2-33ff-4308-8f38-f3fd10cd5a8b',
                                                name: 'Commune de Bullet',
                                                code: '1453',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'b216314a-e1f8-488e-9e15-90e6c913c498',
                                                name: 'Commune de Bursinel',
                                                code: '1195',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'b7b9faa7-55f6-4c7a-b5a0-f771e0d8b227',
                                                name: 'Commune de Bursins',
                                                code: '1183',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '6128059b-649c-46ee-a6df-c64661087a83',
                                                name: 'Commune de Burtigny',
                                                code: '1268a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '76e5ae4b-140e-496e-9680-133e4181fa9f',
                                                name: 'Commune de Bussigny',
                                                code: '1030',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '25cc890e-7687-44ba-8267-a75bb144e05b',
                                                name: 'Commune de Bussy-sur-Moudon',
                                                code: '1514',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '40200895-016b-4271-8873-65cccfbc5a63',
                                                name: 'Commune de Chamblon',
                                                code: '1436',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'a42cc209-6d20-41de-afc9-49085f0f9946',
                                                name: 'Commune de Champagne',
                                                code: '1424',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'db7d022b-5125-41ee-a151-d6c5357cefa2',
                                                name: 'Commune de Champtauroz',
                                                code: '1537',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'fa473595-5b8f-41aa-8cf5-b270ba8328c6',
                                                name: 'Commune de Champvent',
                                                code: '1443',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'afcb7d93-6f96-40db-a4ac-6924d2046efa',
                                                name: 'Commune de Chardonne',
                                                code: '1803',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '71ea6d06-e11c-4061-bb40-3d7538231cc9',
                                                name: "Commune de Château-d'Oex",
                                                code: '1660',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '729209ff-0247-468a-9333-60483adcbb36',
                                                name: 'Commune de Chavannes-de-Bogis',
                                                code: '1279',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'ee539809-33b7-47fb-93bd-5179eee7b194',
                                                name: 'Commune de Chavannes-des-Bois',
                                                code: '1290',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'b35a5de2-29d6-49e1-9b7d-ae67ef75c7c2',
                                                name: 'Commune de Chavannes-le-Chêne',
                                                code: '1464',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'feb6e315-0445-45e6-a1db-908ecf073a33',
                                                name: 'Commune de Chavannes-le-Veyron',
                                                code: '1309',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '2330f07e-7f38-4e96-9602-09d63c694ca8',
                                                name: 'Commune de Chavannes-près-Renens',
                                                code: '1022',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '6517bd87-9865-4264-ac87-48d4a36c2e18',
                                                name: 'Commune de Chavannes-sur-Moudon',
                                                code: '1512',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'f7358910-c668-437e-bbab-bf4f888db755',
                                                name: 'Commune de Chavornay',
                                                code: '1373',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '18b88491-5791-4cb7-b496-8ebd57f97016',
                                                name: 'Commune de Chêne-Pâquier',
                                                code: '1464a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '9ebfc2c5-9ea7-4128-8367-c12d26e65a76',
                                                name: 'Commune de Cheseaux-Noréaz',
                                                code: '1400',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'b003c7dc-5a66-471f-aaec-140c7ded21a3',
                                                name: 'Commune de Cheseaux-sur-Lausanne',
                                                code: '1033',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '16ed0ee2-a9e1-4804-8c3b-2c12683e3c0b',
                                                name: 'Commune de Chéserex',
                                                code: '1275',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'c0612183-9162-41a4-9e01-d8142cb33e33',
                                                name: 'Commune de Chessel',
                                                code: '1846',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '03a8e86c-eefd-4ade-b196-8006b039c344',
                                                name: 'Commune de Chevilly',
                                                code: '1316',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'f5a048f5-8f6d-4cec-95cd-c8bdfb546450',
                                                name: 'Commune de Chevroux',
                                                code: '1545',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'b73914a4-8e00-4401-b5eb-8db93ca61965',
                                                name: 'Commune de Chexbres',
                                                code: '1071',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '843d3c62-7a3b-4db5-9a1e-2e127ad955f6',
                                                name: 'Commune de Chigny',
                                                code: '1134',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'afee8523-fc94-45eb-bb08-208e983fa5e1',
                                                name: 'Commune de Clarmont',
                                                code: '1127',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'cc1bcf3f-5d74-4f10-acb1-faf939e882f9',
                                                name: 'Commune de Coinsins',
                                                code: '1267',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '8fd1a182-0472-4cde-a4dc-40658f0b599c',
                                                name: 'Commune de Commugny',
                                                code: '1291',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '17cd4190-682a-406b-a82f-23d83e1efdfb',
                                                name: 'Commune de Concise',
                                                code: '1426',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '6fbc199f-68cf-4568-b622-98bd34dd8c79',
                                                name: 'Commune de Coppet',
                                                code: '1296',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '04b7b573-f73d-415a-8168-daaa489cee28',
                                                name: 'Commune de Corbeyrier',
                                                code: '1856',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '0f626d11-33d8-4f26-861c-f41db9e961dc',
                                                name: 'Commune de Corcelles-le-Jorat',
                                                code: '1082',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'ae75a84b-e39a-4ddc-8ebb-24af40192b5b',
                                                name: 'Commune de Corcelles-près-Concise',
                                                code: '1426a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'be18f6b0-f39d-4992-9721-8ea64658dfb5',
                                                name: 'Commune de Corcelles-près-Payerne',
                                                code: '1562',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '83453d64-7a1b-4874-9f3c-a304df325b0b',
                                                name: 'Commune de Corseaux',
                                                code: '1802',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd60acff6-6db5-450e-b35c-7b071a6f6f6b',
                                                name: 'Commune de Corsier-sur-Vevey',
                                                code: '1804',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'c5d351ac-6b07-497f-9189-f1d2e4dc9a8b',
                                                name: 'Commune de Cossonay',
                                                code: '1304',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '24dd429c-c0b9-4988-b618-a263596f87a7',
                                                name: 'Commune de Crans-près-Céligny',
                                                code: '1299',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '85b2bf61-556e-48a2-b65b-29a8f547c70a',
                                                name: 'Commune de Crassier',
                                                code: '1263',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'f0488a05-5aea-45af-baf4-4f3222c78575',
                                                name: 'Commune de Crissier',
                                                code: '1023',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '2e3ac70f-51e8-4b16-9f34-ba77ed5ea0df',
                                                name: 'Commune de Cronay',
                                                code: '1403',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'b3cc9b43-f9de-493f-83e0-5919f1e50667',
                                                name: 'Commune de Croy',
                                                code: '1322',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'fb9b292b-df41-48cd-ba00-a081d8aa0625',
                                                name: 'Commune de Cuarnens',
                                                code: '1148a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '8231134c-670a-4831-98b0-2f9f21397d61',
                                                name: 'Commune de Cuarny',
                                                code: '1404',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '630ec330-3e50-455f-b502-6ae0349cfd05',
                                                name: 'Commune de Cudrefin',
                                                code: '1588',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'acae0be1-fc7f-4cbd-8f12-387295a09b8a',
                                                name: 'Commune de Cugy',
                                                code: '1053',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '445459c9-5d3b-4796-9faa-e70b83592233',
                                                name: 'Commune de Curtilles',
                                                code: '1521',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '44c2b2f0-6043-4ed8-a8b6-ea1c088d8a81',
                                                name: 'Commune de Daillens',
                                                code: '1306',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '62ce0393-335b-4175-bb4e-0bc7a82f845c',
                                                name: 'Commune de Démoret',
                                                code: '1415',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '5af30be9-8bb7-4ce1-8992-02dc57108486',
                                                name: 'Commune de Denens',
                                                code: '1135',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '32547c95-8e03-4b3c-b6a4-bd2c5a48f4ba',
                                                name: 'Commune de Denges',
                                                code: '1026',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '1d3add2e-8ef7-4ac4-b940-5a112ef3dc55',
                                                name: 'Commune de Dizy',
                                                code: '1304b',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'acacb7fb-1730-41b9-8de0-d64d72a205cd',
                                                name: 'Commune de Dompierre',
                                                code: '1682',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'b089d159-8794-4ca8-a738-e12b47dbffa8',
                                                name: 'Commune de Donneloye',
                                                code: '1407',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'bf858c2b-f198-4a5c-bd34-906cbcc51036',
                                                name: 'Commune de Duillier',
                                                code: '1266',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '77182f13-68bf-49ce-94a6-11073324b0f3',
                                                name: 'Commune de Dully',
                                                code: '1195a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'ce1161f3-c6ba-4432-8291-aa6cd171d517',
                                                name: "Commune d'Echallens",
                                                code: '1040',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '57f89fe3-3eb2-43e4-b697-971668197e0d',
                                                name: "Commune d'Echandens",
                                                code: '1026a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'b9765415-ac57-453a-b858-c350e42be2bb',
                                                name: "Commune d'Echichens",
                                                code: '1112',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '767bd6b2-f3e3-46ad-bbea-3150273fe81c',
                                                name: "Commune d'Eclépens",
                                                code: '1312',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '22c1ce9f-b172-485c-bab5-5513e9d0f830',
                                                name: "Commune d'Ecublens",
                                                code: '1024',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'f226599f-d42a-47f8-a26f-e31099903169',
                                                name: "Commune d'Epalinges",
                                                code: '1066',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '73a1fecc-92ce-4eb8-bfe5-a32e8fa34ccd',
                                                name: "Commune d'Ependes",
                                                code: '1434',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '36da8080-c277-465f-ba2a-b98973913e50',
                                                name: "Commune d'Essertes",
                                                code: '1078',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '66bd26eb-5d3b-48cc-8614-2c73d7b8cc56',
                                                name: "Commune d'Essertines-sur-Rolle",
                                                code: '1186',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd99a81af-fcff-4cd0-b10c-88cfcc6287b3',
                                                name: "Commune d'Essertines-sur-Yverdon",
                                                code: '1417',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd52dfb95-5d14-47c1-8b34-0312578881fd',
                                                name: "Commune d'Etagnières",
                                                code: '1037',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'c33bf7f2-b06a-47da-8a11-3ae1c1abea70',
                                                name: "Commune d'Etoy",
                                                code: '1163',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'da21c088-d664-4dca-bf05-d7866f25ed82',
                                                name: "Commune d'Eysins",
                                                code: '1262',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '306d8524-18c5-4fbc-94af-e471adb5777c',
                                                name: 'Commune de Faoug',
                                                code: '1595',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '23f91529-2d6c-498c-9ba3-02339d57a562',
                                                name: 'Commune de Féchy',
                                                code: '1173',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'e2e06bc3-1db5-46e9-9f1f-fa0ff5559bf1',
                                                name: 'Commune de Ferreyres',
                                                code: '1313',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '0b00f355-2670-41cb-9fdd-eef1f5e62c8e',
                                                name: 'Commune de Fey',
                                                code: '1044',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '8b005652-9044-4f46-bd89-3029d69b55d5',
                                                name: 'Commune de Fiez',
                                                code: '1420',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '7374a9e7-c5cc-4248-8b0c-21feb954bd0e',
                                                name: 'Commune de Fontaines-sur-Grandson',
                                                code: '1421',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '2c52648f-c0da-4153-823a-eb749eeec523',
                                                name: 'Commune de Forel (Lavaux)',
                                                code: '1072',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '2998b751-2e69-4231-9021-0f6e9d819ffb',
                                                name: 'Commune de Founex',
                                                code: '1297',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'c6cb7ca5-5933-455d-ab08-069cd3786783',
                                                name: 'Commune de Froideville',
                                                code: '1055',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '46aea125-7105-4451-aa4b-ab6ff58a8f6e',
                                                name: 'Commune de Genolier',
                                                code: '1272',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '6dc5a006-23b6-4c95-9449-7e149ab8a3a6',
                                                name: 'Commune de Giez',
                                                code: '1429',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '442f2c1c-c91f-48f4-8062-ed6c053cd025',
                                                name: 'Commune de Gilly',
                                                code: '1182',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '0631dbc4-b3c5-4b0a-a0cb-8072ee43c469',
                                                name: 'Commune de Gimel',
                                                code: '1188',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'ac3174ce-dfa6-42c1-aa9f-667860c857be',
                                                name: 'Commune de Gingins',
                                                code: '1296a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '9afb908e-b216-4f55-8384-d371e7fdd24d',
                                                name: 'Commune de Givrins',
                                                code: '1271',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '622f8fc6-c1f4-4123-9f44-cd7e70ecb1bd',
                                                name: 'Commune de Gland',
                                                code: '1196',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'ba425208-ca8d-4ab5-b261-04df99b94f4a',
                                                name: 'Commune de Gollion',
                                                code: '1124',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'fde0a44c-0edd-4a8a-98a8-c544b02f8af2',
                                                name: 'Commune de Goumoëns',
                                                code: '1376',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'a99bbef3-3aa5-4526-910f-54205c23bb2b',
                                                name: 'Commune de Grancy',
                                                code: '1117',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '35f4cdf3-bcef-40d1-ab4b-4c533da0de15',
                                                name: 'Commune de Grandcour',
                                                code: '1543',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd2d781ee-6635-4f9a-9e79-54abf0f0c06d',
                                                name: 'Commune de Grandevent',
                                                code: '1421a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '22edafa9-7c88-4a69-9585-a450d2bbdaca',
                                                name: 'Commune de Grens',
                                                code: '1274a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '07340995-1e56-4399-b93c-200c8491add9',
                                                name: 'Commune de Gryon',
                                                code: '1882',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'a8439634-f817-4a69-af54-dc807bb8328f',
                                                name: 'Commune de Hautemorges',
                                                code: '1143',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '2014819d-02ba-4329-a949-85781b80ef8d',
                                                name: 'Commune de Henniez',
                                                code: '1525',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '0734f1d0-e50f-480b-8f35-7b96bc5fcff1',
                                                name: 'Commune de Hermenches',
                                                code: '1513',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'f0206962-0713-4789-96b9-fe245557b643',
                                                name: 'Commune de Jongny',
                                                code: '1805',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '2bb36f62-8627-44f8-acb2-348c697504e9',
                                                name: 'Commune de Jorat-Menthue',
                                                code: '1062',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '6f3f5ec2-c4e4-4014-96a1-cc9e9e1edf3e',
                                                name: 'Commune de Jorat-Mézières',
                                                code: '1084',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd60a5214-577c-4cd9-9259-4224220550b1',
                                                name: 'Commune de Jouxtens-Mézery',
                                                code: '1008a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '9b11ee45-6af7-49fe-b8d7-157fac346c60',
                                                name: 'Commune de Juriens',
                                                code: '1326',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'bac71c9a-2dbd-4734-b5f0-6fd08c5c5814',
                                                name: 'Commune de La Chaux (Cossonay)',
                                                code: '1308',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'a82ae227-8797-4a5c-b6d1-99f59c1383a9',
                                                name: 'Commune de La Praz',
                                                code: '1148b',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '18058fb1-d5b4-448d-b08e-764daa4ffa7f',
                                                name: 'Commune de La Rippe',
                                                code: '1278',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '6e6313cd-6803-462d-b553-089f2f0d0e01',
                                                name: 'Commune de La Sarraz',
                                                code: '1315',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '595cd3d2-b2d8-4579-b5da-96e23870f134',
                                                name: 'Commune de La Tour-de-Peilz',
                                                code: '1814',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '67c4cf97-d06c-4bce-8bed-bbaa0350bf97',
                                                name: "Commune de L'Abbaye",
                                                code: '1344',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '51829cc9-e18a-488e-b16c-d1b84a3bd2ff',
                                                name: "Commune de L'Abergement",
                                                code: '1355',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '03d44a15-948e-4840-a191-09971285f9eb',
                                                name: 'Commune de Lavey-Morcles',
                                                code: '1892',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'b0a8179d-8f55-414b-997b-87b122819af1',
                                                name: 'Commune de Lavigny',
                                                code: '1175',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '61e32438-f20f-4248-811e-1d25f8d6f6b3',
                                                name: 'Commune de Le Chenit',
                                                code: '1347',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '1776fb82-d9e8-4d18-b7e8-92fe575e0fcb',
                                                name: 'Commune de Le Lieu',
                                                code: '1345',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '0312bc76-30a8-442d-9dc3-4f933bb4cb37',
                                                name: 'Commune de Le Mont-sur-Lausanne',
                                                code: '1052',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '744b58b1-707c-4a08-adb8-fb236d4f1693',
                                                name: 'Commune de Le Vaud',
                                                code: '1261',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '3a33edcb-2b77-480b-abbf-dc640d132b59',
                                                name: 'Commune de Les Clées',
                                                code: '1356',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '8822da6a-74a4-493d-b227-cc4ee9745152',
                                                name: 'Commune de Leysin',
                                                code: '1854',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '95a7acf5-614b-4843-b763-a1bc9ecd8c5a',
                                                name: 'Commune de Lignerolle',
                                                code: '1357',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '1b57f733-00b3-423a-a1b9-33d373ae0bd3',
                                                name: "Commune de L'Isle",
                                                code: '1148',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '8edf75a7-5a95-41c8-872a-a630d476703e',
                                                name: 'Commune de Lonay',
                                                code: '1027',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'ac16320e-6bb7-445f-beb5-41f28713d22f',
                                                name: 'Commune de Longirod',
                                                code: '1261a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '35c2d898-099b-404f-a7a6-df3da3e54146',
                                                name: 'Commune de Lovatens',
                                                code: '1682a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'a49ed3f9-084a-4a4d-91e9-42e5684aa9a0',
                                                name: 'Commune de Lucens',
                                                code: '1522',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'c9dc7991-02d7-4fba-bc77-105ad246d517',
                                                name: 'Commune de Luins',
                                                code: '1184',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '040ea94f-b307-4105-bf8b-9cc864b4246e',
                                                name: 'Commune de Lully',
                                                code: '1132',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '6cbaf89f-ac66-46d2-a7ba-539df30c65f3',
                                                name: 'Commune de Lussery-Villars',
                                                code: '1307',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'f570f1f4-abab-4f53-83df-1f428b86daa7',
                                                name: 'Commune de Lussy-sur-Morges',
                                                code: '1167',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'a7617660-5b41-444e-b5ac-67a17da55bd0',
                                                name: 'Commune de Lutry',
                                                code: '1095',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '1e0fea59-d3aa-4e27-89ef-6c7cbcd696e7',
                                                name: 'Commune de Maracon',
                                                code: '1613',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '63ad9f26-94b6-41de-abd6-7dbfb29537ee',
                                                name: 'Commune de Marchissy',
                                                code: '1261b',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd665bd4e-9850-4edf-ad46-c23791a4dc5d',
                                                name: 'Commune de Mathod',
                                                code: '1438',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '9d1500e1-b914-4aed-b233-46d430937ff5',
                                                name: 'Commune de Mauborget',
                                                code: '1453a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '066b379e-668e-43b1-90d5-f7dae40f1df3',
                                                name: 'Commune de Mauraz',
                                                code: '1148c',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '4759bda0-fadb-4bbf-8b46-333f53c88fc6',
                                                name: 'Commune de Mex',
                                                code: '1031',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '5144006f-86b4-4d89-8794-78f90cd1956a',
                                                name: 'Commune de Mies',
                                                code: '1295',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '7c84808e-154b-4fbb-bc66-fdf341fa43dc',
                                                name: 'Commune de Missy',
                                                code: '1565',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '50d6c839-03fa-4d95-a95d-efb1763ff333',
                                                name: 'Commune de Moiry',
                                                code: '1314',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '87e54ce5-6e72-4921-97ae-8a911369909a',
                                                name: 'Commune de Mollens',
                                                code: '1146',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '29515928-9ab3-4b60-8721-300a46111a77',
                                                name: 'Commune de Molondin',
                                                code: '1415a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'e59579bd-d9e9-4593-80ba-3af58543b69d',
                                                name: 'Commune de Montagny-près-Yverdon',
                                                code: '1442',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '50aa2b5f-d686-489d-b318-e843145d58da',
                                                name: 'Commune de Montanaire',
                                                code: '1410',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '4d5f53c1-4d5a-4067-9723-94cb359e26e1',
                                                name: 'Commune de Montcherand',
                                                code: '1354',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'aca2a25b-cb0f-490b-8c17-aa4608225cde',
                                                name: 'Commune de Montilliez',
                                                code: '1041a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '0c32a074-75e4-4a44-ae48-296f5ef94f7a',
                                                name: 'Commune de Mont-la-Ville',
                                                code: '1148d',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd4ccb850-88d1-4674-ae46-682ef4fda1a9',
                                                name: 'Commune de Montpreveyres',
                                                code: '1081',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '112747b7-a179-4862-a18b-26b29b49f5ee',
                                                name: 'Commune de Montricher',
                                                code: '1147',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'caa6041e-46fd-4ce5-9da8-fdf00e84c08b',
                                                name: 'Commune de Mont-sur-Rolle',
                                                code: '1185',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'bbd24c51-525a-4801-88dc-a4c9dfaa9d35',
                                                name: 'Commune de Morges',
                                                code: '1110',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '0d81cebc-0b08-41b8-adf7-c7406b26d796',
                                                name: 'Commune de Morrens',
                                                code: '1054',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '839b37fd-8ae9-43c5-89e2-ce43a450637c',
                                                name: 'Commune de Moudon',
                                                code: '1510',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'b6e24498-a2b7-461d-b90f-e12292df35f3',
                                                name: 'Commune de Mutrux',
                                                code: '1428',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '8e5d3273-91ea-4a51-8d64-2e97ec3dbda6',
                                                name: 'Commune de Novalles',
                                                code: '1431',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'c3a58020-0f4e-4fba-abf0-d437722983c9',
                                                name: 'Commune de Noville',
                                                code: '1845',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'a0765d26-7184-4eeb-b2a8-c11100eb6b9a',
                                                name: "Commune d'Ogens",
                                                code: '1045',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'e2dadf9b-0af2-43d2-99ab-93da8f9bc30c',
                                                name: "Commune d'Ollon",
                                                code: '1867',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '5b4e510a-46cd-463d-b367-43df8c1298e4',
                                                name: "Commune d'Onnens",
                                                code: '1425',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'e62f87f6-0847-47c1-a70f-335453a0d7fe',
                                                name: "Commune d'Oppens",
                                                code: '1047',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd1e5961e-6e46-418c-b845-417191e0e5a0',
                                                name: "Commune d'Orbe",
                                                code: '1350',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd3cc898a-a1fe-4bbd-8069-d8e8e9a0f126',
                                                name: "Commune d'Orges",
                                                code: '1430',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '3177c1fb-c747-4e94-8007-f685cc343c94',
                                                name: "Commune d'Ormont-Dessous",
                                                code: '1863',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'e24d1037-a4bc-4fe4-9d37-d04eaa61523e',
                                                name: "Commune d'Ormont-Dessus",
                                                code: '1865',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '69c69f6c-b5bf-4b00-91db-4ad18edc835b',
                                                name: "Commune d'Orny",
                                                code: '1317',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '60b2eb38-2911-4404-8292-847f7caf5025',
                                                name: "Commune d'Oron",
                                                code: '1607',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '6bf3eeca-84b9-470a-b8ed-af5c7d0c86fe',
                                                name: "Commune d'Orzens",
                                                code: '1413',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'afc3d0e7-575f-453f-a2f4-e0f77d45582f',
                                                name: "Commune d'Oulens-sous-Echallens",
                                                code: '1377',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '6630a199-7d74-438a-af59-a2b92d8e767c',
                                                name: 'Commune de Pailly',
                                                code: '1416',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '8d5dd48e-eb9b-46dc-bde3-3a332c50dec1',
                                                name: 'Commune de Paudex',
                                                code: '1094',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '7121674c-b29e-4684-b08f-e31842ba415f',
                                                name: 'Commune de Payerne',
                                                code: '1530',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'c8a1d6d6-794c-4a72-8f0c-e6b41866a02c',
                                                name: 'Commune de Penthalaz',
                                                code: '1305',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '85650c53-13e2-4a1f-865e-faf44aed781a',
                                                name: 'Commune de Penthaz',
                                                code: '1303',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'e537b11e-9e44-4071-82d4-1eb30df2160a',
                                                name: 'Commune de Penthéréaz',
                                                code: '1375',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '7090d788-016c-491c-8759-f2f4d542bb7c',
                                                name: 'Commune de Perroy',
                                                code: '1166',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '7606c8b9-78ff-47cf-8cb6-d0e0cc3e5e71',
                                                name: 'Commune de Poliez-Pittet',
                                                code: '1041b',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '05fe69a7-84f1-494c-b1a5-85f0894a62d8',
                                                name: 'Commune de Pompaples',
                                                code: '1318',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '89a9397d-adc8-48ed-8574-c4e4d685659b',
                                                name: 'Commune de Pomy',
                                                code: '1405',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '221f8f8f-1976-419c-9291-9ac3f223760c',
                                                name: 'Commune de Prangins',
                                                code: '1197',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '3f1f7d85-760f-4e23-9b7d-1a665c854c54',
                                                name: 'Commune de Premier',
                                                code: '1324',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'e208b0b3-4299-4dd3-9178-86595c0bbe29',
                                                name: 'Commune de Préverenges',
                                                code: '1028',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd206da61-0108-489c-b063-81c375cb2640',
                                                name: 'Commune de Prévonloup',
                                                code: '1682b',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'b4dd3217-2d8b-41a7-919b-7098bd10d6c1',
                                                name: 'Commune de Prilly',
                                                code: '1008',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'b01441f9-c1d3-4cc1-ae80-3ea9d6ab96e3',
                                                name: 'Commune de Provence',
                                                code: '1428a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '092856aa-68e4-4de2-af08-8f0554e60882',
                                                name: 'Commune de Puidoux',
                                                code: '1070',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '145128dc-decd-4299-b4ed-a1f026eaa708',
                                                name: 'Commune de Pully',
                                                code: '1009',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'a359762c-7798-4b91-87b8-fb96e6a9dd55',
                                                name: 'Commune de Rances',
                                                code: '1439',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '0d7aab2c-ca61-49fc-8130-4dd0b862031f',
                                                name: 'Commune de Renens',
                                                code: '1020',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '05906626-569a-4817-839c-2d4965363feb',
                                                name: 'Commune de Rennaz',
                                                code: '1847',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd686a038-8c5a-421a-8a0b-8f410c4673ba',
                                                name: 'Commune de Rivaz',
                                                code: '1071a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '8af9cc7a-6f26-4e60-a714-fd674b0590f7',
                                                name: 'Commune de Roche',
                                                code: '1852',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'bb3fa94a-af43-45a5-b266-0e8839f3d1a2',
                                                name: 'Commune de Rolle',
                                                code: '1180',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'abfb3b13-6ae0-4d84-baa4-0b6c7a2434cb',
                                                name: 'Commune de Romainmôtier-Envy',
                                                code: '1323',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'ce09cc5f-c2f5-422a-960d-ec32fffaae8c',
                                                name: 'Commune de Romanel-sur-Lausanne',
                                                code: '1032',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd4a726ed-fc8f-49f4-953c-d3090a07496c',
                                                name: 'Commune de Romanel-sur-Morges',
                                                code: '1122',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '254d21ba-98c9-44cc-bd29-0a1d962ac8c2',
                                                name: 'Commune de Ropraz',
                                                code: '1088',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '07202b51-18d2-47b3-94ff-4360b137c5ad',
                                                name: 'Commune de Rossenges',
                                                code: '1513a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '808c29e5-8211-4109-97ac-541f9a587021',
                                                name: 'Commune de Rossinière',
                                                code: '1658',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '1dba9006-bba1-4792-8323-59434e309eb4',
                                                name: 'Commune de Rougemont',
                                                code: '1659',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '45c7af2c-9710-4986-94f0-6addd0108bda',
                                                name: 'Commune de Rovray',
                                                code: '1463',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'f79d947a-f104-4228-9f40-5149a1020380',
                                                name: 'Commune de Rueyres',
                                                code: '1046',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '928ed8ce-dd15-43b5-b250-a7305ad95afc',
                                                name: 'Commune de Saint-Barthélemy',
                                                code: '1040a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '7a5761be-ebb0-4de2-a920-691641fd4f41',
                                                name: 'Commune de Saint-Cergue',
                                                code: '1264',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '26ba941a-2fa3-49b0-b861-307790d14467',
                                                name: 'Commune de Sainte-Croix',
                                                code: '1450',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '20ff738a-3c28-4096-825b-b93c382b328b',
                                                name: 'Commune de Saint-George',
                                                code: '1188a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '93a7f97b-d4c1-4e22-9a75-3f4fee8ab33f',
                                                name: 'Commune de Saint-Livres',
                                                code: '1176',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'b98caff0-0c9c-4c37-9a54-c645ae48c99f',
                                                name: 'Commune de Saint-Oyens',
                                                code: '1187',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd9caf6da-1f1d-4bfe-a7b4-1f57e61e427d',
                                                name: 'Commune de Saint-Prex',
                                                code: '1162',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'ce2e0492-8a18-4afe-9866-724c5ca5b68a',
                                                name: 'Commune de Saint-Saphorin (Lavaux)',
                                                code: '1071b',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '9b1864cf-d834-4967-beb9-e20ae2ad5f1d',
                                                name: 'Commune de Saint-Sulpice',
                                                code: '1025',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '87451a7f-dc82-48f0-8288-1269453d018c',
                                                name: 'Commune de Saubraz',
                                                code: '1189b',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '15770f29-a526-49e2-9d33-84628b6bbb4e',
                                                name: 'Commune de Savigny',
                                                code: '1073',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '09084ccf-a9ed-41c7-baa3-7ba2adde2d1b',
                                                name: 'Commune de Senarclens',
                                                code: '1304a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '28237596-6bf3-435f-ad4c-7a613c8f09f1',
                                                name: 'Commune de Sergey',
                                                code: '1355a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '4376cb7f-c375-45ef-9b4a-91e8c73084af',
                                                name: 'Commune de Servion',
                                                code: '1077',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'b44e53f4-2642-4839-a7e5-a78301c49ef1',
                                                name: 'Commune de Signy-Avenex',
                                                code: '1274',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '8dd386df-654e-42e4-8260-fb1a4b53f471',
                                                name: 'Commune de Suchy',
                                                code: '1433',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'a4a9e305-077b-447f-991b-c6ea986762ef',
                                                name: 'Commune de Sullens',
                                                code: '1036',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '6188a876-cf40-4f8b-b9e5-9c7897fdaf64',
                                                name: 'Commune de Suscévaz',
                                                code: '1437',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'b7548985-03a3-4f0e-8294-88a3dc5c5b38',
                                                name: 'Commune de Syens',
                                                code: '1510a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '3dc23067-d7df-4b0d-92ac-b0f856cc4248',
                                                name: 'Commune de Tannay',
                                                code: '1295a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '7d9385d7-cdb7-4d4e-b53f-82d08f7db08a',
                                                name: 'Commune de Tartegnin',
                                                code: '1180a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '7333a2d7-ba9e-473a-8a73-46ad3e8fa4a5',
                                                name: 'Commune de Tévenon',
                                                code: '1423',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'a63d7469-890c-4e7d-84e2-d0372fac6f2d',
                                                name: 'Commune de Tolochenaz',
                                                code: '1131',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'e1f30c71-22ee-4514-9aed-10bdb3c429b4',
                                                name: 'Commune de Trélex',
                                                code: '1270',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '6359cdf4-c1ce-4ba9-bbc8-10f33a992c1d',
                                                name: 'Commune de Trey',
                                                code: '1552',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '44d8d60e-e30b-4a4d-8b4e-e084bce1ad4b',
                                                name: 'Commune de Treycovagnes',
                                                code: '1436a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '8fc000f9-eb1b-4ebd-892a-f5cc44d6db1d',
                                                name: 'Commune de Treytorrens',
                                                code: '1538',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '25b5eec4-007f-454e-9abb-290313e03704',
                                                name: "Commune d'Ursins",
                                                code: '1412',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'bb1900df-ffda-41ad-b86b-42dfd9abf8e4',
                                                name: 'Commune de Valbroye',
                                                code: '1523',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '2403e484-a32d-4609-aae7-1075169fb726',
                                                name: 'Commune de Valeyres-sous-Montagny',
                                                code: '1441',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '19f991de-a9aa-4719-abda-0e5c580ab3a6',
                                                name: 'Commune de Valeyres-sous-Rances',
                                                code: '1358',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '37b1016b-cc9f-4ea4-bae5-17f2bbf8ed88',
                                                name: 'Commune de Valeyres-sous-Ursins',
                                                code: '1412a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '6c720581-c9df-466a-876c-4e790d881362',
                                                name: 'Commune de Vallorbe',
                                                code: '1337',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'e79dc268-65c1-4b31-af86-c612d02ebe7c',
                                                name: 'Commune de Vaulion',
                                                code: '1325',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'a7e036d0-ad21-4ff0-8b54-44ebc7b3f6ff',
                                                name: 'Commune de Vaux-sur-Morges',
                                                code: '1126',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '3febcb79-ef8b-45b2-b484-b5f973ba9fe2',
                                                name: 'Commune de Veytaux',
                                                code: '1820a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'e6284d5a-65af-44a0-9454-e877bc7d99fd',
                                                name: 'Commune de Vich',
                                                code: '1267a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '9102f85d-6e66-4a16-a011-27de7cfeb991',
                                                name: 'Commune de Villars-Epeney',
                                                code: '1404a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'd3015daf-1401-4b16-a6a3-f62caf1cfb91',
                                                name: 'Commune de Villars-le-Comte',
                                                code: '1515',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '846c8b44-dd72-4331-895e-76969d9cf667',
                                                name: 'Commune de Villars-le-Terroir',
                                                code: '1040b',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'f9621aee-a1d0-40b2-b954-4958b7bd10c5',
                                                name: 'Commune de Villars-Sainte-Croix',
                                                code: '1029',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'bcff31f0-d5d9-48f1-8c23-5e6231246642',
                                                name: 'Commune de Villars-sous-Yens',
                                                code: '1168',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '67f9d0ea-acaa-480b-aa06-601314d1e68f',
                                                name: 'Commune de Villarzel',
                                                code: '1555',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'fb7984c2-4e39-4367-8bf8-278b46a59429',
                                                name: 'Commune de Villeneuve',
                                                code: '1844',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '834ac00e-b918-45da-b492-69bd74962ec2',
                                                name: 'Commune de Vinzel',
                                                code: '1184a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'ca4806eb-4e38-4b07-8437-0e92715219d5',
                                                name: 'Commune de Vuarrens',
                                                code: '1418',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '958a01cc-5ede-49d4-8e82-8cb4819f6744',
                                                name: 'Commune de Vucherens',
                                                code: '1509',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'eed4f9a9-6d20-4764-82c1-cc7c26e34bed',
                                                name: 'Commune de Vufflens-la-Ville',
                                                code: '1302',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '88ad65c9-47ab-42f8-92d0-ae0aacbe9fd8',
                                                name: 'Commune de Vufflens-le-Château',
                                                code: '1134a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'c0009c78-5f29-4dc0-9759-7030a1a1761f',
                                                name: 'Commune de Vugelles-La Mothe',
                                                code: '1431a',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '6d7561cf-4ad3-4d2a-8539-3653f069a58d',
                                                name: 'Commune de Vuiteboeuf',
                                                code: '1445',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '6dea6398-0680-48c3-9689-fb526a3a808e',
                                                name: 'Commune de Vulliens',
                                                code: '1085',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '0a10be58-3078-4140-a549-b6c6ab82146e',
                                                name: 'Commune de Vullierens',
                                                code: '1115',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '403ffbdb-c3c9-4d4d-9420-d8086daa4b2c',
                                                name: 'Commune de Vully-les-Lacs',
                                                code: '1585',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '423e2943-382c-4f2b-acaf-38c039e673b5',
                                                name: 'Commune de Yens',
                                                code: '1169',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: 'ca91a10b-4567-4ba4-9365-8c299ae9cdf6',
                                                name: 'Commune de Yverdon-les-Bains',
                                                code: '1401',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '686d1609-8f09-4aa2-ad2a-d9e283716295',
                                                name: 'Commune de Yvonand',
                                                code: '1462',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                            {
                                                id: '25308b19-b616-4371-9321-11f5361ae2df',
                                                name: 'Commune de Yvorne',
                                                code: '1853',
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
                                                    id: '0c834f75-6372-484c-bcbb-701952011dff',
                                                    name: 'Communes vaudoises (administrations communales)',
                                                    code: 'COMMUNES',
                                                    meta: {
                                                        default: false,
                                                    },
                                                },
                                                locations: [],
                                            },
                                        ],
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

                    // console.log(fileResource)
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
