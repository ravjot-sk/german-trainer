import test from 'node:test';
import assert from 'node:assert/strict';
import { schedule, isDue, dayStart, addDays } from '../js/srs.js';
import { compare, checkRecall, joinArticle, gapFor, wordDiff, needsPlural } from '../js/check.js';
import { buildSession, interleave, wordExercise } from '../js/session.js';

const NOW = new Date('2026-10-03T10:00:00').getTime();
const item = (o = {}) => ({ id: Math.random().toString(36), itemType: 'word', itemId: 'w1', due: dayStart(NOW),
  interval: 0, ease: 2.5, reps: 0, lapses: 0, introducedAt: null, ...o });

test('correct answers grow the interval, wrong ones bring it back tomorrow', () => {
  let it = schedule(item(), 'correct', NOW);
  assert.equal(it.interval, 1);
  assert.equal(it.due, addDays(dayStart(NOW), 1));
  it = schedule(it, 'correct', NOW);
  assert.equal(it.interval, 3);
  it = schedule(it, 'correct', NOW);
  assert.ok(it.interval >= 7);
  const lapsed = schedule(it, 'wrong', NOW);
  assert.equal(lapsed.reps, 0);
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.due, addDays(dayStart(NOW), 1));
  assert.ok(lapsed.ease < it.ease);
});

test('isDue counts anything due before tomorrow', () => {
  assert.ok(isDue(item({ due: NOW + 3600e3 }), NOW));
  assert.ok(!isDue(item({ due: addDays(dayStart(NOW), 1), introducedAt: NOW - 864e5 }), NOW));
  // Never practised: due whatever its date says.
  assert.ok(isDue(item({ due: addDays(dayStart(NOW), 1) }), NOW));
});

test('answer comparison is strict on spelling, lenient on case and punctuation', () => {
  assert.equal(compare('Ich warte auf dich.', 'ich warte auf dich'), 'almost');
  assert.equal(compare('  der  Tisch ', 'der Tisch'), 'correct');
  assert.equal(compare('der Tish', 'der Tisch'), 'wrong');
  assert.equal(compare('„Hallo“', 'Hallo'), 'correct');
});

test('noun recall needs article and plural', () => {
  const w = { german: 'Kollege', article: 'der', pos: 'noun', plural: 'Kollegen' };
  assert.equal(checkRecall(w, 'der Kollege', 'die Kollegen').grade, 'correct');
  assert.equal(checkRecall(w, 'die Kollege', 'Kollegen').grade, 'wrong');
  assert.equal(checkRecall(w, 'der kollege', 'Kollegen').grade, 'almost');
  assert.ok(!needsPlural({ ...w, plural: '-' }));
  const v = { german: 'sich erinnern', pos: 'verb' };
  assert.equal(checkRecall(v, 'erinnern', '').grade, 'correct');
});

test('gap sentence falls back to finding the word in its sentence', () => {
  const g = gapFor({ german: 'Kollege', contextSentence: 'Ich habe mit dem neuen Kollegen gesprochen.' });
  assert.equal(g.answer, 'Kollegen');
  assert.ok(g.sentence.includes('___'));
  const stored = gapFor({ german: 'x', gapSentence: 'Er ___ an.', gapAnswer: 'ruft' });
  assert.deepEqual(stored, { sentence: 'Er ___ an.', answer: 'ruft' });
});

test('word diff marks changed words', () => {
  const d = wordDiff('Ich habe gegangen', 'Ich bin gegangen');
  assert.ok(d.some((p) => p.type === 'del' && p.text.includes('habe')));
  assert.ok(d.some((p) => p.type === 'add' && p.text.includes('bin')));
});

test('interleave spreads grammar through vocabulary', () => {
  const out = interleave([1, 2, 3, 4, 5, 6], ['a', 'b']);
  assert.equal(out.length, 8);
  assert.notEqual(out[0], 'a');
  assert.notEqual(out[out.length - 1], 'b');
});

test('word exercises progress from recall to gap fill to writing', () => {
  const w = { german: 'Kollege', contextSentence: 'Der Kollege ist nett.' };
  assert.equal(wordExercise(item({ reps: 0 }), w, true), 'recall');
  assert.equal(wordExercise(item({ reps: 1 }), w, true), 'gap');
  const kinds = new Set([2, 3, 4].map((r) => wordExercise(item({ reps: r }), w, true)));
  assert.ok(kinds.has('write'));
  assert.ok(![2, 3, 4].some((r) => wordExercise(item({ reps: r }), w, false) === 'write'));
});

test('daily session caps new words and needs Gemini for drills', () => {
  const words = Array.from({ length: 20 }, (_, i) => ({ id: `w${i}`, german: `Wort${i}`, meaning: 'm', pos: 'other' }));
  const items = words.map((w) => item({ itemId: w.id }));
  items.push(item({ itemType: 'category', itemId: 'adjective_endings' }));
  items.push(item({ itemType: 'category', itemId: 'other' }));
  const args = { items, words, mistakes: [], reviews: [], settings: { newPerDay: 5 }, now: NOW };
  const withGemini = buildSession({ ...args, gemini: true });
  assert.equal(withGemini.filter((t) => t.word).length, 5);
  assert.equal(withGemini.filter((t) => t.kind === 'drill').length, 1);
  const offline = buildSession({ ...args, gemini: false });
  assert.equal(offline.filter((t) => t.kind === 'drill').length, 0);
});

test('noun recall joins the article and word boxes', () => {
  const w = { lemma: 'Zaun', article: 'der', pos: 'noun', plural: 'Zäune' };
  assert.equal(joinArticle('der', 'Zaun'), 'der Zaun');
  assert.equal(joinArticle('', 'der Zaun'), 'der Zaun');
  assert.equal(joinArticle('der', 'der Zaun'), 'der Zaun');
  assert.equal(checkRecall(w, joinArticle('der', 'Zaun'), 'Zäune').grade, 'correct');
  assert.equal(checkRecall(w, joinArticle('die', 'Zaun'), 'Zäune').grade, 'wrong');
  assert.equal(checkRecall(w, joinArticle('der', 'Zaun'), 'Zaune').grade, 'wrong');
});
