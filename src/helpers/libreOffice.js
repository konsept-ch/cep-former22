/**
 * Conversion DOCX -> PDF par LibreOffice, avec profil utilisateur reutilise.
 *
 * Pourquoi ne pas utiliser `libreoffice-convert` : la bibliotheque cree un profil
 * LibreOffice **neuf a chaque conversion** (`tmp.dirSync({prefix: 'soffice'})`) et le
 * detruit ensuite. LibreOffice refait donc son initialisation de premier lancement a
 * chaque appel. Son option `tmpOptions` ne permet pas de corriger cela : elle s'applique
 * aussi au repertoire de travail, qui doit rester unique.
 *
 * Mesure sur le poste, meme document, meme binaire :
 *
 *     profil neuf a chaque fois : 8 801 / 8 826 / 9 804 ms
 *     profil reutilise          : 8 620 ms la premiere fois, puis 1 401 / 1 359 / 1 408 ms
 *
 * La conversion representait les deux tiers du temps d'une generation d'attestation
 * (11 847 ms sur 17 933 ms mesures de bout en bout).
 *
 * docs/90-incidents/investigation_attestations_che_plantes_2026-09.md
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import util from 'node:util'

// extension explicite : ce module doit rester chargeable par `node --test`,
// qui n'a pas le resolveur de ts-node
import { winstonLogger } from '../winston.js'

const execFileAsync = util.promisify(execFile)

/** Delai au-dela duquel on considere que LibreOffice est bloque. */
const DELAI_CONVERSION_MS = 120_000

/**
 * Le profil est partage entre toutes les conversions du process, et survit aux
 * redemarrages tant que le repertoire temporaire n'est pas nettoye.
 */
const profilPath = path.join(os.tmpdir(), 'cep-former22-soffice-profile')

/** Chemins candidats du binaire, dans l'esprit de libreoffice-convert. */
const cheminsCandidats = () => {
    const surcharge = process.env.SOFFICE_BINARY_PATH

    if (surcharge) {
        return [surcharge]
    }

    switch (process.platform) {
        case 'darwin':
            return ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
        case 'win32':
            return [
                path.join(process.env.PROGRAMFILES ?? '', 'LibreOffice/program/soffice.exe'),
                path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'LibreOffice/program/soffice.exe'),
                path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'LIBREO~1/program/soffice.exe'),
            ]
        default:
            return ['/usr/bin/libreoffice', '/usr/bin/soffice', '/snap/bin/libreoffice']
    }
}

let binaireResolu = null

export const resoudreBinaireSoffice = (candidats = cheminsCandidats(), existe = fs.existsSync) => {
    const trouve = candidats.filter(Boolean).find((candidat) => existe(candidat))

    if (!trouve) {
        throw new Error(
            `Binaire LibreOffice introuvable. Chemins essayes : ${candidats.filter(Boolean).join(', ')}. ` +
                'Definir SOFFICE_BINARY_PATH pour le preciser.'
        )
    }

    return trouve
}

/**
 * LibreOffice pose un verrou sur son profil : deux conversions simultanees sur le meme
 * profil se genent. Les conversions sont donc serialisees dans le process. Elles sont de
 * toute facon liees au processeur, il n'y a rien a gagner a les paralleliser.
 */
export const creerSerialiseur = () => {
    let fileDAttente = Promise.resolve()

    return (tache) => {
        const resultat = fileDAttente.then(tache, tache)

        fileDAttente = resultat.then(
            () => undefined,
            () => undefined
        )

        return resultat
    }
}

const serialiser = creerSerialiseur()

const convertir = async (docxBuffer) => {
    binaireResolu = binaireResolu ?? resoudreBinaireSoffice()
    fs.mkdirSync(profilPath, { recursive: true })

    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'cep-attestation-'))
    const entree = path.join(travail, 'source.docx')
    const sortie = path.join(travail, 'source.pdf')

    try {
        fs.writeFileSync(entree, docxBuffer)

        await execFileAsync(
            binaireResolu,
            [
                `-env:UserInstallation=${pathToFileURL(profilPath)}`,
                '--headless',
                '--convert-to',
                'pdf',
                '--outdir',
                travail,
                entree,
            ],
            { timeout: DELAI_CONVERSION_MS }
        )

        if (!fs.existsSync(sortie)) {
            throw new Error('LibreOffice n a produit aucun PDF.')
        }

        return fs.readFileSync(sortie)
    } finally {
        fs.rmSync(travail, { recursive: true, force: true })
    }
}

/**
 * Convertit un DOCX en PDF.
 *
 * Un profil partage peut rester verrouille ou corrompu si une conversion a ete
 * interrompue — LibreOffice refuserait alors de demarrer jusqu'au redemarrage du
 * conteneur. En cas d'echec, le profil est donc jete et la conversion retentee une fois,
 * ce qui remet le mecanisme dans l'etat d'un premier lancement.
 *
 * @param {Buffer} docxBuffer
 * @returns {Promise<Buffer>}
 */
export const avecRepriseSurEchec = async (tache, reinitialiser, journaliser = () => undefined) => {
    try {
        return await tache()
    } catch (premiereErreur) {
        journaliser(premiereErreur)
        reinitialiser()

        return tache()
    }
}

export const convertDocxToPdf = (docxBuffer) =>
    serialiser(() =>
        avecRepriseSurEchec(
            () => convertir(docxBuffer),
            () => fs.rmSync(profilPath, { recursive: true, force: true }),
            (erreur) =>
                winstonLogger.error(
                    `LibreOffice conversion failed, resetting profile and retrying once: ${erreur?.message}`
                )
        )
    )
