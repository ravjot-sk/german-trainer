import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, checkRecall, gapFor, wordDiff, needsPlural } from '../js/check.js';
import { catKey, parseCatKey, recLang, lemmaOf, describe } from '../js/languages.js';
import { categoriesFor, finishCategories, categoryLabel, drillableIds } from '../js/categories.js';
import { buildSession } from '../js/session.js';
import { dayStart } from '../js/srs.js';

// store.js reads localStorage when it loads.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const store = await import('../js/store.js');

const NOW = new Date('2026-10-05T10:00:00').getTime();

test('Japanese answers ignore spaces, full-width forms and Japanese punctuation', () => {
  assert.equal(compare('食べる。', '食べる'), 'correct');
  assert.equal(compare('私は 学生です', '私は学生です'), 'correct');
  assert.equal(compare('「はい」', 'はい'), 'correct');
  assert.equal(compare('ＡＢＣ１', 'ABC1'), 'correct');
  assert.equal(compare('食べた', '食べる'), 'wrong');
});

test('Japanese recall: kanji form is correct, the kana reading alone is almost', () => {
  const w = { lang: 'ja', lemma: '食べる', reading: 'たべる', recallAnswer: '食べる', pos: 'verb' };
  assert.equal(checkRecall(w, '食べる', '').grade, 'correct');
  const r = checkRecall(w, 'たべる', '');
  assert.equal(r.grade, 'almost');
  assert.ok(r.byReading);
  assert.equal(checkRecall(w, 'のむ', '').grade, 'wrong');
  // A word normally written in kana: the reading is the answer.
  const k = { lang: 'ja', lemma: 'ありがとう', reading: 'ありがとう', recallAnswer: 'ありがとう', pos: 'phrase' };
  assert.equal(checkRecall(k, 'ありがとう', '').grade, 'correct');
});

test('other languages recall against recallAnswer, with article when they have one', () => {
  const w = { lang: 'es', lemma: 'mesa', article: 'la', pos: 'noun', recallAnswer: 'la mesa', plural: 'mesas' };
  assert.equal(checkRecall(w, 'la mesa', '').grade, 'correct');
  assert.equal(checkRecall(w, 'el mesa', '').grade, 'wrong');
  assert.ok(!needsPlural({ ...w, lang: 'es', plural: '' }));
  // Without recallAnswer (added by hand), article + lemma.
  assert.equal(checkRecall({ ...w, recallAnswer: '' }, 'la mesa', '').grade, 'correct');
});

test('German words saved before the rename still work', () => {
  const old = { german: 'Kollege', article: 'der', pos: 'noun', plural: 'Kollegen' };
  assert.equal(lemmaOf(old), 'Kollege');
  assert.equal(recLang(old), 'de');
  assert.equal(checkRecall(old, 'der Kollege', 'Kollegen').grade, 'correct');
});

test('gap sentences and diffs work without spaces', () => {
  const g = gapFor({ lang: 'ja', lemma: '会議', contextSentence: '明日は会議があります。' });
  assert.deepEqual(g, { sentence: '明日は___があります。', answer: '会議' });
  // An inflected verb can't be found locally; the exercise falls back to recall.
  assert.equal(gapFor({ lang: 'ja', lemma: '食べる', example: '昨日すしを食べました。' }), null);
  const d = wordDiff('私は学生です', '私が学生です');
  assert.deepEqual(d, [
    { type: 'same', text: '私' }, { type: 'del', text: 'は' }, { type: 'add', text: 'が' }, { type: 'same', text: '学生です' },
  ]);
});

test('category keys: German stays bare, other languages are prefixed', () => {
  assert.equal(catKey('de', 'adjective_endings'), 'adjective_endings');
  assert.equal(catKey('ja', 'particles'), 'ja:particles');
  assert.deepEqual(parseCatKey('ja:particles'), { lang: 'ja', id: 'particles' });
  assert.deepEqual(parseCatKey('adjective_endings'), { lang: 'de', id: 'adjective_endings' });
});

test('each language has its own category list', () => {
  assert.ok(categoriesFor(describe('ja')).some((c) => c.id === 'particles'));
  assert.ok(categoriesFor(describe('de')).some((c) => c.id === 'adjective_endings'));
  assert.equal(categoryLabel('particles', 'en', categoriesFor(describe('ja'))), 'Particles');
  const es = finishCategories([
    { id: 'Ser vs Estar', en: 'Ser vs estar', de: 'Ser oder estar' },
    { id: 'ser_vs_estar', en: 'duplicate' },
    { id: 'spelling', en: 'Spelling' },
    { en: '' },
  ]);
  assert.deepEqual(es.map((c) => c.id), ['ser_vs_estar', 'word_choice', 'register', 'spelling', 'other']);
  assert.deepEqual(drillableIds(es), ['ser_vs_estar', 'word_choice', 'register', 'spelling']);
});

test('levels are never assumed', () => {
  assert.equal(describe('de').level, undefined);
  assert.equal(describe('ja').level, undefined);
  assert.equal(describe('ja', { id: 'ja', level: 'JLPT N4' }).level, 'JLPT N4');
  assert.ok(describe('ja').levels.includes('JLPT N5'));
  assert.equal(describe('xx'), null);
});

test('a Japanese session drills Japanese categories only', () => {
  const item = (o) => ({ id: Math.random().toString(36), due: dayStart(NOW), interval: 0, ease: 2.5, reps: 0, lapses: 0, ...o });
  const items = [item({ itemType: 'category', itemId: 'ja:particles' }), item({ itemType: 'category', itemId: 'adjective_endings' })];
  const drillable = drillableIds(categoriesFor(describe('ja'))).map((id) => catKey('ja', id));
  const tasks = buildSession({ items, words: [], mistakes: [], reviews: [], settings: {}, gemini: true, drillable, now: NOW });
  assert.deepEqual(tasks.map((t) => t.category), ['particles']);
});

test('store: legacy data is German, and each language keeps its own words and categories', () => {
  store._setData({ words: [{ id: 'w1', german: 'Tisch', article: 'der', pos: 'noun', meaning: 'table' }] });
  assert.equal(store.activeLanguage().code, 'de');
  assert.equal(store.activeLanguage().level, undefined);
  store.saveLanguage('de', { level: 'B2' });
  assert.equal(store.activeLanguage().level, 'B2');

  store.setActiveLanguage('ja');
  assert.equal(store.activeLanguage().code, 'ja');
  assert.equal(store.activeLanguage().level, undefined);
  const { word } = store.addWord({ lang: 'ja', lemma: '机', reading: 'つくえ', meaning: 'desk' });
  assert.equal(store.words('ja').length, 1);
  assert.equal(store.words('de').length, 1);
  assert.equal(store.findWord('Tisch', 'ja'), null);
  assert.equal(store.findWord('der Tisch', 'de').id, 'w1');
  assert.equal(store.addWord({ lang: 'ja', lemma: '机' }).created, false);

  store.addMistakes([{ original: 'を', corrected: 'が', category: 'particles' }], 'correction', 'ja');
  assert.ok(store.reviewItemFor('category', 'ja:particles'));
  assert.equal(store.mistakes('ja').length, 1);
  assert.equal(store.mistakes('de').length, 0);

  store.updateWord('w1', { lemma: 'Tisch' });
  assert.equal('german' in store.getWord('w1'), false);
  assert.equal(word.lang, 'ja');
  store.setActiveLanguage(undefined);
});
