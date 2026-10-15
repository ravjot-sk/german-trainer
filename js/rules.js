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
import { seedRule } from './ruleseeds.js';
import { fillGap, diffSize, foldSpelling } from './check.js';

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
// The exercises worth generating now: the one for the rule's rung and the next one up.
export const kindsToAsk = (item) => [...new Set([kindOf(item), RUNGS[Math.min(5, (item.rung || START_RUNG) + 1)]])];

// The rule fields Gemini returned with a mistake, or null when the mistake has no rule.
// m: the mistake with Gemini's rule fields (rulePattern, rule, ruleName, ...). ui: the
// language the learner reads names in.
// Gemini's choice is checked, because a small model files mistakes under the closest rule
// it was shown (#30, #31):
// - a typo has no rule; it is still a mistake, marked wrong like any other;
// - a standard rule brings its own category, name and statement, whatever Gemini wrote;
// - spelling rules come only from the standard list (an umlaut slip is no rule);
// - some standard rules can be seen in the text, and must be.
export function ruleFrom(m, code, ui = 'de') {
  if (/^\s*typo\b/i.test(m.rulePattern || '')) return null;
  const key = ruleKey(m.rule);
  if (!key) return null;
  const seed = seedRule(code, key);
  if (seed) {
    if (!hasRules(seed.category) || !hasEvidence(code, key, m)) return null;
    const text = seed.text[ui === 'en' ? 'en' : 'de'];
    return { lang: code, category: seed.category, key, name: text.name, statement: text.statement, level: seed.level };
  }
  if (!hasRules(m.category) || m.category === 'spelling') return null;
  return {
    lang: code, category: m.category, key,
    name: String(m.ruleName || '').trim() || key.replace(/_/g, ' '),
    statement: String(m.ruleStatement || '').trim(),
    level: String(m.ruleLevel || '').trim(),
    ...(m.rulePattern ? { pattern: String(m.rulePattern).trim() } : {}),
  };
}

// What the learner reads for a rule: a standard rule in its own wording, in the interface
// language; any other as Gemini named it.
export function ruleText(rule, ui = 'de') {
  const seed = rule && seedRule(rule.lang || 'de', rule.key);
  if (seed && seed.category === rule.category) return seed.text[ui === 'en' ? 'en' : 'de'];
  return { name: rule?.name || '', statement: rule?.statement || '' };
}

// How a rule is described in a prompt: the standard statement (in English) when there is one.
export function rulePrompt(rule) {
  const seed = rule && seedRule(rule.lang || 'de', rule.key);
  if (seed && seed.category === rule.category) return { name: seed.text.en.name, statement: seed.statementEn, level: seed.level, standard: true };
  return { name: rule?.name || '', statement: rule?.statement || '', level: rule?.level || '', pattern: rule?.pattern || '', standard: false };
}

// Standard rules whose mistakes can be seen in the words themselves. A mistake filed under
// one of them without that sign belongs elsewhere: "Herauseforderung" is no compound noun,
// and a sentence with neither damit nor um is no damit/um … zu mistake.
const said = (m) => [m.original, m.corrected].filter(Boolean).join(' ');
const around = (m) => [m.original, m.corrected, m.sentence, m.fullSentence, m.correctedSentence].filter(Boolean).join(' ');
const commas = (s) => (String(s || '').match(/[,、]/g) || []).length;
const caseOnly = (m) => {
  const a = String(m.original || '').split(/\s+/), b = String(m.corrected || '').split(/\s+/);
  return a.some((x) => b.some((y) => x !== y && x.toLowerCase() === y.toLowerCase()));
};
const EVIDENCE = {
  de: {
    compound_one_word: (m) => { const j = (s) => String(s || '').replace(/[\s-]+/g, '').toLowerCase(); return m.original !== m.corrected && j(m.original) === j(m.corrected); },
    nouns_capitalised: caseOnly,
    nominalised_verbs_adjectives: caseOnly,
    paar_bisschen_lowercase: caseOnly,
    sie_formal_capital: caseOnly,
    damit_um_zu: (m) => /\b(damit|um)\b/i.test(around(m)),
    weil_denn_deshalb: (m) => /\b(weil|denn|deshalb|deswegen|daher|darum)\b/i.test(around(m)),
    obwohl_trotzdem: (m) => /\b(obwohl|obgleich|trotzdem)\b/i.test(around(m)),
    als_wenn_past: (m) => /\b(als|wenn)\b/i.test(said(m)),
    kein_vs_nicht: (m) => /\b(kein\w*|nicht)\b/i.test(said(m)),
    article_contractions: (m) => /\b(im|am|zum|zur|ins|ans|aufs|vom|beim)\b/i.test(said(m)),
    seit_present: (m) => /\bseit\b/i.test(around(m)),
    passive_perfekt_worden: (m) => /worden/i.test(said(m)),
    comma_subordinate_clause: (m) => commas(m.original) !== commas(m.corrected) || commas(m.sentence || m.fullSentence) !== commas(m.correctedSentence),
    comma_infinitive_group: (m) => commas(m.original) !== commas(m.corrected) || commas(m.sentence || m.fullSentence) !== commas(m.correctedSentence),
    comma_relative_clause: (m) => commas(m.original) !== commas(m.corrected) || commas(m.sentence || m.fullSentence) !== commas(m.correctedSentence),
  },
};
export const hasEvidence = (code, key, m) => !EVIDENCE[code]?.[key] || EVIDENCE[code][key](m);

