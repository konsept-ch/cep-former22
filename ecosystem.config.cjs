module.exports = {
    apps: [
        {
            name: 'server',
            script: 'npm.cmd', // use Windows shim so PM2 can spawn correctly
            interpreter: 'none', // do not try to run npm.cmd through node
            watch: ['src', 'prisma', 'bin'],
            ignore_watch: ['node_modules', 'logs'],
            args: 'run ts-node',
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
