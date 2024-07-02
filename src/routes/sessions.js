import { Router } from 'express'

import { prisma } from '..'
import { sendEmail } from '../sendEmail'
import { sendSms } from '../sendSms'
import { createService, LOG_TYPES } from '../utils'
import { deriveInscriptionStatus, getNamesByType, STATUSES, transformFlagsToStatus } from './inscriptionsUtils'
import { getTemplatePreviews } from './templatesUtils'

export const sessionsRouter = Router()

createService(
    'get',
    '/',
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
                max_users: true,
                claro_cursusbundle_course: {
                    select: {
                        uuid: true,
                        former22_course: {
                            select: {
                                codeCategory: true,
                            },
                        },
                    },
                },
                claro_cursusbundle_session_event: {
                    select: {
                        uuid: true,
                        claro_planned_object: {
                            select: {
                                start_date: true,
                            },
                        },
                        former22_event: {
                            select: {
                                fees: true,
                            },
                        },
                    },
                },
                claro_cursusbundle_course_session_user: {
                    select: {
                        id: true,
                    },
                    where: {
                        registration_type: 'learner',
                        validated: true,
                        confirmed: true,
                        claro_user: {
                            is_removed: false,
                        },
                    },
                },
                former22_session: {
                    select: {
                        sessionName: true,
                        startDate: true,
                        areInvitesSent: true,
                        sessionFormat: true,
                        sessionLocation: true,
                    },
                },
            },
        })

        const fullSessionsData = sessions.map((session) => {
            const startDate = Math.min(
                ...session.claro_cursusbundle_session_event.map((e) => new Date(e.claro_planned_object.start_date))
            )

            return {
                id: session.uuid,
                name: session.course_name,
                code: session.code,
                hidden: session.hidden,
                startDate,
                fees: session.claro_cursusbundle_session_event.reduce((a, e) => a + (e.former22_event?.fees || 0), 0),
                created: session.createdAt,
                updated: session.updatedAt,
                quotaDays: session.quota_days,
                isUsedForQuota: session.used_by_quotas,
                availables: session.max_users - session.claro_cursusbundle_course_session_user.length,
                occupation: session.claro_cursusbundle_course_session_user.length,
                category: session.claro_cursusbundle_course.former22_course?.codeCategory,
                ...session.former22_session,
            }
        })

        res.json(fullSessionsData ?? 'Aucunes session trouvées')
    },
    null,
    sessionsRouter
)

createService(
    'get',
    '/:sessionId/users',
    async (req, res) => {
        const sessionUsers = await prisma.claro_cursusbundle_course_session_user.findMany({
            select: {
                uuid: true,
                claro_user: {
                    select: {
                        uuid: true,
                        first_name: true,
                        last_name: true,
                    },
                },
            },
            where: {
                registration_type: 'learner',
                claro_cursusbundle_course_session: {
                    uuid: req.params.sessionId,
                },
            },
        })

        const inscriptions = sessionUsers?.filter(
            async (sessionUser) =>
                (await prisma.former22_inscription.findFirst({
                    select: {
                        inscriptionId: true,
                    },
                    where: {
                        inscriptionId: sessionUser.uuid,
                        inscriptionStatus: STATUSES.PARTICIPATION,
                    },
                })) !== null
        )

        res.json(
            inscriptions?.map(({ claro_user }) => ({
                uuid: claro_user.uuid,
                fullname: `${claro_user.first_name} ${claro_user.last_name}`,
            })) ?? 'Aucun participant trouvé'
        )
    },
    null,
    sessionsRouter
)

