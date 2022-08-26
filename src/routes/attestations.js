import { Router } from 'express'
import fetch from 'node-fetch'
import { v4 as uuidv4 } from 'uuid'

import { clarolineApiUrl } from '../credentialsConfig'
import { prisma } from '..'
import { createService, LOG_TYPES } from '../utils'

export const attestationsRouter = Router()

// attestations START
createService(
    'get',
    '/',
    async (_req, res) => {
        const attestations = await prisma.former22_attestations.findMany()

        res.json(attestations ?? "Les attestations n'ont pas été trouvés")
    },
    null,
    attestationsRouter
)

createService(
    'post',
    '/',
    async (req, res) => {
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
                title: req.body.title,
                descriptionText: req.body.descriptionText,
                filename: req.body.filename,
                idModel: req.body.idModel,
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
// attestations END
