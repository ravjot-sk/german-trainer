// Checking an answer in a session: locally where the app can, otherwise with Gemini. The
// feedback it shows is drawn in feedback.js.
import * as gemini from '../gemini.js';
import { t } from '../i18n.js';
import { compare, compareAny, compareExact, checkRecall, checkGap, needsPlural, stripArticle } from '../check.js';
import { recLang, lemmaOf, wordTitle, isSentence } from '../languages.js';
import { html, $, waitBox } from '../ui/dom.js';
import { gem } from '../ui/context.js';
import { ruleCompare, transformGrade, strictGrade, isExact } from '../answer.js';
import * as show from './feedback.js';

// The check under way: its Abbrechen stops every Gemini call it makes (see gradeTask).
let ctl = null;
const call = () => ({ signal: ctl?.signal });
const grading = (fb) => { waitBox(fb, t('session.grading'), '', ctl || undefined); };

// Gemini's verdict on an answer the app checked itself, for "Check again".
async function judged(fb, args) {
  grading(fb);
  const o = await gemini.judgeAnswer(args, call());
  return { grade: o.correct ? 'correct' : o.minor ? 'almost' : 'wrong', verdict: o.feedback };
}

// Checks the answer to a task: locally where it can be, otherwise with Gemini. Returns the
// grade, the feedback to show, the mistakes Gemini found (logged when the learner moves on, so a
// second check can still withdraw them) and the plain verdict text.
// recheck ({ correct, feedback }, the first verdict) asks Gemini again: answers the app checks
// itself then get Gemini's opinion instead of the local check.
// Abbrechen while Gemini checks rejects with a GeminiError of kind 'cancel'.
export async function gradeTask(task, a1, a2, fb, recheck = null) {
  ctl = new AbortController();
  try {
    return await gradeOnce(task, a1, a2, fb, recheck);
  } finally {
    ctl = null;
  }
}

