// Checking an answer in a session, the feedback shown after it, and the answer shown when the
// learner doesn't know it.
import * as store from '../store.js';
import * as gemini from '../gemini.js';
import { t } from '../i18n.js';
import { compare, compareAny, compareExact, checkRecall, checkGap, needsPlural } from '../check.js';
import { recLang, lemmaOf, wordTitle, isSentence } from '../languages.js';
import { icon } from '../icons.js';
import { poolOf } from '../gappool.js';
import { esc, $ } from '../ui/dom.js';
import { gem } from '../ui/context.js';
import { tl, jt, furiShown, toneLabel, diffHtml, correctionHtml, naturalBlock } from '../ui/text.js';
import { ruleCompare, transformGrade, strictGrade, isExact } from '../answer.js';

const grading = (fb) => { fb.innerHTML = `<div class="loading">${esc(t('session.grading'))}</div>`; };
const para = (x) => (x ? `<p>${esc(x)}</p>` : '');
const numbered = (list) => list.map((x, i) => `${i + 1}. ${x}`).join('\n');

// Gemini's verdict on an answer the app checked itself, for "Check again".
async function judged(fb, args) {
  grading(fb);
  const o = await gemini.judgeAnswer(args);
  return { grade: o.correct ? 'correct' : o.minor ? 'almost' : 'wrong', verdict: o.feedback };
}

// Checks the answer to a task: locally where it can be, otherwise with Gemini. Returns the
// grade, the feedback to show, the mistakes Gemini found (logged when the learner moves on, so a
// second check can still withdraw them) and the plain verdict text.
// recheck ({ correct, feedback }, the first verdict) asks Gemini again: answers the app checks
// itself then get Gemini's opinion instead of the local check.
export async function gradeTask(task, a1, a2, fb, recheck = null) {
  let grade = 'wrong', html = '', canOverride = false, mistakes = [], almostKey = null, verdict = '';
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
    html = para(verdict) + wordReveal(w);
  } else if (task.kind === 'order') {
    grade = compare(a1, lemmaOf(w));
    if (recheck) {
      ({ grade, verdict } = await judged(fb, { instruction: `Put the given pieces in order to say: "${w.meaning}".`,
        shown: task.parts.join(' | '), expected: lemmaOf(w), answer: a1, recheck }));
    }
    canOverride = grade !== 'correct';
    html = para(verdict) + sentenceReveal(w);
  } else if (task.kind === 'say') {
    if (gem()) {
      grading(fb);
      const r = await gemini.gradeTranslation(w, a1, { recheck });
      mistakes = r.mistakes || [];
      grade = r.correct && !mistakes.length ? 'correct' : 'wrong';
      verdict = r.feedback || '';
      html = `${para(r.feedback)}
        ${correctionHtml(a1, r.correctedText, mistakes)}
        ${r.toneHint ? `<div class="tip"><b>${esc(t('ex.toneTip', { tone: toneLabel(w.tone) }))}</b> ${esc(r.toneHint)}</div>` : ''}
        ${sentenceReveal(w)}
        ${grade === 'correct' ? naturalBlock(r.natural, r.naturalReason) : ''}`;
    } else {
      grade = compare(a1, lemmaOf(w));
      canOverride = grade !== 'correct';
      html = sentenceReveal(w);
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
        const g = await gemini.checkGap(w, task.gap, a1, { recheck }).catch((e) => { if (recheck) throw e; return null; });
        if (g?.correct) grade = 'correct';
        verdict = g?.feedback || '';
      }
    }
    canOverride = grade !== 'correct';
    html = para(verdict) + gapReveal(task);
  } else if (task.kind === 'rule') {
    ({ grade, html, canOverride, mistakes, verdict } = await checkRule(task, a1, fb, recheck));
  } else if (task.kind === 'write') {
    grading(fb);
    const r = await gemini.gradeWordSentence(w, a1, { recheck });
    mistakes = r.mistakes || [];
    grade = r.usesWordCorrectly && !mistakes.length ? 'correct' : 'wrong';
    verdict = r.feedback || '';
    corrected = (r.correctedText || a1).trim();
    natural = r.natural || '';
    // The learner's own sentence, corrected, becomes one of the word's gap sentences when
    // they move on.
    if (r.usesWordCorrectly && r.gapSentence) ownGap = { sentence: r.gapSentence, answer: r.gapAnswer, acceptable: r.gapAcceptable };
    html = `${para(r.feedback)}${correctionHtml(a1, r.correctedText, mistakes)}
      ${naturalBlock(r.natural, r.naturalReason)}`;
  } else if (task.kind === 'drill') {
    const d = task.drill;
    if (task.drillKind === 'gapfill') {
      grade = compareAny(a1, [d.answer, ...(d.acceptableAnswers || [])]);
      if (recheck) {
        ({ grade, verdict } = await judged(fb, { instruction: d.instruction, shown: d.prompt, expected: d.answer, answer: a1, recheck }));
      }
      canOverride = grade !== 'correct';
      html = para(verdict) + drillReveal(task);
    } else {
      grading(fb);
      const r = await gemini.gradeAnswer({ instruction: d.instruction, prompt: d.prompt, model: d.answer, answer: a1, category: task.category, recheck });
      mistakes = r.mistakes || [];
      grade = r.correct ? 'correct' : 'wrong';
      verdict = r.feedback || '';
      html = `${para(r.feedback)}
        ${correctionHtml(a1, r.correctedText, mistakes)}
        ${drillReveal(task)}`;
    }
  }
  return { grade, html, canOverride, mistakes, almostKey, verdict, ownGap, corrected, natural };
}

