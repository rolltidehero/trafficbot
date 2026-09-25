const parser = require('@typescript-eslint/parser');
const plugin = require('@typescript-eslint/eslint-plugin');
module.exports = [{
  files: ['src/**/*.ts'],
  languageOptions: { parser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } },
  plugins: { '@typescript-eslint': plugin },
  rules: {
    'no-unreachable': 'error',
    'no-constant-condition': 'error',
    'no-unsafe-finally': 'error',
    '@typescript-eslint/no-floating-promises': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  },
}];
