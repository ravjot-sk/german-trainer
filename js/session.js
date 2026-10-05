// Builds the daily mixed session: due vocabulary exercises interleaved with grammar drills.
import { isDue, isNew, dayStart } from './srs.js';
import { gapFor } from './check.js';
import { pickGap } from './gappool.js';
import { DRILLABLE } from './categories.js';
import { parseCatKey, isSentence } from './languages.js';

const MAX_WORD_REVIEWS = 15;
const MAX_SENTENCE_REVIEWS = 6;
const MAX_MISTAKES = 4;
const MAX_CATEGORIES = 3;
const DRILL_KINDS = ['gapfill', 'transform', 'constraint'];

// only: optional extra filter on the review items (to count words and sentences apart).
function introducedToday(items, type, now, only = () => true) {
  const today = dayStart(now);
  return items.filter((r) => r.itemType === type && r.introducedAt && r.introducedAt >= today && only(r)).length;
}

// Picks the exercise for a word from how far along it is.
export function wordExercise(item, word, gemini) {
  const hasGap = !!pickGap(word, item.reps || 0);
  const reps = item.reps || 0;
  if (reps === 0) return 'recall';
  if (reps === 1) return hasGap ? 'gap' : 'recall';
  const cycle = ['write', 'gap', 'recall'][(reps + (item.lapses || 0)) % 3];
  if (cycle === 'write' && !gemini) return hasGap ? 'gap' : 'recall';
  if (cycle === 'gap' && !hasGap) return gemini ? 'write' : 'recall';
  return cycle;
}

// Sentences: say it (from the English, graded by Gemini), put it back in order, fill its key
// phrase. A new sentence starts with saying it, since that is the goal. Without Gemini an
// answer in other words can't be judged, so saying it is left for when nothing else works.
export function sentenceExercise(item, sentence, gemini, { chunks = true } = {}) {
  const hasGap = !!gapFor(sentence);
  const order = ['say', 'order', 'gap'];
  const can = { say: gemini || (!chunks && !hasGap), order: chunks, gap: hasGap };
  const reps = item.reps || 0;
  const start = reps === 0 ? 0 : (reps + (item.lapses || 0)) % 3;
  for (let i = 0; i < 3; i++) {
    const k = order[(start + i) % 3];
    if (can[k]) return k;
  }
  return 'say';
}

// Category weakness: recent mistakes in new writing, weighted toward the last two weeks.
export function weakness(category, mistakes, now) {
  const d14 = now - 14 * 864e5, d60 = now - 60 * 864e5;
  let score = 0;
  for (const m of mistakes) {
    if (m.category !== category || m.source === 'drill') continue;
    if (m.createdAt >= d14) score += 2; else if (m.createdAt >= d60) score += 1;
  }
  return score;
}

