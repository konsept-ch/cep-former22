/**
 * Tests du script de demarrage qui recree les liens `/data/uploads/*`.
 *
 * Incident du 6 novembre 2026 sur VAL : apres un redeploiement, les liens avaient ete
 * remplaces par des dossiers vides et toute generation d'attestation echouait.
 *
 * docs/20-former22/attestations_generation_reference.md, § « Persistance »
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { linkUploads, UPLOAD_DIRS } from './link-uploads.js'

const STORAGE_DIR = 'aaaaaaaaaaaaaaaaaaaa'

const silentLogger = () => {
    const lines = { info: [], warn: [], error: [] }

    return {
        lines,
        info: (message) => lines.info.push(message),
        warn: (message) => lines.warn.push(message),
        error: (message) => lines.error.push(message),
    }
}

describe('linkUploads', () => {
    let root
    let storageRoot
    let uploadsRoot

    const target = (dir) => path.join(storageRoot, 'data', STORAGE_DIR, dir)
    const link = (dir) => path.join(uploadsRoot, dir)
    const createTargets = () => UPLOAD_DIRS.forEach((dir) => fs.mkdirSync(target(dir), { recursive: true }))
    const run = (logger) => linkUploads({ storageRoot, uploadsRoot, storageDir: STORAGE_DIR, logger })

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'link-uploads-'))
        storageRoot = path.join(root, 'storage')
        uploadsRoot = path.join(root, 'uploads')
    })

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

    it('ne fait rien et avertit si le stockage n est pas monte', () => {
        const logger = silentLogger()

        assert.equal(run(logger), null)
        assert.equal(fs.existsSync(uploadsRoot), false)
        assert.equal(logger.lines.warn.length, 1)
        assert.equal(logger.lines.error.length, 0)
    })

    it('cree les trois liens quand les cibles existent', () => {
        createTargets()

        assert.deepEqual(run(silentLogger()), {
            'attestation-templates': 'linked',
            'contract-templates': 'linked',
            contracts: 'linked',
        })

        for (const dir of UPLOAD_DIRS) {
            assert.ok(fs.lstatSync(link(dir)).isSymbolicLink())
            assert.equal(path.resolve(fs.readlinkSync(link(dir))), path.resolve(target(dir)))
        }
    })

    it('ne touche a rien si les liens sont deja en place', () => {
        createTargets()
        run(silentLogger())

        assert.deepEqual(Object.values(run(silentLogger())), ['unchanged', 'unchanged', 'unchanged'])
    })

    it('remplace un dossier vide, cas observe sur VAL', () => {
        createTargets()
        fs.mkdirSync(link('attestation-templates'), { recursive: true })

        assert.equal(run(silentLogger())['attestation-templates'], 'linked')
        assert.ok(fs.lstatSync(link('attestation-templates')).isSymbolicLink())
    })

    it('laisse un dossier non vide tel quel et journalise une erreur', () => {
        createTargets()
        fs.mkdirSync(link('contracts'), { recursive: true })
        fs.writeFileSync(path.join(link('contracts'), 'local.docx'), 'x')
        const logger = silentLogger()

        const results = run(logger)

        assert.equal(results.contracts, 'non-empty-dir')
        assert.equal(results['attestation-templates'], 'linked')
        assert.ok(fs.lstatSync(link('contracts')).isDirectory())
        assert.ok(fs.existsSync(path.join(link('contracts'), 'local.docx')))
        assert.equal(logger.lines.error.length, 1)
        assert.match(logger.lines.error[0], /non-empty directory/)
    })

    it('ne cree pas de lien vers une cible absente du stockage', () => {
        fs.mkdirSync(storageRoot)
        const logger = silentLogger()

        assert.deepEqual(Object.values(run(logger)), ['missing-target', 'missing-target', 'missing-target'])
        assert.deepEqual(fs.readdirSync(uploadsRoot), [])
        assert.equal(logger.lines.error.length, 3)
    })

    it('remplace un lien qui pointe ailleurs', () => {
        createTargets()
        fs.mkdirSync(uploadsRoot)
        fs.mkdirSync(path.join(root, 'ailleurs'))
        fs.symlinkSync(path.join(root, 'ailleurs'), link('contract-templates'), 'dir')

        assert.equal(run(silentLogger())['contract-templates'], 'linked')
        assert.equal(
            path.resolve(fs.readlinkSync(link('contract-templates'))),
            path.resolve(target('contract-templates'))
        )
    })

    it('refuse un nom de dossier qui sortirait du stockage', () => {
        createTargets()
        const logger = silentLogger()

        assert.equal(linkUploads({ storageRoot, uploadsRoot, storageDir: '../x', logger }), null)
        assert.equal(fs.existsSync(uploadsRoot), false)
    })
})

describe('UPLOAD_DIRS', () => {
    it('reste aligne sur les chemins de src/utils.js', () => {
        const utils = fs.readFileSync(fileURLToPath(new URL('../src/utils.js', import.meta.url)), 'utf8')
        const paths = [...utils.matchAll(/FilesDest = '([^']+)'/g)].map(([, value]) => value)

        assert.deepEqual(paths.sort(), UPLOAD_DIRS.map((dir) => `/data/uploads/${dir}`).sort())
    })
})
