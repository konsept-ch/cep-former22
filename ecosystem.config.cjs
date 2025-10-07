module.exports = {
    apps: [
        {
            name: 'server',
            // On Windows, PM2 tries to execute npm.cmd with Node and crashes unless we disable the interpreter.
            // Using interpreter: 'none' makes PM2 spawn the binary directly (works cross‑platform).
            script: 'npm',
            interpreter: 'none',
            watch: ['src', 'prisma', 'bin'],
            ignore_watch: ['node_modules', 'logs'],
            args: ['run', 'ts-node'],
            env: {
                TZ: 'UTC',
                DEBUG: 'server:*',
                NODE_ENV: 'development',
            },
            env_production: {
                TZ: 'UTC',
                DEBUG: 'server:*',
                NODE_ENV: 'production',
            },
        },
    ],
}
