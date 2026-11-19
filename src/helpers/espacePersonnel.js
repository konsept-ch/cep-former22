/**
 * Creation, a la demande, de l'espace personnel Claroline manquant.
 *
 * Depuis le 9 juin 2026 (Claroline `23a1847a7b`), l'inscription publique passe
 * `NO_PERSONAL_WORKSPACE` : un compte cree par la personne elle-meme n'a aucun espace
 * personnel, donc aucun endroit ou deposer son attestation. Seuls les comptes IAM en ont
 * un. Plutot que d'alourdir la requete d'inscription, deja proche de la limite memoire en
 * production, on cree l'espace au moment ou la generation en a besoin, par la route qui
 * sert le bouton « Créer l'espace personnel » de l'administration Claroline.
 *
 * Ce module ne doit rien importer, pour rester testable sans base ni serveur (meme raison
 * que `attestationsResolvers.js`). Les acces a Claroline et a la base sont injectes.
 */

/**
 * Dit si la reponse de `POST /apiv2/user/pws` contient bien cet utilisateur.
 *
 * Claroline ne renvoie que les utilisateurs qu'il a effectivement traites. Il saute en
 * silence ceux sur lesquels l'appelant n'a pas le droit ADMINISTRATE, c'est-a-dire ceux
 * dont il ne gere pas l'organisation (`UserVoter::checkAdministrate`), et ceux qui ont
 * deja un espace. Une reponse 200 ne prouve donc rien : il faut y trouver l'utilisateur.
 *
 * @param {unknown} reponse
 * @param {string} userUuid
 * @returns {boolean}
 */
export const espacePersonnelCreePour = (reponse, userUuid) =>
    Boolean(userUuid) && Array.isArray(reponse) && reponse.some((utilisateur) => utilisateur?.id === userUuid)

/**
 * Dit si l'echec de Claroline vient d'un espace qui porte deja le code du compte.
 *
 * L'espace personnel prend le `username` comme `code`, unique. Constate le 19.11.2026 sur
 * une copie de la production : 63 des 517 comptes sans espace ont deja un espace a leur
 * code, le plus souvent un espace personnel reste a l'etat modele et rattache a personne
 * (57), parfois l'espace d'un autre compte (5). Claroline repond alors 422
 * « code already exists and should be unique ». Creer un second espace est impossible, et
 * rattacher l'existant sans controle serait dangereux : cela releve d'une reparation.
 *
 * @param {unknown} erreur
 * @returns {boolean}
 */
export const estConflitDeCode = (erreur) =>
    erreur instanceof Error && / 422 /.test(erreur.message) && /code already exists/.test(erreur.message)

/**
 * Rend l'espace personnel de l'utilisateur, en le creant s'il n'existe pas.
 *
 * Un espace qui existe mais n'a pas de racine exploitable n'est pas traite ici : il releve
 * de `docs/80-support/claroline_personal_workspace_repair_runbook.md`, pas d'une creation.
 *
 * @param {object} options
 * @param {object|null|undefined} options.workspace espace deja charge par Prisma
 * @param {string} options.userUuid
 * @param {(userUuid: string) => Promise<unknown>} options.creerEspace appel a Claroline
 * @param {() => Promise<object|null|undefined>} options.relireEspace relecture en base
 * @param {(etape: string, details?: object) => void} [options.journaliser]
 * @returns {Promise<{ workspace: object|null, cree: boolean, refuse: boolean, conflitCode: boolean }>}
 */
export async function assurerEspacePersonnel({
    workspace,
    userUuid,
    creerEspace,
    relireEspace,
    journaliser = () => undefined,
}) {
    if (workspace) {
        return { workspace, cree: false, refuse: false, conflitCode: false }
    }

    journaliser('personal-workspace-missing')

    let reponse
    try {
        reponse = await creerEspace(userUuid)
    } catch (erreur) {
        if (!estConflitDeCode(erreur)) {
            throw erreur
        }

        journaliser('personal-workspace-code-conflict', { message: erreur.message })

        return { workspace: null, cree: false, refuse: false, conflitCode: true }
    }

    if (!espacePersonnelCreePour(reponse, userUuid)) {
        journaliser('personal-workspace-creation-refused', {
            processedUsers: Array.isArray(reponse) ? reponse.length : null,
        })

        return { workspace: null, cree: false, refuse: true, conflitCode: false }
    }

    const relu = (await relireEspace()) ?? null

    journaliser('personal-workspace-created', {
        workspaceId: relu?.id,
        workspaceUuid: relu?.uuid,
    })

    return { workspace: relu, cree: true, refuse: false, conflitCode: false }
}
