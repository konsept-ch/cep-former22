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

const parseStringIfValidJson = ({ possiblyJsonString }) => {
    try {
        return JSON.parse(possiblyJsonString)
    } catch (e) {
        return possiblyJsonString
    }
}

export const getCustomFacetValues = async ({ customFieldName }) => {
    const customFacets = await prisma.claro_field_facet.findMany({
        where: { name: { contains: customFieldName } },
    })

    const customFacetValues = []

    for (const { id: customFacetId } of customFacets) {
        customFacetValues.push(
            await prisma.claro_field_facet_value.findMany({
                where: { fieldFacet_id: customFacetId },
            })
        )
    }

    return customFacetValues.flat()
}

export const getUserCustomFieldValue = ({ userId, customFacetValues }) => {
    if (customFacetValues.some(({ user_id }) => user_id === userId)) {
        const { field_value } = customFacetValues.find(({ user_id }) => user_id === userId)

        const json = parseStringIfValidJson({ possiblyJsonString: field_value })

        // TODO improve handling when neither array nor simple string if such cases ever exist
        return Array.isArray(json) ? json.join(', ') : `${field_value}`.replace(/^"(.+(?="$))"$/, '$1')
    } else {
        return null
    }
}

const formatOrganizationsHierarchy = ({ organizations, allOrganizations }) => {
    const { claro__organization: mainOrganization } = organizations.find(({ is_main }) => is_main)

    const getHierarchy = ({ organization, hierarchy = [] }) => {
        const hierarchyLatest = [...hierarchy, organization.name]

        const { parent_id: parentId } = organization

        if (parentId) {
            const parent = allOrganizations?.find(({ id }) => id === parentId)

            return getHierarchy({ organization: parent, hierarchy: hierarchyLatest })
        } else {
            return hierarchyLatest.reverse().join(' > ')
        }
    }

    return getHierarchy({ organization: mainOrganization })
}

