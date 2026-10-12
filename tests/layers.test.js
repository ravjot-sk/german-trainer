import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';

// Imports point one way: core (data, Gemini, background jobs) ← ui (shared screen pieces)
// ← practice ← views ← app.js, which starts it all. router.js is a shared ui piece.
const root = new URL('../js/', import.meta.url);
const files = readdirSync(root, { recursive: true }).map((f) => String(f).replaceAll('\\', '/')).filter((f) => f.endsWith('.js'));
const layer = (f) => (f === 'app.js' ? 'app' : f.startsWith('views/') ? 'views' : f.startsWith('practice/') ? 'practice'
  : f.startsWith('ui/') || f === 'router.js' ? 'ui' : 'core');
const RANK = { core: 0, ui: 1, practice: 2, views: 3, app: 4 };

function importsOf(f) {
  const src = readFileSync(new URL(f, root), 'utf8');
  return [...src.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => posix.normalize(posix.join(posix.dirname(f), m[1])));
}

test('modules only import from their own layer or a lower one', () => {
  const wrong = [];
  for (const f of files) {
    for (const dep of importsOf(f)) {
      if (RANK[layer(dep)] > RANK[layer(f)]) wrong.push(`${f} → ${dep}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('the layer check sees the imports', () => {
  assert.ok(importsOf('background.js').includes('appstate.js'));
});

// Loading the data, the strings, Gemini and the background jobs touches nothing on the device;
// only store.init() does, which app.js calls first.
test('core modules read nothing from the device when imported', async () => {
  const reads = [];
  globalThis.localStorage = {
    getItem: (k) => { reads.push(k); return null; },
    setItem: (k) => { reads.push(k); },
    removeItem: (k) => { reads.push(k); },
  };
  const store = await import('../js/store.js');
  await import('../js/i18n.js');
  await import('../js/gemini.js');
  await import('../js/background.js');
  assert.deepEqual(reads, []);
  store.init();
  assert.ok(reads.includes('gt.settings.v1'));
});
