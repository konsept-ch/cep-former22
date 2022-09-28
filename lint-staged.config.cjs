module.exports = {
    '*': 'prettier --ignore-unknown',
    '*.{js,jsx,ts,tsx}': ['eslint --fix', 'prettier --write'],
    '**/*.ts?(x)': () => 'tsc --noEmit',
}
