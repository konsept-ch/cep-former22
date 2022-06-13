import { v4 as uuidv4 } from 'uuid'
import { customAlphabet } from 'nanoid'
import { callApi, CLAROLINE_TOKEN } from './callApi'
import { sendEmail } from './sendEmail'
import { sendSms } from './sendSms'
import { createService, delay, formatDate, getLogDescriptions, LOG_TYPES } from './utils'
import { prisma } from '.'
import { getTemplatePreviews } from './routes/templatesUtils'
import {
    fetchInscriptionsWithStatuses,
    getUserProfession,
    getProfessionFacetsValues,
    parsePhoneForSms,
} from './routes/inscriptionsUtils'

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
            await prisma.former22_user.upsert({
                where: { userId: req.params.userId },
                update: { shouldReceiveSms: req.body.shouldReceiveSms },
                create: { shouldReceiveSms: req.body.shouldReceiveSms, userId: req.params.userId },
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
                is_removed: false,
                claro_user_role: {
                    some: {
                        claro_role: {
                            name: 'ROLE_ADMIN',
                        },
                    },
                },
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

        const coursesPrismaData = await prisma.former22_course.findMany()

        const fullCoursesData = courses.map((course) => {
            const courseAdditionalData = coursesPrismaData.find(({ courseId }) => courseId === course.uuid)

            return {
                ...{
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
                },
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
                actionName: getLogDescriptions.formation(),
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
        'post',
        '/course/:courseId',
        async (req, res) => {
            await prisma.former22_course.upsert({
                where: { courseId: req.params.courseId },
                update: req.body.newData,
                create: { ...req.body.newData, courseId: req.params.courseId },
            })

            res.json('Le cours a été modifié')

            const currentCourse = await prisma.claro_cursusbundle_course.findUnique({
                where: { uuid: req.params.courseId },
                select: {
                    course_name: true,
                },
            })

            return {
                entityName: currentCourse.course_name,
                actionName: getLogDescriptions.formation({
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
        const roomsPrisma = await prisma.claro_location_room.findMany({
            select: {
                event_name: true,
                uuid: true,
                claro__location: {
                    select: {
                        name: true,
                    },
                },
            },
        })

        if (typeof roomsPrisma !== 'undefined') {
            const rooms = roomsPrisma.map(({ event_name, uuid, claro__location }) => ({
                name: event_name,
                id: uuid,
                location: claro__location,
            }))

            const eventsPrisma = await prisma.claro_planned_object.findMany({
                select: {
                    entity_name: true,
                    start_date: true,
                    end_date: true,
                    description: true,
                    claro_location_room: {
                        select: {
                            uuid: true,
                            event_name: true,
                            description: true,
                            capacity: true,
                        },
                    },
                },
            })

            const events = eventsPrisma.map(
                ({ entity_name, start_date, end_date, description, claro_location_room, uuid, ...rest }) => ({
                    ...rest,
                    id: uuid,
                    name: entity_name,
                    room: {
                        id: claro_location_room?.uuid,
                        name: claro_location_room?.event_name,
                        description: claro_location_room?.description,
                        capacity: claro_location_room?.capacity,
                    },
                    start: start_date,
                    end: end_date,
                    description,
                })
            )

            res.json({ rooms, events })
        } else {
            res.json('Aucunes salle trouvées')
        }
    })
    // rooms END

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

    createService('put', '/sessions/:sessionId', async (req, res) => {
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
    })
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

    // invoices START
    createService('get', '/invoices', async (req, res) => {
        const invoicesPrisma = await prisma.former22_invoice.findMany({
            include: {
                claro_cursusbundle_course_session_user: {
                    include: {
                        claro_user: true,
                        claro_cursusbundle_course_session: {
                            include: {
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
                                    include: {
                                        claro_user: true,
                                    },
                                },
                                claro_cursusbundle_course: {
                                    select: { course_name: true },
                                },
                            },
                        },
                    },
                },
            },
        })

        const invoices = invoicesPrisma.map(
            ({
                createdAt,
                invoiceId,
                inscriptionStatus,
                claro_cursusbundle_course_session_user: {
                    claro_cursusbundle_course_session: {
                        claro_cursusbundle_session_event,
                        claro_cursusbundle_course_session_user,
                        course_name: sessionName,
                        claro_cursusbundle_course: { course_name },
                    },
                    claro_user,
                },
                ...rest
            }) => {
                const formateurs = claro_cursusbundle_course_session_user
                    ?.filter(({ registration_type }) => registration_type === 'tutor')
                    ?.map(({ claro_user: { first_name, last_name } }) => `${last_name} ${first_name}`)
                    .join(', ')

                const seances = claro_cursusbundle_session_event
                    .map(({ claro_planned_object: { start_date } }) =>
                        formatDate({
                            dateObject: start_date,
                            isDateVisible: true,
                        })
                    )
                    .join(', ')

                return {
                    participantName: rest.participantName ?? `${claro_user.last_name} ${claro_user.first_name} `,
                    tutorsNames: rest.tutorsNames ?? formateurs,
                    sessionName: rest.sessionName ?? sessionName,
                    courseName: rest.courseName ?? course_name,
                    id: invoiceId,
                    seances,
                    createdAt,
                    inscriptionStatus,
                }
            }
        )

        res.json(invoices)
    })

    createService('delete', '/invoice/:id', async (req, res) => {
        const { id } = req.params

        await prisma.former22_invoice.delete({
            where: { invoiceId: id },
        })

        res.json('La facturation a été modifié')
    })

    createService('put', '/invoice/:id', async (req, res) => {
        const invoiceData = req.body
        const { id } = req.params

        await prisma.former22_invoice.update({
            where: { invoiceId: id },
            data: { ...invoiceData },
        })

        res.json('La facturation a été modifié')
    })
    // invoices END
}
