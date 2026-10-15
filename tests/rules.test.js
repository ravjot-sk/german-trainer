import test from 'node:test';
import assert from 'node:assert/strict';
import { dayStart, addDays } from '../js/srs.js';
import {
  ruleKey, ruleItemId, parseRuleId, ruleFrom, newRuleItem, afterMistake, afterAnswer, status, kindOf,
  addSet, nextExercise, useExercise, valid, topUpList, migrateData, knownRules, START_RUNG,
  ruleText, rulePrompt, tidy, mistakeWords, kindsToAsk, suspectRule, poolOf, DATA_VERSION,
} from '../js/rules.js';
import { buildSession, summarizeDue } from '../js/session.js';
import { CATEGORIES, JAPANESE, migrateCategory, isCurated, hasRules, finishCategories } from '../js/categories.js';
import { SEEDS } from '../js/ruleseeds.js';
import { compareExact, fillGap, compare, checkRecall, wordDiff } from '../js/check.js';
import { fixPairs } from '../js/answer.js';
import * as store from '../js/store.js';

const NOW = new Date('2026-10-06T10:00:00').getTime();
const TODAY = dayStart(NOW);
const rule = (o = {}) => ({ lang: 'de', category: 'verb_complex', key: 'perfekt_sein', name: 'Perfekt mit sein', statement: 'x', level: 'A2', ...o });
const set = (tag = '') => ({
  pair: { correct: `Es ist passiert${tag}.`, wrong: `Es hat passiert${tag}.`, explanation: 'e' },
  gap: { full: `Was ist passiert${tag}?`, sentence: `Was ___ passiert${tag}?`, answer: 'ist', acceptable: [], explanation: 'e' },
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

// ---- rule quality (#30, #31) ----

// The two rules from the bug reports, as they were stored.
const issue31 = {
  item: { ...newRuleItem(rule({ category: 'spelling', key: 'compound_one_word', name: 'Rechtschreibung', statement: 'Wörter müssen korrekt geschrieben werden.' }), NOW), verified: undefined },
  mistake: { id: 'm31', original: 'Herauseforderung', corrected: 'Herausforderung', category: 'spelling', rule: 'compound_one_word', ruleChecked: true,
    fullSentence: 'Wir stehen vor einer großen Herauseforderung.', correctedSentence: 'Wir stehen vor einer großen Herausforderung.', createdAt: NOW, updatedAt: NOW },
};
const issue30 = {
  item: { ...newRuleItem(rule({ category: 'connectors', key: 'damit_um_zu', name: 'Infinitive mit zu', statement: 'Bei identischem Subjekt …' }), NOW), verified: undefined },
  mistake: { id: 'm30', original: 'hofft bestehen', corrected: 'hofft, … zu bestehen', category: 'connectors', rule: 'damit_um_zu', ruleChecked: true,
    fullSentence: 'Sie hofft die Prüfung bestehen.', correctedSentence: 'Sie hofft, die Prüfung zu bestehen.', createdAt: NOW, updatedAt: NOW },
};

test('a typo or an umlaut slip is a mistake without a rule', () => {
  assert.equal(ruleFrom({ ...issue31.mistake, rulePattern: 'typo' }, 'de'), null);
  assert.equal(ruleFrom({ original: 'schon', corrected: 'schön', category: 'spelling', rule: 'umlaut_letters', ruleName: 'Umlaute' }, 'de'), null,
    'spelling rules only come from the standard list');
  assert.equal(ruleFrom({ ...issue31.mistake, rulePattern: 'compound noun' }, 'de'), null, 'not two words joined: not the compound rule');
  assert.equal(ruleFrom({ original: 'Haus Tür', corrected: 'Haustür', category: 'spelling', rule: 'compound_one_word' }, 'de').key, 'compound_one_word');
  assert.equal(ruleFrom({ original: 'Strasse', corrected: 'Straße', category: 'spelling', rule: 'ss_eszett' }, 'de'), null, '#39: the ß/ss rule is retired');
});

test('a standard rule brings its own category and wording, and must show in the text', () => {
  assert.equal(ruleFrom(issue30.mistake, 'de'), null, 'no damit or um: not the damit/um zu rule');
  const r = ruleFrom({ ...issue30.mistake, rule: 'zu_infinitive', ruleName: 'Irgendwas' }, 'de');
  assert.deepEqual([r.category, r.name, r.level], ['verb_complex', 'Infinitiv mit zu', 'B1']);
  assert.equal(ruleFrom({ ...issue30.mistake, rule: 'zu_infinitive' }, 'de', 'en').name, 'Infinitive with zu');
  const own = ruleFrom({ original: 'a', corrected: 'b', category: 'case', rule: 'nach_hause', ruleName: 'nach Hause', rulePattern: 'nach Hause for going home' }, 'de');
  assert.deepEqual([own.name, own.pattern], ['nach Hause', 'nach Hause for going home']);
  assert.equal(ruleText({ ...issue31.item.rule }, 'de').name, 'Komposita zusammen', 'shown in its own wording, whatever was stored');
  assert.equal(rulePrompt(issue31.item.rule).statement, 'Compound nouns are written as one word');
});

test('a gap must give back its full sentence; the hint goes when it is filled in', () => {
  assert.equal(fillGap('Sie hofft, ihre Prüfung ___ (bestehen).', 'zu bestehen'), 'Sie hofft, ihre Prüfung zu bestehen.');
  assert.equal(fillGap('Er ___ gekommen.', 'ist'), 'Er ist gekommen.');
  const ok = { full: 'Sie hofft, ihre Prüfung zu bestehen.', sentence: 'Sie hofft, ihre Prüfung ___ (bestehen).', answer: 'zu bestehen' };
  assert.ok(valid('gap', ok));
  assert.ok(!valid('gap', { ...ok, sentence: 'Sie hofft ___ (bestehen) ihre Prüfung nächste Woche.' }), '#30');
  assert.ok(!valid('gap', { sentence: 'Er ___ gekommen.', answer: 'ist' }), 'no full sentence, no check');
  assert.ok(!valid('pair', { correct: 'Ich plane, nach Berlin zu reisen.', wrong: 'Ich plane nach Berlin reisen zu.' }), 'two places differ');
  assert.ok(valid('pair', { correct: 'Ich plane, nach Berlin zu reisen.', wrong: 'Ich plane nach Berlin zu reisen.' }));
  assert.ok(!valid('spot', { text: 'a b c d e f g h', corrected: 'x b y d z f g h' }), 'three places differ');
  assert.ok(!valid('transform', { instruction: 'i', items: [{ prompt: 'Er geht.', answer: 'Er geht.' }] }));
});

test('explanations that bring up the learner\'s own mistake or a missing trigger are dropped', () => {
  const gap = { full: 'Das Projekt stellt uns vor eine große Herausforderung.', sentence: 'Das Projekt stellt uns vor eine große ___.', answer: 'Herausforderung',
    trigger: 'Herausforderung', explanation: "Herausforderung wird mit 'aus' und nicht mit 'ause' geschrieben." };
  assert.equal(tidy('gap', gap).explanation, '', "#31: 'ause' is not in the exercise");
  assert.equal(tidy('gap', { ...gap, explanation: "»Herausforderung« ist ein Nomen." }).explanation, '»Herausforderung« ist ein Nomen.');
  const leaky = { ...gap, explanation: 'Nicht Herauseforderung schreiben.' };
  assert.equal(tidy('gap', leaky, mistakeWords([issue31.mistake])).explanation, '');
  assert.equal(tidy('pair', { correct: 'Er ist gekommen.', wrong: 'Er hat gekommen.', trigger: 'gegangen', explanation: 'x' }).explanation, '');
  assert.equal(tidy('gap', { ...gap, sentence: 'Wir sind ___ (gegangen).', answer: 'gegangen' }).sentence, 'Wir sind ___.', 'a hint that is the answer goes');
  const leakyArticle = { ...leaky, sentence: 'Das Projekt stellt uns vor ___ große Herausforderung.', answer: 'eine' };
  const it = addSet(newRuleItem(rule(), NOW), { ...set(), gap: leakyArticle }, { learnerWords: mistakeWords([issue31.mistake]) });
  assert.equal(it.pool.gap[0].explanation, '', 'cleared when it joins the pool');
  assert.deepEqual(kindsToAsk(it), ['gap', 'transform']);
  assert.deepEqual(kindsToAsk({ ...it, rung: 5 }), ['produce']);
});

test('older rules: the two misfiled ones are suspect, a sound one is not', () => {
  assert.ok(suspectRule(issue31.item, [issue31.mistake]));
  assert.ok(suspectRule(issue30.item, [issue30.mistake]));
  const good = newRuleItem(ruleFrom({ original: 'Haus Tür', corrected: 'Haustür', category: 'spelling', rule: 'compound_one_word' }, 'de'), NOW);
  const ms = [{ original: 'Haus Tür', corrected: 'Haustür' }, { original: 'Bahn Hof', corrected: 'Bahnhof' }];
  assert.ok(!suspectRule(good, ms));
  assert.ok(suspectRule(good, ms.slice(0, 1)), 'a single mistake is looked at again');
});

test('re-filing: mistakes move to the rule named now, empty rules go', () => {
  store._setData({ mistakes: [issue31.mistake, issue30.mistake].map((m) => ({ ...m })), reviewItems: [issue31.item, issue30.item].map((x) => ({ ...x })) });
  store.refileRules([issue31.item, issue30.item], [
    { id: 'm31', r: { rulePattern: 'typo', rule: '', category: 'spelling' } },
    { id: 'm30', r: { rulePattern: 'zu + infinitive after hoffen', rule: 'zu_infinitive', category: 'connectors' } },
  ], NOW);
  assert.equal(store.reviewItemFor('rule', 'spelling/compound_one_word'), undefined);
  assert.equal(store.reviewItemFor('rule', 'connectors/damit_um_zu'), undefined);
  const moved = store.reviewItemFor('rule', 'verb_complex/zu_infinitive');
  assert.equal(moved.rung, START_RUNG, 'starts fresh');
  assert.equal(moved.rule.name, 'Infinitiv mit zu');
  assert.deepEqual([store.getMistake('m30').category, store.getMistake('m30').rule], ['verb_complex', 'zu_infinitive']);
  assert.deepEqual([store.getMistake('m31').category, store.getMistake('m31').rule], ['spelling', '']);
});

test('deleting a rule keeps its mistakes', () => {
  store._setData({ mistakes: [{ ...issue30.mistake }], reviewItems: [{ ...issue30.item }] });
  store.deleteRule(issue30.item.id, NOW);
  assert.equal(store.ruleItems('de').length, 0);
  assert.equal(store.getMistake('m30').rule, '');
});

test('exercises made before the checks are not served', () => {
  const it = { ...newRuleItem(rule(), NOW), pool: { gap: [{ sentence: 'Sie hofft ___ (bestehen) ihre Prüfung.', answer: 'zu bestehen' }] } };
  assert.equal(nextExercise(it), null);
  assert.deepEqual(topUpList([it], { now: NOW }).map((r) => r.id), [it.id]);
});

// ---- #36 to #40 ----

test('#36: a German gap may not hide a noun the learner has to guess', () => {
  const analyse = { full: 'Für dieses komplexe Problem müssen wir eine gründliche Analyse erstellen.',
    sentence: 'Für dieses komplexe Problem müssen wir eine gründliche ___ erstellen.', answer: 'Analyse' };
  assert.ok(!valid('gap', analyse, 'de'));
  assert.ok(valid('gap', analyse, 'fr'), 'only checked for German');
  assert.ok(valid('gap', { ...analyse, sentence: 'Für dieses komplexe Problem müssen wir eine gründliche ___ (Analyse) erstellen.', answer: 'Analysen',
    full: 'Für dieses komplexe Problem müssen wir eine gründliche Analysen erstellen.' }, 'de'), 'named in brackets');
  assert.ok(valid('gap', { full: 'Wir brauchen eine gründliche Analyse.', sentence: 'Wir brauchen ___ gründliche Analyse.', answer: 'eine' }, 'de'));
  assert.ok(valid('gap', { full: 'Diese Analyse ist gut.', sentence: '___ Analyse ist gut.', answer: 'Diese' }, 'de'), 'the first word is capitalised anyway');
  const item = { ...newRuleItem(rule({ category: 'gender', key: 'gender_by_suffix' }), NOW), pool: { gap: [{ ...analyse, explanation: 'x' }] } };
  assert.deepEqual(poolOf(item).gap, [], 'the saved one from the report is no longer served');
});

test('#39: German without ß or umlauts counts as the same spelling', () => {
  assert.equal(compare('Massnahmen', 'Maßnahmen', 'de'), 'correct');
  assert.equal(compare('Maedchen', 'Mädchen', 'de'), 'correct');
  assert.equal(compare('UEBER', 'über', 'de'), 'almost');
  assert.equal(compare('Massnahmen', 'Maßnahmen'), 'wrong', 'other languages keep their letters');
  assert.equal(compare('haer', 'här', 'sv'), 'wrong');
  assert.equal(compareExact('Die Strasse ist lang.', 'Die Straße ist lang.', 'de'), 'correct');
  const word = { lang: 'de', lemma: 'Maßnahme', article: 'die', pos: 'noun', plural: 'Maßnahmen' };
  const r = checkRecall(word, 'die Massnahme', 'Massnahmen');
  assert.equal(r.grade, 'correct');
  assert.equal(checkRecall(word, 'der Massnahme', 'Massnahmen').plural, 'correct', 'the plural is right even when the article is not');
  assert.deepEqual(wordDiff('der Massnahme', 'die Maßnahme', 'de').filter((p) => p.type !== 'same').map((p) => p.text.trim()), ['der', 'die']);
  assert.deepEqual(fixPairs('wrong', [['Massnahmen', 'Maßnahmen']], 'de'), []);
});

test('#39: the ß/ss rule and spelling-only mistakes go once', () => {
  const data = {
    version: 2,
    mistakes: [
      { id: 'a', lang: 'de', original: 'Strasse', corrected: 'Straße', category: 'spelling', rule: 'ss_eszett' },
      { id: 'b', lang: 'de', original: 'Strase', corrected: 'Straße', category: 'spelling', rule: 'ss_eszett' },
      { id: 'c', lang: 'de', original: 'der', corrected: 'die', category: 'gender', rule: '' },
    ],
    reviewItems: [newRuleItem(rule({ category: 'spelling', key: 'ss_eszett' }), NOW), newRuleItem(rule(), NOW)],
  };
  const touched = [];
  assert.ok(migrateData(data, (r) => touched.push(r.id)));
  assert.deepEqual(data.mistakes.map((m) => [m.id, m.rule]), [['b', ''], ['c', '']]);
  assert.deepEqual(touched, ['b']);
  assert.ok(!data.reviewItems.some((r) => r.rule?.key === 'ss_eszett'));
  assert.equal(data.reviewItems.length, 1);
  assert.equal(data.version, DATA_VERSION);
  assert.ok(!migrateData(data, () => {}), 'only once');
});
