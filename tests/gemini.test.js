import test from 'node:test';
import assert from 'node:assert/strict';
import { describe } from '../js/languages.js';
import * as words from '../js/gemini/words.js';
import * as sentences from '../js/gemini/sentences.js';
import * as grading from '../js/gemini/grading.js';
import * as grammar from '../js/gemini/grammar.js';
import { setupLanguage } from '../js/gemini/setup.js';
import { replyJson, GeminiError } from '../js/gemini/client.js';

// The feature files build prompts and clean replies without the app's data, so they are tested
// here with a learner context and saved sample replies, including broken ones.
const de = { L: { ...describe('de'), level: 'B2' }, ui: 'de', rules: [] };
const ja = { L: { ...describe('ja'), level: 'N3' }, ui: 'en', rules: [] };

test('replyJson reads the answer, skips thoughts and unwraps ```json', () => {
  const reply = (...parts) => ({ candidates: [{ content: { parts } }] });
  assert.deepEqual(replyJson(reply({ text: '{"ok":true}' })), { ok: true });
  assert.deepEqual(replyJson(reply({ thought: true, text: 'hmm' }, { text: '```json\n{"a":1}\n```' })), { a: 1 });
  assert.throws(() => replyJson(reply({ text: 'Sorry, I cannot help.' })), GeminiError);
  assert.throws(() => replyJson({}), GeminiError);
});

test('lookup: "none" article is cleared, extra examples are split and deduplicated', () => {
  const r = words.lookup.read({
    found: true, lemma: 'schnell', article: 'none', example: 'Er läuft schnell.',
    moreExamples: [
      { text: ' Das ging schnell. ', translation: 'That was quick.', gapSentence: 'Das ging ___.', gapAnswer: 'schnell', gapAcceptable: [] },
      { text: 'Er läuft schnell.', translation: 'dup of the example' },
      null,
      { text: '' },
    ],
  }, de, 'schnell', '');
  assert.equal(r.article, '');
  assert.deepEqual(r.moreExamples, [{ text: 'Das ging schnell.', translation: 'That was quick.' }]);
  assert.deepEqual(r.moreGaps, [{ gapSentence: 'Das ging ___.', gapAnswer: 'schnell', gapAcceptable: [], translation: 'That was quick.' }]);
  assert.equal(r.furigana, undefined, 'no furigana for German');
});

test('lookup: Japanese furigana is kept only where it matches its text', () => {
  const r = words.lookup.read({
    found: true, lemma: '水', example: '水を飲む。', gapSentence: '___を飲む。',
    exampleFurigana: '{水|みず}を{飲|の}む。', gapFurigana: '{違|ちが}う', contextFurigana: '{毎朝|まいあさ}',
    moreExamples: [{ text: '水が冷たい。', translation: 'The water is cold.', furigana: '{水|みず}が{冷|つめ}たい。' },
      { text: '水です。', translation: '', furigana: 'wrong' }],
  }, ja, '水', '毎朝');
  assert.deepEqual(r.furigana, ['{水|みず}を{飲|の}む。', '{毎朝|まいあさ}', '{水|みず}が{冷|つめ}たい。']);
  assert.equal(r.exampleFurigana, undefined);
});

test('lookup prompt: Japanese asks for furigana, a context sentence for its own', () => {
  const { schema, prompt } = words.lookup.ask(ja, 'mizu', '毎朝水を飲む');
  assert.ok(schema.properties.exampleFurigana && schema.properties.contextFurigana);
  assert.match(prompt, /Context sentence where the learner found it: "毎朝水を飲む"/);
  assert.equal(words.lookup.ask(ja, 'mizu', '').schema.properties.contextFurigana, undefined);
  assert.equal(words.lookup.ask(de, 'x', '').schema.properties.exampleFurigana, undefined);
});

