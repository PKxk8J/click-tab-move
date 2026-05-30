import js from '@eslint/js'

export default [
  {
    ignores: [
      'amo/**',
      'node_modules/**',
      'web-ext-artifacts/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        browser: 'readonly',
        console: 'readonly',
        document: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      semi: ['error', 'never'],
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: {
      semi: ['error', 'never'],
    },
  },
]
