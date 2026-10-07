import test from 'node:test';
import assert from 'node:assert/strict';
import { dayStart, addDays } from '../js/srs.js';
import { newRuleItem } from '../js/rules.js';
import { ruleCompare, transformGrade, strictGrade, ownMistake, followUpIds, answerRecord, requeueAt } from '../js/answer.js';

const NOW = new Date('2026-10-06T10:00:00').getTime();
const TODAY = dayStart(NOW);
const wordItem = (o = {}) => ({ id: 'word:w1', itemType: 'word', itemId: 'w1', due: TODAY, interval: 0, ease: 2.5, reps: 0, lapses: 0, ...o });
const rule = (o = {}) => ({ lang: 'de', category: 'verb_complex', key: 'perfekt_sein', name: 'Perfekt mit sein', ...o });

test('rule grading: exact categories take no near misses', () => {
  const comma = rule({ category: 'punctuation' });
  assert.equal(ruleCompare(rule(), 'ist', ['Ist']), 'almost');
  assert.equal(ruleCompare(comma, 'ist', ['Ist']), 'wrong');
  assert.equal(ruleCompare(comma, 'Ist', ['Ist']), 'correct');
  assert.equal(strictGrade(comma, 'almost'), 'wrong');
  assert.equal(strictGrade(rule(), 'almost'), 'almost');
});

test('rule grading: a transformation set is almost right when nothing is wrong', () => {
  assert.equal(transformGrade(['correct', 'correct']), 'correct');
  assert.equal(transformGrade(['correct', 'almost']), 'almost');
  assert.equal(transformGrade(['correct', 'wrong']), 'wrong');
});

test('own mistakes: only the rule or category being drilled', () => {
  const ruleTask = { kind: 'rule', rule: rule() };
  assert.equal(ownMistake(ruleTask, { category: 'verb_complex', rule: 'perfekt_sein' }), true);
  assert.equal(ownMistake(ruleTask, { category: 'verb_complex', rule: 'other' }), false);
  const drill = { kind: 'drill', category: 'word_order' };
  assert.equal(ownMistake(drill, { category: 'word_order' }), true);
  assert.equal(ownMistake(drill, { category: 'cases' }), false);
  assert.equal(ownMistake({ kind: 'write' }, { category: 'word_order' }), false);
});

test('follow-ups: each broken rule once, not if already queued ahead', () => {
  const m = (o) => ({ lang: 'de', category: 'verb_complex', rule: 'perfekt_sein', source: 'exercise', ...o });
  const s = { tasks: [{ item: { id: 'x' } }, { item: { id: 'rule:verb_complex/queued' } }], idx: 0, followed: new Set(['rule:verb_complex/done']) };
  assert.deepEqual(followUpIds([m(), m(), m({ rule: 'queued' }), m({ rule: 'done' }), m({ source: 'drill', rule: 'd' }), m({ rule: '' })], s),
    ['rule:verb_complex/perfekt_sein']);
  assert.deepEqual(followUpIds([m({ lang: 'ja', category: 'particles', rule: 'wa' })], s), ['rule:ja:particles/wa']);
});

test('after an answer: daily session schedules and records the exercise', () => {
  const task = { kind: 'recall', word: { id: 'w1' } };
  const { saved, review } = answerRecord(task, wordItem(), { grade: 'correct', answer: 'Haus', practice: false, lang: 'de', now: NOW });
  assert.equal(saved.reps, 1);
  assert.equal(saved.due, addDays(TODAY, 1));
  assert.equal(saved.exerciseType, 'recall');
  assert.deepEqual(review, { reviewItemId: 'word:w1', itemType: 'word', itemId: 'w1', lang: 'de', category: null,
    exerciseType: 'recall', answer: 'Haus', correct: true, grade: 'correct', reviewedAt: NOW });
});