test('suggestWords: entries without a lemma are dropped', () => {
  const r = words.suggestWords.read({ words: [null, { lemma: '' }, { lemma: 'Zug', article: 'none' }] }, de);
  assert.deepEqual(r, [{ lemma: 'Zug', article: '' }]);
  assert.deepEqual(words.suggestWords.read({}, de), []);
});

test('lists keep their order and length when Gemini returns too few', () => {
  assert.deepEqual(words.gapSentences.read({ words: [{ sentences: [{ sentence: 'a ___' }] }] }, de, [{}, {}]), [[{ sentence: 'a ___' }], []]);
  assert.deepEqual(words.translateTexts.read({ translations: [' one '] }, de, ['eins', 'zwei']), ['one', '']);
  assert.deepEqual(words.annotate.read({ texts: ['{水|みず}', 'wrong'] }, null, ['水', '日']), ['{水|みず}']);
});

test('grading replies: register mistakes and matching tone hints are dropped', () => {
  const r = grading.gradeTranslation.read({
    correct: true, toneMatches: true, toneHint: 'say Sie', correctedText: 'Ich fahre.', natural: ' Ich fahre. ', naturalReason: 'x',
    mistakes: [{ category: 'register' }, { category: 'word_choice', wordToLearn: { lemma: 'fahren', article: 'none' } }],
  });
  assert.deepEqual(r.mistakes, [{ category: 'word_choice', wordToLearn: { lemma: 'fahren', article: '' } }]);
  assert.equal(r.toneHint, '');
  assert.equal(r.natural, '', 'a "natural" version equal to the correction is not shown');
  assert.equal(r.naturalReason, '');
  assert.deepEqual(grading.gradeTranslation.read({}).mistakes, []);
});

test('verdicts from malformed replies become plain booleans and strings', () => {
  assert.deepEqual(grading.checkGap.read({}), { correct: false, feedback: '' });
  assert.deepEqual(grading.checkGap.read({ correct: 'yes', feedback: 3 }), { correct: true, feedback: '3' });
  assert.deepEqual(grading.judgeAnswer.read({ correct: true, minor: true, sameMeaning: true }),
    { correct: true, minor: false, sameMeaning: false, feedback: '', correctedText: '' });
  assert.deepEqual(grading.judgeAnswer.read({ correct: false, minor: 1 }), { correct: false, minor: true, sameMeaning: false, feedback: '', correctedText: '' });
});

test('check again: the first verdict goes into the prompt and the temperature drops to 0', () => {
  const first = sentences.correctText.ask(de, 'Ich habe gefahren.');
  assert.equal(first.temperature, 0.2);
  assert.doesNotMatch(first.prompt, /second check/);
  const again = sentences.correctText.ask(de, 'Ich habe gefahren.', { recheck: { correct: false, feedback: 'Perfekt mit sein' } });
  assert.equal(again.temperature, 0);
  assert.match(again.prompt, /First verdict: not correct \("Perfekt mit sein"\)/);
});

test('prompts reuse the learner\'s rules and explain in the interface language', () => {
  const c = { ...de, ui: 'en', rules: [{ category: 'verb_complex', key: 'perfekt_sein', name: 'Perfekt mit sein' }] };
  const { prompt } = grammar.classifyMistakes.ask(c, [{ original: 'habe gefahren', corrected: 'bin gefahren' }]);
  assert.match(prompt, /- verb_complex\/perfekt_sein: Perfekt mit sein/);
  assert.match(prompt, /1\. wrote "habe gefahren" instead of "bin gefahren"/);
  assert.match(sentences.correctText.ask(c, 'x').prompt, /Write explanations in English\./);
  assert.match(sentences.correctText.ask(de, 'x').prompt, /Write explanations in German \(simple, clear German at B2 level\)\./);
});

