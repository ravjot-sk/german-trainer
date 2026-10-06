import test from 'node:test';
import assert from 'node:assert/strict';
import { practicePool, nextPracticeTask, practiceQueue, practiceWeight, newInPool, newFor, wordExercise } from '../js/session.js';
import { gapLevel } from '../js/gappool.js';
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

test('practice reschedules misses, new and due items; early successes only count', () => {
  const early = item('word', 'a');
  for (const grade of ['correct', 'almost']) {
    const r = schedulePractice(early, grade, NOW);
    assert.equal(r.reps, early.reps + 1);
    assert.deepEqual([r.due, r.interval, r.ease, r.lapses], [early.due, early.interval, early.ease, early.lapses]);
    assert.equal(r.lastReviewedAt, NOW);
  }
  // Every right answer counts, also twice on one day.
  assert.equal(schedulePractice(schedulePractice(early, 'correct', NOW), 'correct', NOW + 60e3).reps, early.reps + 2);
  const missed = schedulePractice(early, 'wrong', NOW);
  assert.equal(missed.due, TOMORROW);
  assert.equal(missed.lapses, 1);
  const fresh = schedulePractice(item('word', 'n', { reps: 0, introducedAt: null, due: TOMORROW }), 'correct', NOW);
  assert.equal(fresh.introducedAt, NOW);
  const due = schedulePractice(item('word', 'd', { due: dayStart(NOW) }), 'correct', NOW);
  assert.ok(due.due > TOMORROW);
});

// Runs practice rounds the way runtime.js does: answer each task (right unless answer()
// says otherwise), save it with schedulePractice, requeue a miss once, and start the next
// round (optionally with new words) when the queue runs dry. Returns the item ids shown per round.
function practise({ words, items, rounds = 2, withNew = () => false, answer = () => 'correct', newLimit = 8 }) {
  let its = items;
  const tasks = [];
  const requeued = new Set();
  const shown = [];
  let idx = 0, roundStart = 0, round = 0;
  const pool = () => practicePool(args({ words, items: its }));
  let newIds = newFor(pool(), { withNew: false, limit: newLimit });
  while (round < rounds) {
    tasks.push(...practiceQueue(pool(), { tasks, idx, roundStart, newIds }));
    if (idx >= tasks.length) {
      round++;
      roundStart = tasks.length;
      newIds = newFor(pool(), { withNew: withNew(round), limit: newLimit });
      continue;
    }
    const task = tasks[idx];
    (shown[round] ||= []).push(task.item.itemId);
    const grade = answer(task, requeued.has(task));
    if (!requeued.has(task)) {
      const cur = its.find((x) => x.id === task.item.id);
      its = its.map((x) => (x === cur ? schedulePractice(cur, grade, NOW) : x));
      if (grade === 'wrong') { requeued.add(task); tasks.splice(Math.min(idx + 4, tasks.length), 0, task); }
    }
    idx++;
  }
  return { shown, items: its };
}

test('a practice round shows each item once, then the next round shows them again', () => {
  const words = ['a', 'b', 'c', 'd'].map((id) => word(id));
  const { shown } = practise({ words, items: words.map((w) => item('word', w.id)), rounds: 3 });
  assert.equal(shown.length, 3);
  for (const r of shown) assert.deepEqual([...r].sort(), ['a', 'b', 'c', 'd']);
});

test('the reported bug: one word answered right is not served again within the round', () => {
  const words = [word('taberu', { lang: 'ja' })];
  const { shown, items } = practise({ words, items: [item('word', 'taberu', { reps: 1 })], rounds: 3 });
  assert.deepEqual(shown, [['taberu'], ['taberu'], ['taberu']]);
  assert.equal(items[0].reps, 4); // each right answer made its exercises harder
});

test('a miss comes back once in its round', () => {
  const words = [word('a'), word('b')];
  const { shown } = practise({ words, items: words.map((w) => item('word', w.id)), rounds: 1,
    answer: (task, again) => (task.item.itemId === 'a' && !again ? 'wrong' : 'correct') });
  assert.equal(shown[0].filter((x) => x === 'a').length, 2);
  assert.ok(shown[0].includes('b'));
});

test('words not started yet wait until the learner mixes them in', () => {
  const words = [word('a'), word('b'), word('n1'), word('n2'), word('n3')];
  const items = words.map((w) => item('word', w.id, w.id.startsWith('n') ? { reps: 0, introducedAt: null, due: TOMORROW } : {}));
  const { shown } = practise({ words, items, rounds: 3, newLimit: 2, withNew: (round) => round === 1 });
  assert.deepEqual([...shown[0]].sort(), ['a', 'b']);
  assert.equal(shown[1].filter((x) => x.startsWith('n')).length, 2);
  assert.equal(shown[1].length, 4);
  // Mixed-in words are started now and stay; the one left waits for the next offer.
  assert.deepEqual([...shown[2]].sort(), [...shown[1]].sort());
  // With nothing started yet, the new words are the practice.
  const fresh = practise({ words: [word('n1')], items: [items[2]], rounds: 1 });
  assert.deepEqual(fresh.shown, [['n1']]);
});

test('right practice answers move a word up the exercise ladder and gap levels', () => {
  let it = item('word', 'a', { reps: 0, introducedAt: NOW - 864e5, due: addDays(TOMORROW, 5) });
  const w = word('a', { gapSentence: 'Ich ___ gern.', gapAnswer: 'a' });
  const kinds = [];
  for (let i = 0; i < 7; i++) {
    kinds.push(wordExercise(it, w, true));
    it = schedulePractice(it, 'correct', NOW);
  }
  assert.deepEqual(kinds, ['recall', 'gap', 'recall', 'write', 'gap', 'recall', 'write']);
  assert.deepEqual([0, 3, 6].map(gapLevel), [1, 2, 3]);
});

test('practice skips items it is told to skip, and has nothing left when all are skipped', () => {
  const pool = practicePool(args());
  for (let i = 0; i < 10; i++) assert.equal(nextPracticeTask(pool, [], { skip: new Set(['word:a', 'word:b']) }).item.id, 'word:c');
  assert.equal(nextPracticeTask(pool, [], { skip: new Set(['word:a', 'word:b', 'word:c']) }), null);
  assert.equal(newInPool(practicePool(args())), 0);
});
