// Safely install Husky only when a Git repository is present.
// Also supports subfolders by searching upwards for .git and
// pointing Husky at the correct git dir via HUSKY_GIT_DIR.

/* eslint-disable no-console */
import fs from 'fs'
import path from 'path'

function findGitDir(startDir) {
    let dir = startDir
    for (let i = 0; i < 5; i += 1) {
        const gitPath = path.join(dir, '.git')
        if (fs.existsSync(gitPath)) return gitPath
        const parent = path.dirname(dir)
        if (parent === dir) break
        dir = parent
    }
    return null
}

try {
    // Skip entirely in CI environments
    if (process.env.CI) {
        console.log('husky: skipping install in CI')
        process.exit(0)
    }
    const gitDir = findGitDir(process.cwd())
    if (!gitDir) {
        console.log('husky: skipping install (no .git found)')
        process.exit(0)
    }

    // Change CWD to the Git root so husky installs hooks in the right place
    const gitRoot = path.dirname(gitDir)
    const prevCwd = process.cwd()
    process.chdir(gitRoot)

    // Attempt install; ignore if husky is not installed
    try {
        const mod = await import('husky')
        const husky = mod && (mod.default || mod)
        if (husky && typeof husky.install === 'function') {
            husky.install()
            console.log(`husky: installed at repo root ${gitRoot}`)
        } else if (typeof husky === 'function') {
            // Older husky versions export a function
            husky()
            console.log(`husky: installed (legacy export) at repo root ${gitRoot}`)
        } else {
            console.log('husky: module loaded but no install function, skipping')
        }
    } catch (e) {
        // Handle both CommonJS and ESM missing-module error codes
        if (e && (e.code === 'MODULE_NOT_FOUND' || e.code === 'ERR_MODULE_NOT_FOUND')) {
            console.log('husky: not installed as a dependency, skipping')
        } else {
            throw e
        }
    } finally {
        try {
            process.chdir(prevCwd)
        } catch (_) {
            // no-op: restore CWD best-effort
            /* eslint-disable-next-line no-void */
            void 0
        }
    }
} catch (err) {
    console.error('husky: install failed')
    throw err
}
