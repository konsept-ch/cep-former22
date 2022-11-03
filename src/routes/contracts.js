import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import fs from 'fs'
import path from 'path'
//import libre from 'libreoffice-convert'

import { prisma } from '..'
import { createService, LOG_TYPES, contractTemplateFilesDest } from '../utils'
import { CloneRowModule } from '../cloneRowModule'

export const contractsRouter = Router()

createService(
    'put',
    '/',
    async (req, res) => {
        try {
            const { userId, courseId, templateId } = req.body

            const template = await prisma.former22_contract_template.findUnique({
                where: {
                    uuid: templateId,
                },
            })

            let contract = await prisma.former22_contract.findFirst({
                where: {
                    userId,
                    courseId,
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
                    },
                })
            }

            const subscriptions = await prisma.claro_cursusbundle_session_event_user.findMany({
                where: {
                    claro_user: {
                        uuid: userId,
                    },
                    claro_cursusbundle_session_event: {
                        claro_cursusbundle_course_session: {
                            claro_cursusbundle_course: {
                                uuid: courseId,
                            },
                        },
                    },
                },
                select: {
                    claro_cursusbundle_session_event: {
                        select: {
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
                            claro_cursusbundle_course_session: {
                                select: {
                                    id: true,
                                    course_name: true,
                                    claro_cursusbundle_course: {
                                        select: {
                                            id: true,
                                            course_name: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    claro_user: {
                        select: {
                            id: true,
                            first_name: true,
                            last_name: true,
                        },
                    },
                },
            })

            const user = subscriptions[0].claro_user
            const course =
                subscriptions[0].claro_cursusbundle_session_event.claro_cursusbundle_course_session
                    .claro_cursusbundle_course

            /*const sessions = new Map()
            for (const {
                claro_cursusbundle_session_event: {
                    claro_planned_object: { start_date, end_date },
                    claro_cursusbundle_course_session: session,
                },
            } of subscriptions) {
                if (!sessions.has(session.id)) {
                    sessions.set(session.id, {
                        name: session.course_name,
                        events: [],
                    })
                }
                sessions.get(session.id).events.push({
                    start_date,
                    end_date,
                })
            }*/

            const content = fs.readFileSync(path.resolve(contractTemplateFilesDest, template.fileStoredName), 'binary')
            const zip = new PizZip(content)
            const doc = new Docxtemplater(zip, {
                modules: [new CloneRowModule()],
                delimiters: { start: '[', end: ']' },
                paragraphLoop: true,
                linebreaks: true,
            })

            doc.render({
                FORMATEUR_CIVILITE: 'Madame', // TODO search value where user -> claro_field_facet_value -> claro_field_facet (name: "Civilité")
                FORMATEUR_NOM: `${user.first_name} ${user.last_name}`,
                COURS_NOM: course.course_name,
                Val1: ['Pierre', 'Marie'],
                Val2: ['Dupont', 'Tombez'],
            })

            const docxBuf = doc.getZip().generate({
                type: 'nodebuffer',
                // compression: DEFLATE adds a compression step.
                // For a 50MB output document, expect 500ms additional CPU time
                // compression: 'DEFLATE',
            })

            fs.writeFileSync('/mnt/c/Users/anthony/Desktop/cep/generated_by_WSL.docx', docxBuf)

            /*const ext = '.pdf'

            // Convert it to pdf format with undefined filter (see Libreoffice docs about filter)
            const pdfBuf = await libre.convertAsync(docxBuf, ext, undefined)
            const pdfFileName = `${template.fileStoredName}${ext}`
            const originalPdfName = `${template.fileOriginalName}${ext}`*/

            res.json(true)

            return {
                entityName: 'Contract',
                entityId: contract.uuid,
                actionName: 'Created an contract',
            }
        } catch (error) {
            console.error(error)

            res.json('Erreur')
        }
    },
    { entityType: LOG_TYPES.CONTRACT },
    contractsRouter
)
