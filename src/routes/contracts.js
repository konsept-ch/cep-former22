import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import fs from 'fs'
import path from 'path'

import { prisma } from '..'
import { createService, LOG_TYPES, contractTemplateFilesDest, contractFilesDest } from '../utils'
import { CloneRowModule } from '../cloneRowModule'

export const contractsRouter = Router()

createService(
    'get',
    '/:id',
    async (req, res) => {
        try {
            const contract = await prisma.former22_contract.findUnique({
                where: {
                    uuid: req.params.id,
                },
            })

            res.download(`${contractFilesDest}/${contract.uuid}.docx`)

            return {
                entityName: 'Contract',
                entityId: contract.uuid,
                actionName: 'Downloaded an contract',
            }
        } catch (error) {
            console.error(error)

            res.json('Erreur')
        }
    },
    { entityType: LOG_TYPES.CONTRACT },
    contractsRouter
)

createService(
    'put',
    '/',
    async (req, res) => {
        const { userId, courseId, templateId, year } = req.body

        const template = await prisma.former22_contract_template.findUnique({
            where: {
                uuid: templateId,
            },
        })

        let contract = await prisma.former22_contract.findFirst({
            where: {
                userId,
                courseId,
                year,
            },
        })

        if (contract) {
            if (contract.templateId !== template.uuid) {
                await prisma.former22_contract.update({
                    where: {
                        id: contract.id,
                    },
                    data: {
                        templateId: template.id,
                    },
                })
            }
        } else {
            contract = await prisma.former22_contract.create({
                data: {
                    uuid: uuidv4(),
                    userId,
                    courseId,
                    templateId: template.id,
                    year,
                },
            })
        }

        const course = await prisma.claro_cursusbundle_course.findFirst({
            select: {
                course_name: true,
                claro_cursusbundle_course_session: {
                    select: {
                        course_name: true,
                        code: true,
                        claro_cursusbundle_session_event: {
                            select: {
                                uuid: true,
                                claro_planned_object: {
                                    select: {
                                        start_date: true,
                                        end_date: true,
                                        claro__location: {
                                            select: {
                                                name: true,
                                            },
                                        },
                                    },
                                },
                                former22_event: {
                                    select: {
                                        fees: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
            where: {
                uuid: courseId,
                claro_cursusbundle_course_session: {
                    some: {
                        start_date: {
                            gte: new Date(`${year}-01-01 00:00:00`),
                            lt: new Date(`${year + 1}-01-01 00:00:00`),
                        },
                        claro_cursusbundle_course_session_user: {
                            some: {
                                claro_user: {
                                    uuid: userId,
                                },
                            },
                        },
                    },
                },
            },
        })

        const user = await prisma.claro_user.findUnique({
            select: {
                first_name: true,
                last_name: true,
                claro_field_facet_value: {
                    where: {
                        claro_field_facet: {
                            type: 'choice',
                            name: 'CIVILITÉ',
                        },
                    },
                    select: {
                        claro_field_facet: {
                            select: {
                                name: true,
                                type: true,
                            },
                        },
                        field_value: true,
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
            },
            where: {
                uuid: userId,
            },
        })
        const events = course.claro_cursusbundle_course_session.reduce(
            (a, s) => [...a, ...s.claro_cursusbundle_session_event],
            []
        )

        //console.log('PLANNED OBJECT', events[0])

        const content = fs.readFileSync(path.resolve(contractTemplateFilesDest, template.fileStoredName), 'binary')
        const zip = new PizZip(content)
        const doc = new Docxtemplater(zip, {
            modules: [new CloneRowModule()],
            delimiters: { start: '[', end: ']' },
            paragraphLoop: true,
            linebreaks: true,
        })

        doc.render({
            FORMATEUR_CIVILITE: user.claro_field_facet_value[0]?.field_value.replaceAll('"', '') || 'Indéterminé',
            FORMATEUR_NOM: `${user.first_name} ${user.last_name}`,
            FORMATEUR_ORGANISATION: user.user_organization[0]?.claro__organization.name || 'Indéterminé',
            COURS_NOM: course.course_name,
            SESSION_CODE: course.claro_cursusbundle_course_session.map((s) => s.code),
            SEANCE_DATE: events.map((e) =>
                Intl.DateTimeFormat('fr-CH', {
                    timeZone: 'Europe/Zurich',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                }).format(e.claro_planned_object.start_date)
            ),
            SEANCE_LIEU: events.map((e) => e.claro_planned_object?.claro__location?.name || ''),
            SEANCE_HEURE_DEBUT: events.map((e) =>
                Intl.DateTimeFormat('fr-CH', {
                    timeZone: 'Europe/Zurich',
                    hour: '2-digit',
                    minute: '2-digit',
                }).format(e.claro_planned_object.start_date)
            ),
            SEANCE_HEURE_FIN: events.map((e) =>
                Intl.DateTimeFormat('fr-CH', {
                    timeZone: 'Europe/Zurich',
                    hour: '2-digit',
                    minute: '2-digit',
                }).format(e.claro_planned_object.end_date)
            ),
            SEANCE_HONORAIRE: events.map((e) => (e.former22_event?.fees || 0).toFixed(2)),
        })

        const docxBuf = doc.getZip().generate({
            type: 'nodebuffer',
            // compression: DEFLATE adds a compression step.
            // For a 50MB output document, expect 500ms additional CPU time
            // compression: 'DEFLATE',
        })

        fs.writeFileSync(`${contractFilesDest}/${contract.uuid}.docx`, docxBuf)

        res.json(true)

        return {
            entityName: 'Contract',
            entityId: contract.uuid,
            actionName: 'Updated an contract',
        }
    },
    { entityType: LOG_TYPES.CONTRACT },
    contractsRouter
)
