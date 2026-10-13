// Minimal lint: catches names that are misspelled, never defined or never used.
// Run with `npm run lint`; CI runs it on every pull request.
import globals from 'globals';

export default [
  { ignores: ['node_modules/'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
  },
  { files: ['js/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['sw.js'], languageOptions: { globals: globals.serviceworker } },
  { files: ['tests/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js'], languageOptions: { globals: globals.node } },
];