createService(
    'get',
    '/presence-list/:sessionId',
    async (req, res) => {
        const { sessionId } = req.params

        const sessionPresenceList = await prisma.claro_cursusbundle_course_session.findUnique({
            where: {
                uuid: sessionId,
            },
            select: {
                claro_cursusbundle_course: {
                    select: {
                        course_name: true,
                    },
                },
                code: true,
                claro_cursusbundle_session_event: {
                    select: {
                        claro_planned_object: {
                            select: {
                                start_date: true,
                            },
                        },
                    },
                },
                claro_cursusbundle_course_session_user: {
                    where: {
                        OR: [{ registration_type: 'learner' }, { registration_type: 'tutor' }],
                    },
                    orderBy: [
                        {
                            claro_user: {
                                last_name: 'asc',
                            },
                        },
                        {
                            claro_user: {
                                first_name: 'asc',
                            },
                        },
                    ],
                    select: {
                        uuid: true,
                        registration_type: true,
                        validated: true,
                        status: true,
                        claro_user: {
                            select: {
                                first_name: true,
                                last_name: true,
                                user_organization: {
                                    select: {
                                        is_main: true,
                                        claro__organization: {
                                            include: {
                                                claro_cursusbundle_quota: true,
                                            },
                                        },
                                    },
                                    where: {
                                        is_main: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        })

        if (sessionPresenceList != null) {
            const {
                claro_cursusbundle_course: { course_name: courseName },
                code: sessionCode,
                claro_cursusbundle_session_event: events,
                claro_cursusbundle_course_session_user: inscriptions,
            } = sessionPresenceList
            const inscriptionAdditionalData = await prisma.former22_inscription.findMany({
                where: { OR: inscriptions.map(({ uuid: inscriptionId }) => ({ inscriptionId })) },
            })

            res.json({
                courseName,
                sessionCode,
                eventDates: events.map(({ claro_planned_object: { start_date } }) => start_date),
                learners: getNamesByType({
                    inscriptions: inscriptions.filter(
                        ({ uuid, validated, registration_type, status, claro_user }) =>
                            deriveInscriptionStatus({
                                savedStatus: inscriptionAdditionalData.find(
                                    ({ inscriptionId }) => inscriptionId === uuid
                                )?.inscriptionStatus,
                                transformedStatus: transformFlagsToStatus({
                                    validated,
                                    registrationType: registration_type,
                                    hrValidationStatus: status,
                                    isHrValidationEnabled:
                                        claro_user.user_organization[0].claro__organization?.claro_cursusbundle_quota !=
                                        null,
                                }),
                            }) !== STATUSES.REFUSEE_PAR_RH
                    ),
                    registrationType: 'learner',
                }),
                tutors: getNamesByType({ inscriptions, registrationType: 'tutor' }),
            })
        } else {
            res.status(400).json({ error: "La session n'est pas trouvée" })
        }
    },
    null,
    sessionsRouter
)

createService(
    'get',
    '/seances',
    async (req, res) => {
        const seancesPrisma = await prisma.claro_cursusbundle_session_event.findMany({
            select: {
                uuid: true,
                code: true,
                claro_planned_object: {
                    select: {
                        entity_name: true,
                    },
                },
                claro_cursusbundle_course_session: {
                    select: {
                        quota_days: true,
                        price: true,
                        used_by_quotas: true,
                        createdAt: true,
                        updatedAt: true,
                        hidden: true,
                        former22_session: {
                            select: {
                                sessionFormat: true,
                                sessionLocation: true,
                            },
                        },
                    },
                },
            },
        })

        const seances = seancesPrisma.map((seance) => ({
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
            sessionFormat: seance.claro_cursusbundle_course_session.former22_session?.sessionFormat,
            sessionLocation: seance.claro_cursusbundle_course_session.former22_session?.sessionLocation,
        }))

        res.json(seances ?? 'Aucunes session trouvées')
    },
    null,
    sessionsRouter
)

createService(
    'put',
    '/:sessionId',
    async (req, res) => {
        const { sessionId } = req.params
        const { onlyUpdate, ...payload } = req.body

        const { claro_cursusbundle_course_session_user: learners } =
            await prisma.claro_cursusbundle_course_session.update({
                select: {
                    claro_cursusbundle_course_session_user: {
                        where: { registration_type: 'learner' },
                        select: { uuid: true, claro_user: { select: { mail: true } } },
                    },
                },
                data: {
                    former22_session: {
                        upsert: {
                            create: payload,
                            update: payload,
                        },
                    },
                },
                where: {
                    uuid: sessionId,
                },
            })

        if (onlyUpdate) {
            res.json(true)
        } else {
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
