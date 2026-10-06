import test from 'node:test';
import assert from 'node:assert/strict';
import { dayStart, addDays } from '../js/srs.js';
import {
  ruleKey, ruleItemId, parseRuleId, ruleFrom, newRuleItem, afterMistake, afterAnswer, status, kindOf,
  addSet, nextExercise, useExercise, valid, topUpList, migrateData, knownRules, START_RUNG,
} from '../js/rules.js';
import { buildSession, summarizeDue } from '../js/session.js';
import { CATEGORIES, JAPANESE, migrateCategory, isCurated, hasRules, finishCategories } from '../js/categories.js';
import { SEEDS } from '../js/ruleseeds.js';
import { compareExact } from '../js/check.js';
import * as store from '../js/store.js';

const NOW = new Date('2026-10-06T10:00:00').getTime();
const TODAY = dayStart(NOW);
const rule = (o = {}) => ({ lang: 'de', category: 'verb_complex', key: 'perfekt_sein', name: 'Perfekt mit sein', statement: 'x', level: 'A2', ...o });
const set = (tag = '') => ({
  pair: { correct: `Es ist passiert${tag}.`, wrong: `Es hat passiert${tag}.`, explanation: 'e' },
  gap: { sentence: `Was ___ passiert${tag}?`, answer: 'ist', acceptable: [], explanation: 'e' },
  transform: { instruction: 'Perfekt', items: [{ prompt: 'Er geht.', answer: 'Er ist gegangen.', acceptable: [] }], explanation: 'e' },
  spot: { text: 'Er hat gegangen.', corrected: 'Er ist gegangen.', explanation: 'e' },
  produce: { instruction: 'Schreib …', model: 'Es ist passiert.', explanation: 'e' },
});

test('rule ids: German stays bare, other languages are prefixed', () => {
  assert.equal(ruleKey('Perfekt mit Sein!'), 'perfekt_mit_sein');
  assert.equal(ruleItemId('de', 'verb_complex', 'perfekt_sein'), 'verb_complex/perfekt_sein');
  assert.equal(ruleItemId('ja', 'particles', 'wa_vs_ga'), 'ja:particles/wa_vs_ga');
  assert.deepEqual(parseRuleId('ja:particles/wa_vs_ga'), { lang: 'ja', category: 'particles', key: 'wa_vs_ga' });
});

test('a mistake has a rule only in categories that have rules', () => {
  assert.equal(ruleFrom({ category: 'verb_complex', rule: 'perfekt sein', ruleName: 'P' }, 'de').key, 'perfekt_sein');
  assert.equal(ruleFrom({ category: 'word_choice', rule: 'leihen_borgen' }, 'de'), null);
  assert.equal(ruleFrom({ category: 'case', rule: '' }, 'de'), null);
});

test('the ladder: right answers climb, wrong ones drop, two days of free writing master it', () => {
  let it = newRuleItem(rule(), NOW);
  assert.equal(it.rung, START_RUNG);
  assert.equal(status(it), 'new');
  for (let i = START_RUNG; i < 5; i++) it = afterAnswer(it, 'correct', NOW);
  assert.equal(kindOf(it), 'produce');
  it = afterAnswer(it, 'correct', NOW);
  it = afterAnswer(it, 'correct', NOW + 3600e3); // same day: no second pass
  assert.equal(it.passes, 1);
  assert.equal(it.mastered, false);
  it = afterAnswer(it, 'correct', addDays(NOW, 3));
  assert.equal(it.mastered, true);
  assert.equal(status(it), 'solid');
  it = afterAnswer(it, 'almost', addDays(NOW, 4));
  assert.equal(it.rung, 5);
  it = afterAnswer(it, 'wrong', addDays(NOW, 5));
  assert.equal(it.rung, 4);
  assert.equal(it.mastered, false);
  assert.equal(afterAnswer({ ...it, rung: 1 }, 'wrong', NOW).rung, 1);
});

test('a fresh mistake sets a rule back a rung and makes it due today', () => {
  const it = { ...newRuleItem(rule(), NOW), rung: 5, mastered: true, passes: 2, due: addDays(TODAY, 20), introducedAt: NOW - 1 };
  const back = afterMistake(it, NOW);
  assert.equal(back.rung, 4);
  assert.equal(back.mastered, false);
  assert.equal(back.due, TODAY);
});

