import { Router } from 'express'

import { createService } from '../utils'
import { prisma } from '..'

export const tutorsRouter = Router()

createService(
    'get',
    '/',
    async (req, res) => {
        const tutors = await prisma.claro_cursusbundle_course_session_user.findMany({
            select: {
                uuid: true,
                claro_cursusbundle_course_session: {
                    select: {
                        course_name: true,
                    },
                },
                claro_user: {
                    select: {
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
                    },
                },
                former22_tutor: {
                    select: {
                        json: true,
                    },
                },
            },
            where: {
                registration_type: 'tutor',
            },
        })

        res.json(
            tutors.map((tutor) => ({
                id: tutor.uuid,
                organization: tutor.claro_user.user_organization[0].claro__organization.name,
                session: tutor.claro_cursusbundle_course_session.course_name,
                firstname: tutor.claro_user.first_name,
                lastname: tutor.claro_user.last_name,
                ...(tutor.former22_tutor
                    ? tutor.former22_tutor.json
                    : {
                          address: '',
                          email: '',
                          year: '',
                          cv: false,
                          cert: false,
                          title: '',
                          accreditations: '',
                          skills: [],
                          training: '',
                          roles: [],
                          domain: null,
                          cat: false,
                          ps: false,
                          fsm: false,
                          cursus: false,
                          status: null,
                          dates: '',
                          administrative: [],
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
        await prisma.claro_cursusbundle_course_session_user.update({
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
