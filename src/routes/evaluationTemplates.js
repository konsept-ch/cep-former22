import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'

import { prisma } from '..'
import { createService, LOG_TYPES } from '../utils'

export const evaluationTemplatesRouter = Router()

createService(
    'get',
    '/',
    async (_req, res) => {
        const evaluations = await prisma.former22_evaluation_template.findMany({
            select: {
                uuid: true,
                title: true,
                description: true,
                struct: true,
            },
        })

        res.json(evaluations ?? "Les évaluations n'ont pas été trouvés")
    },
    null,
    evaluationTemplatesRouter
)

createService(
    'post',
    '/',
    async (req, res) => {
        try {
            const { uuid, title } = await prisma.former22_evaluation_template.create({
                data: {
                    uuid: uuidv4(), // can the DB generate this? Should it?
                    struct: [],
                },
            })

            res.json({ uuid }) // return uuid in order to be selected on the frontend

            return {
                entityName: title, // uses the default value, which is set in the DB structure
                entityId: uuid,
                actionName: 'Added an template evaluation',
            }
        } catch (error) {
            console.error(error)

            res.json('Erreur')
        }
    },
    { entityType: LOG_TYPES.EVALUATION_TEMPLATE },
    evaluationTemplatesRouter
)

createService(
    'put',
    '/:uuid',
    async (req, res) => {
        const { uuid } = req.params
        const { title, description, struct } = req.body

        try {
            await prisma.former22_evaluation_template.update({
                where: {
                    uuid,
                },
                data: {
                    title,
                    description,
                    struct,
                },
            })

            res.json("L'évaluation a été modifié")

            return {
                entityName: title,
                entityId: uuid,
                actionName: 'Updated an template evaluation',
            }
        } catch (error) {
            console.error(error)

            res.json('Erreur')
        }
    },
    { entityType: LOG_TYPES.EVALUATION_TEMPLATE },
    evaluationTemplatesRouter
)

createService(
    'delete',
    '/:uuid',
    async (req, res) => {
        const { uuid } = req.params

        try {
            const { title } = await prisma.former22_evaluation_template.delete({
                where: {
                    uuid,
                },
            })

            res.json("L'évaluation a été supprimé")

            return {
                entityName: title,
                entityId: uuid,
                actionName: 'Deleted an template evaluation',
            }
        } catch (error) {
            console.error(error)

            res.status(500).json({ error: 'Error' })
        }
    },
    { entityType: LOG_TYPES.EVALUATION_TEMPLATE },
    evaluationTemplatesRouter
)
