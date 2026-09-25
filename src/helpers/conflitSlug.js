/**
 * Reprise sur echec transitoire lors d'une creation de ressource Claroline.
 *
 * Pourquoi : `claro_resource_node.slug` est unique sur TOUTE la base. L'extension Gedmo
 * calcule le prochain suffixe libre en lisant les slugs existants, puis insere. Entre la
 * lecture et l'insertion, une autre requete peut calculer le meme suffixe : la seconde
 * echoue sur
 * `Duplicate entry '<slug>' for key 'claro_resource_node.UNIQ_A76799FF989D9B62'`
 * et Claroline rend HTTP 500.
 *
 * Reproduit en local le 25.09.2026 : dix creations simultanees portant le meme nom,
 * **huit collisions sur dix**. La famille `mes-attestations-*` compte 17 5xx entrees.
 *
 * ⚠️ **On ne peut pas reconnaitre la collision au contenu de la reponse.** Claroline
 * tourne en mode production : le corps du 500 est la page generique de Symfony,
 * « Oops! An Error Occurred », 918 octets, qui ne mentionne ni `Duplicate entry` ni
 * `SQLSTATE`. Verifie sur une reponse reelle. Le seul signal exploitable est donc le
 * **statut HTTP**, que `callApi` place dans le message de l'erreur qu'il leve.
 *
 * Rejouer est sans danger : la violation de contrainte se produit a l'INSERT, la
 * transaction est annulee, rien n'a ete cree. Une erreur qui n'est pas un 5xx — droits,
 * ressource parente absente, espace personnel incomplet — n'est pas transitoire et
 * remonte immediatement.
 *
 * docs/90-incidents/investigation_attestations_che_plantes_2026-09.md
 */

/** Nombre de tentatives supplementaires apres un premier echec. */
export const TENTATIVES_SUPPLEMENTAIRES = 3

/**
 * Une erreur de creation vaut-elle la peine d'etre rejouee ?
 *
 * @param {unknown} erreur telle que levee par `callApi`
 * @returns {boolean}
 */
export const estEchecTransitoire = (erreur) => {
    const message = String(erreur?.message ?? '')

    if (!message) {
        return false
    }

    // Cas nominal : Claroline en mode production ne dit rien de plus que le statut.
    if (/returned 5\d\d\b/.test(message)) {
        return true
    }

    // Cas ou le detail remonte malgre tout — mode debug, ou journal joint au message.
    return (
        /Duplicate entry/i.test(message) ||
        /UniqueConstraintViolation/i.test(message) ||
        /SQLSTATE\[23000\]/i.test(message)
    )
}

const pause = (ms) =>
    new Promise((resoudre) => {
        setTimeout(resoudre, ms)
    })

/**
 * Rejoue une creation de ressource tant qu'elle echoue de facon transitoire.
 *
 * @param {() => Promise<any>} creer
 * @param {object} options
 * @param {(tentative: number, erreur: Error) => void} [options.journaliser]
 * @param {(ms: number) => Promise<void>} [options.attendre] injectable pour les tests
 * @param {number} [options.tentatives]
 */
export const creerAvecRepriseSurConflit = async (
    creer,
    { journaliser = () => undefined, attendre = pause, tentatives = TENTATIVES_SUPPLEMENTAIRES } = {}
) => {
    let derniereErreur = null

    for (let tentative = 0; tentative <= tentatives; tentative += 1) {
        try {
            return await creer()
        } catch (erreur) {
            if (!estEchecTransitoire(erreur)) {
                throw erreur
            }

            derniereErreur = erreur
            journaliser(tentative + 1, erreur)

            if (tentative < tentatives) {
                // recul croissant et desynchronise : deux requetes en collision ne doivent
                // pas rejouer au meme instant
                await attendre(50 * 2 ** tentative + Math.floor(Math.random() * 50))
            }
        }
    }

    throw derniereErreur
}
