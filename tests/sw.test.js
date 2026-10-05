import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

// After a deploy, an old check.js from the browser's HTTP cache next to the new app.js marked
// correct recall answers wrong (it read word.german, which new words no longer have).
test('service worker revalidates app files instead of using the HTTP cache', () => {
  assert.match(sw, /fetch\(e\.request, \{ cache: 'no-cache' \}\)/);
});

test('service worker caches every app module for offline use', () => {
  for (const f of readdirSync(new URL('../js/', import.meta.url))) {
    if (f.endsWith('.js')) assert.ok(sw.includes(`'./js/${f}'`), `${f} missing from SHELL`);
  }
});
