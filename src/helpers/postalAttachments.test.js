/**
 * Relais des pieces jointes envoyees par Claroline a la route `/mail`.
 *
 * Regression constatee sur VAL le 13.11.2026 : l'invitation a une seance (message
 * Postal #290) arrivait sans `invitation.ics`, la route ne reprenant pas `attachments`.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { normalizePostalAttachments, toMailgunAttachments } from './postalAttachments.js'

const ics = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'

/** Ce que `Postal\SendMessage::attach()` produit cote Claroline. */
const invitation = {
    name: 'invitation.ics',
    content_type: 'text/calendar',
    data: Buffer.from(ics).toString('base64'),
}

describe('normalizePostalAttachments', () => {
    it('reprend telle quelle une piece jointe au format Postal', () => {
        assert.deepEqual(normalizePostalAttachments([invitation]), [invitation])
    })

    it("rend un tableau vide quand Claroline n'envoie rien", () => {
        assert.deepEqual(normalizePostalAttachments(undefined), [])
        assert.deepEqual(normalizePostalAttachments(null), [])
        assert.deepEqual(normalizePostalAttachments({}), [])
        assert.deepEqual(normalizePostalAttachments([]), [])
    })

    it('ecarte les entrees sans nom ou sans contenu', () => {
        const result = normalizePostalAttachments([
            null,
            { name: '', data: 'eA==' },
            { name: 'sans-contenu.txt' },
            { data: 'eA==' },
            invitation,
        ])

        assert.deepEqual(result, [invitation])
    })

    it('donne un type par defaut quand content_type manque', () => {
        assert.deepEqual(normalizePostalAttachments([{ name: 'a.bin', data: 'eA==' }]), [
            { name: 'a.bin', content_type: 'application/octet-stream', data: 'eA==' },
        ])
    })

    it('ne transmet pas de champ inattendu', () => {
        const [result] = normalizePostalAttachments([{ ...invitation, url: '/tmp/invitation.ics' }])

        assert.deepEqual(Object.keys(result).sort(), ['content_type', 'data', 'name'])
    })
})

describe('toMailgunAttachments', () => {
    it('decode le base64 et renomme les champs pour mailgun.js', () => {
        const [result] = toMailgunAttachments([invitation])

        assert.equal(result.filename, 'invitation.ics')
        assert.equal(result.contentType, 'text/calendar')
        assert.ok(Buffer.isBuffer(result.data))
        assert.equal(result.data.toString(), ics)
    })
})
