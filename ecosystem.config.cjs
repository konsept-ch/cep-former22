module.exports = {
    apps: [
        {
            name: 'server',
            script: 'src/index.js',
            watch: ['src', 'prisma'],
            ignore_watch: ['node_modules', 'logs'],
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
