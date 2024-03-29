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
import { tutorsRouter } from './routes/tutors'
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
app.use('/tutors', tutorsRouter)
