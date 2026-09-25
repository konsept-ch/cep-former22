/**
 * Tests de non-regression du flux attestation.
 *
 * Ils couvrent les deux defauts corriges le 25.09.2026 :
 *   - la racine de l'espace personnel etait prise par `[0]`, donc au hasard de l'ordre
 *     rendu par MySQL ;
 *   - chaque relance redeposait un PDF, d'ou les attestations en trois ou quatre
 *     exemplaires sur CHE/26/03.
 *
 * docs/90-incidents/investigation_attestations_che_plantes_2026-09.md
 *
 * Lancement : npm test
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
    ATTESTATIONS_FOLDER_NAME,
    findAttestationsFolder,
    findExistingAttestation,
    resolvePersonalRootNode,
} from './attestationsResolvers.js'

describe('resolvePersonalRootNode', () => {
    it('rend le noeud sans parent, meme quand il n est pas le premier de la liste', () => {
        const nodes = [
            { id: 10, parent_id: 7, uuid: 'enfant-a' },
            { id: 7, parent_id: null, uuid: 'racine' },
            { id: 11, parent_id: 7, uuid: 'enfant-b' },
        ]

        assert.equal(resolvePersonalRootNode(nodes).uuid, 'racine')
    })

    it('ne rend pas [0] quand [0] n est pas la racine — c est tout le defaut', () => {
        const nodes = [
            { id: 99, parent_id: 7, uuid: 'un-pdf-depose-precedemment' },
            { id: 7, parent_id: null, uuid: 'racine' },
        ]

        assert.notEqual(resolvePersonalRootNode(nodes).uuid, nodes[0].uuid)
    })

    it('traite parent_id undefined comme une racine', () => {
        assert.equal(resolvePersonalRootNode([{ uuid: 'racine' }]).uuid, 'racine')
    })

    it('choisit la racine la plus ancienne quand il y en a plusieurs', () => {
        // 9 espaces personnels de la base de production portent plusieurs racines.
        const nodes = [
            { id: 900, parent_id: null, uuid: 'racine-recente' },
            { id: 12, parent_id: null, uuid: 'racine-ancienne' },
            { id: 50, parent_id: 12, uuid: 'enfant' },
        ]

        assert.equal(resolvePersonalRootNode(nodes).uuid, 'racine-ancienne')
    })

    it('rend le meme resultat quel que soit l ordre rendu par MySQL', () => {
        const a = { id: 900, parent_id: null, uuid: 'recente' }
        const b = { id: 12, parent_id: null, uuid: 'ancienne' }

        assert.equal(resolvePersonalRootNode([a, b]).uuid, resolvePersonalRootNode([b, a]).uuid)
    })

    it('rend null quand aucun noeud n est une racine', () => {
        assert.equal(resolvePersonalRootNode([{ id: 10, parent_id: 7, uuid: 'enfant' }]), null)
    })

    it('rend null sur une liste vide, null, undefined ou une valeur non tableau', () => {
        for (const entree of [[], null, undefined, {}, 'racine', 0]) {
            assert.equal(resolvePersonalRootNode(entree), null)
        }
    })
})

describe('findExistingAttestation', () => {
    const sessionName = 'Lutte contre les plantes 2026 session 03'

    it('reconnait un depot deja fait pour cette session', () => {
        const resources = [
            { id: 'a', name: 'Une autre session' },
            { id: 'b', name: sessionName },
        ]

        assert.equal(findExistingAttestation(resources, sessionName).id, 'b')
    })

    it('rend null quand le dossier ne contient pas cette session', () => {
        const resources = [{ id: 'a', name: 'Une autre session' }]

        assert.equal(findExistingAttestation(resources, sessionName), null)
    })

    it('exige une correspondance exacte du nom', () => {
        const resources = [{ id: 'a', name: `${sessionName} (copie)` }]

        assert.equal(findExistingAttestation(resources, sessionName), null)
    })

    it('rend null sur un dossier vide ou une reponse non exploitable', () => {
        for (const entree of [[], null, undefined, {}, 'oui']) {
            assert.equal(findExistingAttestation(entree, sessionName), null)
        }
    })

    it('rend null quand le nom de session est absent, plutot que de faire un faux positif', () => {
        const resources = [{ id: 'a', name: '' }]

        for (const nom of ['', null, undefined]) {
            assert.equal(findExistingAttestation(resources, nom), null)
        }
    })
})

describe('findAttestationsFolder', () => {
    it('trouve le dossier par son nom exact', () => {
        const resources = [
            { id: 'x', name: 'Autre' },
            { id: 'y', name: ATTESTATIONS_FOLDER_NAME },
        ]

        assert.equal(findAttestationsFolder(resources).id, 'y')
    })

    it('rend null quand le dossier n existe pas encore', () => {
        assert.equal(findAttestationsFolder([{ id: 'x', name: 'Autre' }]), null)
    })

    it('rend null sur une reponse non exploitable', () => {
        for (const entree of [null, undefined, {}, 'Mes attestations']) {
            assert.equal(findAttestationsFolder(entree), null)
        }
    })
})
