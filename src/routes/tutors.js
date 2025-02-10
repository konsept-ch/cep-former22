import { Router } from 'express'

import { createService } from '../utils'
import { prisma } from '..'

export const tutorsRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
        const users = await prisma.claro_user.findMany({
            select: {
                uuid: true,
                first_name: true,
                last_name: true,
                user_organization: {
                    select: {
                        claro__organization: {
                            select: {
                                name: true,
                            },
                        },
                    },
                    where: {
                        is_main: true,
                    },
                },
                former22_tutor: {
                    select: {
                        json: true,
                    },
                },
            },
            where: {
                is_removed: false,
                OR: [
                    {
                        claro_user_group: {
                            some: {
                                group_id: 14,
                            },
                        },
                    },
                    {
                        claro_cursusbundle_course_session_user: {
                            some: {
                                registration_type: 'tutor',
                            },
                        },
                    },
                ],
            },
        })

        res.json(
            users.map((user) => ({
                id: user.uuid,
                organization: user.user_organization[0].claro__organization.name,
                firstname: user.first_name,
                lastname: user.last_name,
                ...(user.former22_tutor
                    ? user.former22_tutor.json
                    : {
                          address: '',
                          email: '',
                          year: '',
                          cv: false,
                          cert: false,
                          accreditations: '',
                          expertises: '',
                          titles: [],
                          skills: [],
                          training: '',
                          roles: [],
                          domains: [],
                          cat: false,
                          ps: false,
                          fsm: false,
                          cursus: false,
                          status: null,
                          course: '',
                          pitch: '',
                          scenario: '',
                          links: '',
                          educational: '',
                      }),
            }))
        )
    },
    null,
    tutorsRouter
)

createService(
    'put',
    '/:uuid',
    async (req, res) => {
        await prisma.claro_user.update({
            data: {
                former22_tutor: {
                    upsert: {
                        create: { json: req.body },
                        update: { json: req.body },
                    },
                },
            },
            where: {
                uuid: req.params.uuid,
            },
        })

        res.json({
            message: 'Le formateur a été enregistré',
        })
    },
    null,
    tutorsRouter
)
