import test from 'node:test';
import assert from 'node:assert/strict';
import { dayStart } from '../js/srs.js';
import { chunksFor, joinChunks, shuffled, gapFor, compare } from '../js/check.js';
import { buildSession, sentenceExercise, summarizeDue } from '../js/session.js';

const NOW = new Date('2026-10-05T10:00:00').getTime();
const item = (itemId, o = {}) => ({ id: `word:${itemId}`, itemType: 'word', itemId, due: dayStart(NOW),
  interval: 0, ease: 2.5, reps: 0, lapses: 0, introducedAt: null, ...o });
const sentence = (id, o = {}) => ({ id, kind: 'sentence', lang: 'de', lemma: 'Hast du kurz Zeit?', meaning: 'Do you have a moment?',
  tone: 'informal', chunks: ['Hast', 'du', 'kurz Zeit?'], gapSentence: 'Hast du ___?', gapAnswer: 'kurz Zeit', ...o });
const word = (id) => ({ id, lang: 'de', lemma: `Wort${id}`, pos: 'other', meaning: 'x' });

test('word-order pieces come from Gemini when they still add up to the sentence', () => {
  assert.deepEqual(chunksFor(sentence('s')), ['Hast', 'du', 'kurz Zeit?']);
  // Edited sentence: fall back to its words.
  assert.deepEqual(chunksFor(sentence('s', { lemma: 'Hast du heute Zeit?' })), ['Hast', 'du', 'heute', 'Zeit?']);
  assert.equal(chunksFor(sentence('s', { lemma: 'Danke schön', chunks: [] })), null);
  // Japanese has no spaces, so only Gemini's pieces work.
  const ja = sentence('j', { lang: 'ja', lemma: '少しお時間ありますか。', chunks: ['少し', 'お時間', 'ありますか。'] });
  assert.deepEqual(chunksFor(ja), ['少し', 'お時間', 'ありますか。']);
  assert.equal(compare(joinChunks(chunksFor(ja)), ja.lemma), 'correct');
  assert.equal(chunksFor({ ...ja, chunks: [] }), null);
});

test('rebuilt sentence is checked like a typed answer', () => {
  assert.equal(compare(joinChunks(['Hast', 'du', 'kurz Zeit?']), 'Hast du kurz Zeit?'), 'correct');
  assert.equal(compare(joinChunks(['du', 'Hast', 'kurz Zeit?']), 'Hast du kurz Zeit?'), 'wrong');
});

test('shuffle changes the order', () => {
  const parts = ['a', 'b', 'c', 'd'];
  for (let i = 0; i < 20; i++) {
    const s = shuffled(parts);
    assert.notDeepEqual(s, parts);
    assert.deepEqual([...s].sort(), parts);
  }
});

test('a sentence without a stored gap gets none guessed', () => {
  assert.equal(gapFor(sentence('s', { gapSentence: '', gapAnswer: '' })), null);
});

test('sentence exercises rotate and need Gemini only for saying it', () => {
  const s = sentence('s');
  assert.equal(sentenceExercise(item('s'), s, true), 'say');
  const kinds = [1, 2, 3].map((reps) => sentenceExercise(item('s', { reps }), s, true));
  assert.deepEqual(new Set(kinds), new Set(['say', 'order', 'gap']));
  assert.equal(sentenceExercise(item('s'), s, false), 'order');
  assert.equal(sentenceExercise(item('s'), s, true, { chunks: false }), 'say');
  assert.equal(sentenceExercise(item('s', { reps: 1 }), sentence('s', { gapSentence: '' }), true, { chunks: false }), 'say');
});

test('new sentences have their own daily cap and do not use up new words', () => {
  const words = [...Array(10)].map((_, i) => word(`w${i}`));
  const sentences = [...Array(5)].map((_, i) => sentence(`s${i}`));
  const items = [...words, ...sentences].map((w) => item(w.id));
  const args = { items, words: [...words, ...sentences], mistakes: [], reviews: [], gemini: true, now: NOW,
    settings: { newPerDay: 8, newSentencesPerDay: 3 } };
  const tasks = buildSession(args);
  assert.equal(tasks.filter((x) => x.word?.kind === 'sentence').length, 3);
  assert.equal(tasks.filter((x) => x.word && x.word.kind !== 'sentence').length, 8);
  const sum = summarizeDue(args);
  assert.equal(sum.words, 8);
  assert.equal(sum.sentences, 3);
  assert.equal(sum.newWords, 8);

  // Sentences introduced today count against the sentence cap only.
  const items2 = items.map((r) => (r.itemId === 's0' || r.itemId === 's1' ? { ...r, introducedAt: NOW, reps: 1, due: dayStart(NOW) + 864e5 * 3 } : r));
  const tasks2 = buildSession({ ...args, items: items2 });
  assert.equal(tasks2.filter((x) => x.word?.kind === 'sentence').length, 1);
  assert.equal(tasks2.filter((x) => x.word && x.word.kind !== 'sentence').length, 8);
});
