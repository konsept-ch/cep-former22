import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import multer from 'multer'

import { prisma } from '..'
import { createService, LOG_TYPES, contractTemplateFilesDest } from '../utils'

const upload = multer({ dest: contractTemplateFilesDest })

export const contractTemplatesRouter = Router()

createService(
    'get',
    '/',
    async (_req, res) => {
        const contracts = await prisma.former22_contract_template.findMany({
            select: {
                //id: false,
                uuid: true,
                title: true,
                description: true,
                fileOriginalName: true,
                fileStoredName: true,
            },
        })

        res.json(contracts ?? "Les contrats n'ont pas été trouvés")
    },
    null,
    contractTemplatesRouter
)

createService(
    'post',
    '/',
    async (req, res) => {
        try {
            const { uuid, title } = await prisma.former22_contract_template.create({
                data: {
                    uuid: uuidv4(), // can the DB generate this? Should it?
                },
            })

            res.json({ uuid }) // return uuid in order to be selected on the frontend

            return {
                entityName: title, // uses the default value, which is set in the DB structure
                entityId: uuid,
                actionName: 'Added an template contract',
            }
        } catch (error) {
            console.error(error)

            res.json('Erreur')
        }
    },
    { entityType: LOG_TYPES.CONTRACT_TEMPLATE },
    contractTemplatesRouter
)

createService(
    'put',
    '/:uuid',
    async (req, res) => {
        const { uuid } = req.params
        const { title, description } = req.body

        const { file: { originalname, filename } = {} } = req

        try {
            await prisma.former22_contract_template.update({
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

            res.json('Le contrat a été modifié')

            return {
                entityName: title,
                entityId: uuid,
                actionName: 'Updated an template contract',
            }
        } catch (error) {
            console.error(error)

            res.json('Erreur')
        }
    },
    { entityType: LOG_TYPES.CONTRACT_TEMPLATE },
    contractTemplatesRouter,
    upload.single('file')
)

createService(
    'delete',
    '/:uuid',
    async (req, res) => {
        const { uuid } = req.params

        try {
            const { title } = await prisma.former22_contract_template.delete({
                where: {
                    uuid,
                },
            })

            res.json('Le contrat a été supprimé')

            return {
                entityName: title,
                entityId: uuid,
                actionName: 'Deleted an template contract',
            }
        } catch (error) {
            console.error(error)

            res.status(500).json({ error: 'Error' })
        }
    },
    { entityType: LOG_TYPES.CONTRACT_TEMPLATE },
    contractTemplatesRouter
)
