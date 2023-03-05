module.exports = {
    '*': 'prettier --ignore-unknown',
    '*.{js,jsx,ts,tsx}': ['eslint --fix', 'prettier --write'],
}
