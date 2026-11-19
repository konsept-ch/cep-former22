/**
 * Tests de la creation a la demande de l'espace personnel.
 *
 * Cas d'origine : les comptes crees par la personne elle-meme n'ont pas d'espace
 * personnel depuis le 9 juin 2026, et la generation d'attestation echouait pour eux.
 *
 * Lancement : npm test
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { assurerEspacePersonnel, espacePersonnelCreePour, estConflitDeCode } from './espacePersonnel.js'

const USER_UUID = '3f2a1c4e-0000-4000-8000-000000000001'

const CONFLIT_REEL =
    'Claroline API request failed: POST http://localhost/apiv2/user/pws?ids%5B%5D=x returned 422 ' +
    'Unprocessable Entity - [{"path":"code","message":"code already exists and should be unique"}]'

describe('espacePersonnelCreePour', () => {
    it('reconnait l utilisateur dans la reponse de Claroline', () => {
        assert.equal(espacePersonnelCreePour([{ id: USER_UUID }], USER_UUID), true)
    })

    it('rend false sur une liste vide : Claroline a saute l utilisateur sans erreur', () => {
        assert.equal(espacePersonnelCreePour([], USER_UUID), false)
    })

    it('rend false quand la reponse ne porte que d autres utilisateurs', () => {
        assert.equal(espacePersonnelCreePour([{ id: 'autre' }], USER_UUID), false)
    })

    it('rend false sur une reponse non exploitable ou un uuid absent', () => {
        for (const reponse of [null, undefined, {}, 'ok', [null]]) {
            assert.equal(espacePersonnelCreePour(reponse, USER_UUID), false)
        }
        assert.equal(espacePersonnelCreePour([{ id: undefined }], undefined), false)
    })
})

describe('assurerEspacePersonnel', () => {
    it('ne rappelle pas Claroline quand l espace existe deja', async () => {
        let appels = 0
        const workspace = { id: 1, uuid: 'ws' }

        const resultat = await assurerEspacePersonnel({
            workspace,
            userUuid: USER_UUID,
            creerEspace: async () => {
                appels += 1
                return []
            },
            relireEspace: async () => null,
        })

        assert.deepEqual(resultat, { workspace, cree: false, refuse: false, conflitCode: false })
        assert.equal(appels, 0)
    })

    it('cree l espace manquant puis le relit en base', async () => {
        const relu = { id: 2, uuid: 'nouveau', claro_resource_node: [{ uuid: 'racine' }] }
        const etapes = []

        const resultat = await assurerEspacePersonnel({
            workspace: null,
            userUuid: USER_UUID,
            creerEspace: async (uuid) => [{ id: uuid }],
            relireEspace: async () => relu,
            journaliser: (etape) => etapes.push(etape),
        })

        assert.deepEqual(resultat, { workspace: relu, cree: true, refuse: false, conflitCode: false })
        assert.deepEqual(etapes, ['personal-workspace-missing', 'personal-workspace-created'])
    })

    it('signale un refus quand Claroline ne traite pas l utilisateur, sans relire', async () => {
        let relectures = 0

        const resultat = await assurerEspacePersonnel({
            workspace: undefined,
            userUuid: USER_UUID,
            creerEspace: async () => [],
            relireEspace: async () => {
                relectures += 1
                return null
            },
        })

        assert.deepEqual(resultat, { workspace: null, cree: false, refuse: true, conflitCode: false })
        assert.equal(relectures, 0)
    })

    it('laisse remonter une erreur de Claroline au lieu de la masquer', async () => {
        await assert.rejects(
            assurerEspacePersonnel({
                workspace: null,
                userUuid: USER_UUID,
                creerEspace: async () => {
                    throw new Error('Claroline API request failed: 500')
                },
                relireEspace: async () => null,
            }),
            /500/
        )
    })

    it('rend un conflit de code, sans relire, quand un espace porte deja ce code', async () => {
        // Message reel de Claroline, releve en local le 19.11.2026.
        const etapes = []
        let relectures = 0

        const resultat = await assurerEspacePersonnel({
            workspace: null,
            userUuid: USER_UUID,
            creerEspace: async () => {
                throw new Error(CONFLIT_REEL)
            },
            relireEspace: async () => {
                relectures += 1
                return null
            },
            journaliser: (etape) => etapes.push(etape),
        })

        assert.deepEqual(resultat, { workspace: null, cree: false, refuse: false, conflitCode: true })
        assert.equal(relectures, 0)
        assert.deepEqual(etapes, ['personal-workspace-missing', 'personal-workspace-code-conflict'])
    })
})

describe('estConflitDeCode', () => {
    it('reconnait le 422 de Claroline sur un code deja pris', () => {
        assert.equal(estConflitDeCode(new Error(CONFLIT_REEL)), true)
    })

    it('ne confond pas un autre 422 ni une autre erreur', () => {
        const autre422 = 'Claroline API request failed: POST x returned 422 Unprocessable Entity - [{"path":"name"}]'

        for (const erreur of [new Error(autre422), new Error('returned 500 code already exists'), 'code', null]) {
            assert.equal(estConflitDeCode(erreur), false)
        }
    })
})
