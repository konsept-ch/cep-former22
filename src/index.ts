import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import logger from 'morgan'
import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'
import prismaClientPkg from '@prisma/client'
import yaml from 'js-yaml'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'

import { generateEndpoints } from './expressEndpoints' // deprecated, use routes instead

import { authRouter } from './routes/auth'
import { agendaRouter } from './routes/agenda'
import { coursesRouter } from './routes/courses'
import { mailRouter } from './routes/mail'
import { attestationsRouter } from './routes/attestations'
import { evaluationsRouter } from './routes/evaluations'
import { contractTemplatesRouter } from './routes/contractTemplates'
import { evaluationTemplatesRouter } from './routes/evaluationTemplates'
import { eventsRouter } from './routes/events'
import { inscriptionsRouter } from './routes/inscriptions'
import { invoicesRouter } from './routes/invoices'
import { manualInvoicesRouter } from './routes/manual-invoices'
import { organizationsRouter } from './routes/organizations'
import { peoplesoftRouter } from './routes/peoplesoft'
import { sessionsRouter } from './routes/sessions'
import { templatesRouter } from './routes/templates'
import { usersRouter } from './routes/users'
import { receptionRouter } from './routes/reception'
import { contractsRouter } from './routes/contracts'
import { authMiddleware } from './utils'

const { PrismaClient } = prismaClientPkg
export const prisma = new PrismaClient()

export const app = express()

app.use(helmet())
app.use(cors())
app.use(logger('dev'))
app.use(express.json({ limit: '50mb' }))
app.use(cookieParser())
// app.use(express.urlencoded({ extended: false })) // TODO check if needed

// const port = process.env.PORT ?? 4000
// const apiPrefix = '/api/v1'
const SWAGGER_UI_PATH = '/api-docs'
const SWAGGER_SCHEMA_PATH = `${SWAGGER_UI_PATH}/swagger.json`
const SWAGGER_SCHEMA_YAML_PATH = `${SWAGGER_UI_PATH}/swagger.yaml`
const swaggerOptions = {
    definition: {
        openapi: '3.0.3',
        info: {
            title: 'Former22 API Documentation',
            version: '1.0.0',
        },
    },
    apis: ['./src/swaggerSchemas.yml', './src/routes/peoplesoft.js'], // files containing annotations as above
}

const openapiSpecification = await swaggerJsdoc(swaggerOptions)

const swaggerUiOptions = {
    swaggerOptions: {
        url: SWAGGER_SCHEMA_PATH,
    },
}

app.get(SWAGGER_SCHEMA_PATH, (_req, res) => {
    res.send(openapiSpecification)
})
app.get(SWAGGER_SCHEMA_YAML_PATH, (_req, res) => {
    const yml = yaml.dump(openapiSpecification, { lineWidth: -1 })
    res.set('Content-Type', 'text/yaml; charset=utf-8').status(200).send(yml)
})

