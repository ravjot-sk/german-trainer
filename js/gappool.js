// Gap sentences for a word: a small pool that changes with the learner's answers, so the
// gap-fill exercise doesn't show the same sentence every time. A right answer retires the
// sentence shown; a wrong one shows that same sentence again at the next review. Sentences get
// harder as the word matures. Pure functions only, so they can be unit-tested in Node.
//
// word.gapPool: [{ sentence, answer, acceptable, translation, level, source, seen, seenAt, retired }]
//   sentence holds "___" where answer goes; acceptable lists other forms that are also right there; level is 1-3; source is lookup | context | own | gemini | edit.
// word.gapCurrent: the sentence to show again after a wrong answer, or null.
import { gapFor, gapMark, normalize } from './check.js';
import { isSentence } from './languages.js';
import { DAY } from './srs.js';

export const MAX_POOL = 12;
// A word whose pool has this many fresh sentences or fewer at its level is topped up.
const REFILL_AT = 1;

// The difficulty a word is ready for, from its run of right answers.
export const gapLevel = (reps = 0) => (reps >= 6 ? 3 : reps >= 3 ? 2 : 1);

const validEntry = (e) => !!e && typeof e.sentence === 'string' && e.sentence.includes('___') && !!e.answer;
const keyOf = (s) => normalize(s).toLowerCase();

// Other right fillings for a gap, as Gemini listed them: trimmed, no repeats, not the answer itself.
export function cleanAcceptable(list, answer = '') {
  const seen = new Set([keyOf(String(answer))]);
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const v = String(x || '').trim();
    if (!v || seen.has(keyOf(v))) continue;
    seen.add(keyOf(v));
    out.push(v);
  }
  return out.slice(0, 4);
}

// The word's pool. Words saved before pools existed get one built from their single gap
// sentence (not stored until something changes).
export function poolOf(word) {
  if (!word || isSentence(word)) return [];
  if (Array.isArray(word.gapPool) && word.gapPool.some(validEntry)) return word.gapPool;
  const g = gapFor(word);
  return g ? [{ sentence: g.sentence, answer: g.answer, acceptable: g.acceptable || [], translation: '', level: 1, source: 'lookup', seen: 0, seenAt: 0, retired: false }] : [];
}

// Adds sentences to a pool, skipping broken ones and ones already in it. When it grows past
// MAX_POOL the oldest retired sentences make room. Returns a new array.
export function addToPool(pool, entries, { level = 1, source = 'gemini' } = {}) {
  const out = pool.slice();
  const keys = new Set(out.map((e) => keyOf(e.sentence)));
  for (const e of entries || []) {
    const entry = { sentence: gapMark(e?.sentence).trim(), answer: String(e?.answer || '').trim(), translation: String(e?.translation || '').trim(),
      acceptable: cleanAcceptable(e?.acceptable, e?.answer) };
    if (!validEntry(entry) || keys.has(keyOf(entry.sentence))) continue;
    keys.add(keyOf(entry.sentence));
    out.push({ ...entry, level: e.level || level, source: e.source || source, seen: 0, seenAt: 0, retired: false });
  }
  while (out.length > MAX_POOL) {
    const retired = out.map((e, i) => [e, i]).filter(([e]) => e.retired).sort((a, b) => a[0].seenAt - b[0].seenAt);
    if (!retired.length) break;
    out.splice(retired[0][1], 1);
  }
  return out;
}

// The pool a fresh lookup starts with: its gap sentence (built from the context sentence when
// there was one) and the extra examples that came back gapped (moreGaps).
export function poolFromLookup(r, hasContext = false) {
  const entries = [];
  if (r.gapSentence) entries.push({ sentence: r.gapSentence, answer: r.gapAnswer, acceptable: r.gapAcceptable, translation: hasContext ? '' : r.exampleTranslation, level: 1, source: hasContext ? 'context' : 'lookup' });
  for (const e of r.moreGaps || []) {
    if (e.gapSentence) entries.push({ sentence: e.gapSentence, answer: e.gapAnswer, acceptable: e.gapAcceptable, translation: e.translation, level: 2, source: 'lookup' });
  }
  return addToPool([], entries);
}

// The sentence to show for a word whose review item has `reps` right answers in a row:
// the one answered wrong last time, else a fresh one closest to the word's level (lower
// levels first on a tie, least shown first), else the one seen longest ago. Null when the
// word has no gap sentence at all. Returns { sentence, answer, acceptable, translation }.
export function pickGap(word, reps = 0) {
  const pool = poolOf(word).filter(validEntry);
  if (!pool.length) return null;
  const at = (e) => ({ sentence: e.sentence, answer: e.answer, acceptable: e.acceptable || [], translation: e.translation || '' });
  const cur = word.gapCurrent && pool.find((e) => e.sentence === word.gapCurrent);
  if (cur) return at(cur);
  const want = gapLevel(reps);
  const fresh = pool.filter((e) => !e.retired);
  if (fresh.length) {
    const cost = (e) => [Math.abs((e.level || 1) - want), e.level || 1, e.seen || 0];
    const best = fresh.reduce((a, b) => {
      const x = cost(a), y = cost(b);
      return (x[0] - y[0] || x[1] - y[1] || x[2] - y[2]) <= 0 ? a : b;
    });
    return at(best);
  }
  return at(pool.reduce((a, b) => ((b.seenAt || 0) < (a.seenAt || 0) ? b : a)));
}

// The word fields to save after a gap answer on `sentence` (as pickGap returned it). The
// sentence is kept by its text, since top-ups may reorder the pool in the meantime.
export function afterGap(word, sentence, grade, now = Date.now()) {
  const pool = poolOf(word).map((e) => (e.sentence === sentence
    ? { ...e, seen: (e.seen || 0) + 1, seenAt: now, retired: e.retired || grade !== 'wrong' }
    : e));
  return { gapPool: pool, gapCurrent: grade === 'wrong' ? sentence : null };
}

// A gap sentence edited by hand takes the place of the one it replaces.
export function replaceInPool(pool, oldSentence, entry) {
  return addToPool(pool.filter((e) => e.sentence !== oldSentence), [entry], { level: 1, source: 'edit' });
}

// Whether a word is running out of sentences it hasn't answered right at its level.
export function needsRefill(word, reps = 0) {
  if (!word || isSentence(word)) return false;
  const want = gapLevel(reps);
  const fresh = poolOf(word).filter((e) => validEntry(e) && !e.retired && (e.level || 1) >= want);
  return fresh.length <= REFILL_AT;
}

// Words worth topping up now: due within `days` days (or not started yet) and running low.
// Sorted soonest first, at most `max`, each with the level to write at.
export function refillList({ items, words, now = Date.now(), days = 3, max = 10, skip = new Set() }) {
  const wordById = new Map(words.map((w) => [w.id, w]));
  const horizon = now + days * DAY;
  return items
    .filter((r) => r.itemType === 'word' && wordById.has(r.itemId) && !skip.has(r.itemId))
    .filter((r) => !r.introducedAt || r.due <= horizon)
    .filter((r) => needsRefill(wordById.get(r.itemId), r.reps || 0))
    .sort((a, b) => (a.due || 0) - (b.due || 0))
    .slice(0, max)
    .map((r) => {
      const word = wordById.get(r.itemId);
      return { word, level: gapLevel(r.reps || 0), existing: poolOf(word).map((e) => e.sentence) };
    });
}
