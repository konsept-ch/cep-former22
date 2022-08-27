import { Router } from 'express'
import fetch /* , { FormData, File, fileFrom } */ from 'node-fetch'
import { v4 as uuidv4 } from 'uuid'

import { clarolineApiUrl } from '../credentialsConfig'
import { prisma } from '..'
import { createService, LOG_TYPES } from '../utils'

export const attestationsRouter = Router()

createService(
    'get',
    '/',
    async (_req, res) => {
        const attestations = await prisma.former22_attestations.findMany({
            select: {
                id: false,
                uuid: true,
                title: true,
                description: true,
                fileName: true,
                filePath: true,
            },
        })

        res.json(attestations ?? "Les attestations n'ont pas été trouvés")
    },
    null,
    attestationsRouter
)

createService(
    'post',
    '/',
    async (req, res) => {
        try {
            const { uuid, title } = await prisma.former22_attestations.create({
                data: {
                    uuid: uuidv4(), // can the DB generate this? Should it?
                },
            })

            res.json("L'attestation a été créé")

            return {
                entityName: title, // uses the default value, which is set in the DB structure
                entityId: uuid,
                actionName: 'Added an attestation',
            }
        } catch (error) {
            console.error(error)

            res.json('Erreur')
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

        await prisma.former22_attestations.update({
            where: {
                uuid,
            },
            data: {
                title,
                description,
            },
        })

        res.json("L'attestation a été mise à jour")

        return {
            entityName: title,
            entityId: uuid,
            actionName: 'Updated an attestation',
        }
    },
    { entityType: LOG_TYPES.ATTESTATION },
    attestationsRouter
)

createService(
    'delete',
    '/:uuid',
    async (req, res) => {
        const { uuid } = req.params

        const { title } = await prisma.former22_attestations.delete({
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
    },
    { entityType: LOG_TYPES.ATTESTATION },
    attestationsRouter
)

createService(
    'patch',
    '/upload/:uuid',
    async (req, res) => {
        const { uuid } = req.params
        const { title, description } = req.body

        const response = await fetch(`${clarolineApiUrl}public_file/upload`, {
            method: 'post',
            headers: req.headers,
            body: JSON.stringify({
                file: req.body.filename,
                fileName: req.body.filename,
                sourceType: 'uploadedfile',
            }),
        })

        const uploadResult = await response.json()

        console.log(uploadResult)

        const pathMock = `data/aaaaaaaaaaaaaaaaaaaa/${uuidv4()}.docx`

        await prisma.former22_attestations.create({
            data: {
                path: pathMock,
                title,
                description,
                // fileName,
                uuid,
            },
        })

        res.json("L'attestation a été créé")

        return {
            entityName: req.body.title,
            entityId: req.body.idModel,
            actionName: 'Added an attestation',
        }
    },
    { entityType: LOG_TYPES.ATTESTATION },
    attestationsRouter
)