// A new review item for a rule. Like any new item it is due the day it is added.
export function newRuleItem(rule, now) {
  const itemId = ruleItemId(rule.lang, rule.category, rule.key);
  return {
    id: `rule:${itemId}`, itemType: 'rule', itemId, exerciseType: null,
    due: dayStart(now), interval: 0, ease: 2.5, reps: 0, lapses: 0, introducedAt: null,
    rule, rung: START_RUNG, passes: 0, mastered: false, pool: {},
    // Filed with the checks in ruleFrom, so the one-time re-check of older rules skips it.
    verified: true,
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

// Rules filed before ruleFrom checked Gemini's choice, which look wrongly filed and get
// their mistakes sorted again once (background.recheckRules): a standard key with another
// name, a spelling rule outside the standard list, a mistake without the rule's sign in it,
// or a rule resting on a single mistake.
export function suspectRule(item, mistakes) {
  const r = item.rule || {};
  const seed = seedRule(r.lang || 'de', r.key);
  if (seed) {
    if (seed.category !== r.category) return true;
    if (r.name && r.name !== seed.text.de.name && r.name !== seed.text.en.name) return true;
    if (mistakes.some((m) => !hasEvidence(r.lang || 'de', r.key, m))) return true;
  } else if (r.category === 'spelling') return true;
  return mistakes.length <= 1;
}

// new: not practised yet. shaky: being practised. solid: mastered.
export function status(item) {
  if (item.mastered) return 'solid';
  return item.introducedAt ? 'shaky' : 'new';
}

// ---- exercise pool ----
// Exercises made before the checks in valid() (a gap without its full sentence, like #30's)
// are left out, so the rule gets new ones.
export function poolOf(item) {
  const p = item.pool && typeof item.pool === 'object' ? item.pool : {};
  const lang = item.rule?.lang || '';
  return Object.fromEntries(KINDS.map((k) => [k, Array.isArray(p[k]) ? p[k].filter((ex) => valid(k, ex, lang)) : []]));
}

// The exercise for the rule's current rung, if one is ready.
export function nextExercise(item) {
  const kind = kindOf(item);
  const ex = poolOf(item)[kind][0];
  return ex ? { kind, ex } : null;
}

// Adds one generated set ({ pair, gap, transform, spot, produce }) to the pool. Exercises
// that fail the checks in valid() are left out; the pool tops up again later.
// learnerWords: words from the learner's own mistakes on this rule, which an explanation must
// not bring up unless the exercise shows them.
export function addSet(item, set, { learnerWords = [] } = {}) {
  const pool = poolOf(item);
  for (const k of KINDS) {
    const ex = set?.[k];
    // Checked after tidy, which may take away a hint the check needs.
    const tidied = ex && typeof ex === 'object' ? tidy(k, ex, learnerWords) : ex;
    if (valid(k, tidied, item.rule?.lang || '')) pool[k] = [...pool[k], tidied].slice(-POOL_MAX);
  }
  return { ...item, pool };
}

// All the text an exercise shows the learner, once answered.
const shown = (ex) => [ex.full, ex.sentence, ex.answer, ex.correct, ex.wrong, ex.text, ex.corrected, ex.instruction, ex.model,
  ...(ex.items || []).flatMap((x) => [x.prompt, x.answer])].filter(Boolean).join(' ');
const letters = (s) => String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

// Removes what would confuse: a hint in brackets that gives the answer away, and an
// explanation that names a trigger the exercise doesn't have or a word it doesn't show
// (the "ause" of #31). The rule's statement still shows under the exercise.
export function tidy(kind, ex, learnerWords = []) {
  const out = { ...ex };
  if (kind === 'gap') {
    const hint = /___\s*[(（]([^)）]*)[)）]/.exec(out.sentence)?.[1];
    if (hint && hint.trim().toLowerCase() === String(out.answer).trim().toLowerCase()) out.sentence = out.sentence.replace(/(___)\s*[(（][^)）]*[)）]/, '$1');
  }
  const text = new Set(letters(shown(out)));
  const trigger = String(out.trigger || '').trim();
  const triggerMissing = trigger && !letters(trigger).every((w) => text.has(w));
  const leaked = letters(out.explanation).some((w) => w.length >= 4 && !text.has(w) && learnerWords.includes(w));
  // A quoted form ('ause', »Herauseforderung«) the exercise doesn't contain is a wrong form
  // from somewhere else.
  const all = shown(out).toLowerCase();
  const quotedElsewhere = [...String(out.explanation || '').matchAll(/['"„“”‚‘’»«›‹]([^'"„“”‚‘’»«›‹]{1,40})['"„“”‚‘’»«›‹]/g)]
    .some(([, q]) => q.trim() && !all.includes(q.trim().toLowerCase()));
  if (triggerMissing || leaked || quotedElsewhere) out.explanation = '';
  return out;
}

