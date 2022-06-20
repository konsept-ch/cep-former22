import { Router } from 'express'
import { prisma } from '..'
import { createService, LOG_TYPES } from '../utils'
import { deserializeStatuses, getTemplatePreviews, serializeStatuses } from './templatesUtils'

export const templatesRouter = Router()

// templates preview START
createService(
    'get',
    '/previews',
    async (req, res) => {
        const { templateId, sessionId, inscriptionId } = req.query

        const previews = await getTemplatePreviews({ req, templateId, sessionId, inscriptionId })

        res.json(previews ?? "Les espaces réservés n'ont pas été trouvés")
    },
    null,
    templatesRouter
)

createService(
    'get',
    '/previews/massUpdate',
    async (req, res) => {
        const { templateId } = req.query

        const template = await prisma.former22_template.findUnique({
            where: { templateId },
        })

        res.json(template ?? "Le modèle n'a pas été trouvé")
    },
    null,
    templatesRouter
)
// templates preview END

// templates START
createService(
    'get',
    '/',
    async (_req, res) => {
        const templates = await prisma.former22_template.findMany()

        const templatesWithDeserializedStatuses = templates.map((template) => ({
            ...template,
            statuses: deserializeStatuses(template.statuses),
        }))

        res.json(templatesWithDeserializedStatuses ?? "Les modèles n'ont pas été trouvés")
    },
    null,
    templatesRouter
)

createService(
    'post',
    '/',
    async (req, res) => {
        await prisma.former22_template.create({
            data: {
                templateId: req.body.templateId,
                title: req.body.title,
                descriptionText: req.body.descriptionText,
                emailSubject: req.body.emailSubject,
                smsBody: req.body.smsBody,
                emailBody: req.body.emailBody,
                statuses: serializeStatuses(req.body.statuses),
                isUsedForSessionInvites: req.body.isUsedForSessionInvites,
            },
        })

        res.json('Le modèle a été créé')

        return {
            entityName: req.body.title,
            entityId: req.body.templateId,
            actionName: 'Added a template',
        }
    },
    { entityType: LOG_TYPES.TEMPLATE },
    templatesRouter
)

createService(
    'put',
    '/:templateId',
    async (req, res) => {
        await prisma.former22_template.update({
            where: { templateId: req.params.templateId },
            data: { ...req.body, templateId: req.body.templateId, statuses: serializeStatuses(req.body.statuses) },
        })

        res.json('Le modèle a été modifié')

        return {
            entityName: req.body.title,
            entityId: req.params.templateId,
            actionName: `Updated template ${req.body.title}`,
        }
    },
    { entityType: LOG_TYPES.TEMPLATE },
    templatesRouter
)

createService(
    'delete',
    '/:templateId',
    async (req, res) => {
        const template = await prisma.former22_template.delete({
            where: { templateId: req.params.templateId },
        })

        res.json('Le modèle a été supprimé')

        return {
            entityName: template.title,
            entityId: req.params.templateId,
            actionName: `Deleted template ${template.title}`,
        }
    },
    { entityType: LOG_TYPES.TEMPLATE },
    templatesRouter
)
// templates END
