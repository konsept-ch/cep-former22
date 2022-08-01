// deprecated, use routes instead

import { v4 as uuidv4 } from 'uuid'
import { callApi } from './callApi'
import { sendEmail } from './sendEmail'
import { sendSms } from './sendSms'
import { createService, formatDate, getLogDescriptions, LOG_TYPES } from './utils'
import { prisma } from '.'
import { getTemplatePreviews } from './routes/templatesUtils'
import {
    fetchInscriptionsWithStatuses,
    getUserProfession,
    getProfessionFacetsValues,
    parsePhoneForSms,
} from './routes/inscriptionsUtils'

export const generateEndpoints = () => {
    // organizations START
    createService('get', '/organizations', async (req, res) => {
        const organizations = await callApi({ req, path: 'organization/list/recursive' })
        const allAdditionalData = await prisma.former22_organization.findMany()

        const populateAdditionalData = ({ orgsToPopulate }) =>
            orgsToPopulate.map((currentOrg) => {
                const currentOrgData = allAdditionalData.find(
                    ({ organizationUuid }) => organizationUuid === currentOrg.id
                )

                const populatedChildren = populateAdditionalData({ orgsToPopulate: currentOrg.children })

                if (currentOrgData) {
                    // eslint-disable-next-line no-unused-vars
                    const { organizationUuid, id, ...neededData } = currentOrgData

                    return { ...currentOrg, ...neededData, children: populatedChildren }
                } else {
                    return { ...currentOrg, children: populatedChildren }
                }
            })

        res.json(populateAdditionalData({ orgsToPopulate: organizations }))
    })

    createService(
        'put',
        '/organization/:organizationId',
        async (req, res) => {
            const { organizationName, newData } = req.body
            const { organizationId: organizationUuid } = req.params

            await prisma.former22_organization.upsert({
                where: { organizationUuid },
                update: { ...newData },
                create: { ...newData, organizationUuid },
            })

            res.json("L'organisation a été modifié")

            return {
                entityName: organizationName,
                entityId: organizationUuid,
                actionName: `Updated organization ${organizationName}`,
            }
        },
        { entityType: LOG_TYPES.ORGANISATION }
    )
    // organizations END

    // users START
    createService('get', '/allUsers', async (req, res) => {
        const users = await prisma.claro_user.findMany({
            where: {
                is_removed: false,
            },
            select: {
                id: true,
                uuid: true,
                first_name: true,
                last_name: true,
                mail: true,
                claro_user_role: {
                    select: {
                        claro_role: {
                            select: {
                                translation_key: true,
                            },
                        },
                    },
                },
                user_organization: {
                    where: {
                        is_main: true,
                    },
                    select: {
                        claro__organization: {
                            select: {
                                name: true,
                            },
                        },
                    },
                },
                phone: true,
            },
        })

        const usersSettings = await prisma.former22_user.findMany()
        const professionFacetsValues = await getProfessionFacetsValues()

        const enrichedUsersData = users.map((current) => {
            const currentUserSettings = usersSettings.find(({ userId }) => userId === current.uuid)
            const currentUserProfession = getUserProfession({
                userId: current.id,
                professionFacetsValues,
            })

            let enrichedUser = {
                id: current.uuid,
                firstName: current.first_name,
                lastName: current.last_name,
                email: current.mail,
                mainOrganizationName: current['user_organization'][0]?.['claro__organization'].name,
                phone: current.phone,
                phoneForSms: parsePhoneForSms({ phone: current.phone }),
                roles: current.claro_user_role.map(({ claro_role: { translation_key } }) => translation_key),
            }

            if (currentUserSettings) {
                // eslint-disable-next-line no-unused-vars
                const { _userId, ...settings } = currentUserSettings

                enrichedUser = { ...enrichedUser, ...settings }
            }

            if (currentUserProfession) {
                enrichedUser = { ...enrichedUser, profession: currentUserProfession }
            }

            return enrichedUser
        })

        res.json(enrichedUsersData)
    })

    createService(
        'put',
        '/user/:userId',
        async (req, res) => {
            const { userId } = req.params
            const { shouldReceiveSms, colorCode } = req.body

            await prisma.former22_user.upsert({
                where: { userId },
                update: { shouldReceiveSms, colorCode },
                create: { shouldReceiveSms, colorCode, userId },
            })

            res.json("L'utilisateur a été modifié")

            const [{ first_name, last_name }] = await prisma.claro_user.findMany({
                where: {
                    uuid: req.params.userId,
                },
                select: {
                    first_name: true,
                    last_name: true,
                },
            })

            const userFullName = `${first_name} ${last_name}`

            return {
                entityName: userFullName,
                entityId: req.params.userId,
                actionName: getLogDescriptions.user({
                    shouldReceiveSms: req.body.shouldReceiveSms,
                    fullName: userFullName,
                }),
            }
        },
        { entityType: LOG_TYPES.USER }
    )

    createService('get', '/admins', async (req, res) => {
        const usersPrisma = await prisma.claro_user.findMany({
            where: {
                OR: [
                    {
                        is_removed: false,
                        claro_user_role: {
                            some: {
                                claro_role: {
                                    name: 'ROLE_ADMIN',
                                },
                            },
                        },
                    },
                    {
                        claro_user_group: {
                            some: {
                                claro_group: {
                                    claro_group_role: {
                                        some: {
                                            claro_role: {
                                                name: 'ROLE_ADMIN',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                ],
            },
            select: {
                id: true,
                first_name: true,
                last_name: true,
            },
        })

        res.json(usersPrisma)
    })
    // users END

    // courses START
    createService('get', '/courses', async (req, res) => {
        const courses = await prisma.claro_cursusbundle_course.findMany({
            select: {
                uuid: true,
                course_name: true,
                code: true,
                hidden: true,
                price: true,
                createdAt: true,
                updatedAt: true,
                session_days: true,
                description: true,
                slug: true,
            },
        })

        const coursesFormer22Data = await prisma.former22_course.findMany()

        const fullCoursesData = courses.map((course) => {
            const courseAdditionalData = coursesFormer22Data.find(({ courseId }) => courseId === course.uuid)

            return {
                id: course.uuid,
                name: course.course_name,
                code: course.code,
                hidden: course.hidden,
                price: course.price,
                creationDate: course.createdAt,
                lastModifiedDate: course.updatedAt,
                duration: course.session_days,
                description: course.description,
                slug: course.slug,
                ...courseAdditionalData,
            }
        })

        res.json(fullCoursesData ?? 'Aucuns cours trouvés')
    })

    createService('get', '/courseBySlug/:slug', async (req, res) => {
        const [courseDetails] = await prisma.claro_cursusbundle_course.findMany({
            where: { slug: req.params.slug },
        })

        res.json(courseDetails ?? "Le cours n'a pas été trouvé")
    })

    createService(
        'put',
        '/saveCourseById/:id',
        async (req, res) => {
            const courseDetails = await prisma.claro_cursusbundle_course.update({
                where: { uuid: req.params.id },
                data: { ...req.body },
            })

            res.json(courseDetails ?? "Le cours n'a pas été sauvegardé")

            return {
                entityName: courseDetails.course_name,
                entityId: req.params.id,
                actionName: getLogDescriptions.formation({ isUpdatedDetails: false }),
            }
        },
        { entityType: LOG_TYPES.FORMATION }
    )

    createService(
        'put',
        '/courses/addOrganizations',
        async (req, res) => {
            const organizations = await callApi({ req, path: 'organization' })
            const courses = await callApi({ req, path: 'cursus_course' })

            const responses = []

            for (const course of courses) {
                const response = await callApi({
                    req,
                    path: `cursus_course/${course.id}`,
                    method: 'put',
                    body: { ...course, organizations },
                })

                responses.push(response)
            }

            res.json(responses)

            return {
                entityName: 'Organisations',
                actionName: 'Added organisations',
            }
        },
        { entityType: LOG_TYPES.ORGANISATION }
    )

    createService(
        'put',
        '/courses/removeOrganizations',
        async (req, res) => {
            const organizations = await callApi({ req, path: 'organization' })
            const courses = await callApi({ req, path: 'cursus_course' })

            const defaultOrganisation = organizations.find((organisation) => organisation.meta.default === true)

            const getBody = (course) => ({
                ...course,
                organizations: [defaultOrganisation],
            })

            const responses = []

            for (const course of courses) {
                const response = await callApi({
                    req,
                    path: `cursus_course/${course.id}`,
                    method: 'put',
                    body: getBody(course),
                })

                responses.push(response)
            }

            res.json(responses)

            return {
                entityName: 'Organisations',
                actionName: 'Deleted organisations',
            }
        },
        { entityType: LOG_TYPES.ORGANISATION }
    )

    createService(
        'put',
        '/course/:courseId',
        async (req, res) => {
            const { courseId } = req.params
            const { newData } = req.body

            await prisma.former22_course.upsert({
                where: { courseId },
                update: newData,
                create: { ...newData, courseId },
            })

            res.json('Le cours a été modifié')

            const currentCourse = await prisma.claro_cursusbundle_course.findUnique({
                where: { uuid: courseId },
                select: {
                    course_name: true,
                },
            })

            return {
                entityName: currentCourse.course_name,
                entityId: courseId,
                actionName: getLogDescriptions.formation({ isUpdatedDetails: true }),
            }
        },
        { entityType: LOG_TYPES.FORMATION }
    )
    // courses END

    // sessions START
    createService('get', '/sessions', async (req, res) => {
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
    })

    createService('get', '/seances', async (req, res) => {
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
    })

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
        { entityType: LOG_TYPES.SESSION }
    )
    // sessions END

    // reportError START
    createService('post', '/reportError', async (req, res) => {
        const date = formatDate({
            dateObject: new Date(),
            isDateVisible: true,
            isFullTimeVisible: true,
        })

        const { emailResponse } = await sendEmail({
            to: 'dan@konsept.ch',
            subject: "Rapport d'erreur de l'interface utilisateur",
            html_body: `<h2>Date:</h2><p>${date}</p><h2>Description:</h2><p>${req.body.errorDescription}</p>`,
        })

        await prisma.former22_error_report.create({
            data: {
                errorId: uuidv4(),
                errorDescription: req.body.errorDescription,
                errorDate: date,
            },
        })

        res.json({ emailResponse })
    })
    // reportError END

    // formateurs START
    createService('get', '/formateurs', async (req, res) => {
        const inscriptions = await fetchInscriptionsWithStatuses({ shouldFetchTutors: true })

        if (inscriptions.length > 0) {
            res.json(inscriptions)
        } else {
            res.json('Aucuns formateurs trouvés')
        }
    })
    // formateurs END

    // logs START
    createService('get', '/logs', async (_req, res) => {
        const logs = await prisma.former22_log.findMany()

        res.json(logs ? 'Des logs trouvés' : 'Aucuns logs trouvés')
    })
    // logs END
}
