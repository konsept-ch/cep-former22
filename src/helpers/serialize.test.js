/**
 * Tests de non-regression du serialiseur des ecritures de facture.
 *
 * Doublon reproduit en local le 12.11.2026 : cinq paires de `POST /manual-invoices`
 * simultanes ont donne cinq paires de numeros identiques, parce que chaque creation lit
 * `MAX(invoiceNumberForCurrentYear)` puis insere `MAX + 1` sans rien qui les ordonne.
 * Le test reprend ce motif lire-puis-ecrire avec un compteur en memoire.
 *
 * docs/90-incidents/2026-11-12-doublon-facture-26381040.md
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createSerializer } from './serialize.js'

const pause = () => new Promise((resolve) => setTimeout(resolve, 5))

/** Lit le maximum, laisse la main comme le fait un aller-retour en base, puis ecrit max + 1. */
const makeNumbering = () => {
    const numbers = []
    const nextNumber = async () => {
        const max = numbers.length > 0 ? Math.max(...numbers) : 0
        await pause()
        numbers.push(max + 1)

        return max + 1
    }

    return { numbers, nextNumber }
}

describe('createSerializer', () => {
    it('reproduit le doublon sans serialiseur', async () => {
        const { nextNumber } = makeNumbering()

        const [a, b] = await Promise.all([nextNumber(), nextNumber()])

        assert.equal(a, b)
    })

    it('attribue des numeros distincts a des creations simultanees', async () => {
        const { nextNumber } = makeNumbering()
        const serialize = createSerializer()

        const results = await Promise.all(Array.from({ length: 10 }, () => serialize(nextNumber)))

        assert.deepEqual(results, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    })

    it("execute les taches dans l'ordre d'arrivee", async () => {
        const serialize = createSerializer()
        const order = []

        await Promise.all([
            serialize(async () => {
                await pause()
                order.push('premiere')
            }),
            serialize(async () => {
                order.push('seconde')
            }),
        ])

        assert.deepEqual(order, ['premiere', 'seconde'])
    })

    it("transmet l'erreur a l'appelant sans bloquer les taches suivantes", async () => {
        const serialize = createSerializer()

        const failing = serialize(async () => {
            throw new Error('echec')
        })
        const next = serialize(async () => 'suite')

        await assert.rejects(failing, /echec/)
        assert.equal(await next, 'suite')
    })
})
