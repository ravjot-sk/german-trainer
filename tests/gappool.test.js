import test from 'node:test';
import assert from 'node:assert/strict';
import { gapLevel, poolOf, addToPool, poolFromLookup, pickGap, afterGap, needsRefill, refillList, replaceInPool, MAX_POOL } from '../js/gappool.js';
import { wordExercise } from '../js/session.js';
import { poolTexts } from '../js/furigana.js';

const NOW = new Date('2026-10-05T10:00:00').getTime();
const e = (sentence, o = {}) => ({ sentence, answer: 'x', translation: '', level: 1, source: 'gemini', seen: 0, seenAt: 0, retired: false, ...o });
const word = (o = {}) => ({ id: 'w1', lemma: 'Kollege', meaning: 'colleague', ...o });

test('difficulty follows the run of right answers', () => {
  assert.deepEqual([0, 2, 3, 5, 6, 20].map(gapLevel), [1, 1, 2, 2, 3, 3]);
});

test('old words get a pool from their single gap sentence', () => {
  const p = poolOf(word({ gapSentence: 'Mein ___ ist nett.', gapAnswer: 'Kollege' }));
  assert.equal(p.length, 1);
  assert.equal(p[0].answer, 'Kollege');
  assert.deepEqual(poolOf(word({ contextSentence: 'Ich habe mit dem neuen Kollegen gesprochen.' })).map((x) => x.answer), ['Kollegen']);
  assert.deepEqual(poolOf(word()), []);
  assert.deepEqual(poolOf({ kind: 'sentence', lemma: 'Hallo du.', gapSentence: '___ du.', gapAnswer: 'Hallo' }), []);
});

test('a lookup seeds the pool with its gap sentence and the gapped extra examples', () => {
  const p = poolFromLookup({
    gapSentence: 'Mein ___ ist nett.', gapAnswer: 'Kollege', exampleTranslation: 'My colleague is nice.',
    moreGaps: [{ gapSentence: 'Ich rufe meinen ___ an.', gapAnswer: 'Kollegen', translation: 'I call my colleague.' },
      { gapSentence: 'no gap here', gapAnswer: 'x' }],
  });
  assert.deepEqual(p.map((x) => [x.level, x.source]), [[1, 'lookup'], [2, 'lookup']]);
  assert.equal(p[0].translation, 'My colleague is nice.');
  // From a context sentence the example's translation doesn't fit.
  assert.equal(poolFromLookup({ gapSentence: 'A ___.', gapAnswer: 'b', exampleTranslation: 'x' }, true)[0].translation, '');
});

test('addToPool skips duplicates and broken entries and drops old retired ones when full', () => {
  let p = addToPool([e('A ___.')], [{ sentence: 'a ___', answer: 'x' }, { sentence: 'B', answer: 'x' }, { sentence: 'C ___.', answer: '' }, { sentence: 'D ___.', answer: 'y' }], { level: 2, source: 'own' });
  assert.deepEqual(p.map((x) => x.sentence), ['A ___.', 'D ___.']);
  assert.equal(p[1].level, 2);
  assert.equal(p[1].source, 'own');
  const full = Array.from({ length: MAX_POOL }, (_, i) => e(`S${i} ___.`, { retired: i < 2, seenAt: i === 0 ? 5 : 1 }));
  p = addToPool(full, [{ sentence: 'New ___.', answer: 'x' }]);
  assert.equal(p.length, MAX_POOL);
  assert.ok(!p.some((x) => x.sentence === 'S1 ___.'), 'the retired one seen longest ago goes');
  assert.ok(p.some((x) => x.sentence === 'S0 ___.'));
});

test('pickGap prefers fresh sentences at the word\'s level, lower and less seen first', () => {
  const w = word({ gapPool: [e('L1 ___.'), e('L2 ___.', { level: 2 }), e('L3 ___.', { level: 3 }), e('L1b ___.', { seen: 0 })] });
  assert.equal(pickGap(w, 0).sentence, 'L1 ___.');
  assert.equal(pickGap(w, 3).sentence, 'L2 ___.');
  assert.equal(pickGap(w, 9).sentence, 'L3 ___.');
  // Nothing fresh at level 3: the nearest level.
  const w2 = word({ gapPool: [e('L1 ___.'), e('L2 ___.', { level: 2 }), e('L3 ___.', { level: 3, retired: true })] });
  assert.equal(pickGap(w2, 9).sentence, 'L2 ___.');
});

