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

const registrationTypes = {
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

export const parsePhoneForSms = ({ phone }) => {
    // remove (0) and then spaces and chars: -–./)(+ and then starting zeroes
    const cleanPhone = `${parseInt(
        phone
            ?.replaceAll('(0)', '')
            .replaceAll('o', '0')
            .replaceAll('O', '0')
            .replaceAll(/[-–./'¨)(+\s]/gi, '')
    )}`

    return cleanPhone.startsWith('41') || cleanPhone.length !== 9 ? cleanPhone : `41${cleanPhone}`
}

//TODO check how it is in production
export const getProfessionFacetsValues = async () => {
    const professionFacets = await prisma.claro_field_facet.findMany({
        where: { name: { contains: 'FONCTION PROFESSIONNELLE' } },
    })

    const { id: professionFacetId } = professionFacets[0]

    const professionFacetsValues = await prisma.claro_field_facet_value.findMany({
        where: { fieldFacet_id: professionFacetId },
    })

    return professionFacetsValues
}

export const getUserProfession = ({ userId, professionFacetsValues }) => {
    if (professionFacetsValues.some(({ user_id }) => user_id === userId)) {
        const { field_value } = professionFacetsValues.find(({ user_id }) => user_id === userId)

        return JSON.parse(field_value).join(', ')
    } else {
        return null
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
                            phone: true,
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
                  inscription_uuid: true,
                  claro_user: {
                      select: {
                          first_name: true,
                          last_name: true,
                          mail: true,
                          username: true,
                          phone: true,
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
                      inscription_uuid: current.inscription_uuid,
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

    const getMainOrganization = (organizations) => {
        const { claro__organization: mainOrganization } = organizations.find(({ is_main }) => is_main)

        return mainOrganization?.name
    }

    const getOrganizationCode = (organizations) => {
        const { claro__organization: mainOrganization } = organizations.find(({ is_main }) => is_main)

        return mainOrganization?.code
    }

    const professionFacetsValues = await getProfessionFacetsValues()

    if (typeof sessionsWithInscriptions !== 'undefined' || typeof inscriptionCancellations !== 'undefined') {
        const inscriptionsToFetch = [...sessionsWithInscriptions, ...inscriptionCancellations].map(
            ({ claro_cursusbundle_course_session_user, course_name, start_date, uuid: sessionUuid }) =>
                (async () => {
                    const allLearnersToFetchStatus = claro_cursusbundle_course_session_user?.map((inscription) =>
                        (async () => {
                            const inscriptionStatusForId = await prisma.former22_inscription.findUnique({
                                where: { inscriptionId: inscription.uuid },
                            })
                            const inscriptionStatusForIdWhenCancellation =
                                inscription.registration_type === 'cancellation'
                                    ? await prisma.former22_inscription.findUnique({
                                          where: { inscriptionId: inscription.inscription_uuid },
                                      })
                                    : null

                            const { shouldReceiveSms } =
                                (await prisma.former22_user.findUnique({
                                    where: { userId: inscription.claro_user.uuid },
                                })) ?? {}

                            return {
                                id: inscription.uuid,
                                inscriptionDate: inscription.registration_date,
                                type: inscription.registration_type,
                                deletedInscriptionUuid: inscription.inscription_uuid,
                                status:
                                    inscriptionStatusForId?.inscriptionStatus ??
                                    inscriptionStatusForIdWhenCancellation?.inscriptionStatus ??
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
                                    phone: inscription.claro_user.phone,
                                    phoneForSms: parsePhoneForSms({ phone: inscription.claro_user.phone }),
                                    userId: inscription.claro_user.uuid,
                                    shouldReceiveSms,
                                    hierarchy: inscription.claro_user.user_organization
                                        ? await formatOrganizationsHierarchy(inscription.claro_user.user_organization)
                                        : null,
                                    organization: inscription.claro_user.user_organization
                                        ? getMainOrganization(inscription.claro_user.user_organization)
                                        : null,
                                    organizationCode: inscription.claro_user.user_organization
                                        ? getOrganizationCode(inscription.claro_user.user_organization)
                                        : null,
                                    profession: await getUserProfession({
                                        userId: inscription.claro_user.id,
                                        professionFacetsValues,
                                    }),
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