async function gradeOnce(task, a1, a2, fb, recheck) {
  let grade = 'wrong', view = '', canOverride = false, mistakes = [], almostKey = null, verdict = '';
  let ownGap = null, corrected = '', natural = '';
  const w = task.word;
  if (task.kind === 'recall') {
    const r = checkRecall(w, a1, a2);
    grade = r.grade;
    if (r.byReading) almostKey = 'session.almostReading';
    if (recheck) {
      ({ grade, verdict } = await judged(fb, {
        instruction: `Give the word for "${w.meaning}" (${w.pos || 'word'})${needsPlural(w) ? ', and its plural' : ''}.`,
        expected: wordTitle(w) + (needsPlural(w) ? ` / plural: ${w.plural}` : ''),
        answer: a1 + (a2 ? ` / plural: ${a2}` : ''), recheck,
      }));
      almostKey = null;
    }
    canOverride = grade !== 'correct';
    const parts = [r.main !== 'correct' && [a1, r.target], r.plural && r.plural !== 'correct' && [stripArticle(a2), r.pluralTarget]];
    view = show.checked(verdict, grade, parts.filter(Boolean), recLang(w), show.wordReveal(w));
  } else if (task.kind === 'order') {
    grade = compare(a1, lemmaOf(w));
    if (recheck) {
      ({ grade, verdict } = await judged(fb, { instruction: `Put the given pieces in order to say: "${w.meaning}".`,
        shown: task.parts.join(' | '), expected: lemmaOf(w), answer: a1, recheck }));
    }
    canOverride = grade !== 'correct';
    view = show.checked(verdict, grade, [[a1, lemmaOf(w)]], recLang(w), show.sentenceReveal(w));
  } else if (task.kind === 'say') {
    if (gem()) {
      grading(fb);
      const r = await gemini.gradeTranslation(w, a1, { recheck }, call());
      mistakes = r.mistakes || [];
      grade = r.correct && !mistakes.length ? 'correct' : 'wrong';
      verdict = r.feedback || '';
      view = show.sayHtml(w, a1, r, mistakes, grade);
    } else {
      grade = compare(a1, lemmaOf(w));
      canOverride = grade !== 'correct';
      view = show.checked('', grade, [[a1, lemmaOf(w)]], recLang(w), show.sentenceReveal(w));
    }
  } else if (task.kind === 'gap') {
    if (isSentence(w)) {
      grade = compare(a1, task.gap.answer);
      if (recheck) {
        ({ grade, verdict } = await judged(fb, { instruction: `Fill the gap so the sentence means: "${w.meaning}".`,
          shown: task.gap.sentence, expected: task.gap.answer, answer: a1, recheck }));
      }
    } else {
      const r = recheck ? { grade: 'wrong' } : checkGap(w, task.gap, a1);
      grade = r.grade;
      if (r.byReading) almostKey = 'session.almostReading';
      if (r.byForm) almostKey = 'session.almostForm';
      // A wrong answer brings this sentence back next time, so an answer that is right in a
      // form nobody listed must not count as wrong. Gemini decides when it can.
      if (grade === 'wrong' && gem()) {
        grading(fb);
        const g = await gemini.checkGap(w, task.gap, a1, { recheck }, call()).catch((e) => { if (recheck || gemini.isCancel(e)) throw e; return null; });
        if (g?.correct) grade = 'correct';
        verdict = g?.feedback || '';
      }
    }
    canOverride = grade !== 'correct';
    view = show.checked(verdict, grade, [[a1, [task.gap.answer, ...(task.gap.acceptable || [])]]], undefined, show.gapReveal(task));
  } else if (task.kind === 'rule') {
    ({ grade, html: view, canOverride, mistakes, verdict } = await checkRule(task, a1, fb, recheck));
  } else if (task.kind === 'write') {
    grading(fb);
    const r = await gemini.gradeWordSentence(w, a1, { recheck }, call());
    mistakes = r.mistakes || [];
    grade = r.usesWordCorrectly && !mistakes.length ? 'correct' : 'wrong';
    verdict = r.feedback || '';
    corrected = (r.correctedText || a1).trim();
    natural = r.natural || '';
    // The learner's own sentence, corrected, becomes one of the word's gap sentences when
    // they move on.
    if (r.usesWordCorrectly && r.gapSentence) ownGap = { sentence: r.gapSentence, answer: r.gapAnswer, acceptable: r.gapAcceptable };
    view = show.writeHtml(a1, r, mistakes);
  } else if (task.kind === 'drill') {
    const d = task.drill;
    if (task.drillKind === 'gapfill') {
      grade = compareAny(a1, [d.answer, ...(d.acceptableAnswers || [])]);
      if (recheck) {
        ({ grade, verdict } = await judged(fb, { instruction: d.instruction, shown: d.prompt, expected: d.answer, answer: a1, recheck }));
      }
      canOverride = grade !== 'correct';
      view = show.checked(verdict, grade, [[a1, [d.answer, ...(d.acceptableAnswers || [])]]], undefined, show.drillReveal(task));
    } else {
      grading(fb);
      const r = await gemini.gradeAnswer({ instruction: d.instruction, prompt: d.prompt, model: d.answer, answer: a1, category: task.category, recheck }, call());
      mistakes = r.mistakes || [];
      grade = r.correct ? 'correct' : 'wrong';
      verdict = r.feedback || '';
      view = show.graded(a1, r, mistakes, show.drillReveal(task));
    }
  }
  return { grade, html: view, canOverride, mistakes, almostKey, verdict, ownGap, corrected, natural };
}

