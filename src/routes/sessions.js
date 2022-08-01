import { Router } from 'express'

import { prisma } from '..'
import { sendEmail } from '../sendEmail'
import { sendSms } from '../sendSms'
import { createService, LOG_TYPES } from '../utils'
import { getTemplatePreviews } from './templatesUtils'

export const sessionsRouter = Router()

createService(
    'get',
    '/sessions',
    async (req, res) => {
        const sessions = await prisma.claro_cursusbundle_course_session.findMany({
            select: {
                uuid: true,
                course_name: true,
                code: true,
                hidden: true,
                start_date: true,
                price: true,
                createdAt: true,
                updatedAt: true,
                quota_days: true,
                used_by_quotas: true,
            },
        })
        const sessionsAdditionalData = await prisma.former22_session.findMany()

        const fullSessionsData = sessions.map((session) => {
            const sessionAdditionalData = sessionsAdditionalData.find(({ sessionId }) => sessionId === session.uuid)

            return {
                ...{
                    id: session.uuid,
                    name: session.course_name,
                    code: session.code,
                    hidden: session.hidden,
                    startDate: session.start_date,
                    price: session.price,
                    created: session.createdAt,
                    updated: session.updatedAt,
                    quotaDays: session.quota_days,
                    isUsedForQuota: session.used_by_quotas,
                },
                ...sessionAdditionalData,
            }
        })

        res.json(fullSessionsData ?? 'Aucunes session trouvées')
    },
    null,
    sessionsRouter
)

createService(
    'get',
    '/sessions/seances',
    async (req, res) => {
        const seancesPrisma = await prisma.claro_cursusbundle_session_event.findMany({
            include: {
                claro_planned_object: true,
                claro_cursusbundle_course_session: true,
            },
        })

        const sessionsAdditionalData = await prisma.former22_session.findMany({
            select: {
                sessionId: true,
                sessionFormat: true,
                sessionLocation: true,
            },
        })

        const seances = seancesPrisma?.reduce((acc, seance) => {
            if (seance) {
                const sessionData = sessionsAdditionalData.find(
                    ({ sessionId }) => sessionId === seance.claro_cursusbundle_course_session.uuid
                )

                const formatedSeance = {
                    id: seance.uuid,
                    name: seance.claro_planned_object.entity_name,
                    code: seance.code,
                    duration: seance.claro_cursusbundle_course_session.quota_days,
                    price: seance.claro_cursusbundle_course_session.price,
                    quotaDays: seance.claro_cursusbundle_course_session.quota_days,
                    isUsedForQuota: seance.claro_cursusbundle_course_session.used_by_quotas,
                    creationDate: seance.claro_cursusbundle_course_session.createdAt,
                    lastModifiedDate: seance.claro_cursusbundle_course_session.updatedAt,
                    hidden: seance.claro_cursusbundle_course_session.hidden,
                    sessionFormat: sessionData?.sessionFormat,
                    sessionLocation: sessionData?.sessionLocation,
                }

                return [...acc, formatedSeance]
            } else {
                return [...acc]
            }
        }, [])

        res.json(seances ?? 'Aucunes session trouvées')
    },
    null,
    sessionsRouter
)

createService(
    'put',
    '/sessions/:sessionId',
    async (req, res) => {
        const { sessionId } = req.params

        await prisma.former22_session.upsert({
            where: { sessionId },
            update: { ...req.body },
            create: { sessionId, ...req.body },
        })

        const { claro_cursusbundle_course_session_user: learners } =
            await prisma.claro_cursusbundle_course_session.findUnique({
                where: {
                    uuid: sessionId,
                },
                select: {
                    claro_cursusbundle_course_session_user: {
                        where: { registration_type: 'learner' },
                        select: { uuid: true, claro_user: { select: { mail: true } } },
                    },
                },
            })

        const templateForSessionInvites = await prisma.former22_template.findFirst({
            where: { isUsedForSessionInvites: true },
        })

        if (templateForSessionInvites) {
            const emailsToSend = learners.map(async (learner) => {
                const {
                    uuid: learnerId,
                    claro_user: { mail: learnerEmail },
                } = learner

                const { emailContent, emailSubject, smsContent } = await getTemplatePreviews({
                    req,
                    templateId: templateForSessionInvites.templateId,
                    sessionId,
                    inscriptionId: learnerId,
                })

                const { emailResponse } = await sendEmail({
                    to: learnerEmail,
                    subject: emailSubject,
                    html_body: emailContent,
                })

                await sendSms({ to: '359877155302', content: smsContent })

                return { emailResponse }
            })

            const sentEmails = await Promise.allSettled(emailsToSend)

            const data = sentEmails.map(({ value }) => value)

            res.json(data ?? 'Aucun e-mail envoyé')
        } else {
            res.json("Aucun modèle pour sessions invitées n'a été trouvé")
        }

        return {
            entityName: req.body.sessionName,
            entityId: sessionId,
            actionName: 'Session updated',
        }
    },
    { entityType: LOG_TYPES.SESSION },
    sessionsRouter
)
