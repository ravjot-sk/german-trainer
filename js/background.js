// Gemini work that runs in the background while the learner does something else: furigana
// for Japanese texts, exercise sets for grammar rules, rules for older mistakes and new gap
// sentences. Each keeps track of what it already asked for during this app start.
import * as store from './store.js';
import * as gemini from './gemini.js';
import { addSet, topUpList, kindsToAsk, mistakeWords, suspectRule } from './rules.js';
import { lemmaOf } from './languages.js';
import { fillGap } from './check.js';
import { poolOf, addToPool, refillList } from './gappool.js';
import { missing, strip, poolTexts } from './furigana.js';
import { gem, L, code, furiMode } from './appstate.js';

// Everything here waits behind what the learner is doing (see gemini.js).
const BG = { background: true };

// Japanese texts saved without furigana get it from Gemini once, in one call for a batch of
// records; redraw runs when anything was added.
const furiAsked = new Set();
export async function fillFurigana(recs, redraw) {
  if (furiMode() === 'off' || !gem()) return;
  const todo = recs.filter((r) => r && !furiAsked.has(r.id) && missing(r).length);
  if (!todo.length) return;
  todo.forEach((r) => furiAsked.add(r.id));
  try {
    const marked = await gemini.annotate([...new Set(todo.flatMap(missing))].slice(0, 40), BG);
    let added = false;
    for (const r of todo) {
      const need = missing(r);
      const add = marked.filter((m) => need.includes(strip(m)));
      if (!add.length) continue;
      // Markup for texts that were edited since is dropped.
      const texts = [lemmaOf(r), r.example, ...(r.moreExamples || []).map((e) => e.text), r.contextSentence, r.gapSentence, ...poolTexts(r)];
      store.updateWord(r.id, { furigana: [...(r.furigana || []).filter((m) => texts.includes(strip(m))), ...add] });
      added = true;
    }
    if (added && redraw) redraw();
  } catch (e) {
    console.warn('furigana', e);
  }
}

export const latestItem = (item) => store.reviewItems().find((r) => r.id === item.id) || item;

// Generates exercises for rules (the kind each rule needs now and the next one) and adds them
// to each rule's pool, at most RULES_PER_CALL rules per Gemini call so each exercise gets
// care. A rule already being generated for shares that call. In the background, the call is
// tagged with the rules' ids (see gemini.promote).
const RULES_PER_CALL = 3;
const generating = new Map();
export function generateRuleSets(items, { background = false } = {}) {
  const todo = items.filter((it) => !generating.has(it.id));
  const waits = items.filter((it) => generating.has(it.id)).map((it) => generating.get(it.id));
  const lang = code();
  for (let i = 0; i < todo.length; i += RULES_PER_CALL) {
    const batch = todo.slice(i, i + RULES_PER_CALL);
    const run = (async () => {
      const call = { background, tags: batch.map((it) => it.id) };
      const own = batch.map((it) => store.ruleMistakes(it));
      const sets = await gemini.ruleExercises(batch.map((it, j) => ({
        rule: it.rule,
        kinds: kindsToAsk(it),
        examples: [...new Set(own[j].map((m) => m.correctedSentence).filter(Boolean))].slice(0, 2),
      })), call);
      if (lang === 'ja' && furiMode() !== 'off') await addFurigana(sets, call);
      batch.forEach((it, j) => {
        const cur = latestItem(it);
        if (sets[j]) store.updateReviewItem(addSet(cur, sets[j], { learnerWords: mistakeWords(own[j]) }));
      });
    })();
    batch.forEach((it) => generating.set(it.id, run));
    run.finally(() => batch.forEach((it) => generating.delete(it.id))).catch(() => {});
    waits.push(run);
  }
  return Promise.all(waits);
}

// Japanese exercises get furigana for all their texts in one extra call; each exercise keeps
// the markup list, which jt() reads.
async function addFurigana(sets, call) {
  const texts = [];
  for (const set of sets) {
    for (const ex of Object.values(set || {})) {
      if (!ex || typeof ex !== 'object') continue;
      texts.push(ex.correct, ex.wrong, ex.sentence, ex.sentence && ex.answer ? fillGap(ex.sentence, ex.answer) : '',
        ex.text, ex.corrected, ex.model, ...(ex.items || []).flatMap((x) => [x.prompt, x.answer]));
    }
  }
  try {
    const marked = await gemini.annotate([...new Set(texts.filter((x) => x && /[\u3400-\u9fff]/.test(x)))].slice(0, 60), call);
    for (const set of sets) for (const ex of Object.values(set || {})) if (ex && typeof ex === 'object') ex.furigana = marked;
  } catch (e) {
    console.warn('furigana', e);
  }
}