// Words from the learner's mistakes, for addSet.
export const mistakeWords = (mistakes) => [...new Set(mistakes.flatMap((m) => letters(m.original)))];

// Drops a used exercise.
export function useExercise(item, kind, ex) {
  const pool = poolOf(item);
  pool[kind] = pool[kind].filter((x) => x !== ex && JSON.stringify(x) !== JSON.stringify(ex));
  return { ...item, pool };
}

// Checks a generated exercise before it is used. A gap must give back its full sentence when
// the answer is filled in (#30: "Sie hofft ___ (bestehen) ihre Prüfung" had no right answer),
// and a pair or a text to correct may differ only where the rule's mistakes are.
// A noun in a German gap's answer that the learner can't know: not named in brackets after
// the gap, and not the sentence's first word (which is capitalised anyway). "eine gründliche
// ___ erstellen" with answer "Analyse" tests guessing the word, not the rule (#36).
export function hiddenNoun(ex) {
  const hint = (/___\s*[(（]([^)）]*)[)）]/.exec(ex.sentence)?.[1] || '').toLowerCase();
  const first = String(ex.full || '').trim().startsWith(String(ex.answer).trim());
  const words = String(ex.answer).trim().split(/\s+/);
  return words.some((w, i) => {
    const bare = w.replace(/[^\p{L}-]/gu, '');
    if (!/^\p{Lu}/u.test(bare) || bare.length < 4 || (i === 0 && first)) return false;
    // Named if the hint has the word's start (base form "Analyse" for "Analysen").
    return !hint.includes(bare.toLowerCase().slice(0, 4));
  });
}

const sameText = (a, b) => {
  const n = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\s+([,.!?;:。、！？])/g, '$1').trim();
  return n(a) === n(b);
};
// lang: the rule's language. In German a gap may not hide a noun without naming it (#36).
export function valid(kind, ex, lang = '') {
  if (!ex || typeof ex !== 'object') return false;
  switch (kind) {
    case 'pair': return !!(ex.correct && ex.wrong && ex.correct.trim() !== ex.wrong.trim()) && diffSize(ex.wrong, ex.correct).hunks === 1;
    case 'gap': return !!(ex.sentence && ex.sentence.split('___').length === 2 && ex.answer && ex.full) && sameText(fillGap(ex.sentence, ex.answer), ex.full)
      && (lang !== 'de' || !hiddenNoun(ex));
    case 'transform': return !!(ex.instruction && Array.isArray(ex.items) && ex.items.length && ex.items.every((x) => x.prompt && x.answer && !sameText(x.prompt, x.answer)));
    case 'spot': {
      if (!(ex.text && ex.corrected && ex.text.trim() !== ex.corrected.trim())) return false;
      const d = diffSize(ex.text, ex.corrected);
      return d.hunks <= 2 && d.words <= 6;
    }
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
export const DATA_VERSION = 3;

// Standard rules that were dropped. ß/ss: German typed with ss for ß (or ae for ä) counts as
// right (#39), so it can't be practised as a rule.
export const RETIRED_RULES = { de: ['ss_eszett'] };
const retired = (r) => isRule(r) && (RETIRED_RULES[r.rule?.lang] || []).includes(r.rule?.key);
const onlySpelling = (m) => recLang(m) === 'de' && m.original && m.original !== m.corrected
  && foldSpelling(m.original, 'de') === foldSpelling(m.corrected, 'de');

// Brings saved data up to DATA_VERSION, one version at a time. Mutates data; returns true if
// anything changed. touch(rec) marks a record as edited so sync uploads it; a record removed
// here is deleted on the other devices too.
export function migrateData(data, touch) {
  const version = data.version || 1;
  if (version >= DATA_VERSION) return false;
  if (version < 2) migrateV2(data, touch);
  if (version < 3) migrateV3(data, touch);
  data.version = DATA_VERSION;
  return true;
}

// Version 3 (#39): retired rules go, with the mistakes that were only ss for ß or ae for ä;
// other mistakes filed under a retired rule keep their place without it.
function migrateV3(data, touch) {
  data.reviewItems = data.reviewItems.filter((r) => !retired(r));
  data.mistakes = data.mistakes.filter((m) => !onlySpelling(m));
  for (const m of data.mistakes) {
    if (m.rule && (RETIRED_RULES[recLang(m)] || []).includes(m.rule)) {
      m.rule = '';
      touch(m);
    }
  }
}

// Version 2: renames retired categories on mistakes and category review items, and removes
// the old "fix your sentence" review items, which rules replace. Mistakes from free-writing
// drills used to be hidden from the profile as 'drill'; they were real writing, so they now
// count.
function migrateV2(data, touch) {
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
}

// The rules a prompt should know about, so Gemini reuses a key instead of inventing a second
// name for the same rule.
export function knownRules(items, code, max = 80) {
  return items.filter((r) => isRule(r) && r.rule?.lang === code)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, max)
    .map((r) => r.rule);
}
