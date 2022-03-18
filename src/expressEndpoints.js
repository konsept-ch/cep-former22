import fetch from 'node-fetch'
import { v4 as uuidv4 } from 'uuid'
import { customAlphabet } from 'nanoid'
import { MIDDLEWARE_URL } from './credentialsConfig'
import { callApi, CLAROLINE_TOKEN } from './callApi'
import { sendEmail } from './sendEmail'
import { sendSms } from './sendSms'
import {
    fetchInscriptionsWithStatuses,
    createService,
    STATUSES,
    fetchSessionsLessons,
    getTemplatePreviews,
    delay,
    serializeStatuses,
    deserializeStatuses,
    formatDate,
    getLogDescriptions,
    LOG_TYPES,
    FINAL_STATUSES,
} from './utils'
import { prisma } from '.'

const nanoid = customAlphabet('1234567890', 6)

export const generateEndpoints = () => {
    createService('post', '/auth/sendCode', async (req, res) => {
        await delay(200)

        const email = req.body.email?.trim()

        const code = nanoid() //=> "123456"

        const sendTimestamp = Date.now()

        await prisma.former22_auth_codes.upsert({
            where: { email },
            update: { code, sendTimestamp },
            create: { email, code, sendTimestamp },
        })

        await sendEmail({
            to: email,
            subject: 'Auth code',
            html_body: `<h2>Auth code</h2><p>${code}</p>`,
        })

        res.json({ isCodeSendingSuccessful: true })
    })

    createService('post', '/auth/checkCodeAndToken', async (req, res) => {
        await delay(200)

        const email = req.body.email?.trim()
        const token = req.body.token?.trim()
        const code = req.body.code?.trim()

        const authPair = await prisma.former22_auth_codes.findUnique({
            where: { email },
            select: { code: true },
        })
        const doesCodeMatch = authPair.code === code

        if (doesCodeMatch) {
            const apitokenResponse = await callApi({ req, path: 'apitoken', headers: { [CLAROLINE_TOKEN]: token } })

            const doesTokenExist = apitokenResponse?.some?.(
                ({ token: existingToken, user: { email: associatedEmail } }) =>
                    existingToken === token && associatedEmail === email
            )

            res.json({ areCodeAndTokenCorrect: doesTokenExist })
        } else {
            res.json({ areCodeAndTokenCorrect: false })
        }
    })

    createService('get', '/parameters', async (req, res) => {
        const templates = await prisma.former22_template.findMany({})

        const templatesWithDeserializedStatuses = templates.map((template) => ({
            ...template,
            statuses: deserializeStatuses(template.statuses),
        }))

        const response = templatesWithDeserializedStatuses ?? "Les modèles n'ont pas été trouvés"

        res.json({ emailTemplates: response })
    })

    // templates preview START
    createService('get', '/template/previews', async (req, res) => {
        const { templateId, sessionId, inscriptionId } = req.query

        const previews = await getTemplatePreviews({ req, templateId, sessionId, inscriptionId })

        res.json(previews ?? "Les espaces réservés n'ont pas été trouvés")
    })

    createService('get', '/template/previews/massUpdate', async (req, res) => {
        const { templateId } = req.query

        const template = await prisma.former22_template.findUnique({
            where: { templateId },
        })

        res.json(template ?? "Le modèle n'a pas été trouvé")
    })
    // templates preview END

    // templates START
    createService('get', '/templates', async (_req, res) => {
        const templates = await prisma.former22_template.findMany({})

        const templatesWithDeserializedStatuses = templates.map((template) => ({
            ...template,
            statuses: deserializeStatuses(template.statuses),
        }))

        res.json(templatesWithDeserializedStatuses ?? "Les modèles n'ont pas été trouvés")
    })

    createService(
        'post',
        '/templates',
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
                actionDescription: 'Added a template',
            }
        },
        { entityType: LOG_TYPES.TEMPLATE }
    )

    createService(
        'put',
        '/templates/:templateId',
        async (req, res) => {
            await prisma.former22_template.update({
                where: { templateId: req.params.templateId },
                data: { ...req.body, templateId: req.body.templateId, statuses: serializeStatuses(req.body.statuses) },
            })

            res.json('Le modèle a été modifié')

            return {
                entityName: req.body.title,
                actionDescription: `Updated template ${req.body.title}`,
            }
        },
        { entityType: LOG_TYPES.TEMPLATE }
    )

    createService(
        'delete',
        '/templates/:templateId',
        async (req, res) => {
            const template = await prisma.former22_template.delete({
                where: { templateId: req.params.templateId },
            })

            res.json('Le modèle a été supprimé')

            return {
                entityName: template.title,
                actionDescription: `Deleted template ${template.title}`,
            }
        },
        { entityType: LOG_TYPES.TEMPLATE }
    )
    // templates END

    // organizations START
    createService('get', '/organizations', async (req, res) => {
        const organizations = await callApi({ req, path: 'organization/list/recursive' })

        res.json(organizations)
    })
    // organizations END

    // users START
    createService('get', '/allUsers', async (req, res) => {
        const users = await callApi({ req, path: 'user' })

        res.json(users)
    })

    createService('get', '/admins', async (req, res) => {
        const users = await callApi({ req, path: 'user' })

        const admins = users.reduce((acc, currentUser) => {
            if (currentUser.roles.some(({ name }) => name === 'ROLE_ADMIN')) {
                return [...acc, currentUser]
            }
            return acc
        }, [])

        res.json(admins)
    })
    // users END

    // courses START
    createService('get', '/courses', async (req, res) => {
        const courses = await callApi({ req, path: 'data_source/all_courses/home' })

        const coursesDataToFetch = courses.map(async (course) => {
            const courseAdditionalData = await prisma.former22_course.findUnique({
                where: { courseId: course.id },
            })

            return {
                ...course,
                ...courseAdditionalData,
            }
        })

        const fetchedCoursesData = await Promise.allSettled(coursesDataToFetch)

        const fullCoursesData = fetchedCoursesData.map(({ value }) => value)

        res.json(fullCoursesData ?? 'Aucun cours trouvé')
    })

    createService('get', '/courseBySlug/:slug', async (req, res) => {
        const courseDetails = await callApi({
            req,
            path: 'cursus_course/find',
            params: `filters[slug]=${req.params.slug}`,
        })

        res.json(courseDetails ?? "Le cours n'a pas été trouvé")
    })

    createService(
        'put',
        '/saveCourseById/:id',
        async (req, res) => {
            const courseDetails = await callApi({
                req,
                path: `cursus_course/${req.params.id}`,
                method: 'put',
                body: req.body,
            })

            res.json(courseDetails ?? "Le cours n'a pas été sauvegardé")

            return {
                entityName: courseDetails.name,
                actionDescription: getLogDescriptions.formation(),
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
                actionDescription: 'Added organisations',
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
                actionDescription: 'Deleted organisations',
            }
        },
        { entityType: LOG_TYPES.ORGANISATION }
    )

    createService(
        'post',
        '/course/:courseId',
        async (req, res) => {
            await prisma.former22_course.upsert({
                where: { courseId: req.params.courseId },
                update: { [req.body.field]: req.body.newValue },
                create: { [req.body.field]: req.body.newValue, courseId: req.params.courseId },
            })

            res.json('Le cours a été modifié')

            const currentCourse = await callApi({
                req,
                path: `cursus_course/${req.params.courseId}`,
            })

            return {
                entityName: currentCourse.name,
                actionDescription: getLogDescriptions.formation({
                    field: req.body.header,
                    fieldValue: req.body.newValue,
                }),
            }
        },
        { entityType: LOG_TYPES.FORMATION }
    )
    // courses END

    // rooms START
    createService('get', '/roomsAndEvents', async (req, res) => {
        const rooms = await callApi({ req, path: 'location_room' })

        if (typeof rooms !== 'undefined') {
            const events = await callApi({ req, path: `cursus_event` })

            res.json({ rooms, events })
        } else {
            res.json('Aucune salle trouvée')
        }
    })
    // rooms END

    // sessions START
    createService('get', '/sessions', async (req, res) => {
        const sessions = await callApi({ req, path: 'cursus_session' })

        const sessionsDataToFetch = sessions.map(async (session) => {
            const sessionAdditionalData = await prisma.former22_session.findUnique({
                where: { sessionId: session.id },
            })

            return {
                ...session,
                ...sessionAdditionalData,
            }
        })

        const fetchedSessionsData = await Promise.allSettled(sessionsDataToFetch)

        const fullSessionsData = fetchedSessionsData.map(({ value }) => value)

        res.json(fullSessionsData ?? 'Aucune session trouvée')
    })

    createService('get', '/sessions/lessons', async (req, res) => {
        const sessionsLessons = await fetchSessionsLessons({ req })

        res.json(sessionsLessons ?? 'Aucunes sessions résumé dates trouvées')
    })

    createService('post', '/sessions/:sessionId', async (req, res) => {
        await prisma.former22_session.upsert({
            where: { sessionId: req.params.sessionId },
            update: {
                areInvitesSent: req.body.areInvitesSent,
                sessionName: req.body.sessionName,
                startDate: req.body.startDate,
            },
            create: {
                sessionId: req.params.sessionId,
                areInvitesSent: req.body.areInvitesSent,
                sessionName: req.body.sessionName,
                startDate: req.body.startDate,
            },
        })

        const learners = await callApi({ req, path: `cursus_session/${req.params.sessionId}/users/learner` })

        const templateForSessionInvites = await prisma.former22_template.findFirst({
            where: { isUsedForSessionInvites: true },
        })

        if (templateForSessionInvites) {
            const emailsToSend = learners.map(async (learner) => {
                const { emailContent, emailSubject, smsContent } = await getTemplatePreviews({
                    req,
                    templateId: templateForSessionInvites.templateId,
                    sessionId: req.params.sessionId,
                    inscriptionId: learner.id,
                })

                const { emailResponse } = await sendEmail({
                    to: learner.user.email,
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
    })
    // sessions END

    // inscriptions START
    createService('get', '/inscriptions', async (req, res) => {
        const inscriptions = await fetchInscriptionsWithStatuses()

        if (inscriptions.length > 0) {
            res.json(inscriptions)
        } else {
            res.json('Aucune inscription trouvée')
        }
    })

    createService(
        'post',
        '/inscriptions/:inscriptionId',
        async (req, res) => {
            const { emailTemplateId, status: newStatus } = req.body

            const inscriptions = await fetchInscriptionsWithStatuses()

            const currentInscription = inscriptions.find(({ id }) => id === req.params.inscriptionId)

            if (Object.values(FINAL_STATUSES).includes(currentInscription?.status)) {
                res.json('Ce statut ne peut pas être modifié')

                return {
                    entityName: `${currentInscription.user.username} => ${currentInscription.session.name}`,
                    actionDescription: getLogDescriptions.inscription({
                        originalStatus: currentInscription.status,
                        newStatus: req.body.status,
                    }),
                }
            }

            const statusesForRefusalRh = [STATUSES.REFUSEE_PAR_RH]
            const statusesForValidation = [STATUSES.A_TRAITER_PAR_RH, STATUSES.ENTREE_WEB, STATUSES.ACCEPTEE_PAR_CEP]
            const statusesForAnnulation = [STATUSES.REFUSEE_PAR_CEP, STATUSES.ANNULEE, STATUSES.ECARTEE]

            if (typeof currentInscription !== 'undefined') {
                await prisma.former22_inscription.upsert({
                    where: { inscriptionId: req.params.inscriptionId },
                    update: { inscriptionStatus: req.body.status },
                    create: { inscriptionStatus: req.body.status, inscriptionId: req.params.inscriptionId },
                })

                if (statusesForRefusalRh.includes(newStatus)) {
                    await callApi({
                        req,
                        path: `cursus_session/${currentInscription.session.id}/pending`,
                        params: { 'ids[0]': currentInscription.user.id },
                        method: 'patch',
                    })
                } else if (statusesForValidation.includes(newStatus)) {
                    await callApi({
                        req,
                        path: `cursus_session/${currentInscription.session.id}/pending/validate`,
                        params: { 'ids[0]': currentInscription.id },
                        method: 'put',
                    })
                } else if (statusesForAnnulation.includes(newStatus)) {
                    await callApi({
                        req,
                        path: `cursus_session/${currentInscription.session.id}/users/learner`,
                        params: { 'ids[0]': currentInscription.id },
                        method: 'delete',
                    })
                }

                if (emailTemplateId) {
                    const { emailContent, emailSubject, smsContent } = await getTemplatePreviews({
                        req,
                        templateId: emailTemplateId,
                        sessionId: currentInscription.session.id,
                        inscriptionId: currentInscription.id,
                    })

                    const { emailResponse } = await sendEmail({
                        to: currentInscription.user.email,
                        subject: emailSubject,
                        html_body: emailContent,
                    })

                    await sendSms({ to: '359877155302', content: smsContent })

                    res.json({ emailResponse })
                } else {
                    res.json('Le statut a été modifié')
                }

                return {
                    entityName: `${currentInscription.user.username} => ${currentInscription.session.name}`,
                    actionDescription: getLogDescriptions.inscription({
                        originalStatus: currentInscription.status,
                        newStatus: req.body.status,
                    }),
                }
            } else {
                res.json('Aucune inscription trouvée')
            }
        },
        { entityType: LOG_TYPES.INSCRIPTION }
    )

    createService('post', '/inscriptions/mass/update', async (req, res) => {
        const { emailTemplateId, status: newStatus, inscriptionsIds } = req.body

        inscriptionsIds.forEach(
            async (id) =>
                await fetch(`${MIDDLEWARE_URL}/inscriptions/${id}`, {
                    method: 'post',
                    headers: req.headers,
                    body: JSON.stringify({
                        emailTemplateId,
                        status: newStatus,
                    }),
                })
        )

        res.json('Les statuts ont été modifiés')
    })
    // inscriptions END

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
            res.json('Aucune inscription trouvée')
        }
    })
    // formateurs END
}
