// deprecated, use routes instead

import { v4 as uuidv4 } from 'uuid'
import { callApi } from './callApi'
import { sendEmail } from './sendEmail'
import { createService, formatDate, getLogDescriptions, LOG_TYPES } from './utils'
import { prisma } from '.'
import { fetchInscriptionsWithStatuses } from './routes/inscriptionsUtils'

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
        '/organizations/:organizationId',
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
        '/courses/:courseId',
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
