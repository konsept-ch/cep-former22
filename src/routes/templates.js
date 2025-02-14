import { Router } from 'express'

import { prisma } from '..'
import { createService, LOG_TYPES } from '../utils'
import { deserializeStatuses, getTemplatePreviews, serializeStatuses } from './templatesUtils'

export const templatesRouter = Router()

createService(
    'get',
    '/:templateId([0-9a-z]{18,19})/previews/:sessionId/:inscriptionId',
    async (req, res) => {
        const { templateId, sessionId, inscriptionId } = req.params

        const previews = await getTemplatePreviews({ templateId, sessionId, inscriptionId })

        res.json(previews ?? "Les espaces réservés n'ont pas été trouvés")
    },
    null,
    templatesRouter
)

createService(
    'get',
    '/minimum',
    async (req, res) => {
        const templates = (
            await prisma.former22_template.findMany({
                select: {
                    templateId: true,
                    title: true,
                    descriptionText: true,
                    statuses: true,
                },
            })
        ).map((template) => ({
            ...template,
            statuses: deserializeStatuses(template.statuses),
        }))

        res.json(templates)
    },
    null,
    templatesRouter
)

createService(
    'get',
    '/:templateId([0-9a-z]{18,19}$)',
    async (req, res) => {
        const template = await prisma.former22_template.findUnique({
            where: { templateId: req.params.templateId },
        })

        res.json(template)
    },
    null,
    templatesRouter
)

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
        const templateId = Date.now().toString(36) + Math.random().toString(36).slice(2)
        await prisma.former22_template.create({
            data: {
                templateId,
                title: '',
                descriptionText: '',
                emailSubject: '',
                smsBody: '',
                emailBody: '',
                statuses: '',
                isUsedForSessionInvites: false,
                usedByEvaluation: false,
            },
        })

        res.json({
            templateId,
            message: 'Le modèle a été créé',
        })

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

createService(
    'post',
    '/:templateId/invite',
    async (req, res) => {
        await prisma.former22_template.updateMany({
            data: { isUsedForSessionInvites: false },
            where: { isUsedForSessionInvites: true },
        })

        await prisma.former22_template.update({
            data: { isUsedForSessionInvites: true },
            where: { templateId: req.params.templateId },
        })

        res.json('Le modèle a été modifié')

        return {
            entityName: req.body.title,
            entityId: req.params.templateId,
            actionName: `Invite updated ${req.body.title}`,
        }
    },
    { entityType: LOG_TYPES.TEMPLATE },
    templatesRouter
)