// Checks a rule exercise. Choices, gaps and transformations are checked here; a corrected
// text that differs from the model and a free sentence go to Gemini.
async function checkRule(task, a1, fb, recheck) {
  const { rule, ex: e } = task;
  let grade = 'wrong', view = '', canOverride = false, mistakes = [], verdict = '';
  const about = ` (rule: ${rule.name}${rule.statement ? `: ${rule.statement}` : ''})`;
  if (task.ruleKind === 'pair') {
    grade = a1 === e.correct ? 'correct' : 'wrong';
    if (recheck) {
      ({ grade, verdict } = await judged(fb, { instruction: `Pick the sentence that is correct${about}.`,
        shown: task.order.join(' / '), expected: e.correct, answer: a1, recheck }));
    }
    view = show.checked(verdict, grade, [[a1, e.correct]], undefined, show.ruleReveal(task));
  } else if (task.ruleKind === 'gap') {
    grade = ruleCompare(rule, a1, [e.answer, ...(e.acceptable || [])]);
    if (recheck) {
      ({ grade, verdict } = await judged(fb, { instruction: `Fill the gap with the right form${about}.`,
        shown: e.sentence, expected: e.answer, answer: a1, recheck }));
    }
    canOverride = grade !== 'correct';
    view = show.checked(verdict, grade, [[a1, [e.answer, ...(e.acceptable || [])]]], undefined, show.ruleReveal(task));
  } else if (task.ruleKind === 'transform') {
    const answers = e.items.map((_, i) => $(i ? `#t${i}` : '#a1').value);
    const rights = e.items.map((x) => [x.answer, ...(x.acceptable || [])]);
    const grades = e.items.map((x, i) => ruleCompare(rule, answers[i], rights[i]));
    const notes = [];
    const unsure = grades.map((g, i) => (g !== 'correct' && answers[i].trim() ? i : -1)).filter((i) => i >= 0);
    if (unsure.length && gem()) {
      grading(fb);
      if (recheck) {
        // "Check again" looks at every sentence that isn't an exact match on its own, so each
        // sentence's mark follows the new verdict.
        const first = task.itemVerdicts || [];
        await Promise.all(unsure.map(async (i) => {
          const x = e.items[i];
          const o = await gemini.judgeAnswer({ instruction: `${e.instruction}${about}`, shown: x.prompt, expected: x.answer, answer: answers[i],
            recheck: { correct: first[i]?.grade === 'correct', feedback: first[i]?.note || '' } }, call());
          grades[i] = o.correct ? 'correct' : o.minor ? 'almost' : 'wrong';
          notes[i] = o.correct ? '' : o.feedback;
        }));
      } else {
        // An answer that doesn't match the model or the listed alternatives may still be right
        // (another word order, another correct form): Gemini gets a second look at it.
        await Promise.all(unsure.filter((i) => grades[i] === 'wrong').map(async (i) => {
          const x = e.items[i];
          const r = await gemini.gradeAnswer({ instruction: e.instruction, prompt: x.prompt, model: x.answer, answer: answers[i], category: rule.category, rule }, call())
            .catch((err) => { if (gemini.isCancel(err)) throw err; return null; });
          if (r?.correct) grades[i] = 'correct';
          else if (r?.feedback) notes[i] = r.feedback;
        }));
      }
    }
    task.itemVerdicts = grades.map((g, i) => ({ grade: g, note: notes[i] || '' }));
    grade = transformGrade(grades);
    verdict = notes.filter(Boolean).join(' ');
    canOverride = grade !== 'correct';
    task.answerText = answers.join(' / ');
    view = show.transformHtml(e, grades, answers, rights, notes);
  } else if (task.ruleKind === 'spot') {
    grade = isExact(rule) ? compareExact(a1, e.corrected) : compare(a1, e.corrected);
    if ((grade !== 'correct' || recheck) && gem()) {
      grading(fb);
      const r = await gemini.gradeAnswer({ instruction: 'Find and correct the mistakes against the rule in this text. Change nothing else.',
        prompt: e.text, model: e.corrected, answer: a1, category: rule.category, rule, recheck }, call());
      grade = r.correct ? 'correct' : 'wrong';
      verdict = r.feedback || '';
    }
    canOverride = grade !== 'correct' && !gem();
    view = show.spotHtml(verdict, grade, a1, task);
  } else {
    grading(fb);
    const r = await gemini.gradeAnswer({ instruction: e.instruction, prompt: '', model: e.model, answer: a1, category: rule.category, rule, recheck }, call());
    mistakes = r.mistakes || [];
    grade = r.correct ? 'correct' : 'wrong';
    verdict = r.feedback || '';
    view = show.graded(a1, r, mistakes, show.ruleReveal(task));
  }
  grade = strictGrade(rule, grade);
  return { grade, html: html`${view}${grade === 'correct' ? '' : show.ruleLine(rule)}`, canOverride, mistakes, verdict };
}
