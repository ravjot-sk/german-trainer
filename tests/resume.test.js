import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotOf, restoreSession } from '../js/resume.js';
import { dayStart, addDays } from '../js/srs.js';

const NOW = new Date('2026-10-11T10:00:00').getTime();
const word = (id, o = {}) => ({ id, lang: 'de', lemma: id, meaning: id, pos: 'other', ...o });
const item = (itemType, itemId, o = {}) => ({ id: `${itemType}:${itemId}`, itemType, itemId, due: addDays(dayStart(NOW), 3),
  interval: 6, ease: 2.5, reps: 2, lapses: 0, introducedAt: NOW - 10 * 864e5, ...o });
const rule = { lang: 'de', category: 'verb_complex', key: 'perfekt_sein', name: 'Perfekt mit sein', statement: '', level: 'A2' };

const words = ['a', 'b', 'c'].map((id) => word(id));
const items = [...words.map((w) => item('word', w.id)), item('rule', 'verb_complex/perfekt_sein', { rule, rung: 1 }),
  item('category', 'de:case')];
const byId = (id) => items.find((r) => r.id === id);
const wordTask = (id) => ({ item: byId(`word:${id}`), word: words.find((w) => w.id === id), kind: 'recall' });

function practiceSession() {
  const a = wordTask('a');
  const tasks = [a, wordTask('b'), { item: byId('category:de:case'), category: 'case', kind: 'drill', drillKind: 'transform', drill: { x: 1 } },
    { item: byId('rule:verb_complex/perfekt_sein'), rule, category: 'verb_complex', kind: 'rule', ruleKind: 'choice' }, a, wordTask('c')];
  return { practice: true, focus: 'mix', round: 2, roundStart: 1, newIds: new Set(['word:c']), tasks, lang: 'de', idx: 4,
    correct: 2, answered: 4, requeued: new Set([a]), mistakesLogged: 1, followed: new Set(['rule:x']) };
}
const args = (o = {}) => ({ items, words, gemini: true, lang: 'de', now: NOW + 3600e3, ...o });
// Through JSON, as it is stored.
const roundTrip = (s, now = NOW) => JSON.parse(JSON.stringify(snapshotOf(s, now)));

test('a practice session comes back where it was, with ids only', () => {
  const snap = roundTrip(practiceSession());
  for (const x of snap.tasks) assert.deepEqual(Object.keys(x).filter((k) => !['i', 'k', 'd', 'r'].includes(k)), []);
  const s = restoreSession(snap, args());
  assert.equal(s.practice, true);
  assert.equal(s.focus, 'mix');
  assert.equal(s.round, 2);
  assert.equal(s.roundStart, 1);
  assert.deepEqual([...s.newIds], ['word:c']);
  assert.deepEqual(s.tasks.map((x) => x.item.id), ['word:a', 'word:b', 'category:de:case', 'rule:verb_complex/perfekt_sein', 'word:a', 'word:c']);
  assert.equal(s.idx, 4);
  assert.equal(s.tasks[s.idx].item.id, 'word:a');
  assert.equal(s.tasks[2].drillKind, 'transform');
  assert.equal(s.tasks[2].drill, undefined);
  assert.equal(s.tasks[3].kind, 'rule');
  // The retry of a missed word still counts as a retry (its answer is not saved twice).
  assert.ok(s.requeued.has(s.tasks[4]));
  assert.ok(!s.requeued.has(s.tasks[5]));
  assert.deepEqual([s.correct, s.answered, s.mistakesLogged], [2, 4, 1]);
  assert.deepEqual([...s.followed], ['rule:x']);
});

test('a snapshot is only valid on the day and in the language it was saved', () => {
  const snap = roundTrip(practiceSession());
  assert.equal(restoreSession(snap, args({ now: addDays(dayStart(NOW), 1) + 60e3 })), null);
  assert.equal(restoreSession(snap, args({ lang: 'ja' })), null);
  assert.equal(restoreSession(null, args()), null);
  assert.equal(restoreSession({ ...snap, v: 99 }, args()), null);
});

test('items deleted since are left out and the position follows', () => {
  const snap = roundTrip(practiceSession());
  const s = restoreSession(snap, args({ words: words.filter((w) => w.id !== 'b'), items: items.filter((r) => r.id !== 'word:b') }));
  assert.deepEqual(s.tasks.map((x) => x.item.id), ['word:a', 'category:de:case', 'rule:verb_complex/perfekt_sein', 'word:a', 'word:c']);
  assert.equal(s.idx, 3);
  assert.equal(s.roundStart, 1);
  assert.equal(s.tasks[s.idx].item.id, 'word:a');
});

test('grammar tasks are left out without Gemini', () => {
  const s = restoreSession(roundTrip(practiceSession()), args({ gemini: false }));
  assert.deepEqual(s.tasks.map((x) => x.item.id), ['word:a', 'word:b', 'word:a', 'word:c']);
  assert.equal(s.idx, 2);
});

test('a daily session with nothing left is not restored', () => {
  const daily = { tasks: [wordTask('a'), wordTask('b')], lang: 'de', idx: 1, correct: 1, answered: 1, requeued: new Set(),
    mistakesLogged: 0, followed: new Set() };
  const s = restoreSession(roundTrip(daily), args());
  assert.equal(s.practice, false);
  assert.equal(s.focus, undefined);
  assert.equal(s.tasks[s.idx].item.id, 'word:b');
  assert.equal(restoreSession(roundTrip({ ...daily, idx: 2 }), args()), null);
  // Its last word was deleted: nothing left either.
  assert.equal(restoreSession(roundTrip(daily), args({ items: items.filter((r) => r.id !== 'word:b') })), null);
});
