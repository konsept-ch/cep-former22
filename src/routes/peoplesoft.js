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
                            // slug: true,
                            code: true,
                            course_name: true,
                            createdAt: true,
                            session_days: true,
                            session_hours: true,
                            plainDescription: true,
                            // updatedAt: true,
                            claro_cursusbundle_course_session: {
                                where: { hidden: false }, // TODO: ask CEP about other filters except hidden: false
                                select: {
                                    uuid: true,
                                    code: true,
                                    course_name: true,
                                    plainDescription: true,
                                    max_users: true,
                                    createdAt: true,
                                    // updatedAt: true,
                                    start_date: true,
                                    end_date: true,
                                    // used_by_quotas: true,
                                    // quota_days: true,
                                    // TODO location
                                },
                            },
                        },
                    })

                    const coursesAdditionalData = await prisma.former22_course.findMany({
                        select: {
                            courseId: true,
                            typeStage: true,
                            teachingMethod: true,
                            codeCategory: true,
                            isRecurrent: true,
                            // note: we don't send coordinator and responsible to peoplesoft
                            coordinator: false,
                            responsible: false,
                        },
                    })

                    const fullCoursesData = courses.map((course) => ({
                        ...course,
                        ...coursesAdditionalData.find(({ courseId }) => courseId === course.uuid),
                        // eslint-disable-next-line no-undefined -- unset courseId
                        courseId: undefined,
                    }))

                    // TODO: ask CEP about other filters based on business logic
                    // const filteredCoursesData = fullCoursesData.filter(({ restrictions: { hidden } }) => !hidden)
                    const filteredCoursesData = fullCoursesData

                    // TODO sessions - dates only, not hours

                    // note: we rename some fields here for clarity and consistency
                    const renamedFieldsCoursesData = filteredCoursesData.map(
                        ({
                            uuid: id,
                            code,
                            course_name: name,
                            createdAt: creationDate,
                            typeStage = null,
                            teachingMethod = null,
                            codeCategory = null,
                            isRecurrent,
                            session_days,
                            session_hours,
                            plainDescription: summary,
                            claro_cursusbundle_course_session,
                            ...restCourseData
                        }) => ({
                            ...restCourseData,
                            id,
                            code,
                            name,
                            isActive: true, // TODO: discuss: statut stage actif/inactif
                            creationDate,
                            typeStage,
                            teachingMethod,
                            codeCategory,
                            isCertifying: typeStage === 'Certificat',
                            isRecurrent,
                            durationHours: session_days * 7.5 + session_hours,
                            summary,
                            sessions: claro_cursusbundle_course_session.map(
                                ({
                                    uuid: sessionId,
                                    course_name: sessionName,
                                    createdAt: sessionCreationDate,
                                    updatedAt: sessionLastUpdatedDate,
                                    plainDescription: sessionSummary,
                                    max_users: maxParticipants,
                                    start_date: startDate,
                                    end_date: endDate,
                                    ...restSessionData
                                }) => ({
                                    ...restSessionData,
                                    id: sessionId,
                                    name: sessionName,
                                    creationDate: sessionCreationDate,
                                    lastUpdatedDate: sessionLastUpdatedDate,
                                    summary: sessionSummary,
                                    maxParticipants,
                                    startDate,
                                    endDate, // TODO: check if endDate format is OK or if we should set it to 23h59min later
                                })
                            ),
                        })
                    )

                    // respondToPeopleSoft(res, 'additional ok')

                    respondToPeopleSoft(res, renamedFieldsCoursesData ?? 'Aucun cours trouvé')
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
