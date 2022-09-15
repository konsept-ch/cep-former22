import { prisma } from '..'

export const STATUSES = {
    A_TRAITER_PAR_RH: 'À traiter par RH',
    VALIDE_PAR_RH: 'Validée par RH',
    REFUSEE_PAR_RH: 'Réfusée par RH',
    EN_ATTENTE: 'En attente',
    ENTREE_WEB: 'Entrée Web',
    ACCEPTEE_PAR_CEP: 'Acceptée par CEP',
    REFUSEE_PAR_CEP: 'Refusée par CEP',
    PROPOSEE: 'Proposée',
    INVITEE: 'Invitée',
    PARTICIPATION: 'Participation',
    PARTICIPATION_PARTIELLE: 'Participation Partielle',
    NON_PARTICIPATION: 'Non-participation',
    ANNULEE: 'Annulée',
    ECARTEE: 'Écartée',
}

export const FINAL_STATUSES = [
    STATUSES.A_TRAITER_PAR_RH,
    STATUSES.REFUSEE_PAR_RH,
    STATUSES.EN_ATTENTE,
    STATUSES.REFUSEE_PAR_CEP,
    STATUSES.ANNULEE,
    STATUSES.ECARTEE,
]

export const REGISTRATION_TYPES = {
    CANCELLATION: 'cancellation',
    LEARNER: 'learner',
    TUTOR: 'tutor',
}

export const transformFlagsToStatus = ({ validated, registrationType, hrValidationStatus, isHrValidationEnabled }) => {
    if (registrationType === REGISTRATION_TYPES.CANCELLATION) {
        return STATUSES.ANNULEE
    } else if (!validated) {
        return STATUSES.REFUSEE_PAR_RH
    } else if (isHrValidationEnabled) {
        if (hrValidationStatus === 1) {
            return STATUSES.REFUSEE_PAR_RH
        } else if (hrValidationStatus === 2 || hrValidationStatus === 3) {
            return STATUSES.VALIDE_PAR_RH
        } else {
            // if (hrValidationStatus === 0)
            return STATUSES.A_TRAITER_PAR_RH
        }
    } else {
        return STATUSES.ENTREE_WEB
    }
}

export const deriveInscriptionStatus = ({ savedStatus, transformedStatus }) =>
    transformedStatus === STATUSES.A_TRAITER_PAR_RH || transformedStatus === STATUSES.REFUSEE_PAR_RH
        ? transformedStatus
        : savedStatus ?? transformedStatus

export const getMainOrganization = (organizations) => {
    if (organizations != null) {
        const { claro__organization: mainOrganization } = organizations.find(({ is_main }) => is_main)

        return mainOrganization
    } else {
        return null
    }
}

