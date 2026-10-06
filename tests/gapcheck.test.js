import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGap, kanaForm } from '../js/check.js';
import { poolFromLookup, pickGap, afterGap, addToPool } from '../js/gappool.js';
import { buildSession } from '../js/session.js';
import { answerRecord, requeueAt } from '../js/answer.js';
import { DAY } from '../js/srs.js';

// A Japanese lookup of the English "to eat", shaped like Gemini's answer.
const lookup = {
  lemma: '食べる', reading: 'たべる', pos: 'verb', meaning: 'to eat', recallAnswer: '食べる',
  example: '毎朝パンを食べます。', exampleTranslation: 'I eat bread every morning.',
  gapSentence: '毎朝パンを___。', gapAnswer: '食べます',
  moreGaps: [{ gapSentence: '昨日すしを___。', gapAnswer: '食べました', translation: 'Yesterday I ate sushi.' },
    { gapSentence: '一緒に昼ご飯を___ませんか。', gapAnswer: '食べ', translation: 'Shall we have lunch together?' }],
};
const taberu = { id: 'w1', lang: 'ja', ...lookup };
const gap = (answer, acceptable = []) => ({ sentence: '毎朝パンを___。', answer, acceptable });

test('a Japanese gap takes the expected form, its kana and the forms Gemini listed', () => {
  assert.equal(checkGap(taberu, gap('食べます'), '食べます').grade, 'correct');
  assert.equal(checkGap(taberu, gap('食べます', ['食べる']), '食べる').grade, 'correct');
  assert.deepEqual(checkGap(taberu, gap('食べます'), 'たべます'), { grade: 'almost', byReading: true, byForm: false });
  assert.equal(checkGap(taberu, gap('食べます'), 'タベマス').grade, 'almost');
  assert.equal(checkGap(taberu, gap('食べます'), 'たべ ます').grade, 'almost');
});

test('the dictionary form of a Japanese word in its gap counts as almost', () => {
  assert.deepEqual(checkGap(taberu, gap('食べます'), '食べる'), { grade: 'almost', byReading: false, byForm: true });
  assert.equal(checkGap(taberu, gap('食べます'), 'たべる').grade, 'almost');
});

test('other words and wrong forms are still wrong', () => {
  assert.equal(checkGap(taberu, gap('食べます'), '飲みます').grade, 'wrong');
  assert.equal(checkGap(taberu, gap('食べます'), 'たべました').grade, 'wrong');
  assert.equal(checkGap(taberu, gap('食べます'), '').grade, 'wrong');
});

test('German gaps are unchanged: the infinitive is not the inflected form', () => {
  const essen = { id: 'w2', lemma: 'essen', meaning: 'to eat' };
  const g = { sentence: 'Ich ___ jeden Morgen Brot.', answer: 'esse', acceptable: [] };
  assert.equal(checkGap(essen, g, 'esse').grade, 'correct');
  assert.equal(checkGap(essen, g, 'Esse').grade, 'almost');
  assert.equal(checkGap(essen, g, 'essen').grade, 'wrong');
  assert.equal(checkGap(essen, { ...g, acceptable: ['aß'] }, 'aß').grade, 'correct');
});

test('kana forms come from the kanji readings in the dictionary form', () => {
  assert.equal(kanaForm('食べました', taberu), 'たべました');
  assert.equal(kanaForm('勉強します', { lemma: '勉強する', reading: 'べんきょうする' }), 'べんきょうします');
  assert.equal(kanaForm('一緒に食べ', taberu), null); // 一緒 can't be read from 食べる
  assert.equal(kanaForm('食べます', { lemma: '食べる' }), null); // no reading saved
});

test('pool entries keep the other right forms, without repeats or the answer itself', () => {
  const p = poolFromLookup({ ...lookup, gapAcceptable: ['食べる', ' 食べます ', '食べる', ''] });
  assert.deepEqual(pickGap({ ...taberu, gapPool: p }).acceptable, ['食べる']);
  const added = addToPool([], [{ sentence: 'A ___', answer: 'x', acceptable: 'not a list' }]);
  assert.deepEqual(added[0].acceptable, []);
});

// The reported bug: a learner who knows the word types it the way they learnt it (dictionary
// form, or kana) and gets the same sentence back every time. Daily sessions over two months.
function run(answerOf) {
  let now = new Date('2026-10-06T09:00:00').getTime();
  let word = { ...taberu, gapPool: poolFromLookup(lookup) };
  let item = { id: 'word:w1', itemType: 'word', itemId: 'w1', due: now, reps: 0, lapses: 0 };
  const shown = [];
  for (let day = 0; day < 60; day++, now += DAY) {
    const tasks = buildSession({ items: [item], words: [word], mistakes: [], reviews: [], settings: {}, gemini: true, now });
    const again = new Set();
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      let grade = 'correct';
      if (task.kind === 'gap') {
        task.gap ||= pickGap(word, item.reps);
        shown.push(task.gap.sentence);
        grade = checkGap(word, task.gap, answerOf(task.gap)).grade;
      }
      if (again.has(task)) continue;
      item = answerRecord(task, item, { grade, answer: '', practice: false, lang: 'ja', now }).saved;
      if (task.kind === 'gap') word = { ...word, ...afterGap(word, task.gap.sentence, grade, now) };
      const at = requeueAt(task, grade, { practice: false, idx: i, length: tasks.length });
      if (at >= 0) { again.add(task); tasks.splice(at, 0, task); }
    }
  }
  const counts = {};
  for (const s of shown) counts[s] = (counts[s] || 0) + 1;
  return counts;
}

test('a learner typing the dictionary form or kana is not stuck on one sentence', () => {
  for (const answerOf of [() => '食べる', (g) => kanaForm(g.answer, taberu) || 'たべる']) {
    const counts = run(answerOf);
    assert.ok(Object.keys(counts).length >= 2, JSON.stringify(counts));
    assert.ok(Object.values(counts).every((n) => n === 1), JSON.stringify(counts));
  }
});

test('a wrong answer still brings the same sentence back until it is right', () => {
  const counts = run(() => '飲みます');
  assert.deepEqual(Object.keys(counts), ['毎朝パンを___。']);
});

test('full-width or long gap marks count as the gap', () => {
  const p = poolFromLookup({ gapSentence: '毎朝パンを＿＿＿。', gapAnswer: '食べます',
    moreGaps: [{ gapSentence: '昨日すしを_____。', gapAnswer: '食べました' }, { gapSentence: '一緒に＿食べませんか。', gapAnswer: '昼ご飯を' }] });
  assert.deepEqual(p.map((e) => e.sentence), ['毎朝パンを___。', '昨日すしを___。', '一緒に___食べませんか。']);
  assert.equal(pickGap({ ...taberu, gapSentence: '毎朝パンを＿＿＿。', gapPool: undefined }).sentence, '毎朝パンを___。');
});
