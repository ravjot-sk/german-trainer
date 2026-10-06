// Grammar rules: the layer between a category ("Verbkomplex") and single mistakes. A rule is
// one thing to learn ("passieren bildet das Perfekt mit sein"). Mistakes are evidence for a
// rule; the rule, not the sentence, is what gets practised and scheduled.
//
// A rule is stored as a review item (itemType 'rule'), so it syncs with no new collection:
//   itemId  catKey(lang, "category/key")
//   rule    { lang, category, key, name, statement, level }
//   rung    1..5, which exercise comes next (see RUNGS)
//   passes  free-writing passes on different days; two make the rule mastered
//   pool    unused generated exercises, per kind
// Pure functions only, so they can be unit-tested in Node.
import { dayStart, DAY } from './srs.js';
import { catKey, parseCatKey, recLang } from './languages.js';
import { hasRules, migrateCategory } from './categories.js';

// The mastery ladder: recognise, choose, transform, find, write.
export const RUNGS = [null, 'pair', 'gap', 'transform', 'spot', 'produce'];
export const KINDS = RUNGS.slice(1);
// New rules start at the gap: a B2 learner can usually recognise the right form already.
export const START_RUNG = 2;
// Exercises kept per kind, so a top-up never piles up unused ones.
const POOL_MAX = 3;

export const ruleKey = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);

export const ruleItemId = (code, category, key) => catKey(code, `${category}/${key}`);

export function parseRuleId(itemId) {
  const { lang, id } = parseCatKey(itemId);
  const i = id.indexOf('/');
  return { lang, category: id.slice(0, i), key: id.slice(i + 1) };
}

export const isRule = (r) => r && r.itemType === 'rule';
export const kindOf = (item) => RUNGS[Math.min(5, Math.max(1, item.rung || START_RUNG))];

// The rule fields Gemini returned with a mistake, or null when the mistake has no rule.
export function ruleFrom(m, code) {
  const key = ruleKey(m.rule);
  if (!key || !hasRules(m.category)) return null;
  return {
    lang: code, category: m.category, key,
    name: String(m.ruleName || '').trim() || key.replace(/_/g, ' '),
    statement: String(m.ruleStatement || '').trim(),
    level: String(m.ruleLevel || '').trim(),
  };
}

// A new review item for a rule. Like any new item it is due the day it is added.
export function newRuleItem(rule, now) {
  const itemId = ruleItemId(rule.lang, rule.category, rule.key);
  return {
    id: `rule:${itemId}`, itemType: 'rule', itemId, exerciseType: null,
    due: dayStart(now), interval: 0, ease: 2.5, reps: 0, lapses: 0, introducedAt: null,
    rule, rung: START_RUNG, passes: 0, mastered: false, pool: {},
    createdAt: now, updatedAt: now,
  };
}

// A fresh mistake on a rule: one rung down, no longer mastered, and due again today.
export function afterMistake(item, now) {
  return {
    ...item, rung: Math.max(1, (item.rung || START_RUNG) - 1), passes: 0, mastered: false,
    due: Math.min(item.due ?? dayStart(now), dayStart(now)), reps: 0,
  };
}

// Moves a rule along the ladder after an exercise. "almost" (a near miss the learner may
// override) keeps the rung.
export function afterAnswer(item, grade, now) {
  const next = { ...item };
  const rung = item.rung || START_RUNG;
  if (grade === 'correct') {
    if (rung < 5) next.rung = rung + 1;
    else if (item.lastPassDay !== dayStart(now)) {
      next.passes = (item.passes || 0) + 1;
      next.lastPassDay = dayStart(now);
      if (next.passes >= 2) next.mastered = true;
    }
  } else if (grade === 'wrong') {
    next.rung = Math.max(1, rung - 1);
    next.passes = 0;
    next.mastered = false;
  }
  return next;
}

// new: not practised yet. shaky: being practised. solid: mastered.
export function status(item) {
  if (item.mastered) return 'solid';
  return item.introducedAt ? 'shaky' : 'new';
}

