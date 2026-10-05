import test from 'node:test';
import assert from 'node:assert/strict';
import { dayStart, addDays } from '../js/srs.js';
import { summarizeDue } from '../js/session.js';

// store.js keeps its data in localStorage, so give it an in-memory one.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const store = await import('../js/store.js');

const NOW = new Date('2026-10-05T09:00:00').getTime();
const due = (now) => summarizeDue({ items: store.reviewItems(), words: store.words('de'), mistakes: store.mistakes('de'),
  reviews: store.reviews('de'), settings: store.getSettings(), gemini: false, now });

test('a word added today counts toward today\'s session', () => {
  store.addWord({ lemma: 'Haus', article: 'das', meaning: 'house', lang: 'de' }, NOW);
  const s = due(NOW + 3600e3);
  assert.equal(s.words, 1);
  assert.equal(s.newWords, 1);
});

test('new items saved by older versions (due tomorrow) still count today', () => {
  const legacy = { id: 'word:x', itemType: 'word', itemId: store.words('de')[0].id, due: addDays(dayStart(NOW), 1),
    interval: 0, ease: 2.5, reps: 0, lapses: 0, introducedAt: null };
  assert.equal(summarizeDue({ items: [legacy], words: store.words('de'), mistakes: [], reviews: [], settings: {}, gemini: false, now: NOW }).words, 1);
});
