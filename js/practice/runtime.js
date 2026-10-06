// The running session (daily or free practice): which tasks it holds, preparing generated
// exercises ahead of time, and what happens after each answer. The session object lives in
// ui.session; tasks are mutated in place, and the screen checks them by identity.
import * as store from '../store.js';
import * as gemini from '../gemini.js';
import { logMistakes } from '../actions.js';
import { t } from '../i18n.js';
import { buildSession, practicePool, nextPracticeTask, ruleTask } from '../session.js';
import { nextExercise, kindOf } from '../rules.js';
import { isSentence } from '../languages.js';
import { afterGap } from '../gappool.js';
import { gem, code, sessionArgs, ui } from '../ui/context.js';
import { fillFurigana, latestItem, generateRuleSets, topUpRules, classifyOldMistakes, refillGaps } from '../background.js';
import { ownMistake, followUpIds, answerRecord, requeueAt } from '../answer.js';

// Starts generating a drill as soon as its task is queued, so it is ready when it comes up.
function prepare(task) {
  if (task.kind === 'rule') return prepareRule(task);
  if (task.kind !== 'drill') return;
  const examples = store.mistakes(code()).filter((m) => m.category === task.category).slice(0, 4);
  const words = store.words(code()).filter((w) => !isSentence(w));
  const word = task.drillKind === 'constraint' && words.length ? words[Math.floor(Math.random() * Math.min(words.length, 30))] : null;
  task.drillPromise = gemini.generateDrill(task.category, task.drillKind, { examples, word })
    .then((d) => (task.drill = d))
    .catch((e) => { task.drillError = e; });
}

// A new session in the active language; free practice adds { practice: true, focus }.
const newSession = (tasks, extra = {}) => ({
  ...extra, tasks, lang: code(), idx: 0, correct: 0, answered: 0, requeued: new Set(), mistakesLogged: 0, followed: new Set(),
});

export function startSession() {
  const tasks = buildSession(sessionArgs());
  tasks.forEach(prepare);
  ui.session = newSession(tasks);
  if (code() === 'ja') fillFurigana(tasks.map((x) => x.word).filter(Boolean));
  refillGaps();
  topUpRules();
  classifyOldMistakes();
}

// A rule task takes the exercise for the rule's rung from its pool, or has one generated.
function prepareRule(task) {
  task.item = latestItem(task.item);
  const ready = nextExercise(task.item);
  if (ready) {
    task.ruleKind = ready.kind;
    task.ex = ready.ex;
    return;
  }
  task.ruleKind = kindOf(task.item);
  task.exPromise = generateRuleSets([task.item])
    .then(() => {
      task.item = latestItem(task.item);
      const r = nextExercise(task.item);
      if (!r) throw new Error(t('session.genFailed'));
      task.ruleKind = r.kind;
      task.ex = r.ex;
    })
    .catch((e) => { task.exError = e; });
}

// A rule the learner just broke in their own writing comes up a few tasks later, once.
function followUp(mistakes) {
  const s = ui.session;
  if (!s || !gem()) return;
  for (const id of followUpIds(mistakes, s)) {
    const item = store.reviewItems().find((r) => r.id === id);
    if (!item) continue;
    s.followed.add(id);
    const task = ruleTask(item);
    prepare(task);
    s.tasks.splice(Math.min(s.idx + 3, s.tasks.length), 0, task);
  }
}

// Logs the mistakes Gemini found in an answer and queues follow-ups for the rules broken.
export function logTaskMistakes(task, mistakes) {
  const s = ui.session;
  const own = (m) => ownMistake(task, m);
  const logged = [
    ...logMistakes(mistakes.filter((m) => !own(m)), 'exercise', s.lang).mistakes,
    ...logMistakes(mistakes.filter(own), 'drill', s.lang).mistakes,
  ];
  s.mistakesLogged += logged.filter((m) => m.source !== 'drill').length;
  followUp(logged);
}

// Practice never runs out: it keeps a few tasks queued ahead of the current one.
const PRACTICE_AHEAD = 3;

export function startPractice(focus) {
  ui.session = newSession([], { practice: true, focus });
  topUpPractice();
  refillGaps();
  topUpRules();
  classifyOldMistakes();
}

export function topUpPractice() {
  const s = ui.session;
  if (s.ended) return;
  const want = s.idx + PRACTICE_AHEAD;
  if (s.tasks.length >= want) return;
  // Built from current data each time, so answers already given change what comes next.
  const pool = practicePool({ ...sessionArgs(), focus: s.focus });
  const added = [];
  while (s.tasks.length < want) {
    const task = nextPracticeTask(pool, s.tasks.map((x) => x.item.id), { focus: s.focus });
    if (!task) break;
    prepare(task);
    s.tasks.push(task);
    added.push(task);
  }
  if (code() === 'ja') fillFurigana(added.map((x) => x.word).filter(Boolean));
}

// Saves the answer to the current task (the first time it is answered) and moves on.
export function advance(task) {
  const { grade, answer } = task.state;
  const firstTry = !ui.session.requeued.has(task);
  if (firstTry) {
    const now = Date.now();
    // The latest copy: in practice the same item can come up again before an earlier answer was saved.
    task.item = latestItem(task.item);
    const { saved, review } = answerRecord(task, task.item, { grade, answer, practice: ui.session.practice, lang: ui.session.lang, now });
    store.saveReview(saved, review);
    task.item = saved;
    // Right: that sentence is retired. Wrong: it comes back at the word's next gap fill.
    if (task.kind === 'gap' && !isSentence(task.word) && task.gap) {
      const w = store.getWord(task.word.id);
      if (w) store.updateWord(w.id, afterGap(w, task.gap.sentence, grade, now));
    }
    ui.session.answered++;
    if (grade !== 'wrong') ui.session.correct++;
    const at = requeueAt(task, grade, { practice: ui.session.practice, idx: ui.session.idx, length: ui.session.tasks.length });
    if (at >= 0) {
      ui.session.requeued.add(task);
      ui.session.tasks.splice(at, 0, task);
    }
  }
  ui.session.idx++;
}