import { Prisma } from '@prisma/client'
import { v4 as uuidv4 } from 'uuid'
app.get('/testtesttest0', async (_req, res) => {
    const invoices = await prisma.former22_manual_invoice.findMany({
        select: {
            id: true,
            items: true,
            former22_invoice_item: true,
        },
        where: {
            invoiceType: 'Directe',
            items: {
                not: Prisma.AnyNull,
            },
        },
    })
    res.json(invoices)
})
app.get('/testtesttest1', async (_req, res) => {
    enum InscriptionType {
        Inscription,
        Cancellation,
    }

    const hash = (sessionName: any, userId: any) => sessionName + '...' + userId

    const inscriptions = (
        await prisma.claro_cursusbundle_course_session_user.findMany({
            select: {
                id: true,
                claro_cursusbundle_course_session: {
                    select: {
                        course_name: true,
                    },
                },
                user_id: true,
            },
        })
    ).reduce(
        (map, su) =>
            map.set(hash(su.claro_cursusbundle_course_session.course_name, su.user_id), {
                ...su,
                type: InscriptionType.Inscription,
            }),
        (
            await prisma.claro_cursusbundle_course_session_cancellation.findMany({
                select: {
                    id: true,
                    claro_cursusbundle_course_session: {
                        select: {
                            course_name: true,
                        },
                    },
                    user_id: true,
                },
            })
        ).reduce(
            (map, c) =>
                map.set(hash(c.claro_cursusbundle_course_session.course_name, c.user_id), {
                    ...c,
                    type: InscriptionType.Cancellation,
                }),
            new Map()
        )
    )

    const invoices = await prisma.former22_manual_invoice.findMany({
        select: {
            id: true,
            items: true,
        },
        where: {
            invoiceType: 'Directe',
            items: {
                not: Prisma.AnyNull,
            },
        },
    })

    for (const invoice of invoices) {
        for (const item of invoice.items as any) {
            const split: any = item.designation.split(' - ')
            if (split.length < 2) {
                res.json({
                    message: 'The designation do not splitted.',
                    designation: item.designation,
                })
                return
            }

            const sessionName: any = split.slice(1).join(' - ')
            const nameParts = split[0].split(' ')
            const firstname = nameParts[0]
            const lastname = nameParts[nameParts.length - 1]

            const users = await prisma.claro_user.findMany({
                select: {
                    id: true,
                    first_name: true,
                    last_name: true,
                },
                where: {
                    first_name: {
                        startsWith: firstname,
                    },
                    last_name: {
                        endsWith: lastname,
                    },
                },
            })
            if (users.length == 0) {
                res.json({
                    message: 'The user is not exists.',
                    user: nameParts.join(' '),
                    session: sessionName,
                    designation: item.designation,
                })
                return
            }

            let selectedUsers =
                users.length > 1
                    ? users.filter(
                          (user: any) =>
                              user.first_name.startsWith(firstname) &&
                              user.last_name.endsWith(lastname) &&
                              (nameParts.length > 2
                                  ? user.first_name.endsWith(nameParts[1]) || user.last_name.startsWith(nameParts[1])
                                  : true)
                      )
                    : users
            if (selectedUsers.length == 0) {
                res.json({
                    message: 'The user can do not separated.',
                    user: nameParts.join(' '),
                    users,
                })
                return
            }

            let inscription = null
            for (const user of selectedUsers) {
                if ((inscription = inscriptions.get(hash(sessionName, user.id)))) break
            }

            if (inscription == null) {
                res.json({
                    message: 'The inscription is not exists',
                    session: sessionName,
                    user: nameParts.join(' '),
                    users,
                })
                return
            }

            await prisma.former22_invoice_item.create({
                data: {
                    uuid: uuidv4(),
                    invoiceId: invoice.id,
                    designation: item.designation,
                    unit: item.unit.value,
                    amount: item.amount,
                    price: item.price == 'null' ? null : item.price,
                    vatCode: item.vatCode.value,
                    ...(inscription.type == InscriptionType.Inscription
                        ? { inscriptionId: inscription.id }
                        : { cancellationId: inscription.id }),
                },
            })
        }
    }

    res.json({
        message: 'Successfull',
    })
})
app.get('/testtesttest2', async (_req, res) => {
    await prisma.former22_invoice_item.updateMany({
        data: {
            price: null,
        },
        where: {
            price: 'null',
        },
    })
    res.json({
        message: 'Successfull',
    })
})

// Make sure the schema file is publicly accessible, otherwise break our Swagger UI as well
// https://github.com/scottie1984/swagger-ui-express#load-swagger-from-url
app.use(
    SWAGGER_UI_PATH,
    swaggerUi.serveFiles(undefined, swaggerUiOptions),
    swaggerUi.setup(undefined, swaggerUiOptions)
)

generateEndpoints()

app.use('/peoplesoft', peoplesoftRouter)

app.get('/', (_req, res) => {
    const peoplesoftRoutes = peoplesoftRouter.stack.map(({ route: { path, stack } }) => ({
        path: `/peoplesoft${path}`,
        method: stack[0].method,
    }))

    const SWAGGER_LINK = `<a href="${SWAGGER_UI_PATH}">${SWAGGER_UI_PATH} (Swagger - Former22 API documentation)</a>`

    res.send(
        `<ul><li>${SWAGGER_LINK}</li>${peoplesoftRoutes
            .map(({ path, method }) => `<li><a href="${path}">${path} (${method})</a></li>`)
            .join('')}</ul>`
    )
})

app.use('/reception', receptionRouter)
app.use('/auth', authRouter)
app.use('/mail', mailRouter)
app.use('/evaluations', evaluationsRouter)

app.use('*', authMiddleware)

app.use('/agenda', agendaRouter)
app.use('/courses', coursesRouter)
app.use('/attestations', attestationsRouter)
app.use('/contract-templates', contractTemplatesRouter)
app.use('/evaluation-templates', evaluationTemplatesRouter)
app.use('/events', eventsRouter)
app.use('/inscriptions', inscriptionsRouter)
app.use('/invoices', invoicesRouter)
app.use('/manual-invoices', manualInvoicesRouter)
app.use('/organizations', organizationsRouter)
app.use('/sessions', sessionsRouter)
app.use('/templates', templatesRouter)
app.use('/users', usersRouter)
app.use('/contracts', contractsRouter)
