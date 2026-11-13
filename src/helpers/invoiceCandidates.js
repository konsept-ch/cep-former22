/**
 * Une inscription ne se facture qu'une fois.
 *
 * `POST /manual-invoices/direct` prend comme candidats les inscriptions et les annulations
 * sans article de facture. Mais une meme inscription peut porter PLUSIEURS annulations :
 * un changement de statut envoye deux fois fait desinscrire deux fois par Claroline, qui
 * enregistre deux lignes dans `claro_cursusbundle_course_session_cancellation`. La seconde
 * n'a pas d'article : elle etait facturee a nouveau. En PROD, les factures 8055, 8057 et
 * 8058 sont la troisieme facture d'une meme annulation.
 *
 * Cette fonction ne garde, dans l'ordre recu, que le premier candidat de chaque inscription
 * (cle `uuid` : l'uuid de l'inscription, y compris pour une annulation), et aucun candidat
 * d'une inscription deja facturee. C'est la regle du changement de statut, qui refuse une
 * seconde facture pour la meme inscription.
 *
 * docs/90-incidents/2026-11-12-doublon-facture-26381040.md
 *
 * @template {{ uuid: string }} T
 * @param {T[]} candidates
 * @param {Iterable<string>} invoicedInscriptionUuids
 * @returns {T[]}
 */
export const keepOneUninvoicedPerInscription = (candidates, invoicedInscriptionUuids) => {
    const taken = new Set(invoicedInscriptionUuids)

    return candidates.filter(({ uuid }) => {
        if (taken.has(uuid)) return false

        taken.add(uuid)

        return true
    })
}
