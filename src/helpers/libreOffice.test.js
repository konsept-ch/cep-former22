/**
 * Tests de non-regression de la conversion DOCX -> PDF.
 *
 * Le profil LibreOffice est desormais reutilise entre les conversions : c'est ce qui fait
 * passer une conversion de 8,8 s a 1,3 s. Ce choix introduit deux contraintes que ces
 * tests verrouillent :
 *
 *   - deux conversions ne doivent jamais se chevaucher, sans quoi elles se disputent le
 *     verrou du profil partage ;
 *   - un profil corrompu doit etre jete et la conversion retentee, sans quoi toutes les
 *     generations restent bloquees jusqu'au redemarrage du conteneur.
 *
 * docs/90-incidents/investigation_attestations_che_plantes_2026-09.md
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { avecRepriseSurEchec, creerSerialiseur, resoudreBinaireSoffice } from './libreOffice.js'

const attendre = (ms) => new Promise((resoudre) => setTimeout(resoudre, ms))

describe('resoudreBinaireSoffice', () => {
    it('retient le premier chemin qui existe', () => {
        const existe = (chemin) => chemin === '/usr/bin/soffice'

        assert.equal(resoudreBinaireSoffice(['/introuvable', '/usr/bin/soffice'], existe), '/usr/bin/soffice')
    })

    it('ignore les chemins vides, que produisent les variables absentes sous Windows', () => {
        const existe = (chemin) => chemin === '/usr/bin/libreoffice'

        assert.equal(
            resoudreBinaireSoffice(['', null, undefined, '/usr/bin/libreoffice'], existe),
            '/usr/bin/libreoffice'
        )
    })

    it('leve une erreur explicite quand aucun binaire n est trouve', () => {
        assert.throws(
            () => resoudreBinaireSoffice(['/a', '/b'], () => false),
            (erreur) => erreur.message.includes('/a, /b') && erreur.message.includes('SOFFICE_BINARY_PATH')
        )
    })
})

describe('creerSerialiseur', () => {
    it('ne laisse jamais deux conversions se chevaucher', async () => {
        const serialiser = creerSerialiseur()
        let enCours = 0
        let chevauchements = 0

        const tache = async (duree) => {
            enCours += 1
            if (enCours > 1) {
                chevauchements += 1
            }
            await attendre(duree)
            enCours -= 1
        }

        await Promise.all([serialiser(() => tache(20)), serialiser(() => tache(5)), serialiser(() => tache(1))])

        assert.equal(chevauchements, 0)
    })

    it('respecte l ordre d arrivee', async () => {
        const serialiser = creerSerialiseur()
        const ordre = []

        await Promise.all([
            serialiser(async () => {
                await attendre(15)
                ordre.push('a')
            }),
            serialiser(async () => {
                ordre.push('b')
            }),
            serialiser(async () => {
                ordre.push('c')
            }),
        ])

        assert.deepEqual(ordre, ['a', 'b', 'c'])
    })

    it('une conversion en echec ne bloque pas la file', async () => {
        const serialiser = creerSerialiseur()
        const ordre = []

        const echec = serialiser(async () => {
            throw new Error('conversion en echec')
        })

        await assert.rejects(echec, /conversion en echec/)
        await serialiser(async () => {
            ordre.push('suivante')
        })

        assert.deepEqual(ordre, ['suivante'])
    })
})

describe('avecRepriseSurEchec', () => {
    it('ne reinitialise rien quand la conversion reussit', async () => {
        let reinitialisations = 0
        const resultat = await avecRepriseSurEchec(
            async () => 'pdf',
            () => {
                reinitialisations += 1
            }
        )

        assert.equal(resultat, 'pdf')
        assert.equal(reinitialisations, 0)
    })

    it('jette le profil et retente une fois apres un echec', async () => {
        let appels = 0
        let reinitialisations = 0

        const resultat = await avecRepriseSurEchec(
            async () => {
                appels += 1
                if (appels === 1) {
                    throw new Error('profil verrouille')
                }

                return 'pdf'
            },
            () => {
                reinitialisations += 1
            }
        )

        assert.equal(resultat, 'pdf')
        assert.equal(appels, 2)
        assert.equal(reinitialisations, 1)
    })

    it('ne retente qu une seule fois et laisse remonter la seconde erreur', async () => {
        let appels = 0

        await assert.rejects(
            avecRepriseSurEchec(
                async () => {
                    appels += 1
                    throw new Error(`echec ${appels}`)
                },
                () => undefined
            ),
            /echec 2/
        )

        assert.equal(appels, 2)
    })

    it('journalise la premiere erreur, pour qu un profil corrompu soit visible', async () => {
        const vues = []

        await avecRepriseSurEchec(
            (() => {
                let appels = 0

                return async () => {
                    appels += 1
                    if (appels === 1) {
                        throw new Error('profil verrouille')
                    }

                    return 'pdf'
                }
            })(),
            () => undefined,
            (erreur) => vues.push(erreur.message)
        )

        assert.deepEqual(vues, ['profil verrouille'])
    })
})
