import { v4 as uuidv4 } from 'uuid'
import { callApi } from './callApi'
import { app, prisma } from './'
import { winstonLogger } from './winston'

// for testing/development purposes only
export const delay = (ms) => new Promise((res) => setTimeout(res, ms))

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

                return getHierarchy({ organization: parent, hierarchy: hierarchyLatest })
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

// Deprecated
export const fetchInscriptionsWithStatusesUsingApi = async ({ req }) => {
    const sessions = await callApi({ req, path: 'cursus_session' })

    if (typeof sessions !== 'undefined') {
        const inscriptionsToFetch = sessions.map((session) =>
            (async () => {
                const learners = await callApi({ req, path: `cursus_session/${session.id}/users/learner` })
                const pendingLearners = await callApi({ req, path: `cursus_session/${session.id}/pending` })

                const allLearnersToFetchStatus = [...learners, ...pendingLearners].map((learner) =>
                    (async () => {
                        const inscription = await prisma.former22_inscription.findUnique({
                            where: { inscriptionId: learner.id },
                        })
                        return {
                            ...learner,
                            status:
                                inscription?.inscriptionStatus ??
                                transformFlagsToStatus({
                                    validated: learner.validated,
                                    confirmed: learner.confirmed,
                                }),
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

export const fetchSessionsLessons = async ({ req, sessionId }) => {
    if (typeof sessionId !== 'undefined') {
        const lessons = await callApi({ req, path: `cursus_session/${sessionId}/events` })

        return lessons
    } else {
        const sessions = await callApi({ req, path: 'cursus_session' })

        if (typeof sessions !== 'undefined') {
            const lessonsToFetch = sessions.map((session) =>
                (async () => {
                    const lessons = await callApi({ req, path: `cursus_session/${session.id}/events` })

                    return { [session.id]: lessons }
                })()
            )

            const fetchedLessons = await Promise.allSettled(lessonsToFetch)

            return fetchedLessons.flatMap(({ value }) => value)
        } else {
            return []
        }
    }
}

export const formatDate = ({ dateString, dateObject, isTimeVisible, isFullTimeVisible, isDateVisible }) => {
    const date = dateObject ?? (dateString ? new Date(dateString) : new Date())
    const getDay = () => (date.getDate() < 10 ? `0${date.getDate()}` : date.getDate())
    const getMonth = () => {
        const month = date.getMonth() + 1

        return month < 10 ? `0${month}` : month
    }
    const getMinutes = () => (date.getMinutes() < 10 ? `0${date.getMinutes()}` : date.getMinutes())

    const getSeconds = () => (date.getSeconds() < 10 ? `0${date.getSeconds()}` : date.getSeconds())

    const getDate = () => (isDateVisible === true ? `${getDay()}.${getMonth()}.${date.getFullYear()}` : null)
    // + 1 because of timezone offset
    const getTime = () =>
        isTimeVisible === true || isFullTimeVisible === true
            ? `${date.getHours() + 1}h${getMinutes()}${
                  isFullTimeVisible === true ? `m${getSeconds()}s${date.getMilliseconds()}ms` : ''
              }`
            : null

    return [getDate(), getTime()].filter(Boolean).join(', ')
}

export const getLogDescriptions = {
    formation: (columnNewData) =>
        columnNewData
            ? `Changed column field "${columnNewData.field}" to "${columnNewData.fieldValue}"`
            : 'Updated description',
    inscription: ({ originalStatus, newStatus }) => `Changed status from "${originalStatus}" to "${newStatus}"`,
}

export const LOG_STATUSES = {
    PENDING: 'Pending',
    COMPLETE: 'Complete',
    FAIL: 'Fail',
}

export const LOG_TYPES = {
    FORMATION: 'Formation',
    INSCRIPTION: 'Inscription',
    SESSION: 'Session',
    TEMPLATE: 'Model',
    ORGANISATION: 'Organisation',
}

// TODO: named params
export const createService = (method, url, handlerFunction, logHelper, router = app) => {
    router[method](url, async (req, res) => {
        let logId
        try {
            if (logHelper) {
                const log = await prisma.former22_log.create({
                    data: {
                        logId: uuidv4(),
                        userEmail: req.headers['x-login-email-address'],
                        entityType: logHelper.entityType,
                        dateAndTime: Date.now(),
                        actionStatus: LOG_STATUSES.PENDING,
                    },
                })

                logId = log.id
            }

            winstonLogger.http(
                `Request to path ${req.route.path}. Date and time: ${formatDate({
                    dateObject: new Date(),
                    isDateVisible: true,
                    isFullTimeVisible: true,
                })}. Time stamp: ${Date.now()}`
            )

            const logPayload = await handlerFunction(req, res)

            if (logHelper) {
                await prisma.former22_log.update({
                    where: { id: logId },
                    data: {
                        entityName: logPayload.entityName,
                        actionDescription: logPayload.actionDescription,
                        actionStatus: LOG_STATUSES.COMPLETE,
                    },
                })
            }
        } catch (error) {
            console.error(error)
            winstonLogger.error(
                `${req.method} request to ${req.originalUrl} failed. IP: ${req.ip} Response code: ${
                    error.status || 500
                }, response message: ${error.message}. Date and time: ${formatDate({
                    dateObject: new Date(),
                    isDateVisible: true,
                    isFullTimeVisible: true,
                })}. Time stamp: ${Date.now()}`
            )

            if (logHelper) {
                await prisma.former22_log.update({
                    where: { id: logId },
                    data: {
                        actionStatus: LOG_STATUSES.FAIL,
                        entityName: error.message,
                        actionDescription: error.stack,
                    },
                })
            }

            res.status(500).send({ message: error.message, stack: error.stack })
        }
    })
}

export const getSessionAddress = ({ sessions, wantedSessionId }) => {
    const currentSessionData = sessions.find(({ id }) => wantedSessionId === id)
    const sessionLocation = currentSessionData.location
    const sessionAddress = sessionLocation?.address

    const sessionAddressArray = [
        sessionLocation?.name,
        sessionAddress?.street1,
        sessionAddress?.street2,
        [sessionAddress?.postalCode, sessionAddress?.state].filter(Boolean).join(' '),
        [sessionAddress?.city, sessionAddress?.country].filter(Boolean).join(', '),
    ]

    const location = sessionAddressArray.filter(Boolean).join('<br/>')

    return location
}

const formatSessionLessons = ({ sessionLessons }) => {
    // TODO add another format for multiday lessons :
    // 15.12.2022 13h30 - 16.12.2022 15h30
    const lessonsResume = sessionLessons.map(({ start, end }) =>
        [
            formatDate({ dateString: start, isDateVisible: true }),
            [
                formatDate({ dateString: start, isTimeVisible: true }),
                formatDate({ dateString: end, isTimeVisible: true }),
            ].join('-'),
        ].join(', ')
    )

    const lessons = `<code>${lessonsResume.join('<br/>')}</code>`

    return lessons
}

export const draftVariables = {
    PARTICIPANT_NOM: '[PARTICIPANT_NOM]',
    SESSION_NOM: '[SESSION_NOM]',
    SESSION_DATE_DÉBUT: '[SESSION_DATE_DÉBUT]',
    LIEU: '[LIEU]',
    SESSION_RÉSUMÉ_DATES: '[SESSION_RÉSUMÉ_DATES]',
    PARTICIPANT_CIVILITÉ: '[PARTICIPANT_CIVILITÉ]',
    INSCRIPTION_DATE: '[INSCRIPTION_DATE]',
}

const replacePlaceholders = ({
    userFullName,
    sessionName,
    startDate,
    location,
    lessons,
    civility,
    inscriptionDate,
    template: { emailBody, emailSubject, smsBody },
}) => {
    const placeholdersMapper = {
        [draftVariables.PARTICIPANT_NOM]: userFullName,
        [draftVariables.SESSION_NOM]: sessionName,
        [draftVariables.SESSION_DATE_DÉBUT]: startDate,
        [draftVariables.LIEU]: location,
        [draftVariables.SESSION_RÉSUMÉ_DATES]: lessons,
        [draftVariables.PARTICIPANT_CIVILITÉ]: civility,
        [draftVariables.INSCRIPTION_DATE]: inscriptionDate,
    }

    let enrichedEmailContent = emailBody

    let enrichedSMSContent = smsBody

    let enrichedEmailSubject = emailSubject

    Object.entries(placeholdersMapper).forEach(([placeholder, value]) => {
        if (emailBody.includes(placeholder)) {
            enrichedEmailContent = enrichedEmailContent.replaceAll(placeholder, value)
        }

        if (smsBody.includes(placeholder)) {
            enrichedSMSContent = enrichedSMSContent.replaceAll(placeholder, value)
        }

        if (emailSubject.includes(placeholder)) {
            enrichedEmailSubject = enrichedEmailSubject.replaceAll(placeholder, value)
        }
    })

    return {
        emailContent: enrichedEmailContent,
        smsContent: enrichedSMSContent,
        emailSubject: enrichedEmailSubject,
    }
}

export const serializeStatuses = (statusesArray) => statusesArray.map(({ value }) => value).join(', ')

export const deserializeStatuses = (statusesString) =>
    statusesString.split(', ').map((status) => ({ value: status, label: status }))

export const getTemplatePreviews = async ({ req, templateId, sessionId, inscriptionId }) => {
    const template = await prisma.former22_template.findUnique({
        where: { templateId },
    })

    const sessions = await callApi({ req, path: 'cursus_session' })

    const currentSession = sessions.find(({ id }) => id === sessionId)

    const sessionLessons = await fetchSessionsLessons({ req, sessionId })

    const inscriptions = await fetchInscriptionsWithStatuses()

    const currentInscription = inscriptions.find(({ id }) => id === inscriptionId)

    const userData = await callApi({ req, path: `profile/${currentInscription.user.username}` })

    let userCivility = '(Civilité non défini)'

    if (userData.user.profile) {
        userData.facets.forEach(({ sections }) =>
            sections.forEach(({ fields }) =>
                fields.forEach(({ name, id }) => {
                    if (name.includes('civilit')) {
                        if (userData.user.profile[id]) {
                            userCivility = userData.user.profile[id]
                        }
                    }
                })
            )
        )
    }

    return replacePlaceholders({
        userFullName: `${currentInscription.user.firstName} ${currentInscription.user.lastName}`,
        sessionName: currentSession.name,
        startDate: formatDate({ dateString: currentSession.restrictions.dates[0], isDateVisible: true }),
        location: getSessionAddress({ sessions, wantedSessionId: sessionId }),
        lessons: formatSessionLessons({ sessionLessons }),
        inscriptionDate: formatDate({ dateObject: currentInscription.inscriptionDate, isDateVisible: true }),
        civility: userCivility,
        template,
    })
}
