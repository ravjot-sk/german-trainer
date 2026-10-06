// What an answer in a session means: how a rule exercise is graded, which mistakes count
// toward the exercise itself, and what is saved and requeued afterwards. Pure functions so
// they can be unit-tested in Node.
import { schedule, schedulePractice } from './srs.js';
import { compareAny, compareAnyExact } from './check.js';
import { afterAnswer, useExercise, ruleItemId } from './rules.js';

// ---- grading rule exercises ----
// Capitalisation, punctuation and spelling are exactly what the usual lenient check ignores.
export const EXACT_CATEGORIES = ['capitalisation', 'punctuation', 'spelling'];
export const isExact = (rule) => EXACT_CATEGORIES.includes(rule.category);

export const ruleCompare = (rule, answer, list) => (isExact(rule) ? compareAnyExact(answer, list) : compareAny(answer, list));

// A transformation set is right when every item is, almost when none is wrong.
export const transformGrade = (grades) =>
  (grades.every((g) => g === 'correct') ? 'correct' : grades.every((g) => g !== 'wrong') ? 'almost' : 'wrong');

// A near miss on a rule that is about case is a miss.
export const strictGrade = (rule, grade) => (grade === 'almost' && isExact(rule) ? 'wrong' : grade);

// ---- after an answer ----
// Anything written freely counts as new writing, whatever the exercise was about. Only a
// mistake against the very rule or category being drilled stays out of the profile (it
// counts toward that drill's accuracy), so drills don't feed themselves.
export const ownMistake = (task, m) => (task.kind === 'rule' ? m.category === task.rule.category && m.rule === task.rule.key
  : task.kind === 'drill' && m.category === task.category);

// The rule items a session should bring up again after these mistakes: each rule broken in
// the learner's own writing, once per session, unless it is already queued ahead.
export function followUpIds(mistakes, { tasks, idx, followed }) {
  const ids = [];
  for (const m of mistakes) {
    if (!m.rule || m.source === 'drill') continue;
    const id = `rule:${ruleItemId(m.lang, m.category, m.rule)}`;
    if (ids.includes(id) || followed.has(id) || tasks.slice(idx + 1).some((x) => x.item.id === id)) continue;
    ids.push(id);
  }
  return ids;
}

// The review item to save after an answer to a task (item is the latest saved copy of the
// task's item) and the review record. Practice only moves the schedule for misses and for
// new or due items.
export function answerRecord(task, item, { grade, answer, practice, lang, now }) {
  const scheduled = practice ? schedulePractice(item, grade, now) : schedule(item, grade, now);
  const updated = scheduled === item ? { ...item } : scheduled;
  if (scheduled !== item) {
    if (task.word) updated.exerciseType = task.kind;
    if (task.kind === 'drill') updated.exerciseType = task.drillKind;
  }
  let saved = updated;
  // A rule climbs or drops a rung, and the exercise is used up.
  if (task.kind === 'rule') {
    saved = useExercise(afterAnswer({ ...updated, pool: item.pool }, grade, now), task.ruleKind, task.ex);
    saved.exerciseType = task.ruleKind;
  }
  const review = {
    reviewItemId: item.id, itemType: item.itemType, itemId: item.itemId,
    lang, category: task.category || null, exerciseType: task.drillKind || task.ruleKind || task.kind,
    answer: task.answerText || answer, correct: grade !== 'wrong', grade, reviewedAt: now, ...(practice ? { mode: 'practice' } : {}),
  };
  return { saved, review };
}

// Locally checked items answered wrong come back once: at the end of the daily session, a few
// tasks later in practice. Returns where to insert the task again, or -1.
export function requeueAt(task, grade, { practice, idx, length }) {
  if (grade !== 'wrong' || !['recall', 'gap', 'order'].includes(task.kind)) return -1;
  return practice ? Math.min(idx + 4, length) : length;
}