export const parsePhoneForSms = ({ phone }) => {
    // remove (0) and then spaces and chars: -–./)(+ and then starting zeroes
    if (phone) {
        const cleanPhone = `${parseInt(
            phone
                ?.replaceAll('(0)', '')
                .replaceAll('o', '0')
                .replaceAll('O', '0')
                .replaceAll(/[-–.,/'¨)(+\s]/gi, '')
        )}`

        return cleanPhone.startsWith('41') || cleanPhone.length !== 9 ? cleanPhone : `41${cleanPhone}`
    } else {
        return phone
    }
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
            quota_days: true,
            used_by_quotas: true,
            claro_cursusbundle_course_session_user: {
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
                    status: true,
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
                                    claro__organization: true, // TODO: wait for Anthony to fix?
                                    // claro__organization: {
                                    //     include: {
                                    //         claro_cursusbundle_quota: true,
                                    //     },
                                    // },
                                },
                            },
                        },
                    },
                    claro_cursusbundle_course_session: {
                        select: {
                            claro_cursusbundle_course: {
                                select: { uuid: true, course_name: true },
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
                          quota_days: true,
                          used_by_quotas: true,
                          claro_cursusbundle_course: {
                              select: { uuid: true, course_name: true },
                          },
                      },
                  },
              },
          })

    const inscriptionCancellations = shouldFetchTutors
        ? []
        : inscriptionCancellationsRecords.map((current) => {
              const { claro_cursusbundle_course, ...sessionData } = current.claro_cursusbundle_course_session
              return {
                  ...sessionData,
                  claro_cursusbundle_course_session_user: [
                      {
                          registration_type: REGISTRATION_TYPES.CANCELLATION,
                          validated: false,
                          uuid: current.uuid,
                          inscription_uuid: current.inscription_uuid,
                          registration_date: current.registration_date,
                          claro_user: current.claro_user,
                          claro_cursusbundle_course_session: {
                              claro_cursusbundle_course: {
                                  uuid: claro_cursusbundle_course.uuid,
                                  course_name: claro_cursusbundle_course.course_name,
                              },
                          },
                      },
                  ],
              }
          })

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

    const getOrganizationCode = (organizations) => {
        const { claro__organization: mainOrganization } = organizations.find(({ is_main }) => is_main)

        return mainOrganization?.code
    }

    const professionFacetsValues = await getProfessionFacetsValues()

    const coursesAdditionalData = await prisma.former22_course.findMany({
        select: {
            courseId: true,
            coordinator: true,
        },
    })

    if (typeof sessionsWithInscriptions !== 'undefined' || typeof inscriptionCancellations !== 'undefined') {
        const inscriptionsToFetch = [...sessionsWithInscriptions, ...inscriptionCancellations].map(
            ({
                claro_cursusbundle_course_session_user,
                course_name,
                quota_days,
                used_by_quotas,
                start_date,
                uuid: sessionUuid,
            }) =>
                (async () => {
                    const allLearnersToFetchStatus = claro_cursusbundle_course_session_user?.map((inscription) =>
                        (async () => {
                            try {
                                const inscriptionStatusForId = await prisma.former22_inscription.findUnique({
                                    where: { inscriptionId: inscription.uuid },
                                    include: { former22_attestation: true },
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

                                const courseData =
                                    inscription.claro_cursusbundle_course_session.claro_cursusbundle_course

                                const coordinator = coursesAdditionalData.find(
                                    ({ courseId }) => courseId === courseData.uuid
                                )?.coordinator

                                const userMainOrganization = getMainOrganization(
                                    inscription.claro_user.user_organization
                                )

                                const isHrValidationEnabled = false // TODO: wait for Anthony to fix?
                                // const isHrValidationEnabled = userMainOrganization?.claro_cursusbundle_quota != null

                                return {
                                    id: inscription.uuid,
                                    inscriptionDate: inscription.registration_date,
                                    type: inscription.registration_type,
                                    deletedInscriptionUuid: inscription.inscription_uuid,
                                    coordinator,
                                    attestationTitle: inscriptionStatusForId?.former22_attestation?.title,
                                    status: deriveInscriptionStatus({
                                        savedStatus:
                                            inscriptionStatusForId?.inscriptionStatus ??
                                            inscriptionStatusForIdWhenCancellation?.inscriptionStatus,
                                        transformedStatus: transformFlagsToStatus({
                                            validated: inscription.validated,
                                            registrationType: inscription.registration_type,
                                            hrValidationStatus: inscription.status,
                                            isHrValidationEnabled,
                                        }),
                                    }),
                                    session: {
                                        id: sessionUuid,
                                        name: course_name,
                                        startDate: start_date,
                                        quotaDays: quota_days,
                                        isUsedForQuota: used_by_quotas,
                                        courseName: courseData.course_name,
                                        startYear: new Date(start_date).getFullYear(),
                                    },
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
                                            ? await formatOrganizationsHierarchy(
                                                  inscription.claro_user.user_organization
                                              )
                                            : null,
                                        organization: userMainOrganization?.name,
                                        organizationId: userMainOrganization?.uuid,
                                        organizationCode: inscription.claro_user.user_organization
                                            ? getOrganizationCode(inscription.claro_user.user_organization)
                                            : null,
                                        profession: await getUserProfession({
                                            userId: inscription.claro_user.id,
                                            professionFacetsValues,
                                        }),
                                    },
                                }
                            } catch (error) {
                                console.error(error)
                            }
                        })()
                    )

                    const fetchedLearnerStatuses = await Promise.allSettled(allLearnersToFetchStatus)

                    return fetchedLearnerStatuses.flatMap(({ value }) => value)
                })()
        )

        const fetchedInscriptions = await Promise.allSettled(inscriptionsToFetch)

        let fetchedPendingLearners = []

        if (!shouldFetchTutors) {
            const allPendingInscriptionsOnCourseLevel = await prisma.claro_cursusbundle_course_course_user.findMany({
                include: {
                    claro_cursusbundle_course: {
                        include: {
                            claro_cursusbundle_course_session: true,
                        },
                    },
                    claro_user: {
                        include: {
                            user_organization: {
                                select: {
                                    is_main: true,
                                    claro__organization: true, // TODO: wait for Anthony to fix?
                                    // claro__organization: {
                                    //     include: {
                                    //         claro_cursusbundle_quota: true,
                                    //     },
                                    // },
                                },
                            },
                        },
                    },
                },
            })

            if (allPendingInscriptionsOnCourseLevel) {
                const pendingList = allPendingInscriptionsOnCourseLevel.map((inscription) =>
                    (async () => {
                        const { shouldReceiveSms } =
                            (await prisma.former22_user.findUnique({
                                where: { userId: inscription.claro_user.uuid },
                            })) ?? {}

                        const userMainOrganization = getMainOrganization(inscription.claro_user.user_organization)

                        return {
                            id: inscription.uuid,
                            inscriptionDate: inscription.registration_date,
                            type: inscription.registration_type,
                            coordinator: coursesAdditionalData.find(
                                ({ courseId }) => courseId === inscription.claro_cursusbundle_course.uuid
                            )?.coordinator,
                            status: STATUSES.EN_ATTENTE,
                            isPending: true,
                            session: {
                                id: inscription.claro_cursusbundle_course.uuid,
                                name: `En attente - ${inscription.claro_cursusbundle_course.course_name}`,
                                startDate: 'En attente',
                                quotaDays: 0,
                                isUsedForQuota: false,
                                courseName: inscription.claro_cursusbundle_course.course_name,
                                startYear: new Date().getFullYear(),
                            },
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
                                organization: userMainOrganization?.name,
                                organizationId: userMainOrganization?.uuid,
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

                fetchedPendingLearners = await Promise.allSettled(pendingList)
            }
        }

        return [...fetchedInscriptions, ...fetchedPendingLearners].flatMap(({ value }) => value)
    } else {
        return []
    }
}

export const getNamesByType = ({ inscriptions, registrationType }) =>
    inscriptions
        .filter(({ registration_type }) => registration_type === registrationType)
        .map(({ claro_user: { first_name, last_name } }) => ({
            firstName: first_name,
            lastName: last_name,
        }))
