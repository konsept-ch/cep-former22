/* eslint-disable @typescript-eslint/no-explicit-any */
import { v4 as uuidv4 } from 'uuid'

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
    ANNULEE: 'Annulation à traiter',
    ANNULEE_FACTURABLE: 'Annulée facturable',
    ANNULEE_NON_FACTURABLE: 'Annulée non-facturable',
    ECARTEE: 'Écartée',
} as const
type StatusesKeys = keyof typeof STATUSES
type StatusesValues = (typeof STATUSES)[StatusesKeys]

export const finalStatuses = [
    STATUSES.A_TRAITER_PAR_RH,
    STATUSES.REFUSEE_PAR_RH,
    STATUSES.EN_ATTENTE,
    STATUSES.REFUSEE_PAR_CEP,
    STATUSES.ANNULEE,
    STATUSES.ANNULEE_FACTURABLE,
    STATUSES.ANNULEE_NON_FACTURABLE,
    STATUSES.ECARTEE,
] as const

export const lockGroups = [
    [
        STATUSES.PARTICIPATION,
        STATUSES.PARTICIPATION_PARTIELLE,
        STATUSES.NON_PARTICIPATION,
        STATUSES.ANNULEE,
        STATUSES.ANNULEE_FACTURABLE,
        STATUSES.ANNULEE_NON_FACTURABLE,
    ],
] as const

export const statusesForAnnulation = [
    STATUSES.ANNULEE,
    STATUSES.ANNULEE_FACTURABLE,
    STATUSES.ANNULEE_NON_FACTURABLE,
    STATUSES.NON_PARTICIPATION,
    STATUSES.REFUSEE_PAR_CEP,
    STATUSES.ECARTEE,
] as const

export const REGISTRATION_TYPES = {
    CANCELLATION: 'cancellation',
    LEARNER: 'learner',
    TUTOR: 'tutor',
} as const
type RegistrationTypesKeys = keyof typeof REGISTRATION_TYPES
type RegistrationTypesValues = (typeof REGISTRATION_TYPES)[RegistrationTypesKeys]

