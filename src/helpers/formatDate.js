// CEP : heure de Suisse, heure d'ete comprise. L'ancien code ajoutait `+ 1` a l'heure d'un conteneur
// en UTC : faux d'une heure en ete, et le jour restait celui d'UTC (une date a 23h30 UTC tombait la
// veille). Voir docs/90-incidents/investigation_attestations_che_plantes_2026-09.md.
const zurichParts = new Intl.DateTimeFormat('fr-CH', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
})

export const formatDate = ({ dateString, dateObject, isTimeVisible, isFullTimeVisible, isDateVisible }) => {
    const date = dateObject ?? (dateString ? new Date(dateString) : new Date())
    const part = Object.fromEntries(zurichParts.formatToParts(date).map(({ type, value }) => [type, value]))

    const getDate = () => (isDateVisible === true ? `${part.day}.${part.month}.${part.year}` : null)
    const getTime = () =>
        isTimeVisible === true || isFullTimeVisible === true
            ? `${Number(part.hour)}h${part.minute}${
                  isFullTimeVisible === true ? `m${part.second}s${date.getMilliseconds()}ms` : ''
              }`
            : null

    return [getDate(), getTime()].filter(Boolean).join(', ')
}
