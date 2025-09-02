import { Router } from 'express'

import { prisma } from '..'
import { callApi } from '../callApi'
import { createService, getLogDescriptions, LOG_TYPES, yearMinusOne } from '../utils'

export const coursesRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
        const recentYear = yearMinusOne()
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
                former22_course: {
                    select: {
                        coordinator: true,
                        responsible: true,
                        typeStage: true,
                        teachingMethod: true,
                        codeCategory: true,
                        theme: true,
                        targetAudience: true,
                        billingMode: true,
                        pricingType: true,
                        baseRate: true,
                        isRecurrent: true,
                        goals: true,
                    },
                },
            },
            where: {
                claro_cursusbundle_course_session: {
                    some: {
                        start_date: {
                            gt: recentYear,
                        },
                    },
                },
            },
        })

        res.json(
            courses.map((course) => {
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
                    ...course.former22_course,
                }
            })
        )
    },
    null,
    coursesRouter
)

createService(
    'get',
    '/by-slug/:slug',
    async (req, res) => {
        const course = await prisma.claro_cursusbundle_course.findFirst({
            where: { slug: req.params.slug },
        })
        if (!course) return res.status(404).json({ message: "Le cours n'a pas été trouvé" })

        res.json(course)
    },
    null,
    coursesRouter
)

createService(
    'put',
    '/save-by-id/:id',
    async (req, res) => {
        const course = await prisma.claro_cursusbundle_course.update({
            select: {
                course_name: true,
            },
            where: { uuid: req.params.id },
            data: { ...req.body },
        })

        res.json({
            message: 'Le cours a été modifié',
        })

        return {
            entityName: course.course_name,
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

        const currentCourse = await prisma.claro_cursusbundle_course.update({
            select: {
                course_name: true,
            },
            data: {
                former22_course: {
                    upsert: {
                        create: newData,
                        update: newData,
                    },
                },
            },
            where: { uuid: courseId },
        })

        res.json({
            message: 'Le cours a été modifié',
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
