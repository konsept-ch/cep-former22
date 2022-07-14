module.exports = {
    apps: [
        {
            name: 'middleware',
            script: 'src/index.js',
            watch: ['src', 'prisma'],
            ignore_watch: ['node_modules', 'logs'],
            node_args: '--experimental-specifier-resolution=node',
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
