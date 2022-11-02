import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'

import { prisma } from '..'
import { createService, LOG_TYPES } from '../utils'

export const contractsRouter = Router()

createService(
    'put',
    '/',
    async (req, res) => {
        try {
            const { userId, courseId, templateId } = req.body

            const template = await prisma.former22_contract_template.findUnique({
                where: {
                    uuid: templateId,
                },
            })

            let contract = await prisma.former22_contract.findFirst({
                where: {
                    userId,
                    courseId,
                },
            })

            if (contract) {
                await prisma.former22_contract.update({
                    where: {
                        id: contract.id,
                    },
                    data: {
                        templateId: template.id,
                    },
                })
            } else {
                contract = await prisma.former22_contract.create({
                    data: {
                        uuid: uuidv4(),
                        userId,
                        courseId,
                        templateId: template.id,
                    },
                })
            }

            res.json(true)

            return {
                entityName: 'Contract',
                entityId: contract.uuid,
                actionName: 'Created an contract',
            }
        } catch (error) {
            console.error(error)

            res.json('Erreur')
        }
    },
    { entityType: LOG_TYPES.CONTRACT },
    contractsRouter
)