// Checks a rule exercise. Choices, gaps and transformations are checked here; a corrected
// text that differs from the model and a free sentence go to Gemini.
async function checkRule(task, a1, fb, recheck) {
  const { rule, ex: e } = task;
  let grade = 'wrong', html = '', canOverride = false, mistakes = [], verdict = '';
  const about = ` (rule: ${rule.name}${rule.statement ? `: ${rule.statement}` : ''})`;
  if (task.ruleKind === 'pair') {
    grade = a1 === e.correct ? 'correct' : 'wrong';
    if (recheck) {
      ({ grade, verdict } = await judged(fb, { instruction: `Pick the sentence that is correct${about}.`,
        shown: task.order.join(' / '), expected: e.correct, answer: a1, recheck }));
    }
    html = para(verdict) + ruleReveal(task);
  } else if (task.ruleKind === 'gap') {
    grade = ruleCompare(rule, a1, [e.answer, ...(e.acceptable || [])]);
    if (recheck) {
      ({ grade, verdict } = await judged(fb, { instruction: `Fill the gap with the right form${about}.`,
        shown: e.sentence, expected: e.answer, answer: a1, recheck }));
    }
    canOverride = grade !== 'correct';
    html = para(verdict) + ruleReveal(task);
  } else if (task.ruleKind === 'transform') {
    const answers = e.items.map((_, i) => $(i ? `#t${i}` : '#a1').value);
    const grades = e.items.map((x, i) => ruleCompare(rule, answers[i], [x.answer, ...(x.acceptable || [])]));
    // An answer that doesn't match the model or the listed alternatives may still be right
    // (another word order, another correct form): Gemini gets a second look at it.
    const notes = [];
    const unsure = grades.map((g, i) => (g === 'wrong' && answers[i].trim() ? i : -1)).filter((i) => i >= 0);
    if (unsure.length && gem() && !recheck) {
      grading(fb);
      await Promise.all(unsure.map(async (i) => {
        const x = e.items[i];
        const r = await gemini.gradeAnswer({ instruction: e.instruction, prompt: x.prompt, model: x.answer, answer: answers[i], category: rule.category, rule })
          .catch(() => null);
        if (r?.correct) grades[i] = 'correct';
        else if (r?.feedback) notes[i] = r.feedback;
      }));
    }
    grade = transformGrade(grades);
    if (recheck) {
      ({ grade, verdict } = await judged(fb, { instruction: `${e.instruction}${about}`, shown: numbered(e.items.map((x) => x.prompt)),
        expected: numbered(e.items.map((x) => x.answer)), answer: numbered(answers), recheck }));
    }
    canOverride = grade !== 'correct';
    task.answerText = answers.join(' / ');
    html = `${para(verdict)}<div class="reveal">${e.items.map((x, i) => `<div class="tf-result ${grades[i] === 'correct' ? 'ok' : 'bad'}">
      ${grades[i] === 'correct' ? icon('check', 16) : icon('close', 16)} <span ${tl()}>${jt(x.answer, e)}</span></div>${why(notes[i])}`).join('')}${why(e.explanation)}</div>`;
  } else if (task.ruleKind === 'spot') {
    grade = isExact(rule) ? compareExact(a1, e.corrected) : compare(a1, e.corrected);
    if ((grade !== 'correct' || recheck) && gem()) {
      grading(fb);
      const r = await gemini.gradeAnswer({ instruction: 'Find and correct the mistakes against the rule in this text. Change nothing else.',
        prompt: e.text, model: e.corrected, answer: a1, category: rule.category, rule, recheck });
      grade = r.correct ? 'correct' : 'wrong';
      verdict = r.feedback || '';
    }
    canOverride = grade !== 'correct' && !gem();
    html = para(verdict) + ruleReveal(task);
  } else {
    grading(fb);
    const r = await gemini.gradeAnswer({ instruction: e.instruction, prompt: '', model: e.model, answer: a1, category: rule.category, rule, recheck });
    mistakes = r.mistakes || [];
    grade = r.correct ? 'correct' : 'wrong';
    verdict = r.feedback || '';
    html = `${para(r.feedback)}
      ${correctionHtml(a1, r.correctedText, mistakes)}
      ${ruleReveal(task)}`;
  }
  grade = strictGrade(rule, grade);
  return { grade, html: html + (grade === 'correct' ? '' : ruleLine(rule)), canOverride, mistakes, verdict };
}

