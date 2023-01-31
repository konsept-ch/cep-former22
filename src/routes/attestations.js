import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import multer from 'multer'

import { prisma } from '..'
import { createService, LOG_TYPES, attestationTemplateFilesDest } from '../utils'

const upload = multer({ dest: attestationTemplateFilesDest })

export const attestationsRouter = Router()

createService(
    'get',
    '/',
    async (_req, res) => {
        const attestations = await prisma.former22_attestation.findMany({
            select: {
                id: false,
                uuid: true,
                title: true,
                description: true,
                fileOriginalName: true,
                fileStoredName: true,
            },
        })

        res.json(attestations ?? "Les attestations n'ont pas été trouvées")
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
            console.error(error)

            res.json("Erreur de création d'attestation")
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

            res.json("L'attestation a été modifié")

            return {
                entityName: title,
                entityId: uuid,
                actionName: 'Updated an attestation',
            }
        } catch (error) {
            console.error(error)

            res.status(500).json("Erreur de modification d'attestation")
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
        const { shouldForceDelete } = req.query

        if (!shouldForceDelete) {
            const isAttestationUsed =
                (
                    await prisma.former22_attestation.findUnique({
                        where: {
                            uuid,
                        },
                        include: {
                            former22_inscription: true,
                        },
                    })
                )?.former22_inscription.length > 0

            if (isAttestationUsed) {
                res.status(400).json({ error: 'Attestation template is used and therefore cannot be deleted.' })

                return {}
            }
        }

        try {
            const { title } = await prisma.former22_attestation.delete({
                where: {
                    uuid,
                },
            })

            res.json("L'attestation a été supprimé")

            return {
                entityName: title,
                entityId: uuid,
                actionName: 'Deleted an attestation',
            }
        } catch (error) {
            console.error(error)

            res.status(500).json({ error: "Erreur de suppréssion d'attestation" })

            return {}
        }
    },
    { entityType: LOG_TYPES.ATTESTATION },
    attestationsRouter
)
