module.exports = {
    apps: [
        {
            name: 'server',
            script: 'npm',
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