test('after an answer: a right practice answer on a not-yet-due item counts but keeps its due date', () => {
  const item = wordItem({ introducedAt: NOW - 1, due: addDays(TODAY, 5), interval: 5, reps: 2, exerciseType: 'gap' });
  const { saved, review } = answerRecord({ kind: 'recall', word: {} }, item, { grade: 'correct', answer: 'a', practice: true, lang: 'de', now: NOW });
  assert.notEqual(saved, item);
  assert.equal(saved.due, item.due);
  assert.equal(saved.reps, 3); // counts as a success, so the next exercise is harder
  assert.equal(saved.exerciseType, 'recall');
  assert.equal(review.mode, 'practice');
  const miss = answerRecord({ kind: 'recall', word: {} }, item, { grade: 'wrong', answer: 'a', practice: true, lang: 'de', now: NOW });
  assert.equal(miss.saved.due, addDays(TODAY, 1));
  assert.equal(miss.review.correct, false);
});

test('after an answer: a drill records its kind', () => {
  const task = { kind: 'drill', drillKind: 'gapfill', category: 'word_order' };
  const item = { id: 'category:word_order', itemType: 'category', itemId: 'word_order', due: TODAY, interval: 0, ease: 2.5, reps: 0, lapses: 0 };
  const { saved, review } = answerRecord(task, item, { grade: 'almost', answer: 'x', practice: false, lang: 'de', now: NOW });
  assert.equal(saved.exerciseType, 'gapfill');
  assert.equal(review.exerciseType, 'gapfill');
  assert.equal(review.category, 'word_order');
  assert.equal(review.correct, true);
});

test('after an answer: a rule moves on the ladder and uses up the exercise', () => {
  const ex = { correct: 'Es ist passiert.', wrong: 'Es hat passiert.' };
  const other = { correct: 'Er ist gekommen.', wrong: 'Er hat gekommen.' };
  const item = { ...newRuleItem(rule(), NOW), rung: 1, pool: { pair: [ex, other] } };
  const task = { kind: 'rule', rule: rule(), ruleKind: 'pair', ex, answerText: '' };
  const right = answerRecord(task, item, { grade: 'correct', answer: ex.correct, practice: false, lang: 'de', now: NOW });
  assert.equal(right.saved.rung, 2);
  assert.deepEqual(right.saved.pool.pair, [other]);
  assert.equal(right.saved.exerciseType, 'pair');
  assert.equal(right.review.exerciseType, 'pair');
  const wrong = answerRecord(task, { ...item, rung: 3 }, { grade: 'wrong', answer: ex.wrong, practice: false, lang: 'de', now: NOW });
  assert.equal(wrong.saved.rung, 2);
});

test('after an answer: a transformation records all its answers', () => {
  const task = { kind: 'rule', rule: rule(), ruleKind: 'transform', ex: {}, answerText: 'a / b' };
  const item = newRuleItem(rule(), NOW);
  assert.equal(answerRecord(task, item, { grade: 'wrong', answer: 'a', practice: false, lang: 'de', now: NOW }).review.answer, 'a / b');
});

test('requeue: wrong local answers come back at the end, or four tasks later in practice', () => {
  assert.equal(requeueAt({ kind: 'recall' }, 'wrong', { practice: false, idx: 2, length: 10 }), 10);
  assert.equal(requeueAt({ kind: 'gap' }, 'wrong', { practice: true, idx: 2, length: 10 }), 6);
  assert.equal(requeueAt({ kind: 'order' }, 'wrong', { practice: true, idx: 2, length: 4 }), 4);
  assert.equal(requeueAt({ kind: 'recall' }, 'almost', { practice: false, idx: 2, length: 10 }), -1);
  assert.equal(requeueAt({ kind: 'write' }, 'wrong', { practice: false, idx: 2, length: 10 }), -1);
});

test('"I don\'t know" counts as a wrong answer: the run resets and the word comes back', () => {
  const item = wordItem({ reps: 4, interval: 10, introducedAt: NOW - 30 * 86400000, due: addDays(TODAY, 5) });
  for (const practice of [false, true]) {
    const { saved, review } = answerRecord({ kind: 'recall', word: {} }, item, { grade: 'wrong', answer: '', practice, lang: 'de', now: NOW });
    assert.equal(saved.reps, 0);
    assert.equal(saved.lapses, 1);
    assert.equal(saved.due, addDays(TODAY, 1));
    assert.equal(review.correct, false);
  }
  assert.ok(requeueAt({ kind: 'recall' }, 'wrong', { practice: true, idx: 2, length: 10 }) > 2);
});