test('the pool keeps one list per exercise kind and serves the current rung', () => {
  let it = newRuleItem(rule(), NOW);
  assert.equal(nextExercise(it), null);
  it = addSet(it, { ...set(), spot: { text: 'same', corrected: 'same' } });
  assert.equal(it.pool.spot.length, 0, 'a spot text with nothing to fix is dropped');
  it = addSet(it, set('2'));
  const { kind, ex } = nextExercise(it);
  assert.equal(kind, 'gap');
  assert.equal(it.pool.gap.length, 2);
  it = useExercise(it, kind, ex);
  assert.equal(it.pool.gap.length, 1);
  for (let i = 0; i < 5; i++) it = addSet(it, set(String(i)));
  assert.equal(it.pool.pair.length, 3, 'capped');
  assert.ok(valid('transform', set().transform));
  assert.ok(!valid('gap', { sentence: 'no gap', answer: 'x' }));
  assert.ok(!valid('gap', { sentence: '___ and ___', answer: 'x' }));
});

test('top-ups pick rules due soon whose rung has no exercise', () => {
  const a = { ...newRuleItem(rule({ key: 'a' }), NOW) };
  const b = addSet(newRuleItem(rule({ key: 'b' }), NOW), set());
  const c = { ...newRuleItem(rule({ key: 'c' }), NOW), due: addDays(TODAY, 10) };
  assert.deepEqual(topUpList([a, b, c], { now: NOW }).map((r) => r.rule.key), ['a']);
  assert.deepEqual(topUpList([a, b, c], { now: NOW, skip: new Set([a.id]) }), []);
});

test('older data moves onto the new categories once', () => {
  const touched = [];
  const touch = (r) => touched.push(r.id);
  const data = {
    mistakes: [
      { id: 'm1', category: 'perfekt_auxiliary' },
      { id: 'm2', lang: 'ja', category: 'conjugation' },
      { id: 'm3', category: 'adjective_endings' },
      { id: 'm4', category: 'case', source: 'drill' },
    ],
    reviewItems: [
      { id: 'category:verb_position', itemType: 'category', itemId: 'verb_position', reps: 1 },
      { id: 'category:separable_verbs', itemType: 'category', itemId: 'separable_verbs', reps: 4 },
      { id: 'category:adjective_endings', itemType: 'category', itemId: 'adjective_endings', reps: 2 },
      { id: 'category:ja:conjugation', itemType: 'category', itemId: 'ja:conjugation', reps: 0 },
      { id: 'mistake:m1', itemType: 'mistake', itemId: 'm1' },
      { id: 'word:w1', itemType: 'word', itemId: 'w1' },
    ],
  };
  assert.equal(migrateData(data, touch), true);
  assert.deepEqual(data.mistakes.map((m) => m.category), ['verb_complex', 'verb_conjugation', 'adjective_endings', 'case']);
  assert.equal(data.mistakes[3].source, 'exercise', 'free-writing drill mistakes now count');
  assert.deepEqual(data.reviewItems.map((r) => r.id).sort(),
    ['category:adjective_endings', 'category:ja:verb_conjugation', 'category:word_order_main', 'word:w1']);
  // The two old word-order items became one, keeping the most practised.
  assert.equal(data.reviewItems.find((r) => r.id === 'category:word_order_main').reps, 4);
  assert.ok(touched.includes('m1') && touched.includes('m4') && !touched.includes('m3'));
  assert.equal(migrateData(data, touch), false, 'only once');
});

test('category lists: research-based ones are curated, every old id has a home', () => {
  assert.equal(CATEGORIES.length, 22);
  assert.equal(JAPANESE.length, 19);
  assert.ok(isCurated('de') && isCurated('ja') && !isCurated('es'));
  for (const id of ['verb_position', 'separable_verbs', 'case_prepositions', 'gender_plural', 'perfekt_auxiliary',
    'verb_prepositions', 'reflexive_verbs', 'konjunktiv', 'spelling', 'adjective_endings', 'word_choice', 'register', 'other']) {
    assert.ok(CATEGORIES.some((c) => c.id === migrateCategory('de', id)), id);
  }
  for (const id of ['particles', 'conjugation', 'politeness', 'aspect', 'conditionals', 'giving_receiving', 'transitivity',
    'clause_linking', 'counters', 'word_choice', 'spelling', 'other']) {
    assert.ok(JAPANESE.some((c) => c.id === migrateCategory('ja', id)), id);
  }
  assert.ok(!hasRules('word_choice') && hasRules('case'));
  assert.ok(finishCategories(Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, en: `C${i}` }))).length <= 20);
});

test('seed rules only use real categories and unique keys', () => {
  for (const [code, list] of [['de', CATEGORIES], ['ja', JAPANESE]]) {
    const keys = new Set();
    for (const [cat, rules] of Object.entries(SEEDS[code])) {
      assert.ok(list.some((c) => c.id === cat), `${code}:${cat}`);
      for (const [k] of rules) {
        assert.equal(k, ruleKey(k));
        assert.ok(!keys.has(k), k);
        keys.add(k);
      }
    }
  }
});

