import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'
import prismaClientPkg from '@prisma/client'
import yaml from 'js-yaml'

import { generateEndpoints } from './expressEndpoints'
import { peopleSoftServices } from './peopleSoftServices'
import { mailRouter } from './routes/mail'

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
    apis: ['./src/swaggerSchemas.yml', './src/peopleSoftServices.js'], // files containing annotations as above
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
peopleSoftServices()
app.use('/mail', mailRouter)

app.get('/', (_req, res) => {
    const allRoutes = app._router.stack
        .filter(({ name }) => name === 'bound dispatch')
        .map(({ route: { path } }) => path)
        .slice(0, -1)

    const SWAGGER_LINK = `<a href="${SWAGGER_UI_PATH}">${SWAGGER_UI_PATH} (Swagger - Middleware API documentation)</a>`

    res.send(
        `<ul><li>${SWAGGER_LINK}</li>${allRoutes
            .map((route) => `<li><a href="${route}">${route}</a></li>`)
            .join('')}</ul>`
    )
})

app.listen(port, () => {
    console.log(`Middleware app listening at port: ${port}`)
})
