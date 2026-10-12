import test from 'node:test';
import assert from 'node:assert/strict';
import de from '../js/i18n/de.js';
import en from '../js/i18n/en.js';

const STRINGS = { de, en };

test('German and English have the same keys', () => {
  assert.deepEqual(Object.keys(de).filter((k) => !(k in en)), [], 'missing in English');
  assert.deepEqual(Object.keys(en).filter((k) => !(k in de)), [], 'missing in German');
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