// ---- exercise pool ----
export function poolOf(item) {
  const p = item.pool && typeof item.pool === 'object' ? item.pool : {};
  return Object.fromEntries(KINDS.map((k) => [k, Array.isArray(p[k]) ? p[k] : []]));
}

// The exercise for the rule's current rung, if one is ready.
export function nextExercise(item) {
  const kind = kindOf(item);
  const ex = poolOf(item)[kind][0];
  return ex ? { kind, ex } : null;
}

// Adds one generated set ({ pair, gap, transform, spot, produce }) to the pool.
export function addSet(item, set) {
  const pool = poolOf(item);
  for (const k of KINDS) {
    if (valid(k, set?.[k])) pool[k] = [...pool[k], set[k]].slice(-POOL_MAX);
  }
  return { ...item, pool };
}

// Drops a used exercise.
export function useExercise(item, kind, ex) {
  const pool = poolOf(item);
  pool[kind] = pool[kind].filter((x) => x !== ex && JSON.stringify(x) !== JSON.stringify(ex));
  return { ...item, pool };
}

export function valid(kind, ex) {
  if (!ex || typeof ex !== 'object') return false;
  switch (kind) {
    case 'pair': return !!(ex.correct && ex.wrong && ex.correct.trim() !== ex.wrong.trim());
    case 'gap': return !!(ex.sentence && ex.sentence.split('___').length === 2 && ex.answer);
    case 'transform': return !!(ex.instruction && Array.isArray(ex.items) && ex.items.length && ex.items.every((x) => x.prompt && x.answer));
    case 'spot': return !!(ex.text && ex.corrected && ex.text.trim() !== ex.corrected.trim());
    case 'produce': return !!(ex.instruction && ex.model);
    default: return false;
  }
}

// Rules due within `days` whose current exercise is missing, most urgent first.
export function topUpList(items, { now, days = 3, skip = new Set(), max = 6 } = {}) {
  const limit = dayStart(now) + days * DAY;
  return items.filter((r) => isRule(r) && !skip.has(r.id) && (r.due ?? 0) < limit && !nextExercise(r))
    .sort((a, b) => (a.due ?? 0) - (b.due ?? 0))
    .slice(0, max);
}

// ---- moving older data onto the new categories ----
export const DATA_VERSION = 2;

// Renames retired categories on mistakes and category review items, and removes the old
// "fix your sentence" review items, which rules replace. Mistakes from free-writing drills
// used to be hidden from the profile as 'drill'; they were real writing, so they now count.
// Mutates data; returns true if anything changed. touch(rec) marks a record as edited so
// sync uploads it.
export function migrateData(data, touch) {
  if ((data.version || 1) >= DATA_VERSION) return false;
  for (const m of data.mistakes) {
    const c = migrateCategory(recLang(m), m.category);
    const changed = c !== m.category || m.source === 'drill';
    m.category = c;
    if (m.source === 'drill') m.source = 'exercise';
    if (changed) touch(m);
  }
  const byTarget = new Map();
  for (const r of data.reviewItems) {
    if (r.itemType !== 'category') continue;
    const { lang, id } = parseCatKey(r.itemId);
    const to = catKey(lang, migrateCategory(lang, id));
    const cur = byTarget.get(to);
    if (!cur || (r.reps || 0) > (cur.reps || 0) || r.itemId === to) byTarget.set(to, r);
  }
  const keep = new Set(byTarget.values());
  data.reviewItems = data.reviewItems.filter((r) => r.itemType !== 'mistake' && (r.itemType !== 'category' || keep.has(r)));
  for (const [to, r] of byTarget) {
    if (r.itemId === to) continue;
    // A renamed item gets the id the new category would have, so devices agree on it.
    r.itemId = to;
    r.id = `category:${to}`;
    touch(r);
  }
  data.version = DATA_VERSION;
  return true;
}

// The rules a prompt should know about, so Gemini reuses a key instead of inventing a second
// name for the same rule.
export function knownRules(items, code, max = 80) {
  return items.filter((r) => isRule(r) && r.rule?.lang === code)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, max)
    .map((r) => r.rule);
}
