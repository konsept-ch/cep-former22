import { prisma } from '..'

export const FINAL_STATUSES = {
    ANNULEE: 'Annulée',
    ECARTEE: 'Écartée',
}

export const STATUSES = {
    EN_ATTENTE: 'En attente',
    A_TRAITER_PAR_RH: 'À traiter par RH',
    REFUSEE_PAR_RH: 'Réfusée par RH',
    ENTREE_WEB: 'Entrée Web',
    ACCEPTEE_PAR_CEP: 'Acceptée par CEP',
    REFUSEE_PAR_CEP: 'Refusée par CEP',
    INVITEE: 'Invitée',
    PROPOSEE: 'Proposée',
    ...FINAL_STATUSES,
}

export const registrationTypes = {
    CANCELLATION: 'cancellation',
}

const transformFlagsToStatus = ({ validated, confirmed, registrationType }) => {
    if (registrationType === registrationTypes.CANCELLATION) {
        return STATUSES.ANNULEE
    } else if (!confirmed) {
        return STATUSES.PROPOSEE
    } else if (!validated) {
        return STATUSES.EN_ATTENTE
    } else {
        return STATUSES.ENTREE_WEB
    }
}

export const fetchInscriptionsWithStatuses = async ({ shouldFetchTutors } = { shouldFetchTutors: false }) => {
    const sessionsWithInscriptions = await prisma.claro_cursusbundle_course_session.findMany({
        select: {
            uuid: true,
            start_date: true,
            course_name: true,
            claro_cursusbundle_course_session_user: {
                // eslint-disable-next-line no-undefined
                where: shouldFetchTutors
                    ? { registration_type: 'tutor' }
                    : {
                          NOT: {
                              registration_type: 'tutor',
                          },
                      },
                select: {
                    uuid: true,
                    validated: true,
                    confirmed: true,
                    registration_date: true,
                    registration_type: true,
                    claro_user: {
                        select: {
                            first_name: true,
                            last_name: true,
                            mail: true,
                            username: true,
                            uuid: true,
                            id: true,
                            user_organization: {
                                select: {
                                    is_main: true,
                                    claro__organization: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    })

    const inscriptionCancellationsRecords = shouldFetchTutors
        ? []
        : await prisma.claro_cursusbundle_course_session_cancellation.findMany({
              select: {
                  registration_date: true,
                  uuid: true,
                  claro_user: {
                      select: {
                          first_name: true,
                          last_name: true,
                          mail: true,
                          username: true,
                          uuid: true,
                      },
                  },
                  claro_cursusbundle_course_session: {
                      select: {
                          uuid: true,
                          start_date: true,
                          course_name: true,
                      },
                  },
              },
          })

    const inscriptionCancellations = shouldFetchTutors
        ? []
        : inscriptionCancellationsRecords.map((current) => ({
              ...current.claro_cursusbundle_course_session,
              claro_cursusbundle_course_session_user: [
                  {
                      registration_type: registrationTypes.CANCELLATION,
                      validated: false,
                      confirmed: false,
                      uuid: current.uuid,
                      registration_date: current.registration_date,
                      claro_user: current.claro_user,
                  },
              ],
          }))

    const formatOrganizationsHierarchy = async (organizations) => {
        const { claro__organization: mainOrganization } = organizations.find(({ is_main }) => is_main)

        const getHierarchy = async ({ organization, hierarchy = [] }) => {
            const hierarchyLatest = [...hierarchy, organization.name]

            const parentId = organization.parent_id

            if (parentId) {
                const parent = await prisma.claro__organization.findUnique({ where: { id: parentId } })

                return getHierarchy({ organization: parent, hierarchy: hierarchyLatest }) // TODO: await
            } else {
                return hierarchyLatest.reverse().join(' > ')
            }
        }

        return await getHierarchy({ organization: mainOrganization })
    }

    //TODO check how it is in production
    const professionFacets = await prisma.claro_field_facet.findMany({
        where: { name: { contains: 'FONCTION OCCUP' } },
    })

    const { id: professionFacetId } = professionFacets.find(({ name }) => name.includes('FONCTION OCCUP'))

    const professionFacetsValues = await prisma.claro_field_facet_value.findMany({
        where: { fieldFacet_id: professionFacetId },
    })

    const getProfession = (userId) => {
        const { field_value } = professionFacetsValues.find(({ user_id }) => user_id === userId)

        return JSON.parse(field_value).join(', ')
    }

    const getMainOrganization = (organizations) => {
        const { claro__organization: mainOrganization } = organizations.find(({ is_main }) => is_main)

        return mainOrganization?.name
    }

    const getOrganizationCode = (organizations) => {
        const { claro__organization: mainOrganization } = organizations.find(({ is_main }) => is_main)

        return mainOrganization?.code
    }

    if (typeof sessionsWithInscriptions !== 'undefined' || typeof inscriptionCancellations !== 'undefined') {
        const inscriptionsToFetch = [...sessionsWithInscriptions, ...inscriptionCancellations].map(
            ({ claro_cursusbundle_course_session_user, course_name, start_date, uuid: sessionUuid }) =>
                (async () => {
                    const allLearnersToFetchStatus = claro_cursusbundle_course_session_user?.map((inscription) =>
                        (async () => {
                            const inscriptionWithStatus = await prisma.former22_inscription.findUnique({
                                where: { inscriptionId: inscription.uuid },
                            })

                            return {
                                id: inscription.uuid,
                                inscriptionDate: inscription.registration_date,
                                type: inscription.registration_type,
                                status:
                                    inscriptionWithStatus?.inscriptionStatus ??
                                    transformFlagsToStatus({
                                        validated: inscription.validated,
                                        confirmed: inscription.confirmed,
                                        registrationType: inscription.registration_type,
                                    }),
                                session: { id: sessionUuid, name: course_name, startDate: start_date },
                                user: {
                                    firstName: inscription.claro_user.first_name,
                                    lastName: inscription.claro_user.last_name,
                                    email: inscription.claro_user.mail,
                                    username: inscription.claro_user.username,
                                    userId: inscription.claro_user.uuid,
                                    hierarchy: inscription.claro_user.user_organization
                                        ? await formatOrganizationsHierarchy(inscription.claro_user.user_organization)
                                        : null,
                                    organization: inscription.claro_user.user_organization
                                        ? getMainOrganization(inscription.claro_user.user_organization)
                                        : null,
                                    organizationCode: inscription.claro_user.user_organization
                                        ? getOrganizationCode(inscription.claro_user.user_organization)
                                        : null,
                                    profession: professionFacetsValues.some(
                                        ({ user_id }) => user_id === inscription.claro_user.id
                                    )
                                        ? getProfession(inscription.claro_user.id)
                                        : null,
                                },
                            }
                        })()
                    )
                    const fetchedLearnerStatuses = await Promise.allSettled(allLearnersToFetchStatus)

                    return fetchedLearnerStatuses.flatMap(({ value }) => value)
                })()
        )

        const fetchedInscriptions = await Promise.allSettled(inscriptionsToFetch)

        return fetchedInscriptions.flatMap(({ value }) => value)
    } else {
        return []
    }
}
