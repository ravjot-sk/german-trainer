import test from 'node:test';
import assert from 'node:assert/strict';
import { practicePool, nextPracticeTask, practiceWeight } from '../js/session.js';
import { dayStart, addDays, schedulePractice } from '../js/srs.js';

const NOW = new Date('2026-10-05T10:00:00').getTime();
const TOMORROW = addDays(dayStart(NOW), 1);
const word = (id, o = {}) => ({ id, lang: 'de', lemma: id, meaning: id, pos: 'other', ...o });
const item = (itemType, itemId, o = {}) => ({ id: `${itemType}:${itemId}`, itemType, itemId, due: addDays(TOMORROW, 5),
  interval: 6, ease: 2.5, reps: 2, lapses: 0, introducedAt: NOW - 10 * 864e5, lastReviewedAt: NOW - 864e5, ...o });

function args(o = {}) {
  const words = o.words || ['a', 'b', 'c'].map((id) => word(id));
  return { items: o.items || words.map((w) => item('word', w.id)), words, mistakes: o.mistakes || [], reviews: o.reviews || [],
    gemini: o.gemini ?? false, drillable: o.drillable || ['de:case'], now: NOW, focus: o.focus || 'mix' };
}

test('practice draws from words that are not due', () => {
  const pool = practicePool(args());
  assert.equal(pool.length, 3);
  const task = nextPracticeTask(pool, [], { random: () => 0 });
  assert.equal(task.word.id, 'a');
  assert.ok(['recall', 'gap'].includes(task.kind));
});

test('new words can start in practice beyond the daily cap', () => {
  const words = [word('n1'), word('n2')];
  const items = words.map((w) => item('word', w.id, { reps: 0, introducedAt: null, lastReviewedAt: undefined, due: TOMORROW }));
  assert.equal(practicePool(args({ words, items })).length, 2);
});

test('recent tasks are not repeated while others are left', () => {
  const pool = practicePool(args());
  for (let i = 0; i < 20; i++) {
    const task = nextPracticeTask(pool, ['word:a', 'word:b'], { random: Math.random });
    assert.equal(task.item.id, 'word:c');
  }
  // A pool of one keeps going.
  const one = practicePool(args({ words: [word('x')] }));
  assert.equal(nextPracticeTask(one, ['word:x']).item.id, 'word:x');
  assert.equal(nextPracticeTask([], []), null);
});

test('weak, recently missed and due items weigh more', () => {
  const calm = practiceWeight(item('word', 'a', { lastReviewedAt: NOW }), null, NOW);
  const missed = practiceWeight(item('word', 'a', { lastReviewedAt: NOW }), { correct: false, reviewedAt: NOW - 3600e3 }, NOW);
  const due = practiceWeight(item('word', 'a', { lastReviewedAt: NOW, due: dayStart(NOW) }), null, NOW);
  const lapsed = practiceWeight(item('word', 'a', { lastReviewedAt: NOW, lapses: 3 }), null, NOW);
  assert.ok(missed > calm && due > calm && lapsed > calm);
});

const rule = { lang: 'de', category: 'verb_complex', key: 'perfekt_sein', name: 'Perfekt mit sein', statement: '', level: 'A2' };

test('focus filters the pool', () => {
  const words = [word('w'), word('s', { kind: 'sentence', chunks: ['Ich', 'gehe.'] })];
  const mistakes = [{ id: 'm1', lang: 'de', category: 'case', createdAt: NOW, source: 'correction' }];
  const items = [...words.map((w) => item('word', w.id)), item('rule', 'verb_complex/perfekt_sein', { rule, rung: 2 }),
    item('category', 'de:case'), item('category', 'de:verb_complex')];
  const pool = (focus, gemini = true) => practicePool(args({ words, items, mistakes, gemini, focus,
    drillable: ['de:case', 'de:verb_complex'] })).map((x) => x.item.id).sort();
  assert.deepEqual(pool('words'), ['word:w']);
  assert.deepEqual(pool('sentences'), ['word:s']);
  // A category with rules is practised through them, not as a whole.
  assert.deepEqual(pool('grammar'), ['category:de:case', 'rule:verb_complex/perfekt_sein']);
  assert.deepEqual(pool('grammar', false), []);
  // Only the category with mistakes is weak; the words and the rule were never missed.
  assert.deepEqual(pool('weak'), ['category:de:case']);
});

test('the mix puts grammar after two vocabulary tasks', () => {
  const words = [word('a'), word('b'), word('c')];
  const items = [...words.map((w) => item('word', w.id)), item('rule', 'verb_complex/perfekt_sein', { rule, rung: 3 })];
  const pool = practicePool(args({ words, items, gemini: true }));
  const task = nextPracticeTask(pool, ['word:a', 'word:b']);
  assert.equal(task.kind, 'rule');
  assert.equal(task.ruleKind, 'transform');
  assert.ok(nextPracticeTask(pool, ['word:a', 'rule:verb_complex/perfekt_sein']).word);
});

test('practice reschedules misses, new and due items, but not early successes', () => {
  const early = item('word', 'a');
  assert.equal(schedulePractice(early, 'correct', NOW), early);
  assert.equal(schedulePractice(early, 'almost', NOW), early);
  const missed = schedulePractice(early, 'wrong', NOW);
  assert.equal(missed.due, TOMORROW);
  assert.equal(missed.lapses, 1);
  const fresh = schedulePractice(item('word', 'n', { reps: 0, introducedAt: null, due: TOMORROW }), 'correct', NOW);
  assert.equal(fresh.introducedAt, NOW);
  const due = schedulePractice(item('word', 'd', { due: dayStart(NOW) }), 'correct', NOW);
  assert.ok(due.due > TOMORROW);
});