// Callers pass one language's words, mistakes and items; drillable lists that language's
// category keys (German ones by default).
// hasChunks(sentence) says whether the word-order exercise works for it (check.chunksFor).
export function buildSession({ items, words, mistakes, reviews, settings, gemini, drillable = DRILLABLE, now = Date.now(),
  hasChunks = () => true }) {
  const wordById = new Map(words.map((w) => [w.id, w]));
  const sentenceIds = new Set(words.filter(isSentence).map((w) => w.id));
  const isSent = (r) => sentenceIds.has(r.itemId);
  const mistakeById = new Map(mistakes.map((m) => [m.id, m]));
  const due = items.filter((r) => isDue(r, now)).sort((a, b) => a.due - b.due);

  // Vocabulary: reviews first, then new words up to the daily cap.
  const wordItems = due.filter((r) => r.itemType === 'word' && wordById.has(r.itemId) && !isSent(r));
  const newCap = Math.max(0, (settings.newPerDay ?? 8) - introducedToday(items, 'word', now, (r) => !isSent(r)));
  const wordTasks = [
    ...wordItems.filter((r) => !isNew(r)).slice(0, MAX_WORD_REVIEWS),
    ...wordItems.filter(isNew).slice(0, newCap),
  ].map((item) => {
    const word = wordById.get(item.itemId);
    return { item, word, kind: wordExercise(item, word, gemini) };
  });

  // Saved sentences, with their own cap for new ones so they don't crowd out words.
  const sentItems = due.filter((r) => r.itemType === 'word' && isSent(r));
  const newSentCap = Math.max(0, (settings.newSentencesPerDay ?? 3) - introducedToday(items, 'word', now, isSent));
  const sentenceTasks = [
    ...sentItems.filter((r) => !isNew(r)).slice(0, MAX_SENTENCE_REVIEWS),
    ...sentItems.filter(isNew).slice(0, newSentCap),
  ].map((item) => {
    const word = wordById.get(item.itemId);
    return { item, word, kind: sentenceExercise(item, word, gemini, { chunks: hasChunks(word) }) };
  });

  // Past sentences to fix.
  const mistakeItems = due.filter((r) => r.itemType === 'mistake' && mistakeById.has(r.itemId));
  const newMistakeCap = Math.max(0, (settings.newMistakesPerDay ?? 4) - introducedToday(items, 'mistake', now));
  const fixTasks = [
    ...mistakeItems.filter((r) => !isNew(r)),
    ...mistakeItems.filter(isNew).slice(0, newMistakeCap),
  ].slice(0, MAX_MISTAKES).map((item) => ({ item, mistake: mistakeById.get(item.itemId), kind: 'fix' }));

  // Generated drills for the weakest due categories (need Gemini).
  let drillTasks = [];
  if (gemini) {
    drillTasks = due
      .filter((r) => r.itemType === 'category' && drillable.includes(r.itemId))
      .sort((a, b) => weakness(parseCatKey(b.itemId).id, mistakes, now) - weakness(parseCatKey(a.itemId).id, mistakes, now))
      .slice(0, MAX_CATEGORIES)
      .map((item) => {
        const done = reviews.filter((v) => v.reviewItemId === item.id).length;
        return { item, category: parseCatKey(item.itemId).id, kind: 'drill', drillKind: DRILL_KINDS[done % DRILL_KINDS.length] };
      });
  }

  return interleave(interleave(wordTasks, sentenceTasks), [...fixTasks, ...drillTasks]);
}

// Spreads grammar tasks evenly through the vocabulary tasks.
export function interleave(a, b) {
  if (!b.length) return a.slice();
  if (!a.length) return b.slice();
  const out = [];
  const step = (a.length + 1) / (b.length + 1);
  let bi = 0;
  for (let i = 0; i < a.length; i++) {
    out.push(a[i]);
    while (bi < b.length && (bi + 1) * step <= i + 1) out.push(b[bi++]);
  }
  while (bi < b.length) out.push(b[bi++]);
  return out;
}

export function summarizeDue(args) {
  const tasks = buildSession(args);
  return {
    total: tasks.length,
    words: tasks.filter((x) => x.word && !isSentence(x.word)).length,
    sentences: tasks.filter((x) => isSentence(x.word)).length,
    grammar: tasks.filter((x) => x.kind === 'fix' || x.kind === 'drill').length,
    newWords: tasks.filter((x) => x.word && !isSentence(x.word) && isNew(x.item)).length,
  };
}

// ---------- Practice: an endless session the learner starts any time ----------
// Unlike the daily session it draws from everything already saved, not only what is due:
// weak, recently missed, due and long-unseen items come up more often, new words may start
// (beyond the daily cap), and the last few tasks are not repeated.

export const PRACTICE_FOCUS = ['mix', 'words', 'sentences', 'grammar', 'weak'];
const COOLDOWN = 8;
const WEEK = 7 * 864e5;

// How strongly an item should come up next. lastReview: its latest review, if any.
export function practiceWeight(item, lastReview, now) {
  let w = 1;
  if (isNew(item)) w += 1;
  else if (isDue(item, now)) w += 2;
  w += Math.min(item.lapses || 0, 4) * 0.5;
  if (lastReview && !lastReview.correct && now - lastReview.reviewedAt < WEEK) w += 3;
  const seen = item.lastReviewedAt || item.introducedAt;
  if (seen) w += Math.min(2, (now - seen) / WEEK);
  return w;
}

