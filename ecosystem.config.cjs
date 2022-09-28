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
                NODE_ENV: 'development',
            },
            env_production: {
                TZ: 'UTC',
                NODE_ENV: 'production',
            },
        },
    ],
}
