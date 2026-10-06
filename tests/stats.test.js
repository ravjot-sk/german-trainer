import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY } from '../js/srs.js';
import { categoryStats, byRecent, writingMistakes } from '../js/stats.js';

const NOW = new Date('2026-10-06T10:00:00').getTime();
const cats = [{ id: 'word_order', de: 'Wortstellung', en: 'Word order' }, { id: 'cases', de: 'Fälle', en: 'Cases' }, { id: 'spelling', de: 'R', en: 'S' }];
const mistake = (category, daysAgo, o = {}) => ({ category, createdAt: NOW - daysAgo * DAY, source: 'correction', ...o });
const review = (category, correct) => ({ category, correct });

test('stats: counts the last two weeks against the two before', () => {
  const mistakes = [mistake('word_order', 1), mistake('word_order', 2), mistake('word_order', 20), mistake('cases', 30)];
  const [wo, cases] = categoryStats({ mistakes, reviews: [], cats, lang: 'de', now: NOW });
  assert.deepEqual([wo.id, wo.total, wo.recent, wo.prev, wo.trend], ['word_order', 3, 2, 1, 'worse']);
  assert.deepEqual([cases.id, cases.total, cases.recent, cases.prev, cases.trend], ['cases', 1, 0, 0, 'steady']);
});

test('stats: improving needs fewer mistakes and good drill accuracy', () => {
  const mistakes = [mistake('cases', 20), mistake('cases', 21)];
  const good = [review('cases', true), review('cases', true), review('cases', true), review('cases', false)];
  assert.equal(categoryStats({ mistakes, reviews: good, cats, lang: 'de', now: NOW })[0].trend, 'improving');
  const poor = [review('cases', true), review('cases', false), review('cases', false)];
  const s = categoryStats({ mistakes, reviews: poor, cats, lang: 'de', now: NOW })[0];
  assert.equal(s.trend, 'steady');
  assert.equal(s.drills, 3);
  assert.equal(s.acc, 1 / 3);
});

test('stats: drill mistakes stay out, drill answers alone still list the category', () => {
  const mistakes = [mistake('word_order', 1, { source: 'drill' })];
  const stats = categoryStats({ mistakes, reviews: [review('spelling', true)], cats, lang: 'de', now: NOW });
  assert.deepEqual(stats.map((s) => s.id), ['spelling']);
  assert.equal(writingMistakes(mistakes).length, 0);
});

test('stats: sorted by recent mistakes, then by total', () => {
  const list = [{ recent: 1, total: 5 }, { recent: 2, total: 2 }, { recent: 1, total: 9 }].sort(byRecent);
  assert.deepEqual(list.map((s) => s.total), [2, 9, 5]);
});
