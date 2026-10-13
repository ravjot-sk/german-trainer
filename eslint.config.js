// Minimal lint: catches names that are misspelled, never defined or never used, and HTML put
// on the page without html`…`.
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
  {
    files: ['js/**/*.js'],
    languageOptions: { globals: globals.browser },
    rules: {
      // Screens build HTML with html`…` and put it on the page with setHtml (ui/dom.js), so
      // every value is escaped.
      'no-restricted-syntax': ['error', {
        selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
        message: 'Use setHtml(el, html`…`) or replaceHtml from ui/dom.js, so values are escaped.',
      }, {
        selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
        message: 'Use setHtml(el, html`…`) from ui/dom.js, so values are escaped.',
      }],
    },
  },
  { files: ['js/ui/dom.js'], rules: { 'no-restricted-syntax': 'off' } },
  { files: ['sw.js'], languageOptions: { globals: globals.serviceworker } },
  { files: ['tests/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js'], languageOptions: { globals: globals.node } },
];
