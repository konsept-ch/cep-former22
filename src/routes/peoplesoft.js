import { Router } from 'express'
import convert from 'xml-js'

import { callApi, CLAROLINE_TOKEN, PEOPLESOFT_TOKEN } from '../callApi'
import { createService } from '../utils'
import { prisma } from '..'
import { fetchInscriptionsWithStatuses } from './inscriptionsUtils'

export const peoplesoftRouter = Router()

const respondToPeopleSoft = (res, data) =>
    res.format({
        'application/json': () => res.json(data),

        'application/xml': () => {
            const options = { compact: true, spaces: 4 }
            const result =
                typeof data === 'string'
                    ? convert.json2xml({ error: data }, options)
                    : convert.json2xml({ formations: { formation: data } }, options)
            res.send(result)
        },

        default: () => res.json(data),
    })

/**
 * @openapi
 *
 * /peoplesoft/formations:
 *   get:
 *     summary: Retourne la liste des formations
 *     tags: [Formations]
 *     description: Liste des formations proposées par le CEP
 *     parameters:
 *       - name: X-Former22-API-Key
 *         in: header
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: La liste des formations a été retourné avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Course'
 *           application/xml:
 *             schema:
 *               type: object
 *               xml:
 *                 name: formations
 *               properties:
 *                 formation:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Course'
 */
createService(
    'get',
    '/formations',
    async (req, res) => {
        const token = req.header(PEOPLESOFT_TOKEN) ?? req.query.apitoken

        if (token == null) {
            respondToPeopleSoft(res, `Vous devez passer le header ${PEOPLESOFT_TOKEN}`)
        } else {
            const currentAuth = await callApi({
                req,
                path: '/apiv2/apitoken/list/current',
                headers: { [CLAROLINE_TOKEN]: token },
            })

            if (currentAuth === 'Access Denied.') {
                respondToPeopleSoft(res, "Votre token n'existe pas dans Claroline")
            } else {
                const isAdmin = currentAuth[0]?.user?.permissions.administrate

                if (!isAdmin) {
                    respondToPeopleSoft(res, "Vous n'êtes pas admin")
                } else {
                    const courses = await prisma.claro_cursusbundle_course.findMany({
                        where: { hidden: false }, // TODO: ask CEP about other filters except hidden: false
                        select: {
                            // TODO: ask CEP if we should send the poster and thumbnail URLs
                            uuid: true,
                            slug: true,
                            code: true,
                            course_name: true,
                            createdAt: true,
                            updatedAt: true,
                            session_days: true,
                            session_hours: true,
                            plainDescription: true,
                            max_users: true,
                            price: true,
                        },
                    })

                    const coursesDataToFetch = courses.map(async (course) => {
                        const courseAdditionalData = await prisma.former22_course.findUnique({
                            where: { courseId: course.uuid },
                            select: {
                                // note: we don't send coordinator and responsible to peoplesoft
                                coordinator: false,
                                responsible: false,
                                typeStage: true,
                                teachingMethod: true,
                                codeCategory: true,
                            },
                        })

                        return {
                            ...course,
                            ...courseAdditionalData,
                        }
                    })

                    const fetchedCoursesData = await Promise.allSettled(coursesDataToFetch)

                    const fullCoursesData = fetchedCoursesData.map(({ value }) => value)

                    // const filteredCoursesData = fullCoursesData.filter(({ restrictions: { hidden } }) => !hidden)
                    const filteredCoursesData = fullCoursesData

                    // TODO sessions - dates only, not hours

                    // note: we rename some fields here
                    const strippedCoursesData = filteredCoursesData.map(
                        ({
                            uuid: id,
                            course_name: name,
                            createdAt: creationDate,
                            updatedAt: lastUpdatedDate,
                            max_users: maxParticipants,
                            session_days,
                            session_hours,
                            ...restCourseData
                        }) => ({
                            ...restCourseData,
                            id,
                            name,
                            creationDate,
                            lastUpdatedDate,
                            maxParticipants,
                            durationHours: session_days * 7.5 + session_hours,
                        })
                    )

                    respondToPeopleSoft(res, strippedCoursesData ?? 'Aucun cours trouvé')
                }
            }
        }
    },
    null,
    peoplesoftRouter
)

/**
 * @openapi
 *
 * /peoplesoft/inscriptions:
 *   get:
 *     summary: Retourne la liste des inscriptions qui concernent PeopleSoft de la Ville de Lausanne
 *     tags: [Inscriptions]
 *     description: Liste des inscriptions qui concernent PeopleSoft de la Ville de Lausanne
 *     parameters:
 *       - name: filter
 *         in: query
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: La liste des inscriptions a été retourné avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Inscription'
 */
createService(
    'get',
    '/inscriptions',
    async (_req, res) => {
        try {
            const inscriptions = await fetchInscriptionsWithStatuses()

            if (inscriptions.length > 0) {
                respondToPeopleSoft(res, inscriptions)
            } else {
                respondToPeopleSoft(res, 'Aucune inscription trouvée')
            }
        } catch (error) {
            console.error(error)
        }
    },
    null,
    peoplesoftRouter
)