test('a right answer retires the sentence, a wrong one shows it again', () => {
  let w = word({ gapPool: [e('A ___.'), e('B ___.')] });
  const first = pickGap(w, 0);
  assert.equal(first.sentence, 'A ___.');
  w = { ...w, ...afterGap(w, first.sentence, 'wrong', NOW) };
  assert.equal(w.gapCurrent, 'A ___.');
  assert.equal(pickGap(w, 0).sentence, 'A ___.');
  w = { ...w, ...afterGap(w, 'A ___.', 'correct', NOW + 1) };
  assert.equal(w.gapCurrent, null);
  assert.equal(w.gapPool[0].retired, true);
  assert.equal(w.gapPool[0].seen, 2);
  assert.equal(pickGap(w, 1).sentence, 'B ___.');
  // An answer counted as almost right also retires it.
  w = { ...w, ...afterGap(w, 'B ___.', 'almost', NOW + 2) };
  // All retired: the one seen longest ago comes back.
  assert.equal(pickGap(w, 2).sentence, 'A ___.');
});

test('the repeated sentence survives the pool being reordered by a top-up', () => {
  let w = word({ gapPool: [e('A ___.', { retired: true }), e('B ___.')] });
  w = { ...w, ...afterGap(w, 'B ___.', 'wrong', NOW) };
  w.gapPool = w.gapPool.slice(1).concat([e('C ___.')]);
  assert.equal(pickGap(w, 0).sentence, 'B ___.');
});

test('a hand-edited gap sentence replaces the old one', () => {
  const p = replaceInPool([e('Old ___.'), e('B ___.')], 'Old ___.', { sentence: 'New ___.', answer: 'x' });
  assert.deepEqual(p.map((x) => x.sentence), ['B ___.', 'New ___.']);
});

test('words running low at their level are topped up, soonest due first', () => {
  const low = word({ id: 'a', gapPool: [e('A ___.')] });
  const ok = word({ id: 'b', gapPool: [e('A ___.'), e('B ___.'), e('C ___.')] });
  const easy = word({ id: 'c', gapPool: [e('A ___.'), e('B ___.'), e('C ___.')] });
  const later = word({ id: 'd', gapPool: [] });
  const sentence = { id: 's', kind: 'sentence', lemma: 'Hallo du.' };
  assert.ok(needsRefill(low, 0));
  assert.ok(!needsRefill(ok, 0));
  assert.ok(needsRefill(easy, 4), 'level 1 sentences don\'t count for a level 2 word');
  assert.ok(!needsRefill(sentence, 0));
  const it = (itemId, o) => ({ id: `r${itemId}`, itemType: 'word', itemId, reps: 0, introducedAt: NOW - 864e5, due: NOW, ...o });
  const list = refillList({
    words: [low, ok, easy, later, sentence], now: NOW,
    items: [it('a', { due: NOW + 864e5 }), it('b'), it('c', { reps: 4 }), it('d', { due: NOW + 30 * 864e5 }), it('s')],
  });
  assert.deepEqual(list.map((x) => [x.word.id, x.level]), [['c', 2], ['a', 1]]);
  assert.deepEqual(list[1].existing, ['A ___.']);
  assert.deepEqual(refillList({ words: [low], items: [it('a')], now: NOW, skip: new Set(['a']) }), []);
});

test('a word with only a pool still gets gap exercises', () => {
  const w = word({ gapPool: [e('A ___.')] });
  assert.equal(wordExercise({ reps: 1 }, w, false), 'gap');
  assert.equal(wordExercise({ reps: 1 }, word(), false), 'recall');
});

test('pool sentences are offered for furigana, gapped and filled in', () => {
  assert.deepEqual(poolTexts({ gapPool: [{ sentence: '___を食べる。', answer: 'すし' }] }), ['___を食べる。', 'すしを食べる。']);
  assert.deepEqual(poolTexts({}), []);
});
