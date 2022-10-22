import { Router } from 'express'

import { prisma } from '..'
import { callApi } from '../callApi'
import { createService, LOG_TYPES } from '../utils'

export const organizationsRouter = Router()

createService(
    'get',
    '/hierarchy',
    async (req, res) => {
        const organizations = await callApi({ req, path: 'organization/list/recursive' })
        const allAdditionalData = await prisma.former22_organization.findMany()

        const populateAdditionalData = ({ orgsToPopulate }) =>
            orgsToPopulate.map((currentOrg) => {
                const currentOrgData = allAdditionalData.find(
                    ({ organizationUuid }) => organizationUuid === currentOrg.id
                )

                const populatedChildren = populateAdditionalData({ orgsToPopulate: currentOrg.children })

                if (currentOrgData) {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { organizationUuid, id, ...neededData } = currentOrgData

                    return { ...currentOrg, ...neededData, children: populatedChildren }
                } else {
                    return { ...currentOrg, children: populatedChildren }
                }
            })

        res.json(populateAdditionalData({ orgsToPopulate: organizations }))
    },
    null,
    organizationsRouter
)

createService(
    'get',
    '/flat-with-address',
    async (req, res) => {
        const organizations = await prisma.claro__organization.findMany({
            select: {
                uuid: true,
                name: true,
                code: true,
                former22_organization: {
                    select: {
                        clientNumber: true,
                        addressTitle: true,
                        postalAddressCode: true,
                        postalAddressCountry: true,
                        postalAddressCountryCode: true,
                        postalAddressDepartment: true,
                        postalAddressDepartmentCode: true,
                        postalAddressLocality: true,
                        postalAddressStreet: true,
                    },
                },
            },
        })

        res.json(organizations)
    },
    null,
    organizationsRouter
)

createService(
    'put',
    '/:organizationId',
    async (req, res) => {
        const { organizationName, newData } = req.body
        const { organizationId: organizationUuid } = req.params

        const { id } = await prisma.claro__organization.findUnique({
            where: { uuid: organizationUuid },
            select: { id: true },
        })

        await prisma.former22_organization.upsert({
            where: { organizationUuid },
            update: { ...newData, organizationId: id },
            create: { ...newData, organizationId: id, organizationUuid },
        })

        res.json("L'organisation a été modifié")

        return {
            entityName: organizationName,
            entityId: organizationUuid,
            actionName: `Updated organization ${organizationName}`,
        }
    },
    { entityType: LOG_TYPES.ORGANISATION },
    organizationsRouter
)
