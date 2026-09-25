/**
 * Tests de non-regression de la reprise sur collision de slug.
 *
 * Collision reproduite en local le 25.09.2026, huit creations simultanees portant le meme
 * nom : `Duplicate entry 'mes-attestations-17565' for key
 * 'claro_resource_node.UNIQ_A76799FF989D9B62'`, 2 echecs sur 8. C'est la cause des
 * HTTP 500 rendus par Claroline en production.
 *
 * docs/90-incidents/investigation_attestations_che_plantes_2026-09.md
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { creerAvecRepriseSurConflit, estEchecTransitoire, TENTATIVES_SUPPLEMENTAIRES } from './conflitSlug.js'

const sansAttente = async () => undefined

/** Le message tel que `callApi` le remonte : statut, URL, puis debut du corps Claroline. */
const messageReel =
    'Claroline API request failed: POST http://localhost/resources/add/abc returned 500 Internal Server Error - ' +
    '<!DOCTYPE html><html><head><title>An Error Occurred: Internal Server Error</title></head>' +
    '<body><h1>Oops! An Error Occurred</h1><h2>The server returned a "500 Internal Server Error".</h2></body></html>'

describe('estEchecTransitoire', () => {
    it('reconnait le message reel remonte par callApi, sans detail SQL', () => {
        // Claroline en production ne rend que la page generique de Symfony : aucun
        // `Duplicate entry`, aucun `SQLSTATE`. Seul le statut est exploitable.
        assert.ok(!/Duplicate entry|SQLSTATE/.test(messageReel), 'le corps reel ne dit rien du conflit')
        assert.equal(estEchecTransitoire(new Error(messageReel)), true)
    })

    it('reconnait tout 5xx de Claroline', () => {
        for (const statut of [500, 502, 503, 504]) {
            const message = `Claroline API request failed: POST /resources/add/x returned ${statut} Error - <html>`
            assert.equal(estEchecTransitoire(new Error(message)), true, String(statut))
        }
    })

    it('reconnait aussi le detail SQL quand il remonte malgre tout', () => {
        for (const message of [
            "Duplicate entry 'x' for key 'claro_resource_node.UNIQ_A76799FF989D9B62'",
            'Doctrine\\DBAL\\Exception\\UniqueConstraintViolationException',
            'SQLSTATE[23000]: Integrity constraint violation',
        ]) {
            assert.equal(estEchecTransitoire(new Error(message)), true, message)
        }
    })

    it('ne confond pas avec une autre panne', () => {
        for (const message of [
            "L'espace personnel Claroline de l'utilisateur est incomplet.",
            'Claroline API request failed: POST ... returned 404 Not Found',
            'Claroline API request failed: POST ... returned 403 Forbidden',
            'SQLSTATE[42S02]: Base table or view not found',
            '',
        ]) {
            assert.equal(estEchecTransitoire(new Error(message)), false, message)
        }
    })

    it('tolere une erreur absente ou sans message', () => {
        assert.equal(estEchecTransitoire(null), false)
        assert.equal(estEchecTransitoire(undefined), false)
        assert.equal(estEchecTransitoire({}), false)
    })
})

describe('creerAvecRepriseSurConflit', () => {
    it('ne rejoue pas quand la creation reussit du premier coup', async () => {
        let appels = 0
        const resultat = await creerAvecRepriseSurConflit(
            async () => {
                appels += 1

                return 'ressource'
            },
            { attendre: sansAttente }
        )

        assert.equal(resultat, 'ressource')
        assert.equal(appels, 1)
    })

    it('rejoue apres une collision et rend le resultat de la reprise', async () => {
        let appels = 0
        const resultat = await creerAvecRepriseSurConflit(
            async () => {
                appels += 1
                if (appels === 1) {
                    throw new Error(messageReel)
                }

                return 'ressource'
            },
            { attendre: sansAttente }
        )

        assert.equal(resultat, 'ressource')
        assert.equal(appels, 2)
    })

    it('ne rejoue PAS sur une erreur qui n est pas une collision', async () => {
        let appels = 0

        await assert.rejects(
            creerAvecRepriseSurConflit(
                async () => {
                    appels += 1
                    throw new Error("L'espace personnel Claroline de l'utilisateur est incomplet.")
                },
                { attendre: sansAttente }
            ),
            /espace personnel/
        )

        assert.equal(appels, 1, 'rejouer une erreur non transitoire masquerait le vrai probleme')
    })

    it('abandonne apres le nombre de tentatives prevu, et remonte la derniere erreur', async () => {
        let appels = 0

        await assert.rejects(
            creerAvecRepriseSurConflit(
                async () => {
                    appels += 1
                    throw new Error(messageReel)
                },
                { attendre: sansAttente }
            ),
            /returned 500/
        )

        assert.equal(appels, TENTATIVES_SUPPLEMENTAIRES + 1)
    })

    it('journalise chaque tentative, pour que les collisions restent visibles', async () => {
        const vues = []
        let appels = 0

        await creerAvecRepriseSurConflit(
            async () => {
                appels += 1
                if (appels <= 2) {
                    throw new Error(messageReel)
                }

                return 'ressource'
            },
            { attendre: sansAttente, journaliser: (tentative) => vues.push(tentative) }
        )

        assert.deepEqual(vues, [1, 2])
    })

    it('espace les reprises, sans quoi deux requetes en collision rejoueraient ensemble', async () => {
        const attentes = []
        let appels = 0

        await creerAvecRepriseSurConflit(
            async () => {
                appels += 1
                if (appels <= 2) {
                    throw new Error(messageReel)
                }

                return 'ressource'
            },
            {
                attendre: async (ms) => {
                    attentes.push(ms)
                },
            }
        )

        assert.equal(attentes.length, 2)
        assert.ok(attentes[1] > attentes[0], 'le recul doit croitre')
        assert.ok(
            attentes.every((ms) => ms >= 50),
            'chaque recul doit etre non nul'
        )
    })
})
