import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, dayStart } from '../js/srs.js';
import { trimReviews, KEEP_DAYS } from '../js/reviews.js';
import { categoryStats } from '../js/stats.js';
import { nextDrillKind, practicePool } from '../js/session.js';

const NOW = new Date('2026-10-11T10:00:00').getTime();
let n = 0;
const rev = (item, daysAgo, o = {}) => ({ id: `r${n++}`, reviewItemId: item, reviewedAt: NOW - daysAgo * DAY, lang: 'de', correct: true, ...o });

test('trim: keeps the last 90 days, the latest per item and the last 10 drills per category', () => {
  const old = Array.from({ length: 15 }, (_, i) => rev('category:de:cases', 200 - i, { category: 'cases', exerciseType: 'gapfill' }));
  const word = [rev('word:a', 300), rev('word:a', 150), rev('word:b', 120)];
  const recent = [rev('word:a', 10), rev('word:c', 0)];
  const all = [...old, ...word, ...recent];
  const kept = trimReviews(all, NOW);
  // 10 newest of the 15 old drills, word:b's only review, and the recent ones.
  assert.deepEqual(kept.map((r) => r.id), [...old.slice(5), word[2], ...recent].map((r) => r.id));
  assert.ok(!kept.includes(word[0]) && !kept.includes(word[1]));
});

test('trim: nothing older than the cutoff leaves the list as it is, and running twice changes nothing', () => {
  const list = [rev('word:a', KEEP_DAYS - 1), rev('word:b', 1)];
  assert.equal(trimReviews(list, NOW), list);
  const mixed = [rev('word:a', 400), rev('word:a', 300), rev('word:a', 1)];
  const once = trimReviews(mixed, NOW);
  assert.deepEqual(trimReviews(once, NOW), once);
});

test('trim: categories are kept per language', () => {
  const de = Array.from({ length: 12 }, (_, i) => rev('category:de:cases', 200 - i, { category: 'cases' }));
  const ja = Array.from({ length: 3 }, (_, i) => rev('category:ja:particles', 200 - i, { category: 'particles', lang: 'ja' }));
  const kept = trimReviews([...de, ...ja], NOW);
  assert.equal(kept.filter((r) => r.lang === 'de').length, 10);
  assert.equal(kept.filter((r) => r.lang === 'ja').length, 3);
});

test('trim: profile numbers, today counts and practice weighting stay the same', () => {
  const cats = [{ id: 'cases' }, { id: 'word_order' }];
  const reviews = [
    ...Array.from({ length: 30 }, (_, i) => rev('category:de:cases', 365 - i * 5, { category: 'cases', correct: i % 3 > 0 })),
    ...Array.from({ length: 4 }, (_, i) => rev('category:de:word_order', 100 - i, { category: 'word_order', correct: i % 2 === 0 })),
    rev('word:w1', 200), rev('word:w1', 0.1), rev('word:w2', 250),
  ];
  const kept = trimReviews(reviews, NOW);
  assert.ok(kept.length < reviews.length);
  const stats = (list) => categoryStats({ mistakes: [], reviews: list, cats, lang: 'de', now: NOW });
  assert.deepEqual(stats(kept), stats(reviews));
  const today = (list) => list.filter((r) => r.reviewedAt >= dayStart(NOW)).length;
  assert.equal(today(kept), today(reviews));
  const items = ['w1', 'w2'].map((id) => ({ id: `word:${id}`, itemType: 'word', itemId: id, reps: 3, due: NOW + 5 * DAY, interval: 5 }));
  const words = [{ id: 'w1', lemma: 'gehen', meaning: 'go' }, { id: 'w2', lemma: 'laufen', meaning: 'run' }];
  const weights = (list) => practicePool({ items, words, mistakes: [], reviews: list, gemini: false, now: NOW }).map((p) => p.weight);
  assert.deepEqual(weights(kept), weights(reviews));
});

test('drills take turns after the last one practised', () => {
  assert.equal(nextDrillKind(null), 'gapfill');
  assert.equal(nextDrillKind({ exerciseType: 'gapfill' }), 'transform');
  assert.equal(nextDrillKind({ exerciseType: 'transform' }), 'constraint');
  assert.equal(nextDrillKind({ exerciseType: 'constraint' }), 'gapfill');
  assert.equal(nextDrillKind({ exerciseType: 'recall' }), 'gapfill');
});
