import test from 'node:test';
import assert from 'node:assert/strict';
import { align, parse, strip, segmentsFor, cutChunks, toHtml, missing, toHira } from '../js/furigana.js';

const show = (segs) => segs && segs.map((s) => (s.rt ? `${s.text}(${s.rt})` : s.text)).join('');

test('a word lines up with its reading around the kana it contains', () => {
  assert.equal(show(align('食べる', 'たべる')), '食(た)べる');
  assert.equal(show(align('引っ越し', 'ひっこし')), '引(ひ)っ越(こ)し');
  assert.equal(show(align('日本', 'にほん')), '日本(にほん)');
  assert.equal(show(align('聞き取り', 'ききとり')), '聞(き)き取(と)り');
  assert.equal(show(align('お茶', 'おちゃ')), 'お茶(ちゃ)');
  assert.equal(show(align('人々', 'ひとびと')), '人々(ひとびと)');
});

test('katakana in the word or the reading still lines up', () => {
  assert.equal(show(align('アルバイト先', 'あるばいとさき')), 'アルバイト先(さき)');
  assert.equal(show(align('食べる', 'タベル')), '食(た)べる');
});

test('no furigana when word and reading do not fit', () => {
  assert.equal(align('食べる', 'のむ'), null);
  assert.equal(align('たべる', 'たべる'), null, 'no kanji');
  assert.equal(align('食べる', 'taberu'), null, 'reading not in kana');
  assert.equal(align('食べる', ''), null);
});

test('Gemini markup is used only when it gives back the exact text', () => {
  const plain = '毎日、手を洗う。';
  assert.equal(show(parse('{毎日|まいにち}、{手|て}を{洗|あら}う。', plain)), '毎日(まいにち)、手(て)を洗(あら)う。');
  assert.equal(parse('{毎日|まいにち}、手を洗った。', plain), null, 'different text');
  assert.equal(parse('{毎日|mainichi}、{手|て}を{洗|あら}う。', plain), null, 'reading not kana');
  assert.equal(parse('{、|てん}{毎日|まいにち}手を洗う。', '、毎日手を洗う。'), null, 'markup over kana');
  assert.equal(parse('毎日、手を洗う。', plain), null, 'no readings at all');
  assert.equal(strip('{食|た}べる'), '食べる');
});

test('gap sentences keep their gap', () => {
  assert.equal(show(parse('{毎朝|まいあさ}___を{飲|の}む。', '毎朝___を飲む。')), '毎朝(まいあさ)___を飲(の)む。');
});

test('a record gives furigana for its word and for any stored sentence', () => {
  const w = { lang: 'ja', lemma: '飲む', reading: 'のむ', example: '水を飲む。', furigana: ['{水|みず}を{飲|の}む。'] };
  assert.equal(show(segmentsFor('飲む', w)), '飲(の)む');
  assert.equal(show(segmentsFor('水を飲む。', w)), '水(みず)を飲(の)む。');
  assert.equal(segmentsFor('お茶を飲む。', w), null);
  assert.equal(segmentsFor('のむ', w), null);
  // A sentence's reading is the whole sentence, so it never lines up word by word.
  const s = { lang: 'ja', kind: 'sentence', lemma: '水を飲む。', reading: 'みずをのむ。', furigana: [] };
  assert.equal(segmentsFor('水を飲む。', s), null);
});

test('word-order pieces take their part of the sentence furigana', () => {
  const segs = parse('{昨日|きのう}{友達|ともだち}と{映画|えいが}を{見|み}た。', '昨日友達と映画を見た。');
  const pieces = cutChunks(segs, ['昨日', '友達と', '映画を', '見た。']);
  assert.deepEqual(pieces.map(show), ['昨日(きのう)', '友達(ともだち)と', '映画(えいが)を', '見(み)た。']);
  // A reading spanning two pieces is dropped, not split.
  const split = cutChunks(segs, ['昨日友', '達と映画を', '見た。']);
  assert.deepEqual(split.map(show), ['昨日(きのう)友', '達と映画(えいが)を', '見(み)た。']);
  assert.equal(cutChunks(segs, ['昨日', '友達と']), null);
});

test('ruby HTML escapes its text', () => {
  assert.equal(toHtml([{ text: '<b>', rt: '' }, { text: '食', rt: 'た' }]), '&lt;b&gt;<ruby>食<rt>た</rt></ruby>');
});

test('missing lists the Japanese texts that still need furigana', () => {
  const w = { lang: 'ja', lemma: '飲む', reading: 'のむ', example: '水を飲む。', contextSentence: '', gapSentence: '水を___。', furigana: [] };
  assert.deepEqual(missing(w), ['水を飲む。', '水を___。']);
  assert.deepEqual(missing({ ...w, furigana: ['{水|みず}を{飲|の}む。'] }), ['水を___。']);
  assert.deepEqual(missing({ ...w, lang: 'de' }), []);
  const s = { lang: 'ja', kind: 'sentence', lemma: '水を飲む。', gapSentence: '', furigana: [] };
  assert.deepEqual(missing(s), ['水を飲む。']);
  assert.equal(toHira('カタカナ'), 'かたかな');
});