test('translateSentence: a kept sentence stays exactly as typed and an unknown tone falls back', () => {
  const r = sentences.translateSentence.read({ sentence: 'changed', tone: 'weird' }, de, '  Ich fahre.  ', 'formal', { keep: true });
  assert.equal(r.sentence, 'Ich fahre.');
  assert.equal(r.tone, 'everyday');
  assert.equal(sentences.translateSentence.read({ tone: 'weird' }, de, 'x', 'formal').tone, 'formal');
});

test('ruleExercises: every exercise gets an id, missing sets become empty', () => {
  const sets = grammar.ruleExercises.read({ sets: [{ pair: { correct: 'a', wrong: 'b' }, gap: { sentence: '___' }, spot: { text: 'x' } }] }, de,
    [{ kinds: ['pair', 'gap'] }, { kinds: ['gap'] }]);
  assert.equal(sets[0].spot, undefined, 'only the kinds asked for are kept');
  assert.ok(sets[0].pair.id && sets[0].gap.id && sets[0].pair.id !== sets[0].gap.id);
  assert.deepEqual(sets[1], {});
});

test('setupLanguage: rejects a bad code and tidies the articles', () => {
  assert.equal(setupLanguage.read({ found: true, code: 'Spanish' }, 'Spanish'), null);
  assert.equal(setupLanguage.read({ found: false, code: 'es' }, 'x'), null);
  const r = setupLanguage.read({ found: true, code: 'ES', english: '', articles: [' el ', '', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo'], categories: [] }, 'Spanisch');
  assert.equal(r.code, 'es');
  assert.equal(r.english, 'Spanisch');
  assert.deepEqual(r.articles, ['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas']);
});

// Without propertyOrdering Gemini writes fields alphabetically, so a mistake's category came
// before its rule (#30).
test('schemas keep their field order: pattern, then rule, then category', () => {
  const { schema } = sentences.correctText.ask(de, 'x');
  const m = schema.properties.mistakes.items;
  const order = m.propertyOrdering;
  assert.ok(order.indexOf('correctedSentence') < order.indexOf('rulePattern'));
  assert.ok(order.indexOf('rulePattern') < order.indexOf('rule') && order.indexOf('rule') < order.indexOf('category'));
  const c = grammar.classifyMistakes.ask(de, [{ original: 'a', corrected: 'b' }]).schema.properties.mistakes.items.propertyOrdering;
  assert.deepEqual(c.slice(0, 4), ['original', 'rulePattern', 'rule', 'category']);
});

test('rule keys: standard rules listed flat with their category, typos get none, real cases as examples', () => {
  const { prompt } = sentences.correctText.ask(de, 'x');
  assert.match(prompt, /- zu_infinitive: Infinitive with zu .* \[verb_complex\] \(B1\)/);
  assert.match(prompt, /"Herauseforderung" → "Herausforderung": rulePattern "typo", rule ""/);
  assert.match(prompt, /not damit_um_zu/);
  assert.match(prompt, /a missing or extra umlaut/);
});

test('classifyMistakes: answers that come back out of order are not used', () => {
  const list = [{ original: 'a' }, { original: 'b' }];
  assert.deepEqual(grammar.classifyMistakes.read({ mistakes: [{ original: 'A', rule: 'x' }, { original: 'b', rule: '' }] }, de, list).map((x) => x.rule), ['x', '']);
  assert.throws(() => grammar.classifyMistakes.read({ mistakes: [{ original: 'b' }] }, de, list));
  assert.throws(() => grammar.classifyMistakes.read({ mistakes: [{ original: 'b' }, { original: 'a' }] }, de, list));
});

test('ruleExercises: no wrong sentences of the learner, only the kinds needed, a full sentence per gap', () => {
  const std = { lang: 'de', category: 'spelling', key: 'compound_one_word', name: 'Rechtschreibung', statement: 'Wörter richtig schreiben.' };
  const own = { lang: 'de', category: 'case', key: 'nach_hause', name: 'nach Hause', statement: 'Für den Heimweg sagt man nach Hause.', pattern: 'nach Hause for going home' };
  const ask = grammar.ruleExercises.ask(de, [
    { rule: std, kinds: ['gap', 'transform'], examples: [] },
    { rule: own, kinds: ['spot'], examples: ['Ich gehe nach Hause.'] },
  ]);
  assert.match(ask.prompt, /1\. \[spelling\/compound_one_word\] Compound nouns are written as one word \(A2\)/, 'the standard statement, not the stored one');
  assert.doesNotMatch(ask.prompt, /Rechtschreibung|Wörter richtig/);
  assert.match(ask.prompt, /Pattern: nach Hause for going home\n {3}Correct example: "Ich gehe nach Hause\."/);
  assert.match(ask.prompt, /NOT "Sie hofft ___ \(bestehen\) ihre Prüfung\."/);
  assert.match(ask.prompt, /never a word the learner would have to guess/, '#36');
  assert.match(ask.prompt, /The instruction says exactly what to change/, '#38');
  assert.match(ask.prompt, /at B1 level/, 'explanations one level simpler');
  assert.equal(ask.temperature, 0.6);
  const sets = ask.schema.properties.sets.items;
  assert.deepEqual(Object.keys(sets.properties), ['gap', 'transform', 'spot']);
  assert.deepEqual(sets.properties.gap.propertyOrdering.slice(0, 3), ['full', 'answer', 'sentence']);
});

test('#37: the grader corrects first and decides last', () => {
  const ask = grading.gradeAnswer.ask(de, { instruction: 'i', prompt: 'p', model: 'm', answer: 'a', category: 'verb_complex' });
  const order = ask.schema.propertyOrdering;
  assert.ok(order.indexOf('correctedText') < order.indexOf('correct'));
  assert.equal(order[order.length - 1], 'correct');
  assert.match(ask.prompt, /a part the learner left as it was is not a mistake/);
});

test('#40: recall asks whether another word means the same; #38: a correction comes back', () => {
  const plain = grading.judgeAnswer.ask(de, { instruction: 'i', expected: 'e', answer: 'a' });
  assert.ok(!('sameMeaning' in plain.schema.properties));
  assert.equal(plain.schema.propertyOrdering[0], 'correctedText');
  const recall = grading.judgeAnswer.ask(de, { instruction: 'i', expected: 'auf eine Fährte geraten', answer: 'auf dem falschen Weg', meaning: true });
  assert.ok('sameMeaning' in recall.schema.properties);
  assert.match(recall.prompt, /sameMeaning is true when it is a different German word or phrase/);
  assert.deepEqual(grading.judgeAnswer.read({ correct: false, sameMeaning: true, correctedText: 'x' }),
    { correct: false, minor: false, sameMeaning: true, feedback: '', correctedText: 'x' });
});

test('#39: ss for ß and ae for ä are never mistakes in German', () => {
  assert.match(grading.judgeAnswer.ask(de, { instruction: 'i', expected: 'e', answer: 'a' }).prompt, /Writing ss for ß/);
  assert.doesNotMatch(grading.judgeAnswer.ask(ja, { instruction: 'i', expected: 'e', answer: 'a' }).prompt, /Writing ss for ß/);
  assert.match(sentences.correctText.ask(de, 'Die Strasse.').prompt, /- Writing ss for ß/);
  const r = grading.gradeAnswer.read({ correct: false, mistakes: [
    { original: 'Strasse', corrected: 'Straße', category: 'spelling' },
    { original: 'Maedchen', corrected: 'Mädchen', category: 'spelling' },
    { original: 'der', corrected: 'die', category: 'gender' },
  ] }, de);
  assert.deepEqual(r.mistakes.map((m) => m.original), ['der']);
  assert.equal(grading.gradeAnswer.read({ mistakes: [{ original: 'Strasse', corrected: 'Straße' }] }, ja).mistakes.length, 1, 'other languages keep them');
});
