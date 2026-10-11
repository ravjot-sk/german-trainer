import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// i18n.js imports the store, which needs a browser, so the string table is read as text and
// evaluated on its own.
const src = readFileSync(new URL('../js/i18n.js', import.meta.url), 'utf8');
const table = src.match(/const STRINGS = (\{[\s\S]*?\n\});/);
const STRINGS = table && Function(`return ${table[1]}`)();

test('i18n string table can be read', () => {
  assert.ok(STRINGS?.de && STRINGS?.en);
});

test('German and English have the same keys', () => {
  const de = Object.keys(STRINGS.de), en = Object.keys(STRINGS.en);
  assert.deepEqual(de.filter(k => !(k in STRINGS.en)), [], 'missing in English');
  assert.deepEqual(en.filter(k => !(k in STRINGS.de)), [], 'missing in German');
});

test('no UI string is empty', () => {
  for (const l of ['de', 'en']) {
    for (const [k, v] of Object.entries(STRINGS[l])) {
      assert.ok(typeof v === 'string' && v.trim(), `${l}.${k} is empty`);
    }
  }
});

test('placeholders match between languages', () => {
  const vars = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const k of Object.keys(STRINGS.de)) {
    if (k in STRINGS.en) assert.deepEqual(vars(STRINGS.en[k]), vars(STRINGS.de[k]), `placeholders differ for ${k}`);
  }
});
