import { prisma } from '..'
import { callApi } from '../callApi'
import { fetchSessionsLessons, formatDate, formatTime, getSessionAddress } from '../utils'
import { fetchInscriptionsWithStatuses } from './inscriptionsUtils'

const formatSessionLessons = ({ sessionLessons }) => {
    // TODO add another format for multiday lessons :
    // 15.12.2022 13h30 - 16.12.2022 15h30
    const lessonsResume = sessionLessons.map(({ start, end }) =>
        [
            formatDate({ dateString: start, isDateVisible: true }),
            [formatTime({ dateString: start }), formatTime({ dateString: end })].join('-'),
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
        [draftVariables.EVALUATION_LIEN]: evaluationLink,
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

export const getTemplatePreviews = async ({ req, templateId, sessionId, inscriptionId, evaluationId }) => {
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
        evaluationLink: evaluationId,
        template,
    })
}
