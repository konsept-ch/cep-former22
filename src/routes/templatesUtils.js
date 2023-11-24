import { DateTime } from 'luxon'
import { prisma } from '..'
import { formatDate } from '../utils'

const getSessionAddress = (session) => {
    const location = session.claro__location
    return [
        location?.name,
        location?.address_street1,
        location?.address_street2,
        [location?.address_postal_code, location?.address_state].filter(Boolean).join(' '),
        [location?.address_city, location?.address_country].filter(Boolean).join(', '),
    ]
        .filter(Boolean)
        .join('<br/>')
}

const formatTime = (dateString) =>
    DateTime.fromISO(new Date(dateString).toISOString(), { zone: 'UTC' })
        .setZone('Europe/Zurich')
        .setLocale('fr')
        .toLocaleString(DateTime.TIME_SIMPLE)

export const draftVariables = {
    PARTICIPANT_NOM: '[PARTICIPANT_NOM]',
    SESSION_NOM: '[SESSION_NOM]',
    SESSION_DATE_DÉBUT: '[SESSION_DATE_DÉBUT]',
    LIEU: '[LIEU]',
    SESSION_RÉSUMÉ_DATES: '[SESSION_RÉSUMÉ_DATES]',
    PARTICIPANT_CIVILITÉ: '[PARTICIPANT_CIVILITÉ]',
    INSCRIPTION_DATE: '[INSCRIPTION_DATE]',
    EVALUATION_LIEN: '[EVALUATION_LIEN]',
}

const replacePlaceholders = ({
    userFullName,
    sessionName,
    startDate,
    location,
    lessons,
    civility,
    inscriptionDate,
    evaluationLink,
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
        [draftVariables.EVALUATION_LIEN]: `<a href="${evaluationLink}" target="_blank">${evaluationLink}</a>`,
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

export const getTemplatePreviews = async ({ templateId, sessionId, inscriptionId, evaluationLink }) => {
    const template = await prisma.former22_template.findUnique({
        where: { templateId },
    })

    const currentSession = await prisma.claro_cursusbundle_course_session.findUnique({
        select: {
            course_name: true,
            start_date: true,
            claro__location: {
                select: {
                    name: true,
                    address_street1: true,
                    address_street2: true,
                    address_postal_code: true,
                    address_city: true,
                    address_state: true,
                    address_country: true,
                },
            },
            claro_cursusbundle_session_event: {
                select: {
                    claro_planned_object: {
                        select: {
                            start_date: true,
                            end_date: true,
                        },
                    },
                },
            },
        },
        where: {
            uuid: sessionId,
        },
    })

    const query = {
        select: {
            registration_date: true,
            claro_user: {
                select: {
                    id: true,
                    first_name: true,
                    last_name: true,
                    username: true,
                    claro_field_facet_value: {
                        select: {
                            field_value: true,
                        },
                        where: {
                            claro_field_facet: {
                                is: {
                                    name: {
                                        startsWith: 'Civilit',
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        where: {
            uuid: inscriptionId,
        },
    }
    const currentInscription =
        (await prisma.claro_cursusbundle_course_session_user.findUnique(query)) ||
        (await prisma.claro_cursusbundle_course_session_cancellation.findUnique(query))

    return replacePlaceholders({
        userFullName: `${currentInscription.claro_user.first_name} ${currentInscription.claro_user.last_name}`,
        sessionName: currentSession.course_name,
        startDate: formatDate({ dateString: currentSession.start_date, isDateVisible: true }),
        location: getSessionAddress(currentSession),
        lessons: `<code>${currentSession.claro_cursusbundle_session_event
            .map((e) => [
                formatDate({ dateString: e.claro_planned_object.start_date, isDateVisible: true }),
                [formatTime(e.claro_planned_object.start_date), formatTime(e.claro_planned_object.end_date)].join('-'),
            ])
            .join(',<br/>')}</code>`,
        inscriptionDate: formatDate({ dateObject: currentInscription.registration_date, isDateVisible: true }),
        civility: currentInscription.claro_user.claro_field_facet_value?.field_value || '(Civilité non défini)',
        evaluationLink,
        template,
    })
}
