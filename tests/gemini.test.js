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
  assert.deepEqual(grammar.classifyMistakes.read({ mistakes: [{ category: 'x' }] }, de, [{}, {}]), [{ category: 'x' }, null]);
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
  assert.deepEqual(grading.judgeAnswer.read({ correct: true, minor: true }), { correct: true, minor: false, feedback: '' });
  assert.deepEqual(grading.judgeAnswer.read({ correct: false, minor: 1 }), { correct: false, minor: true, feedback: '' });
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
  const sets = grammar.ruleExercises.read({ sets: [{ pair: { correct: 'a', wrong: 'b' }, gap: { sentence: '___' } }] }, de, [{}, {}]);
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
