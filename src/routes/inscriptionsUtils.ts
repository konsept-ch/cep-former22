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
}) => (savedStatus === STATUSES.A_TRAITER_PAR_RH ? transformedStatus : savedStatus ?? transformedStatus)

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

const formatOrganizationsHierarchy = (allOrganizations: any, organization: any, hierarchy = []): string | null => {
    if (organization == null) return null

    const hierarchyLatest: any = [...hierarchy, organization.name]
    const parentId = organization.parent_id

    if (parentId) {
        const parent: any = allOrganizations?.find(({ id }: any) => id === parentId)
        return formatOrganizationsHierarchy(allOrganizations, parent, hierarchyLatest)
    } else {
        return hierarchyLatest.reverse().join(' > ')
    }
}

export const fetchInscriptionsWithStatuses = async (
    { shouldFetchTutors, shouldFetchCancellations } = { shouldFetchTutors: false, shouldFetchCancellations: false }
) => {
    try {
        const sessions: any = await prisma.claro_cursusbundle_course_session.findMany({
            select: {
                uuid: true,
                start_date: true,
                course_name: true,
                quota_days: true,
                used_by_quotas: true,
                claro_cursusbundle_course: {
                    select: {
                        uuid: true,
                        course_name: true,
                        price: true,
                        session_days: true,
                        former22_course: {
                            select: {
                                coordinator: true,
                                codeCategory: true,
                                theme: true,
                                targetAudience: true,
                            },
                        },
                    },
                },
                claro_cursusbundle_course_session_user: !shouldFetchCancellations && {
                    where: shouldFetchTutors
                        ? { registration_type: REGISTRATION_TYPES.TUTOR }
                        : { registration_type: REGISTRATION_TYPES.LEARNER },
                    select: {
                        id: true,
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
                                    where: {
                                        is_main: true,
                                    },
                                },
                                former22_user: {
                                    select: {
                                        shouldReceiveSms: true,
                                    },
                                },
                            },
                        },
                    },
                },
                claro_cursusbundle_course_session_cancellation: shouldFetchCancellations && {
                    select: {
                        registration_date: true,
                        id: true,
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
                                    where: {
                                        is_main: true,
                                    },
                                },
                                former22_user: {
                                    select: {
                                        shouldReceiveSms: true,
                                    },
                                },
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
        const inscriptionsAdditionalData = await prisma.former22_inscription.findMany({
            include: { former22_attestation: true, former22_organization: true },
        })
        const allOrganizations = await prisma.claro__organization.findMany()
        const items = await prisma.former22_invoice_item.findMany({
            select: {
                inscriptionId: true,
                cancellationId: true,
                former22_manual_invoice: {
                    select: {
                        number: true,
                        invoiceNumberForCurrentYear: true,
                        courseYear: true,
                        claro_user: {
                            select: {
                                uuid: true,
                            },
                        },
                    },
                },
            },
        })
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
                }: any) =>
                    inscriptions?.length > 0 || cancellations?.length > 0
                        ? (shouldFetchCancellations ? cancellations : inscriptions).map((inscription: any) => {
                              try {
                                  const inscriptionStatusForId = inscriptionsAdditionalData.find(
                                      ({ inscriptionId }) => inscriptionId === inscription.uuid
                                  )
                                  const inscriptionStatusForIdWhenCancellation = shouldFetchCancellations
                                      ? inscriptionsAdditionalData.find(
                                            ({ inscriptionId }) => inscriptionId === inscription.inscription_uuid
                                        )
                                      : null

                                  const { coordinator, codeCategory, theme, targetAudience } =
                                      courseData.former22_course ?? {}

                                  const userMainOrganization = inscriptionStatusForId?.former22_organization
                                      ? allOrganizations.find(
                                            (o) => o.id === inscriptionStatusForId.former22_organization?.organizationId
                                        )
                                      : inscription.claro_user.user_organization[0]?.claro__organization

                                  const isHrValidationEnabled = userMainOrganization?.claro_cursusbundle_quota != null

                                  const derivedStatus = deriveInscriptionStatus({
                                      savedStatus: (shouldFetchCancellations
                                          ? inscriptionStatusForIdWhenCancellation
                                          : inscriptionStatusForId
                                      )?.inscriptionStatus as StatusesValues,
                                      transformedStatus: transformFlagsToStatus({
                                          validated: inscription.validated,
                                          registrationType: shouldFetchCancellations
                                              ? REGISTRATION_TYPES.CANCELLATION
                                              : inscription.registration_type,
                                          hrValidationStatus: inscription.status,
                                          isHrValidationEnabled,
                                      }),
                                  })

                                  return {
                                      id: inscription.uuid,
                                      inscriptionDate: inscription.registration_date,
                                      type: inscription.registration_type,
                                      deletedInscriptionUuid: inscription.inscription_uuid,
                                      remark: inscriptionStatusForId?.remark,
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
                                          firstName: inscription.claro_user.first_name,
                                          lastName: inscription.claro_user.last_name,
                                          email: inscription.claro_user.mail,
                                          username: inscription.claro_user.username,
                                          phone: inscription.claro_user.phone,
                                          phoneForSms: parsePhoneForSms({
                                              phone: inscription.claro_user.phone,
                                          }),
                                          userId: inscription.claro_user.uuid,
                                          shouldReceiveSms: inscription.claro_user.former22_user?.shouldReceiveSms,
                                          hierarchy: formatOrganizationsHierarchy(
                                              allOrganizations,
                                              userMainOrganization
                                          ),
                                          organization: userMainOrganization?.name,
                                          organizationId: userMainOrganization?.uuid,
                                          organizationCode: userMainOrganization?.code,
                                          profession: getUserProfession({
                                              userId: inscription.claro_user.id,
                                              professionFacetsValues,
                                          }),
                                      },
                                      validationType:
                                          inscription.status === 2
                                              ? 'Validée'
                                              : inscription.status === 3
                                              ? 'Validée sur quota'
                                              : '',
                                      organizationClientNumber:
                                          userMainOrganization?.former22_organization?.clientNumber,
                                      invoiceNumber: (shouldFetchCancellations
                                          ? items.find((i) => i.cancellationId === inscription.id)
                                          : items.find((i) => i.inscriptionId === inscription.id)
                                      )?.former22_manual_invoice.number,
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
                                  coordinator: courseData.former22_course?.coordinator,
                                  codeCategory: courseData.former22_course?.codeCategory,
                                  theme: courseData.former22_course?.theme,
                                  targetAudience: courseData.former22_course?.targetAudience,
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
                                    former22_course: {
                                        select: {
                                            coordinator: true,
                                            codeCategory: true,
                                            theme: true,
                                            targetAudience: true,
                                        },
                                    },
                                },
                            },
                            claro_user: {
                                include: {
                                    former22_user: {
                                        select: {
                                            shouldReceiveSms: true,
                                        },
                                    },
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
                                        where: {
                                            is_main: true,
                                        },
                                    },
                                },
                            },
                        },
                    }
                )

                if (allPendingInscriptionsOnCourseLevel) {
                    fetchedPendingLearners = allPendingInscriptionsOnCourseLevel.map((inscription: any) => {
                        const userMainOrganization = inscription.claro_user.user_organization[0]?.claro__organization

                        const { coordinator, codeCategory, theme, targetAudience } =
                            inscription.claro_cursusbundle_course.former22_course

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
                                shouldReceiveSms: inscription.claro_user.former22_user?.shouldReceiveSms,
                                hierarchy: formatOrganizationsHierarchy(allOrganizations, userMainOrganization),
                                organization: userMainOrganization?.name,
                                organizationId: userMainOrganization?.uuid,
                                organizationCode: userMainOrganization?.code,
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
