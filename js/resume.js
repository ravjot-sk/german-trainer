// A running session as a small snapshot that survives iOS closing the app. It holds ids
// only (no generated exercise text) and is valid until the end of the day it was saved.
import { dayStart } from './srs.js';
import { wordExercise, sentenceExercise, ruleTask } from './session.js';
import { parseCatKey, isSentence } from './languages.js';

const V = 1;
// Where the app keeps it (localStorage, this device only).
export const SESSION_KEY = 'gt.session';

// The session (ui.session) as plain JSON.
export function snapshotOf(s, now = Date.now()) {
  return {
    v: V, day: dayStart(now), lang: s.lang, practice: !!s.practice, focus: s.focus || null,
    round: s.round || 0, roundStart: s.roundStart || 0, newIds: s.newIds ? [...s.newIds] : null,
    idx: s.idx, correct: s.correct, answered: s.answered, mistakesLogged: s.mistakesLogged,
    followed: [...s.followed],
    tasks: s.tasks.map((x) => ({ i: x.item.id, k: x.kind, ...(x.drillKind ? { d: x.drillKind } : {}),
      ...(s.requeued.has(x) ? { r: 1 } : {}) })),
  };
}

// The session the snapshot describes, rebuilt from current data, or null when it is from
// another day or language, or a daily session with nothing left. Items deleted since (and
// grammar without Gemini) are left out; exercises are picked again from the items' state.
// Same arguments as buildSession (sessionArgs()), plus the active language code.
export function restoreSession(snap, { items, words, gemini, hasChunks = () => true, lang, now = Date.now() }) {
  if (!snap || snap.v !== V || snap.day !== dayStart(now) || snap.lang !== lang || !Array.isArray(snap.tasks)) return null;
  const itemById = new Map(items.map((r) => [r.id, r]));
  const wordById = new Map(words.map((w) => [w.id, w]));
  const tasks = [];
  const requeued = new Set();
  let idx = 0, roundStart = 0;
  snap.tasks.forEach((e, i) => {
    const task = taskFor(e, itemById, wordById, { gemini, hasChunks });
    if (!task) return;
    if (i < snap.idx) idx++;
    if (i < snap.roundStart) roundStart++;
    if (e.r) requeued.add(task);
    tasks.push(task);
  });
  if (!snap.practice && idx >= tasks.length) return null;
  return {
    practice: snap.practice, ...(snap.practice ? { focus: snap.focus, round: snap.round, roundStart,
      newIds: snap.newIds ? new Set(snap.newIds) : null } : {}),
    tasks, lang: snap.lang, idx, correct: snap.correct || 0, answered: snap.answered || 0,
    requeued, mistakesLogged: snap.mistakesLogged || 0, followed: new Set(snap.followed || []),
  };
}

function taskFor(e, itemById, wordById, { gemini, hasChunks }) {
  const item = itemById.get(e.i);
  if (!item) return null;
  if (e.k === 'rule') return gemini && item.rule ? ruleTask(item) : null;
  if (e.k === 'drill') return gemini ? { item, category: parseCatKey(item.itemId).id, kind: 'drill', drillKind: e.d } : null;
  const word = item.itemType === 'word' && wordById.get(item.itemId);
  if (!word) return null;
  return { item, word, kind: isSentence(word)
    ? sentenceExercise(item, word, gemini, { chunks: hasChunks(word) }) : wordExercise(item, word, gemini) };
}
