import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import logger from 'morgan'
import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'
import yaml from 'js-yaml'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'

import { authRouter } from './routers/auth.js'
import { agendaRouter } from './routers/agenda.js'
import { coursesRouter } from './routers/courses.js'
import { mailRouter } from './routers/mail.js'
import { attestationsRouter } from './routers/attestations.js'
import { evaluationsRouter } from './routers/evaluations.js'
import { contractTemplatesRouter } from './routers/contractTemplates.js'
import { evaluationTemplatesRouter } from './routers/evaluationTemplates.js'
import { eventsRouter } from './routers/events.js'
import { inscriptionsRouter } from './routers/inscriptions.js'
import { invoicesRouter } from './routers/invoices.js'
import { manualInvoicesRouter } from './routers/manual-invoices.js'
import { organizationsRouter } from './routers/organizations.js'
import { peoplesoftRouter } from './routers/peoplesoft.js'
import { sessionsRouter } from './routers/sessions.js'
import { templatesRouter } from './routers/templates.js'
import { usersRouter } from './routers/users.js'
import { receptionRouter } from './routers/reception.js'
import { contractsRouter } from './routers/contracts.js'

import authMiddleware from './middlewares/auth.js'
import errorMiddleware from './middlewares/error.js'

export const app = express()
const port = 4000

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

app.use(errorMiddleware)

app.listen(port, () => {
    console.info(`Middleware app listening on port: ${port}`)
})
