import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionsMark, targetSpan, targetFits, markRuns, withTarget } from '../js/target.js';
import { valid, migrateData, unmarked } from '../js/rules.js';
import { parse, toHtml } from '../js/furigana.js';

// The set from #44: the instruction points at an underline nobody could see.
const REPORTED = {
  instruction: 'Setzen Sie das unterstrichene Substantiv in den Plural und passen Sie den Satz an.',
  items: [
    { prompt: 'Der Chef hat mir ein Lob für das Dokument gegeben.', answer: 'Der Chef hat mir ein Lob für die Dokumente gegeben.', acceptable: [] },
    { prompt: 'Ich habe heute ein wichtiges Problem im Büro gelöst.', answer: 'Ich habe heute wichtige Probleme im Büro gelöst.', acceptable: [] },
  ],
  explanation: 'e',
};

test('an instruction that points at a mark is recognised', () => {
  assert.ok(mentionsMark(REPORTED.instruction));
  assert.ok(mentionsMark('Put the underlined noun in the plural.'));
  assert.ok(mentionsMark('Ersetze das markierte Verb.'));
  assert.ok(mentionsMark('下線の言葉を丁寧にしてください。'));
  assert.ok(!mentionsMark('Setze den Satz ins Perfekt.'));
  assert.ok(!mentionsMark('Verbinde die Sätze mit „weil".'));
});

test('the target is found in its sentence, exact spelling first', () => {
  assert.deepEqual(targetSpan('Der Chef hat das Dokument.', 'Dokument'), [17, 25]);
  assert.deepEqual(targetSpan('Der Chef hat das Dokument.', 'das Dokument'), [13, 25]);
  assert.deepEqual(targetSpan('Dokument und dokument', 'dokument'), [13, 21]);
  assert.deepEqual(targetSpan('Ein Dokument.', 'DOKUMENT'), [4, 12]);
  assert.equal(targetSpan('Der Chef.', 'Dokument'), null);
  assert.equal(targetSpan('Der Chef.', ''), null);
});

test('a transformation whose target is not in the sentence is left out', () => {
  const ok = { ...REPORTED, items: REPORTED.items.map((x, i) => ({ ...x, target: ['Dokument', 'Problem'][i] })) };
  assert.ok(valid('transform', ok));
  assert.ok(targetFits({ prompt: 'Er geht.', target: '' }), 'no target is fine');
  const bad = { ...ok, items: [{ ...ok.items[0], target: 'Koffer' }, ok.items[1]] };
  assert.ok(!valid('transform', bad));
});

test('underlining cuts plain text at the target', () => {
  const runs = markRuns([{ text: 'Der Chef hat das Dokument.' }], [17, 25]);
  assert.deepEqual(runs.map((r) => [r.segs.map((s) => s.text).join(''), r.mark]),
    [['Der Chef hat das ', false], ['Dokument', true], ['.', false]]);
});

test('underlining keeps a word with its reading whole', () => {
  const text = '水を飲む。';
  const segs = parse('{水|みず}を{飲|の}む。', text);
  // Target "飲む" starts on the kanji with a reading and ends in the kana after it.
  const runs = markRuns(segs, targetSpan(text, '飲む'));
  assert.deepEqual(runs.map((r) => [toHtml(r.segs), r.mark]),
    [['<ruby>水<rt>みず</rt></ruby>を', false], ['<ruby>飲<rt>の</rt></ruby>む', true], ['。', false]]);
  // A target inside a reading's word marks the whole word.
  const inner = markRuns([{ text: '毎朝', rt: 'まいあさ' }, { text: 'です' }], [1, 2]);
  assert.deepEqual(inner.map((r) => r.mark), [true, false]);
});

test('the grader is told which word was underlined', () => {
  assert.equal(withTarget('Setze in den Plural.', ''), 'Setze in den Plural.');
  assert.match(withTarget('Setze das unterstrichene Nomen in den Plural.', 'Dokument'), /"Dokument"/);
});

test('version 4 removes saved transformations that point at a mark without a target', () => {
  const fixed = { ...REPORTED, items: REPORTED.items.map((x, i) => ({ ...x, target: ['Dokument', 'Problem'][i] })) };
  const plain = { instruction: 'Setze den Satz ins Perfekt.', items: [{ prompt: 'Er geht.', answer: 'Er ist gegangen.' }] };
  assert.ok(unmarked(REPORTED) && !unmarked(fixed) && !unmarked(plain));
  const item = { id: 'rule:number/plural_forms', itemType: 'rule', rule: { lang: 'de', category: 'number', key: 'plural_forms' },
    pool: { pair: [], gap: [], transform: [REPORTED, plain, fixed], spot: [], produce: [] } };
  const other = { id: 'rule:case/x', itemType: 'rule', rule: { lang: 'de', category: 'case', key: 'x' },
    pool: { pair: [], gap: [], transform: [plain], spot: [], produce: [] } };
  const data = { version: 3, mistakes: [], reviewItems: [item, other], words: [] };
  const touched = [];
  assert.equal(migrateData(data, (r) => touched.push(r.id)), true);
  assert.deepEqual(data.reviewItems[0].pool.transform, [plain, fixed]);
  assert.deepEqual(data.reviewItems[1].pool.transform, [plain]);
  assert.deepEqual(touched, ['rule:number/plural_forms']);
  assert.equal(data.version, 4);
});
