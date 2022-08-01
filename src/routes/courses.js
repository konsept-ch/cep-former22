import { Router } from 'express'

import { prisma } from '..'
import { callApi } from '../callApi'
import { createService, getLogDescriptions, LOG_TYPES } from '../utils'

export const coursesRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
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
    },
    null,
    coursesRouter
)

createService(
    'get',
    '/by-slug/:slug',
    async (req, res) => {
        const [courseDetails] = await prisma.claro_cursusbundle_course.findMany({
            where: { slug: req.params.slug },
        })

        res.json(courseDetails ?? "Le cours n'a pas été trouvé")
    },
    null,
    coursesRouter
)

createService(
    'put',
    '/save-by-id/:id',
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
    { entityType: LOG_TYPES.FORMATION },
    coursesRouter
)

createService(
    'put',
    '/addOrganizations',
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
    { entityType: LOG_TYPES.ORGANISATION },
    coursesRouter
)

createService(
    'put',
    '/removeOrganizations',
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
    { entityType: LOG_TYPES.ORGANISATION },
    coursesRouter
)

createService(
    'put',
    '/:courseId',
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
    { entityType: LOG_TYPES.FORMATION },
    coursesRouter
)