export const transformFlagsToStatus = ({
    validated,
    registrationType,
    hrValidationStatus,
    isHrValidationEnabled,
}: {
    validated: boolean
    registrationType: RegistrationTypesValues
    hrValidationStatus: 0 | 1 | 2 | 3
    isHrValidationEnabled: boolean
}) => {
    if (registrationType === REGISTRATION_TYPES.CANCELLATION) {
        return STATUSES.ANNULEE_NON_FACTURABLE
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

export const deriveInscriptionStatus = ({
    savedStatus,
    transformedStatus,
}: {
    savedStatus?: StatusesValues | null
    transformedStatus: StatusesValues
}) =>
    transformedStatus === STATUSES.A_TRAITER_PAR_RH || transformedStatus === STATUSES.REFUSEE_PAR_RH
        ? transformedStatus
        : savedStatus ?? transformedStatus

export const getMainOrganization = (organizations: any[]) => {
    if (organizations != null) {
        const { claro__organization: mainOrganization } =
            organizations.find(({ is_main }: { is_main: boolean }) => is_main) ?? {}

        return mainOrganization
    } else {
        return null
    }
}

export const parsePhoneForSms = ({ phone }: { phone: string | null }) => {
    // explanation: remove (0) and then spaces and chars: -–./)(+ and then starting zeroes
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

export const getUserProfession = ({
    userId,
    professionFacetsValues,
}: {
    userId: number
    professionFacetsValues: any[]
}) => {
    if (professionFacetsValues.some(({ user_id }: { user_id: number }) => user_id === userId)) {
        const { field_value } = professionFacetsValues.find(({ user_id }: { user_id: number }) => user_id === userId)

        return JSON.parse(field_value).join(', ')
    } else {
        return null
    }
}

const formatOrganizationsHierarchy = ({
    organizations,
    allOrganizations,
}: {
    organizations: any[]
    allOrganizations: any[]
}) => {
    const { claro__organization: mainOrganization } =
        organizations.find(({ is_main }: { is_main: boolean }) => is_main) ?? {}

    const getHierarchy = ({ organization, hierarchy = [] }: any): string => {
        const hierarchyLatest = [...hierarchy, organization?.name]

        const { parent_id: parentId } = organization ?? {}

        if (parentId) {
            const parent = allOrganizations?.find(({ id }: any) => id === parentId)

            return getHierarchy({ organization: parent, hierarchy: hierarchyLatest })
        } else {
            return hierarchyLatest.reverse().join(' > ')
        }
    }

    return getHierarchy({ organization: mainOrganization })
}

const getOrganizationCode = (organizations: any[]) => {
    const { claro__organization: mainOrganization } =
        organizations.find(({ is_main }: { is_main: boolean }) => is_main) ?? {}

    return mainOrganization?.code
}

export const fetchInscriptionsWithStatuses = async (
    { shouldFetchTutors, shouldFetchCancellations } = { shouldFetchTutors: false, shouldFetchCancellations: false }
) => {
    try {
        const sessions = await prisma.claro_cursusbundle_course_session.findMany({
            select: {
                uuid: true,
                start_date: true,
                course_name: true,
                quota_days: true,
                used_by_quotas: true,
                claro_cursusbundle_course: {
                    select: { uuid: true, course_name: true, price: true, session_days: true },
                },
                claro_cursusbundle_course_session_user: !shouldFetchCancellations && {
                    where: shouldFetchTutors
                        ? { registration_type: REGISTRATION_TYPES.TUTOR }
                        : { registration_type: REGISTRATION_TYPES.LEARNER },
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
                                        claro__organization: {
                                            include: {
                                                claro_cursusbundle_quota: true,
                                                former22_organization: {
                                                    select: {
                                                        clientNumber: true,
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                claro_cursusbundle_course_session_cancellation: shouldFetchCancellations && {
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
                            },
                        },
                    },
                },
            },
        })

        const professionFacetsValues = await getProfessionFacetsValues()
        const coursesAdditionalData = (
            await prisma.former22_course.findMany({
                select: {
                    courseId: true,
                    coordinator: true,
                    codeCategory: true,
                    theme: true,
                    targetAudience: true,
                },
            })
        ).reduce((map, course) => map.set(course.courseId, course), new Map())
        const inscriptionsAdditionalData = await prisma.former22_inscription.findMany({
            include: { former22_attestation: true },
        })
        const usersAdditionalData = await prisma.former22_user.findMany()
        const allOrganizations = await prisma.claro__organization.findMany()

        if (typeof sessions !== 'undefined') {
            const fetchedInscriptions = sessions.flatMap(
                ({
                    claro_cursusbundle_course_session_user: inscriptions,
                    claro_cursusbundle_course_session_cancellation: cancellations,
                    claro_cursusbundle_course: courseData,
                    course_name,
                    quota_days,
                    used_by_quotas,
                    start_date,
                    uuid: sessionUuid,
                }) =>
                    inscriptions?.length > 0 || cancellations?.length > 0
                        ? (shouldFetchCancellations ? cancellations : inscriptions).map((inscription) => {
                              try {
                                  const inscriptionStatusForId = inscriptionsAdditionalData.find(
                                      ({ inscriptionId }) => inscriptionId === inscription.uuid
                                  )
                                  const inscriptionStatusForIdWhenCancellation = shouldFetchCancellations
                                      ? inscriptionsAdditionalData.find(
                                            ({ inscriptionId }) =>
                                                inscriptionId === (inscription as any).inscription_uuid
                                        )
                                      : null

                                  const { shouldReceiveSms } =
                                      usersAdditionalData.find(
                                          ({ userId }) => userId === (inscription as any).claro_user.uuid
                                      ) ?? {}

                                  const { coordinator, codeCategory, theme, targetAudience } =
                                      coursesAdditionalData.get(courseData.uuid) ?? {}

                                  const userMainOrganization = getMainOrganization(
                                      (inscription as any).claro_user.user_organization
                                  )

                                  const isHrValidationEnabled = userMainOrganization?.claro_cursusbundle_quota != null

                                  const derivedStatus = deriveInscriptionStatus({
                                      savedStatus: (shouldFetchCancellations
                                          ? inscriptionStatusForIdWhenCancellation
                                          : inscriptionStatusForId
                                      )?.inscriptionStatus as StatusesValues,
                                      transformedStatus: transformFlagsToStatus({
                                          validated: (inscription as any).validated,
                                          registrationType: shouldFetchCancellations
                                              ? REGISTRATION_TYPES.CANCELLATION
                                              : (inscription as any).registration_type,
                                          hrValidationStatus: (inscription as any).status,
                                          isHrValidationEnabled,
                                      }),
                                  })

                                  return {
                                      id: inscription.uuid,
                                      inscriptionDate: inscription.registration_date,
                                      type: (inscription as any).registration_type,
                                      deletedInscriptionUuid: (inscription as any).inscription_uuid,
                                      coordinator,
                                      codeCategory,
                                      theme,
                                      targetAudience,
                                      attestationTitle: inscriptionStatusForId?.former22_attestation?.title,
                                      status: shouldFetchCancellations
                                          ? statusesForAnnulation.includes(derivedStatus as any)
                                              ? derivedStatus
                                              : STATUSES.ANNULEE_NON_FACTURABLE
                                          : derivedStatus,
                                      session: {
                                          id: sessionUuid,
                                          name: course_name,
                                          startDate: start_date,
                                          quotaDays: quota_days,
                                          isUsedForQuota: used_by_quotas,
                                          courseName: courseData.course_name,
                                          coursePrice: courseData.price,
                                          courseDuration: courseData.session_days,
                                          startYear: new Date(start_date as unknown as string).getFullYear(),
                                      },
                                      user: {
                                          firstName: (inscription as any).claro_user.first_name,
                                          lastName: (inscription as any).claro_user.last_name,
                                          email: (inscription as any).claro_user.mail,
                                          username: (inscription as any).claro_user.username,
                                          phone: (inscription as any).claro_user.phone,
                                          phoneForSms: parsePhoneForSms({
                                              phone: (inscription as any).claro_user.phone,
                                          }),
                                          userId: (inscription as any).claro_user.uuid,
                                          shouldReceiveSms,
                                          hierarchy: (inscription as any).claro_user.user_organization
                                              ? formatOrganizationsHierarchy({
                                                    organizations: (inscription as any).claro_user.user_organization,
                                                    allOrganizations,
                                                })
                                              : null,
                                          organization: userMainOrganization?.name,
                                          organizationId: userMainOrganization?.uuid,
                                          organizationCode: (inscription as any).claro_user.user_organization
                                              ? getOrganizationCode((inscription as any).claro_user.user_organization)
                                              : null,
                                          profession: getUserProfession({
                                              userId: (inscription as any).claro_user.id,
                                              professionFacetsValues,
                                          }),
                                      },
                                      validationType:
                                          (inscription as any).status === 2
                                              ? 'Validée'
                                              : (inscription as any).status === 3
                                              ? 'Validée sur quota'
                                              : '',
                                      organizationClientNumber:
                                          userMainOrganization?.former22_organization?.clientNumber,
                                  }
                              } catch (error) {
                                  console.error(error)
                              }
                          })
                        : shouldFetchTutors || shouldFetchCancellations
                        ? []
                        : [
                              {
                                  id: uuidv4(),
                                  coordinator: coursesAdditionalData.get(courseData.uuid)?.coordinator,
                                  codeCategory: coursesAdditionalData.get(courseData.uuid)?.codeCategory,
                                  theme: coursesAdditionalData.get(courseData.uuid)?.theme,
                                  targetAudience: coursesAdditionalData.get(courseData.uuid)?.targetAudience,
                                  session: {
                                      id: sessionUuid,
                                      name: course_name,
                                      startDate: start_date,
                                      quotaDays: quota_days,
                                      isUsedForQuota: used_by_quotas,
                                      courseName: courseData.course_name,
                                      startYear: new Date(start_date as unknown as string).getFullYear(),
                                  },
                              },
                          ]
            )

            let fetchedPendingLearners: any[] = []

            if (!shouldFetchTutors && !shouldFetchCancellations) {
                const allPendingInscriptionsOnCourseLevel = await prisma.claro_cursusbundle_course_course_user.findMany(
                    {
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
                                            claro__organization: {
                                                include: {
                                                    claro_cursusbundle_quota: true,
                                                    former22_organization: {
                                                        select: {
                                                            clientNumber: true,
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    }
                )

                if (allPendingInscriptionsOnCourseLevel) {
                    fetchedPendingLearners = allPendingInscriptionsOnCourseLevel.map((inscription) => {
                        const { shouldReceiveSms } =
                            usersAdditionalData.find(({ userId }) => userId === inscription.claro_user.uuid) ?? {}

                        const userMainOrganization = getMainOrganization(inscription.claro_user.user_organization)

                        const { coordinator, codeCategory, theme, targetAudience } =
                            coursesAdditionalData.get(inscription.claro_cursusbundle_course.uuid) ?? {}

                        return {
                            id: inscription.uuid,
                            inscriptionDate: inscription.registration_date,
                            type: inscription.registration_type,
                            coordinator,
                            codeCategory,
                            theme,
                            targetAudience,
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
                                    ? formatOrganizationsHierarchy({
                                          organizations: inscription.claro_user.user_organization,
                                          allOrganizations,
                                      })
                                    : null,
                                organization: userMainOrganization?.name,
                                organizationId: userMainOrganization?.uuid,
                                organizationCode: inscription.claro_user.user_organization
                                    ? getOrganizationCode(inscription.claro_user.user_organization)
                                    : null,
                                profession: getUserProfession({
                                    userId: inscription.claro_user.id,
                                    professionFacetsValues,
                                }),
                            },
                        }
                    })
                }
            }

            return [...fetchedInscriptions, ...fetchedPendingLearners]
        } else {
            return []
        }
    } catch (error) {
        console.error(error)

        return -1
    }
}

export const getNamesByType = ({
    inscriptions,
    registrationType,
}: {
    inscriptions: any[]
    registrationType: RegistrationTypesValues
}) =>
    inscriptions
        .filter(
            ({ registration_type }: { registration_type: RegistrationTypesValues }) =>
                registration_type === registrationType
        )
        .map(
            ({ claro_user: { first_name, last_name } }: { claro_user: { first_name: string; last_name: string } }) => ({
                firstName: first_name,
                lastName: last_name,
            })
        )