const getOrganizationCode = (organizations) => {
    const { claro__organization: mainOrganization } = organizations.find(({ is_main }) => is_main)

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
                    select: { uuid: true, course_name: true },
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

        const civilityFacetValues = await getCustomFacetValues({ customFieldName: 'Civilit' })
        const phoneNumberFacetValues = await getCustomFacetValues({ customFieldName: 'phone portable' })
        const birthDateFacetValues = await getCustomFacetValues({ customFieldName: 'Date de naissance' })
        const avsNumberFacetValues = await getCustomFacetValues({ customFieldName: 'ro AVS' })
        const companyNameFacetValues = await getCustomFacetValues({ customFieldName: "Nom de l'entreprise" })
        const serviceOrSectorInCompanyFacetValues = await getCustomFacetValues({
            customFieldName: "Service ou secteur dans l'entreprise",
        })
        const workplaceAddressFacetValues = await getCustomFacetValues({
            customFieldName: 'Adresse du lieu de travail',
        })
        const homeAddressFacetValues = await getCustomFacetValues({ customFieldName: 'Adresse du domicile' })
        const additionalAddressInfoFacetValues = await getCustomFacetValues({ customFieldName: 'ment adresse' })
        const postalCodeFacetValues = await getCustomFacetValues({ customFieldName: 'Code postal' })
        const localityFacetValues = await getCustomFacetValues({ customFieldName: 'Localit' })
        const employerFacetValues = await getCustomFacetValues({ customFieldName: 'Employeur' })
        const diplomaNameFacetValues = await getCustomFacetValues({ customFieldName: 'nom du dipl' })
        const professionNameFacetValues = await getCustomFacetValues({ customFieldName: 'nom de la profession' })

        const coursesAdditionalData = await prisma.former22_course.findMany({
            select: {
                courseId: true,
                coordinator: true,
            },
        })
        const inscriptionsAdditionalData = await prisma.former22_inscription.findMany({
            include: { former22_attestation: true },
        })
        const usersAdditionalData = await prisma.former22_user.findMany()
        const allOrganizations = await prisma.claro__organization.findMany()

        if (typeof sessions !== 'undefined' || typeof inscriptionCancellations !== 'undefined') {
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
                                            ({ inscriptionId }) => inscriptionId === inscription.inscription_uuid
                                        )
                                      : null

                                  const { shouldReceiveSms } =
                                      usersAdditionalData.find(
                                          ({ userId }) => userId === inscription.claro_user.uuid
                                      ) ?? {}

                                  const coordinator = coursesAdditionalData.find(
                                      ({ courseId }) => courseId === courseData.uuid
                                  )?.coordinator

                                  const userMainOrganization = getMainOrganization(
                                      inscription.claro_user.user_organization
                                  )

                                  const isHrValidationEnabled = userMainOrganization?.claro_cursusbundle_quota != null

                                  return {
                                      id: inscription.uuid,
                                      inscriptionDate: inscription.registration_date,
                                      type: inscription.registration_type,
                                      deletedInscriptionUuid: inscription.inscription_uuid,
                                      coordinator,
                                      attestationTitle: inscriptionStatusForId?.former22_attestation?.title,
                                      status: deriveInscriptionStatus({
                                          savedStatus: (shouldFetchCancellations
                                              ? inscriptionStatusForIdWhenCancellation
                                              : inscriptionStatusForId
                                          )?.inscriptionStatus,
                                          transformedStatus: transformFlagsToStatus({
                                              validated: inscription.validated,
                                              registrationType: shouldFetchCancellations
                                                  ? REGISTRATION_TYPES.CANCELLATION
                                                  : inscription.registration_type,
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
                                          civility: getUserCustomFieldValue({
                                              userId: inscription.claro_user.id,
                                              customFacetValues: civilityFacetValues,
                                          }),
                                          phoneNumber: getUserCustomFieldValue({
                                              userId: inscription.claro_user.id,
                                              customFacetValues: phoneNumberFacetValues,
                                          }),
                                          birthDate: getUserCustomFieldValue({
                                              userId: inscription.claro_user.id,
                                              customFacetValues: birthDateFacetValues,
                                          }),
                                          avsNumber: getUserCustomFieldValue({
                                              userId: inscription.claro_user.id,
                                              customFacetValues: avsNumberFacetValues,
                                          }),
                                          companyName: getUserCustomFieldValue({
                                              userId: inscription.claro_user.id,
                                              customFacetValues: companyNameFacetValues,
                                          }),
                                          serviceOrSectorInCompany: getUserCustomFieldValue({
                                              userId: inscription.claro_user.id,
                                              customFacetValues: serviceOrSectorInCompanyFacetValues,
                                          }),
                                          workplaceAddress: getUserCustomFieldValue({
                                              userId: inscription.claro_user.id,
                                              customFacetValues: workplaceAddressFacetValues,
                                          }),
                                          homeAddress: getUserCustomFieldValue({
                                              userId: inscription.claro_user.id,
                                              customFacetValues: homeAddressFacetValues,
                                          }),
                                          additionalAddressInfo: getUserCustomFieldValue({
                                              userId: inscription.claro_user.id,
                                              customFacetValues: additionalAddressInfoFacetValues,
                                          }),
                                          postalCode: getUserCustomFieldValue({
                                              userId: inscription.claro_user.id,
                                              customFacetValues: postalCodeFacetValues,
                                          }),
                                          locality: getUserCustomFieldValue({
                                              userId: inscription.claro_user.id,
                                              customFacetValues: localityFacetValues,
                                          }),
                                          employer: getUserCustomFieldValue({
                                              userId: inscription.claro_user.id,
                                              customFacetValues: employerFacetValues,
                                          }),
                                          diplomaName: getUserCustomFieldValue({
                                              userId: inscription.claro_user.id,
                                              customFacetValues: diplomaNameFacetValues,
                                          }),
                                          professionName: getUserCustomFieldValue({
                                              userId: inscription.claro_user.id,
                                              customFacetValues: professionNameFacetValues,
                                          }),
                                      },
                                  }
                              } catch (error) {
                                  // eslint-disable-next-line no-console
                                  console.error(error)
                              }
                          })
                        : shouldFetchTutors || shouldFetchCancellations
                        ? []
                        : [
                              {
                                  id: uuidv4(),
                                  coordinator: coursesAdditionalData.find(
                                      ({ courseId }) => courseId === courseData.uuid
                                  )?.coordinator,
                                  session: {
                                      id: sessionUuid,
                                      name: course_name,
                                      startDate: start_date,
                                      quotaDays: quota_days,
                                      isUsedForQuota: used_by_quotas,
                                      courseName: courseData.course_name,
                                      startYear: new Date(start_date).getFullYear(),
                                  },
                              },
                          ]
            )

            let fetchedPendingLearners = []

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
        // eslint-disable-next-line no-console
        console.error(error)

        return -1
    }
}

export const getNamesByType = ({ inscriptions, registrationType }) =>
    inscriptions
        .filter(({ registration_type }) => registration_type === registrationType)
        .map(({ claro_user: { first_name, last_name } }) => ({
            firstName: first_name,
            lastName: last_name,
        }))
