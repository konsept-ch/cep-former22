import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'
import prismaClientPkg from '@prisma/client'
import yaml from 'js-yaml'

import { generateEndpoints } from './expressEndpoints' // deprecated, use routes instead

import { authRouter } from './routes/auth'
import { agendaRouter } from './routes/agenda'
import { mailRouter } from './routes/mail'
import { inscriptionsRouter } from './routes/inscriptions'
import { invoicesRouter } from './routes/invoices'
import { organizationsRouter } from './routes/organizations'
import { peoplesoftRouter } from './routes/peoplesoft'
import { sessionsRouter } from './routes/sessions'
import { templatesRouter } from './routes/templates'
import { usersRouter } from './routes/users'

const { PrismaClient } = prismaClientPkg
export const prisma = new PrismaClient()

export const app = express()

app.use(cors())
app.use(express.json({ limit: '50mb' }))

const port = process.env.PORT ?? 4000
const SWAGGER_UI_PATH = '/api-docs'
const SWAGGER_SCHEMA_PATH = '/api-docs/swagger.json'
const SWAGGER_SCHEMA_YAML_PATH = '/api-docs/swagger.yaml'
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
app.use(SWAGGER_UI_PATH, swaggerUi.serveFiles(null, swaggerUiOptions), swaggerUi.setup(null, swaggerUiOptions))

generateEndpoints()
app.use('/auth', authRouter)
app.use('/agenda', agendaRouter)
app.use('/mail', mailRouter)
app.use('/inscriptions', inscriptionsRouter)
app.use('/invoices', invoicesRouter)
app.use('/organizations', organizationsRouter)
app.use('/peoplesoft', peoplesoftRouter)
app.use('/sessions', sessionsRouter)
app.use('/templates', templatesRouter)
app.use('/users', usersRouter)

app.get('/', (_req, res) => {
    const allRoutes = app._router.stack
        .filter(({ name }) => name === 'bound dispatch')
        .map(({ route: { path, stack } }) => ({ path, method: stack[0].method }))
        .slice(0, -1)

    const peoplesoftRoutes = peoplesoftRouter.stack.map(({ route: { path, stack } }) => ({
        path: `/peoplesoft${path}`,
        method: stack[0].method,
    }))
    const mailRoutes = mailRouter.stack.map(({ route: { path, stack } }) => ({
        path: `/mail${path}`,
        method: stack[0].method,
    }))
    const templatesRoutes = templatesRouter.stack.map(({ route: { path, stack } }) => ({
        path: `/templates${path}`,
        method: stack[0].method,
    }))

    const SWAGGER_LINK = `<a href="${SWAGGER_UI_PATH}">${SWAGGER_UI_PATH} (Swagger - Middleware API documentation)</a>`

    res.send(
        `<ul><li>${SWAGGER_LINK}</li>${[...allRoutes, ...peoplesoftRoutes, ...mailRoutes, ...templatesRoutes]
            .map(({ path, method }) => `<li><a href="${path}">${path} (${method})</a></li>`)
            .join('')}</ul>`
    )
})

app.listen(port, () => {
    console.log(`Middleware app listening at port: ${port}`)
})
