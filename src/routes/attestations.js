import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import multer from 'multer'

import { prisma } from '..'
import { createService, LOG_TYPES, attestationTemplateFilesDest } from '../utils'
import { AttestationGenerationError, generateAttestation } from '../helpers/attestations'
import { winstonLogger } from '../winston'

const upload = multer({ dest: attestationTemplateFilesDest })

export const attestationsRouter = Router()

createService(
    'get',
    '/',
    async (_req, res) => {
        const attestations = await prisma.former22_attestation.findMany({
            select: {
                uuid: true,
                title: true,
                description: true,
                fileOriginalName: true,
                fileStoredName: true,
            },
        })

        res.json(attestations)
    },
    null,
    attestationsRouter
)

createService(
    'get',
    '/minimum',
    async (_req, res) => {
        const attestations = await prisma.former22_attestation.findMany({
            select: {
                uuid: true,
                title: true,
                description: true,
            },
        })

        res.json(attestations)
    },
    null,
    attestationsRouter
)

createService(
    'post',
    '/',
    async (req, res) => {
        try {
            const { uuid, title } = await prisma.former22_attestation.create({
                data: {
                    uuid: uuidv4(), // can the DB generate this? Should it?
                },
            })

            res.json({ uuid }) // return uuid in order to be selected on the frontend

            return {
                entityName: title, // uses the default value, which is set in the DB structure
                entityId: uuid,
                actionName: 'Added an attestation',
            }
        } catch (error) {
            res.json({
                message: "Erreur de création d'attestation",
            })
        }
    },
    { entityType: LOG_TYPES.ATTESTATION },
    attestationsRouter
)

createService(
    'put',
    '/:uuid',
    async (req, res) => {
        const { uuid } = req.params
        const { title, description } = req.body

        const { file: { originalname, filename } = {} } = req

        console.log(req.file)

        try {
            await prisma.former22_attestation.update({
                where: {
                    uuid,
                },
                data: {
                    title,
                    description,
                    fileOriginalName: originalname,
                    fileStoredName: filename,
                },
            })

            res.json({
                message: "L'attestation a été modifiée",
            })

            return {
                entityName: title,
                entityId: uuid,
                actionName: 'Updated an attestation',
            }
        } catch (error) {
            console.error(error)

            res.status(500).json({
                message: "Erreur de modification d'attestation",
            })
        }
    },
    { entityType: LOG_TYPES.ATTESTATION },
    attestationsRouter,
    upload.single('file')
)

createService(
    'delete',
    '/:uuid',
    async (req, res) => {
        const { uuid } = req.params

        try {
            const { title } = await prisma.former22_attestation.delete({
                where: {
                    uuid,
                },
            })

            res.json({
                message: "L'attestation a été supprimée",
            })

            return {
                entityName: title,
                entityId: uuid,
                actionName: 'Deleted an attestation',
            }
        } catch (error) {
            console.error(error)

            res.status(500).json({ message: "Erreur de suppréssion d'attestation" })

            return {}
        }
    },
    { entityType: LOG_TYPES.ATTESTATION },
    attestationsRouter
)

createService(
    'post',
    '/generate',
    async (req, res) => {
        const { selectedAttestationTemplateUuid, uuids } = req.body

        const inscriptions = await prisma.claro_cursusbundle_course_session_user.findMany({
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
                                // la relation porte TOUS les noeuds du workspace, pas sa racine.
                                // la racine est le noeud sans parent : filtrer explicitement,
                                // l'ordre rendu par MySQL n'est pas garanti.
                                claro_resource_node: {
                                    // La racine est le noeud sans parent ET de type
                                    // `directory` : 12 espaces personnels ont une racine
                                    // de type `file` ou `scorm`, sur laquelle Claroline
                                    // refuse toute creation. 9 autres ont plusieurs
                                    // racines. L'ordre rendu par MySQL n'est de toute
                                    // facon pas garanti.
                                    where: {
                                        parent_id: null,
                                        claro_resource_type: { is: { name: 'directory' } },
                                    },
                                    orderBy: { id: 'asc' },
                                },
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
            where: {
                uuid: {
                    in: uuids,
                },
            },
        })

        // La boucle n'est pas transactionnelle et ne doit pas l'etre : un echec sur un
        // participant ne justifie pas de priver les suivants de leur attestation. L'ancien
        // code laissait remonter la premiere erreur, ce qui decapitait la fin du lot sans
        // dire ou il s'etait arrete.
        // docs/90-incidents/investigation_attestations_che_plantes_2026-09.md
        const failures = []

        for (const currentInscription of inscriptions) {
            const user = currentInscription.claro_user
            const {
                course_name: sessionName,
                claro_cursusbundle_course: {
                    course_name: courseName,
                    session_days: courseDurationDays,
                    session_hours: courseDurationHours,
                    former22_course,
                },
                claro_cursusbundle_course_session_user: tutors,
                claro_cursusbundle_session_event: sessionDates,
            } = currentInscription.claro_cursusbundle_course_session

            try {
                await generateAttestation(selectedAttestationTemplateUuid, req, {
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
            } catch (error) {
                failures.push({
                    inscriptionUuid: currentInscription.uuid,
                    participant: `${user.first_name} ${user.last_name}`,
                    reason:
                        error instanceof AttestationGenerationError
                            ? error.message
                            : "La génération de l'attestation a échoué.",
                })

                winstonLogger.error(
                    `Attestation generation failed: ${JSON.stringify({
                        inscriptionUuid: currentInscription.uuid,
                        selectedAttestationTemplateUuid,
                        message: error?.message,
                        context: error?.context,
                    })}`
                )
            }
        }

        const generated = inscriptions.length - failures.length

        if (failures.length > 0) {
            res.status(207).json({
                message: `${generated} attestation(s) générée(s), ${failures.length} en échec.`,
                generated,
                failures,
            })
        } else {
            res.json({ message: 'La génération à été effectuée avec succès', generated })
        }
    },
    { entityType: LOG_TYPES.ATTESTATION },
    attestationsRouter
)