// The answer to a task, for "I don't know": the same answer a checked task shows.
export function revealFor(task) {
  const w = task.word;
  switch (task.kind) {
    case 'recall': return wordReveal(w);
    case 'order':
    case 'say': return sentenceReveal(w);
    case 'gap': return gapReveal(task);
    case 'write': return writeReveal(w);
    case 'rule': return ruleReveal(task) + ruleLine(task.rule);
    case 'drill': return drillReveal(task);
    default: return '';
  }
}

const why = (x) => (x ? `<div class="muted small">${esc(x)}</div>` : '');
const ruleLine = (rule) => (rule.statement ? `<div class="tip"><b>${esc(rule.name)}</b> ${esc(rule.statement)}</div>` : '');

function ruleReveal(task) {
  const e = task.ex;
  switch (task.ruleKind) {
    case 'pair': return `<div class="reveal"><div class="sentence" ${tl()}>${jt(e.correct, e)}</div>${why(e.explanation)}</div>`;
    case 'gap': return `<div class="reveal"><b ${tl()}>${esc(e.answer)}</b><div class="sentence" ${tl()}>${jt(e.sentence.replace('___', e.answer), e)}</div>${why(e.explanation)}</div>`;
    case 'transform': return `<div class="reveal">${e.items.map((x) => `<div class="sentence" ${tl()}>${jt(x.answer, e)}</div>`).join('')}${why(e.explanation)}</div>`;
    case 'spot': return `<div class="reveal"><div class="sentence" ${tl()}>${diffHtml(e.text, e.corrected)}</div>${why(e.explanation)}</div>`;
    default: return `<div class="reveal"><div class="muted small">${esc(t('session.answer'))}</div><div class="sentence" ${tl()}>${jt(e.model, e)}</div>${why(e.explanation)}</div>`;
  }
}

function drillReveal(task) {
  const d = task.drill;
  if (task.drillKind === 'gapfill') {
    return `<div class="reveal"><b ${tl()}>${esc(d.answer)}</b>${d.prompt ? `<div class="sentence" ${tl()}>${jt(d.prompt.replace('___', d.answer), d)}</div>` : ''}
      ${why(d.explanation)}</div>`;
  }
  return `<div class="reveal"><div class="muted small">${esc(t('session.answer'))}</div><div class="sentence" ${tl()}>${jt(d.answer, d)}</div>
    ${why(d.explanation)}</div>`;
}

function gapReveal(task) {
  const g = task.gap;
  return `<div class="reveal" ${tl()}><b>${esc(g.answer)}</b><div class="sentence">${jt(g.sentence.replace('___', g.answer), task.word)}</div>
    ${g.translation ? `<div class="muted small" lang="en">${esc(g.translation)}</div>` : ''}</div>`;
}

// Sentences with the word, for "I don't know" in the write exercise.
export function writeExamples(w, n = 3) {
  const own = [w.example, ...poolOf(store.getWord(w.id) || w).map((e) => e.sentence.replace('___', e.answer))];
  return [...new Set(own.map((x) => (x || '').trim()).filter(Boolean))].slice(0, n);
}

function writeReveal(w) {
  const c = recLang(w);
  const list = writeExamples(w);
  return `<div class="reveal">
    <div class="kv"><span>${esc(t('ex.word'))}</span><b ${tl(c)}>${jt(wordTitle(w), w, c)}</b></div>
    ${list.length ? `<div class="muted small">${esc(t('session.examples'))}</div>` : ''}
    ${list.map((x) => `<div class="sentence" ${tl(c)}>${jt(x, w, c)}</div>`).join('')}
  </div>`;
}

function sentenceReveal(w) {
  return `<div class="reveal"><div class="muted small">${esc(t('ex.saved'))} · ${esc(toneLabel(w.tone))}</div>
    <div class="sentence" ${tl(recLang(w))}>${jt(lemmaOf(w), w, recLang(w))}${w.reading && !furiShown(w) ? `<div class="reading">${esc(w.reading)}</div>` : ''}</div>
    ${w.toneNote ? `<div class="muted small">${esc(w.toneNote)}</div>` : ''}</div>`;
}

function wordReveal(w) {
  const forms = w.verbForms || w.forms;
  const c = recLang(w);
  return `<div class="reveal">
    <div class="kv"><span>${esc(t('session.answer'))}</span><b ${tl(c)}>${jt(wordTitle(w), w, c)}</b></div>
    ${w.reading ? `<div class="kv"><span>${esc(t('edit.reading'))}</span><span ${tl(c)}>${esc(w.reading)}</span></div>` : ''}
    ${needsPlural(w) ? `<div class="kv"><span>${esc(t('ex.plural'))}</span><b ${tl(c)}>${esc(w.plural)}</b></div>` : ''}
    ${forms ? `<div class="kv"><span>${esc(t('edit.forms'))}</span><span ${tl(c)}>${esc(forms)}</span></div>` : ''}
    ${w.example ? `<div class="sentence" ${tl(c)}>${jt(w.example, w, c)}</div>` : ''}
  </div>`;
}
