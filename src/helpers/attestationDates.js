/**
 * Dates imprimees sur une attestation.
 *
 * Une seance peut n'avoir aucune date (« Date a definir » dans Claroline). Formater sa
 * `start_date` nulle imprimait « 1 janvier 1970 » dans `[SESSION_DATES]`, et dans
 * `[SESSION_DATE_FIN]` si elle venait en dernier. Constate sur VAL le 25.11.2026, existe
 * en PROD.
 *
 * On ne garde donc que les seances datees, dans l'ordre chronologique. Sans aucune seance
 * datee, l'attestation porte « Date à définir », comme la liste des seances dans Claroline.
 */

export const DATE_A_DEFINIR = 'Date à définir'

const formatDate = (date) =>
    Intl.DateTimeFormat('fr-CH', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)

/**
 * @param {Array<{ claro_planned_object?: { start_date?: Date | string | null } | null }>} sessionDates
 * @returns {{ sessionDates: string, sessionEndDate: string }}
 */
export function getAttestationDates(sessionDates) {
    const dates = (sessionDates ?? [])
        .map((event) => event?.claro_planned_object?.start_date)
        .filter((startDate) => startDate !== null && startDate !== undefined && startDate !== '')
        .map((startDate) => new Date(startDate))
        .filter((date) => !Number.isNaN(date.getTime()))
        .sort((a, b) => a.getTime() - b.getTime())

    if (dates.length === 0) {
        return { sessionDates: DATE_A_DEFINIR, sessionEndDate: DATE_A_DEFINIR }
    }

    return {
        sessionDates: dates.map(formatDate).join(', '),
        sessionEndDate: formatDate(dates.at(-1)),
    }
}
