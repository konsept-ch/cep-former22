/**
 * Resolutions pures du flux attestation, isolees pour etre testables sans base ni serveur.
 *
 * Ce module ne doit rien importer : `helpers/attestations.js` tire `prisma` depuis `..`,
 * donc l'importer demarre l'application Express entiere. Les tests de non-regression
 * ciblent ce fichier-ci.
 *
 * Contexte : docs/90-incidents/investigation_attestations_che_plantes_2026-09.md
 */

export const ATTESTATIONS_FOLDER_NAME = 'Mes attestations'

/**
 * Rend la racine de l'espace personnel parmi les noeuds d'un workspace.
 *
 * `claro_workspace.claro_resource_node` porte TOUS les noeuds du workspace, pas sa racine.
 * L'ancien code prenait `[0]`, ce qui revient a faire confiance a l'ordre de stockage de
 * MySQL. La racine est le noeud sans parent.
 *
 * @param {Array<{ parent_id: number|null, uuid: string }>|null|undefined} nodes
 * @returns {object|null}
 */
export const resolvePersonalRootNode = (nodes) => {
    if (!Array.isArray(nodes)) {
        return null
    }

    const racines = nodes.filter(({ parent_id: parentId }) => parentId == null)

    if (racines.length === 0) {
        return null
    }

    // 9 espaces personnels de la base de production portent plusieurs racines, jusqu'a
    // quatre. Prendre la premiere rendue resterait arbitraire : on retient la plus
    // ancienne, seul choix reproductible.
    return racines.reduce((plusAncienne, candidate) =>
        Number(candidate.id) < Number(plusAncienne.id) ? candidate : plusAncienne
    )
}

/**
 * Rend l'attestation deja deposee pour cette session, s'il y en a une.
 *
 * Le flux historique creait une nouvelle ressource a chaque appel, d'ou les attestations
 * en trois ou quatre exemplaires constatees sur CHE/26/03. La ressource porte le nom de
 * la session : c'est ce qui permet de reconnaitre un depot deja fait.
 *
 * @param {Array<{ name: string }>|null|undefined} resources contenu du dossier
 * @param {string} sessionName
 * @returns {object|null}
 */
export const findExistingAttestation = (resources, sessionName) => {
    if (!Array.isArray(resources) || !sessionName) {
        return null
    }

    return resources.find(({ name }) => name === sessionName) ?? null
}

/**
 * Rend le dossier `Mes attestations` parmi les enfants de la racine personnelle.
 *
 * @param {Array<{ name: string }>|null|undefined} resources
 * @returns {object|null}
 */
export const findAttestationsFolder = (resources) => {
    if (!Array.isArray(resources)) {
        return null
    }

    return resources.find(({ name }) => name === ATTESTATIONS_FOLDER_NAME) ?? null
}
