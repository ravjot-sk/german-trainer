// Builds the daily mixed session: due vocabulary exercises interleaved with grammar drills.
import { isDue, isNew, dayStart } from './srs.js';
import { gapFor } from './check.js';
import { DRILLABLE } from './categories.js';

const MAX_WORD_REVIEWS = 15;
const MAX_MISTAKES = 4;
const MAX_CATEGORIES = 3;
const DRILL_KINDS = ['gapfill', 'transform', 'constraint'];

function introducedToday(items, type, now) {
  const today = dayStart(now);
  return items.filter((r) => r.itemType === type && r.introducedAt && r.introducedAt >= today).length;
}

// Picks the exercise for a word from how far along it is.
export function wordExercise(item, word, gemini) {
  const hasGap = !!gapFor(word);
  const reps = item.reps || 0;
  if (reps === 0) return 'recall';
  if (reps === 1) return hasGap ? 'gap' : 'recall';
  const cycle = ['write', 'gap', 'recall'][(reps + (item.lapses || 0)) % 3];
  if (cycle === 'write' && !gemini) return hasGap ? 'gap' : 'recall';
  if (cycle === 'gap' && !hasGap) return gemini ? 'write' : 'recall';
  return cycle;
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

export function buildSession({ items, words, mistakes, reviews, settings, gemini, now = Date.now() }) {
  const wordById = new Map(words.map((w) => [w.id, w]));
  const mistakeById = new Map(mistakes.map((m) => [m.id, m]));
  const due = items.filter((r) => isDue(r, now)).sort((a, b) => a.due - b.due);

  // Vocabulary: reviews first, then new words up to the daily cap.
  const wordItems = due.filter((r) => r.itemType === 'word' && wordById.has(r.itemId));
  const newCap = Math.max(0, (settings.newPerDay ?? 8) - introducedToday(items, 'word', now));
  const wordTasks = [
    ...wordItems.filter((r) => !isNew(r)).slice(0, MAX_WORD_REVIEWS),
    ...wordItems.filter(isNew).slice(0, newCap),
  ].map((item) => {
    const word = wordById.get(item.itemId);
    return { item, word, kind: wordExercise(item, word, gemini) };
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
      .filter((r) => r.itemType === 'category' && DRILLABLE.includes(r.itemId))
      .sort((a, b) => weakness(b.itemId, mistakes, now) - weakness(a.itemId, mistakes, now))
      .slice(0, MAX_CATEGORIES)
      .map((item) => {
        const done = reviews.filter((v) => v.reviewItemId === item.id).length;
        return { item, category: item.itemId, kind: 'drill', drillKind: DRILL_KINDS[done % DRILL_KINDS.length] };
      });
  }

  return interleave(wordTasks, [...fixTasks, ...drillTasks]);
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
    words: tasks.filter((x) => ['recall', 'gap', 'write'].includes(x.kind)).length,
    grammar: tasks.filter((x) => x.kind === 'fix' || x.kind === 'drill').length,
    newWords: tasks.filter((x) => x.word && isNew(x.item)).length,
  };
}
