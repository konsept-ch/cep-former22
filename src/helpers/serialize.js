/**
 * File d'attente en memoire : les taches confiees au meme serialiseur s'executent une par
 * une, dans l'ordre d'arrivee. Une tache en echec ne bloque pas les suivantes.
 *
 * Suffisant parce que le middleware tourne dans UN seul processus (PM2, une application en
 * mode fork, `ecosystem.config.cjs`). S'il passe un jour en mode cluster ou sur plusieurs
 * instances, ce verrou ne protege plus rien : il faudra un verrou en base.
 *
 * ⚠️ Une tache ne doit jamais rappeler le meme serialiseur : elle attendrait sa propre fin.
 *
 * docs/90-incidents/2026-11-12-doublon-facture-26381040.md
 */
export const createSerializer = () => {
    let tail = Promise.resolve()

    return (task) => {
        const result = tail.then(() => task())
        tail = result.catch(() => undefined)

        return result
    }
}

/**
 * Toute ecriture qui lit puis attribue un numero de facture, ou qui verifie qu'une
 * inscription n'est pas deja facturee avant de la facturer, passe par ici.
 */
export const serializeInvoiceWrites = createSerializer()