// Whether an item counts as a weak spot (focus "weak").
function isWeak(item, lastReview, weak) {
  return (item.lapses || 0) > 0 || (lastReview && !lastReview.correct) || weak > 0;
}

function weightedPick(list, random) {
  const total = list.reduce((s, x) => s + x.weight, 0);
  let r = random() * total;
  for (const x of list) {
    r -= x.weight;
    if (r < 0) return x;
  }
  return list[list.length - 1];
}

// The candidates practice can choose from, each as { item, group, weight, make }, where
// group is 'vocab' or 'grammar' and make() builds the task. Same arguments as buildSession.
export function practicePool({ items, words, mistakes, reviews, gemini, drillable = DRILLABLE, now = Date.now(),
  hasChunks = () => true, focus = 'mix' }) {
  const wordById = new Map(words.map((w) => [w.id, w]));
  const mistakeById = new Map(mistakes.map((m) => [m.id, m]));
  const lastReview = new Map();
  const done = new Map();
  for (const v of reviews) {
    done.set(v.reviewItemId, (done.get(v.reviewItemId) || 0) + 1);
    const prev = lastReview.get(v.reviewItemId);
    if (!prev || v.reviewedAt >= prev.reviewedAt) lastReview.set(v.reviewItemId, v);
  }

  const pool = [];
  for (const item of items) {
    const last = lastReview.get(item.id);
    let entry = null;
    if (item.itemType === 'word' && wordById.has(item.itemId)) {
      const word = wordById.get(item.itemId);
      const sentence = isSentence(word);
      if ((focus === 'words' && sentence) || (focus === 'sentences' && !sentence) || focus === 'grammar') continue;
      entry = { group: 'vocab', make: () => ({ item, word, kind: sentence
        ? sentenceExercise(item, word, gemini, { chunks: hasChunks(word) }) : wordExercise(item, word, gemini) }) };
    } else if (item.itemType === 'mistake' && mistakeById.has(item.itemId)) {
      if (focus === 'words' || focus === 'sentences') continue;
      entry = { group: 'grammar', make: () => ({ item, mistake: mistakeById.get(item.itemId), kind: 'fix' }) };
    } else if (item.itemType === 'category' && gemini && drillable.includes(item.itemId)) {
      if (focus === 'words' || focus === 'sentences') continue;
      const category = parseCatKey(item.itemId).id;
      const weak = weakness(category, mistakes, now);
      if (focus === 'weak' && !isWeak(item, last, weak)) continue;
      pool.push({ item, group: 'grammar', weight: practiceWeight(item, last, now) + weak * 0.5,
        make: () => ({ item, category, kind: 'drill', drillKind: DRILL_KINDS[(done.get(item.id) || 0) % DRILL_KINDS.length] }) });
      continue;
    }
    if (!entry) continue;
    if (focus === 'weak' && !isWeak(item, last, 0)) continue;
    pool.push({ item, weight: practiceWeight(item, last, now), ...entry });
  }
  return pool;
}

// The next task for a practice session, or null when there is nothing to practise.
// recent: the review item ids of the latest tasks, newest last. In the mix, about one task
// in three is grammar when there is any.
export function nextPracticeTask(pool, recent = [], { focus = 'mix', random = Math.random } = {}) {
  if (!pool.length) return null;
  const cooldown = new Set(recent.slice(-Math.min(COOLDOWN, pool.length - 1)));
  let fresh = pool.filter((x) => !cooldown.has(x.item.id));
  if (!fresh.length) fresh = pool;
  if (focus === 'mix') {
    const groups = recent.slice(-2).map((id) => pool.find((x) => x.item.id === id)?.group);
    const want = groups.length === 2 && groups.every((g) => g === 'vocab') ? 'grammar' : 'vocab';
    const preferred = fresh.filter((x) => x.group === want);
    if (preferred.length) fresh = preferred;
  }
  return weightedPick(fresh, random).make();
}
