/**
 * Tests de non-regression des dates imprimees sur une attestation.
 *
 * Constate sur VAL le 25.11.2026 : une session avec une seance datee et une seance sans
 * date donnait « Dates : 1 janvier 1970, 15 décembre 2027 ».
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DATE_A_DEFINIR, getAttestationDates } from './attestationDates.js'

const event = (startDate) => ({ claro_planned_object: { start_date: startDate } })

describe('getAttestationDates', () => {
    it('ignore une seance sans date au lieu d imprimer 1970', () => {
        const result = getAttestationDates([event(null), event(new Date('2027-12-15T08:00:00Z'))])

        assert.equal(result.sessionDates, '15 décembre 2027')
        assert.equal(result.sessionEndDate, '15 décembre 2027')
        assert.doesNotMatch(result.sessionDates, /1970/)
    })

    it('prend la derniere seance datee comme date de fin, quel que soit l ordre recu', () => {
        const result = getAttestationDates([
            event(new Date('2027-12-20T08:00:00Z')),
            event(null),
            event(new Date('2027-12-15T08:00:00Z')),
        ])

        assert.equal(result.sessionDates, '15 décembre 2027, 20 décembre 2027')
        assert.equal(result.sessionEndDate, '20 décembre 2027')
    })

    it('ecrit « Date à définir » quand aucune seance n est datee', () => {
        assert.deepEqual(getAttestationDates([event(null), { claro_planned_object: null }]), {
            sessionDates: DATE_A_DEFINIR,
            sessionEndDate: DATE_A_DEFINIR,
        })
    })

    it('ecrit « Date à définir » pour une session sans seance', () => {
        assert.equal(getAttestationDates([]).sessionDates, DATE_A_DEFINIR)
        assert.equal(getAttestationDates(undefined).sessionEndDate, DATE_A_DEFINIR)
    })
})
