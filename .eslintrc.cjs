module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: {
        sourceType: 'module',
        ecmaFeatures: {
            impliedStrict: true,
        },
    },
    plugins: ['@typescript-eslint', 'import'],
    extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
    env: {
        node: true,
        es2022: true,
    },
    ignorePatterns: ['**/migrations/*.js'],
    rules: {
        eqeqeq: ['error', 'smart'],
        yoda: ['error', 'never', { exceptRange: true }],
        'object-shorthand': 'error',
        'no-console': 'warn',
        'no-duplicate-imports': 'off',
        'no-unsafe-optional-chaining': ['error', { disallowArithmeticOperators: true }],
        'no-lone-blocks': 'error',
        'no-return-assign': 'error',
        'no-self-compare': 'error',
        'no-shadow': 'error',
        'no-undef': 'error',
        'no-undef-init': 'error',
        'no-use-before-define': 'error',
        'no-void': 'error',
        'no-param-reassign': 'error',
        'no-useless-rename': 'error',
        'no-useless-call': 'error',
        'no-useless-concat': 'error',
        'no-plusplus': 'error',
        'no-var': 'error',
        '@typescript-eslint/no-unused-vars': 'error',
        'prefer-rest-params': 'error',
        'prefer-spread': 'error',
        'prefer-arrow-callback': 'error',
        'prefer-const': 'error',
        'prefer-template': 'error',
        'prefer-object-has-own': 'error',
        'import/no-absolute-path': 'error',
        'import/no-self-import': 'error',
        'import/no-cycle': 'error',
        'import/named': 'error',
        'import/no-duplicates': 'warn',
        'import/no-default-export': 'warn',
        'import/no-namespace': 'warn',
    },
}
