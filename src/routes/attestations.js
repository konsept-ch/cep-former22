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
