/**
 * Dates et heures du middleware en heure de Suisse.
 *
 * L'ancien `formatDate` ajoutait une heure en dur a un conteneur en UTC : juste en hiver, faux
 * d'une heure en ete, et le jour restait celui d'UTC.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { formatDate } from './formatDate.js'

describe('formatDate', () => {
    it('donne l heure de Suisse en hiver (UTC+1)', () => {
        const dateObject = new Date('2026-01-15T08:05:00Z')

        assert.equal(formatDate({ dateObject, isDateVisible: true, isTimeVisible: true }), '15.01.2026, 9h05')
    })

    it('donne l heure de Suisse en ete (UTC+2)', () => {
        const dateObject = new Date('2026-07-15T08:05:00Z')

        assert.equal(formatDate({ dateObject, isDateVisible: true, isTimeVisible: true }), '15.07.2026, 10h05')
    })

    it('donne le jour suisse pour une heure UTC tardive', () => {
        assert.equal(formatDate({ dateString: '2027-11-30T23:30:00Z', isDateVisible: true }), '01.12.2027')
    })

    it('garde le format complet des journaux', () => {
        const dateObject = new Date('2026-07-15T08:05:09.042Z')

        assert.equal(formatDate({ dateObject, isFullTimeVisible: true }), '10h05m09s42ms')
    })
})
