/**
 * Cree, au demarrage du conteneur, les liens `/data/uploads/*` vers le stockage partage.
 *
 * Le code attend ses fichiers sous `/data/uploads/` (`src/utils.js` :
 * `attestationTemplateFilesDest`, `contractTemplateFilesDest`, `contractFilesDest`). Sur
 * Jelastic, ces fichiers vivent sur l'Extra Storage de Claroline, monte en `/data/storage`.
 * Les liens etaient crees a la main dans le conteneur et se perdaient a chaque redeploiement :
 * au demarrage suivant, `multer({ dest })` recreait des dossiers vides a leur place.
 * Constate sur VAL le 6 novembre 2026.
 *
 * Regles, pour chaque lien :
 * - deja le bon lien : rien ;
 * - absent, dossier vide ou lien vers une autre cible : remplace par le bon lien ;
 * - dossier non vide ou fichier : erreur journalisee, rien n'est touche ;
 * - cible absente du stockage : erreur journalisee, rien n'est touche.
 * Si `/data/storage` n'existe pas (local, CI), simple avertissement.
 *
 * Le script ne fait jamais echouer le demarrage : il sort toujours avec le code 0.
 *
 * docs/20-former22/attestations_generation_reference.md, § « Persistance »
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_STORAGE_ROOT = '/data/storage'
export const DEFAULT_UPLOADS_ROOT = '/data/uploads'
/** Dossier de plateforme Claroline sous `files/data/`. Identique sur VAL et PROD. */
export const DEFAULT_STORAGE_DIR = 'aaaaaaaaaaaaaaaaaaaa'
/** Doit rester aligne sur les trois constantes de `src/utils.js`. */
export const UPLOAD_DIRS = ['attestation-templates', 'contract-templates', 'contracts']

const PREFIX = '[link-uploads]'

/* eslint-disable no-console */
const consoleLogger = {
    info: (message) => console.log(`${PREFIX} ${message}`),
    warn: (message) => console.warn(`${PREFIX} WARNING ${message}`),
    error: (message) => console.error(`${PREFIX} ERROR ${message}`),
}
/* eslint-enable no-console */

const isValidDirName = (name) => typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name) && !/^\.+$/.test(name)

const linkOne = ({ linkPath, target, logger }) => {
    if (!fs.existsSync(target)) {
        logger.error(`${target} does not exist on the storage: ${linkPath} left untouched.`)

        return 'missing-target'
    }

    let stats = null

    try {
        stats = fs.lstatSync(linkPath)
    } catch (error) {
        if (error.code !== 'ENOENT') throw error
    }

    if (stats?.isSymbolicLink()) {
        const current = fs.readlinkSync(linkPath)

        if (path.resolve(path.dirname(linkPath), current) === path.resolve(target)) {
            logger.info(`${linkPath} -> ${target} already in place.`)

            return 'unchanged'
        }

        // Un lien ne porte aucune donnee : le remplacer ne perd rien.
        logger.warn(`${linkPath} pointed to ${current}, replacing it.`)
        fs.unlinkSync(linkPath)
    } else if (stats?.isDirectory()) {
        if (fs.readdirSync(linkPath).length > 0) {
            logger.error(
                `${linkPath} is a non-empty directory, left untouched. ` +
                    `Files are read from it instead of ${target}. ` +
                    'Move its content aside by hand, then restart the container.'
            )

            return 'non-empty-dir'
        }

        // rmdir echoue si le dossier n'est pas vide ou s'il est un point de montage.
        fs.rmdirSync(linkPath)
    } else if (stats) {
        logger.error(`${linkPath} exists and is neither a directory nor a link, left untouched.`)

        return 'not-a-dir'
    }

    fs.symlinkSync(target, linkPath, 'dir')
    logger.info(`${linkPath} -> ${target} created.`)

    return 'linked'
}

/**
 * @returns {Record<string, string> | null} statut par dossier, ou `null` si rien n'a ete tente
 */
export const linkUploads = ({
    storageRoot = DEFAULT_STORAGE_ROOT,
    uploadsRoot = DEFAULT_UPLOADS_ROOT,
    storageDir = DEFAULT_STORAGE_DIR,
    logger = consoleLogger,
} = {}) => {
    if (!isValidDirName(storageDir)) {
        logger.error(`UPLOADS_STORAGE_DIR="${storageDir}" is not a valid directory name, no link created.`)

        return null
    }

    if (!fs.existsSync(storageRoot)) {
        logger.warn(`${storageRoot} is not mounted, no link created. Expected in local and CI, not on Jelastic.`)

        return null
    }

    fs.mkdirSync(uploadsRoot, { recursive: true })

    const results = {}

    for (const dir of UPLOAD_DIRS) {
        const linkPath = path.join(uploadsRoot, dir)
        const target = path.join(storageRoot, 'data', storageDir, dir)

        try {
            results[dir] = linkOne({ linkPath, target, logger })
        } catch (error) {
            logger.error(`${linkPath}: ${error.message}`)
            results[dir] = 'failed'
        }
    }

    return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        linkUploads({ storageDir: process.env.UPLOADS_STORAGE_DIR || DEFAULT_STORAGE_DIR })
    } catch (error) {
        consoleLogger.error(error.message)
    }
}
