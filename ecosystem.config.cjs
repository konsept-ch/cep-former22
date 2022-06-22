module.exports = {
    apps: [
        {
            name: 'middleware',
            script: 'src/index.js',
            watch: ['src', 'prisma'],
            ignore_watch: ['node_modules', 'logs'],
            node_args: '--experimental-specifier-resolution=node',
        },
    ],
}