// Rules coming up soon without an exercise for their rung get one, in the background.
const topUpAsked = new Set();
export function topUpRules() {
  if (!gem() || !L()?.level) return;
  const list = topUpList(store.ruleItems(code()), { now: Date.now(), skip: topUpAsked });
  if (!list.length) return;
  list.forEach((it) => topUpAsked.add(it.id));
  generateRuleSets(list, { background: true }).catch((e) => console.warn('rule exercises', e));
}

// Mistakes saved before rules existed get their category checked and their rule named, a
// batch at a time in the background. Each is asked about at most once per app start.
const classifyAsked = new Set();
let classifying = false;
export async function classifyOldMistakes(redraw) {
  if (classifying || !gem() || !L()?.level) return;
  const list = store.mistakesWithoutRule(code()).filter((m) => !classifyAsked.has(m.id)).slice(0, 30);
  if (!list.length) return;
  list.forEach((m) => classifyAsked.add(m.id));
  classifying = true;
  try {
    const got = await gemini.classifyMistakes(list, BG);
    list.forEach((m, i) => store.setMistakeRule(m.id, got[i]));
    if (redraw) redraw();
  } catch (e) {
    console.warn('classify mistakes', e);
  } finally {
    classifying = false;
  }
}

// Rules filed before Gemini's choices were checked, which look wrongly filed (rules.suspectRule),
// get their mistakes sorted again once, with the same prompt and checks as new mistakes.
// Mistakes move to the rule named now, or to none; rules left empty go (store.refileRules).
let rechecking = false;
const recheckAsked = new Set();
export async function recheckRules(redraw) {
  if (rechecking || !gem() || !L()?.level) return;
  const lang = code();
  const old = store.ruleItems(lang).filter((it) => !it.verified && !recheckAsked.has(it.id));
  if (!old.length) return;
  const fine = [], suspect = [];
  for (const it of old) (suspectRule(it, store.ruleMistakes(it)) ? suspect : fine).push(it);
  if (fine.length) store.markRulesVerified(fine);
  // Up to 30 mistakes per call, whole rules only.
  const batch = [];
  let count = 0;
  for (const it of suspect) {
    const n = store.ruleMistakes(it).length;
    if (batch.length && count + n > 30) break;
    batch.push(it);
    count += n;
  }
  if (!batch.length) return;
  batch.forEach((it) => recheckAsked.add(it.id));
  const ms = batch.flatMap((it) => store.ruleMistakes(it));
  rechecking = true;
  try {
    const got = ms.length ? await gemini.classifyMistakes(ms, BG) : [];
    store.refileRules(batch, ms.map((m, i) => ({ id: m.id, r: got[i] })));
    if (redraw) redraw();
  } catch (e) {
    console.warn('recheck rules', e);
  } finally {
    rechecking = false;
  }
}

// Words coming up soon that are running out of gap sentences get new ones, in one Gemini call
// in the background. A word is asked for at most once per app start, even if the call fails.
const refillAsked = new Set();
let refilling = false;
export async function refillGaps() {
  if (refilling || !gem()) return;
  const lang = code();
  const list = refillList({ items: store.reviewItems(), words: store.words(lang), skip: refillAsked });
  if (!list.length) return;
  list.forEach((x) => refillAsked.add(x.word.id));
  refilling = true;
  try {
    const got = await gemini.gapSentences(list, undefined, BG);
    const updated = [];
    list.forEach((x, i) => {
      const w = store.getWord(x.word.id);
      if (!w || !got[i].length) return;
      store.updateWord(w.id, { gapPool: addToPool(poolOf(w), got[i], { level: x.level, source: 'gemini' }) });
      updated.push(w);
    });
    if (lang === 'ja') fillFurigana(updated);
  } catch (e) {
    console.warn('gap sentences', e);
  } finally {
    refilling = false;
  }
}
