module.exports = {
    '*': 'prettier --ignore-unknown',
    '*.{js,jsx}': ['eslint --fix', 'prettier --write'],
}
