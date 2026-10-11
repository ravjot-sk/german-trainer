import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

// After a deploy, an old check.js from the browser's HTTP cache next to the new app.js marked
// correct recall answers wrong (it read word.german, which new words no longer have).
test('service worker downloads a new version past the HTTP cache', () => {
  assert.match(sw, /new Request\(u, \{ cache: 'reload' \}\)/);
});

// Cache first, so the app opens at once on a weak signal, but only from its own version's
// cache: while a new version waits, its files must not reach the running app.
test('service worker serves files from its own version cache first', () => {
  assert.match(sw, /caches\.open\(VERSION\)\.then\(async \(cache\) => \{\s*const hit = await cache\.match/);
  assert.doesNotMatch(sw, /caches\.match\(/);
});

// A new version waits until the app asks for it, so files never change under a running app.
test('service worker waits to be switched to', () => {
  const install = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('message'"));
  assert.doesNotMatch(install, /skipWaiting/);
  assert.match(sw, /e\.data === 'skipWaiting'\) self\.skipWaiting\(\)/);
});

test('service worker caches every app module for offline use', () => {
  const files = readdirSync(new URL('../js/', import.meta.url), { recursive: true });
  for (const f of files.map(String)) {
    if (f.endsWith('.js')) assert.ok(sw.includes(`'./js/${f.replaceAll('\\', '/')}'`), `${f} missing from SHELL`);
  }
});
