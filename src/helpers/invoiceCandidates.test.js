/**
 * Tests de non-regression du choix des inscriptions a facturer par la generation directe.
 *
 * Constate en PROD le 12.11.2026 : trois inscriptions portent deux annulations, et la
 * seconde, sans article, a ete facturee une troisieme fois (factures 8055, 8057, 8058).
 * Reproduit en local : le `/direct` d'origine facturait 11624 (inscription deja facturee)
 * et 11824 + 11825 (deux annulations de la meme inscription).
 *
 * docs/90-incidents/2026-11-12-doublon-facture-26381040.md
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { keepOneUninvoicedPerInscription } from './invoiceCandidates.js'

const ids = (rows) => rows.map(({ id }) => id)

describe('keepOneUninvoicedPerInscription', () => {
    it('ecarte une annulation dont l inscription est deja facturee', () => {
        const candidates = [{ id: 11624, uuid: '2be6204a' }]

        assert.deepEqual(keepOneUninvoicedPerInscription(candidates, ['2be6204a']), [])
    })

    it('ne garde que la premiere de deux annulations de la meme inscription', () => {
        const candidates = [
            { id: 11824, uuid: 'a2749cd8' },
            { id: 11825, uuid: 'a2749cd8' },
        ]

        assert.deepEqual(ids(keepOneUninvoicedPerInscription(candidates, [])), [11824])
    })

    it('garde les inscriptions distinctes et non facturees, dans le meme ordre', () => {
        const candidates = [
            { id: 53026, uuid: 'participation' },
            { id: 11136, uuid: 'non-participation' },
            { id: 11624, uuid: 'deja-facturee' },
            { id: 11824, uuid: 'double' },
            { id: 11825, uuid: 'double' },
        ]

        assert.deepEqual(
            ids(keepOneUninvoicedPerInscription(candidates, new Set(['deja-facturee']))),
            [53026, 11136, 11824]
        )
    })

    it('ne change rien quand il n y a ni doublon ni inscription facturee', () => {
        const candidates = [
            { id: 1, uuid: 'a' },
            { id: 2, uuid: 'b' },
        ]

        assert.deepEqual(keepOneUninvoicedPerInscription(candidates, []), candidates)
    })

    it('ne modifie pas les tableaux recus', () => {
        const candidates = [
            { id: 1, uuid: 'a' },
            { id: 2, uuid: 'a' },
        ]
        const invoiced = ['b']

        keepOneUninvoicedPerInscription(candidates, invoiced)

        assert.equal(candidates.length, 2)
        assert.deepEqual(invoiced, ['b'])
    })
})