test('a daily session practises rules and drills only categories without rules', () => {
  const ruleItem = newRuleItem(rule(), NOW);
  const mastered = { ...newRuleItem(rule({ key: 'done' }), NOW), due: addDays(TODAY, 30), introducedAt: NOW - 1, mastered: true };
  const cat = (id) => ({ id: `category:${id}`, itemType: 'category', itemId: id, due: TODAY, interval: 0, ease: 2.5, reps: 0, lapses: 0 });
  const items = [ruleItem, mastered, cat('verb_complex'), cat('case'), cat('spelling')];
  // spelling has no mistakes left (they moved to capitalisation), so nothing to drill there.
  const mistakes = [{ id: 'a', category: 'verb_complex', createdAt: NOW }, { id: 'b', category: 'case', createdAt: NOW }];
  const args = { items, words: [], mistakes, reviews: [], settings: {}, gemini: true, drillable: ['verb_complex', 'case', 'spelling'], now: NOW };
  const tasks = buildSession(args);
  assert.deepEqual(tasks.map((x) => [x.kind, x.category]), [['rule', 'verb_complex'], ['drill', 'case']]);
  assert.equal(tasks[0].ruleKind, 'gap');
  assert.equal(summarizeDue(args).grammar, 2);
  assert.deepEqual(buildSession({ ...args, gemini: false }), []);
});

test('store: mistakes create rules; own-rule drill mistakes stay out of the ladder', () => {
  store._setData({});
  const m = { original: 'hat passiert', corrected: 'ist passiert', category: 'perfekt_auxiliary', sentence: 's', correctedSentence: 'c',
    rule: 'perfekt_sein', ruleName: 'Perfekt mit sein', ruleStatement: 'passieren nimmt sein', ruleLevel: 'A2' };
  const [saved] = store.addMistakes([m], 'exercise', 'de', NOW);
  assert.equal(saved.category, 'verb_complex', 'old category ids from Gemini are mapped');
  assert.equal(saved.rule, 'perfekt_sein');
  const item = store.reviewItemFor('rule', 'verb_complex/perfekt_sein');
  assert.equal(item.rule.name, 'Perfekt mit sein');
  assert.equal(item.rung, START_RUNG);
  assert.equal(store.reviewItems().filter((r) => r.itemType === 'mistake').length, 0, 'no fix-your-sentence items any more');

  store.updateReviewItem({ ...item, rung: 4 });
  store.addMistakes([{ ...m, ruleName: 'Other name' }], 'drill', 'de', NOW);
  assert.equal(store.reviewItemFor('rule', 'verb_complex/perfekt_sein').rung, 4, 'a drill mistake does not set it back');
  store.addMistakes([m], 'correction', 'de', NOW);
  const after = store.reviewItemFor('rule', 'verb_complex/perfekt_sein');
  assert.equal(after.rung, 3);
  assert.equal(after.rule.name, 'Perfekt mit sein', 'keeps its first name');

  store.addMistakes([{ original: 'a', corrected: 'b', category: 'word_choice', rule: 'x' }], 'correction', 'de', NOW);
  assert.equal(store.ruleItems('de').length, 1);
  assert.deepEqual(knownRules(store.reviewItems(), 'de').map((r) => r.key), ['perfekt_sein']);
});

test('store: older mistakes wait for a rule, then get one without resetting progress', () => {
  store._setData({ mistakes: [
    { id: 'old', lang: 'de', category: 'spelling', original: 'Paar', corrected: 'paar', createdAt: 1 },
    { id: 'wc', lang: 'de', category: 'word_choice', original: 'a', corrected: 'b', createdAt: 1 },
  ] });
  assert.deepEqual(store.mistakesWithoutRule('de').map((m) => m.id), ['old']);
  store.setMistakeRule('old', { category: 'capitalisation', rule: 'paar_bisschen_lowercase', ruleName: 'paar klein', ruleStatement: '', ruleLevel: 'B1' }, NOW);
  const m = store.getMistake('old');
  assert.equal(m.category, 'capitalisation');
  assert.equal(m.rule, 'paar_bisschen_lowercase');
  assert.deepEqual(store.mistakesWithoutRule('de'), []);
  assert.ok(store.reviewItemFor('rule', 'capitalisation/paar_bisschen_lowercase'));
  assert.ok(store.reviewItemFor('category', 'capitalisation'));
});

test('exact comparison for capitalisation and punctuation rules', () => {
  assert.equal(compareExact('ein Paar Bilder', 'ein paar Bilder'), 'wrong');
  assert.equal(compareExact('Ich weiß dass er kommt.', 'Ich weiß, dass er kommt.'), 'wrong');
  assert.equal(compareExact(' das  Warten ', 'das Warten'), 'correct');
  assert.equal(compareExact('', ''), 'wrong');
});
