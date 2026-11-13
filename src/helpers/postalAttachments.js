/**
 * Pieces jointes au format de l'API Postal `POST /api/v1/send/message`.
 *
 * Claroline les envoie par `Postal\SendMessage::attach()` (vendor postal/postal) :
 * `{ name, content_type, data }`, `data` etant le contenu encode en base64. La route
 * `/mail/api/v1/send/message` imite cette API : elle doit donc les relayer telles quelles
 * vers Postal, et les convertir pour Mailgun.
 *
 * Avant ce helper, la route ne reprenait pas `attachments` : l'invitation a une seance
 * arrivait sans son `invitation.ics` (message Postal #290 sur VAL, 13.11.2026).
 */

const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

/**
 * Ne garde que les pieces jointes exploitables, au format Postal.
 *
 * @param {unknown} attachments le champ `attachments` du corps recu
 * @returns {{ name: string, content_type: string, data: string }[]}
 */
export const normalizePostalAttachments = (attachments) => {
    if (!Array.isArray(attachments)) {
        return []
    }

    return attachments
        .filter(
            (attachment) =>
                attachment &&
                typeof attachment.name === 'string' &&
                attachment.name !== '' &&
                typeof attachment.data === 'string'
        )
        .map(({ name, content_type, data }) => ({
            name,
            content_type: typeof content_type === 'string' && content_type !== '' ? content_type : DEFAULT_CONTENT_TYPE,
            data,
        }))
}

/**
 * Convertit des pieces jointes Postal en pieces jointes mailgun.js
 * (`{ filename, data, contentType }`, `data` decode en Buffer).
 *
 * @param {{ name: string, content_type: string, data: string }[]} attachments
 */
export const toMailgunAttachments = (attachments) =>
    attachments.map(({ name, content_type, data }) => ({
        filename: name,
        contentType: content_type,
        data: Buffer.from(data, 'base64'),
    }))
