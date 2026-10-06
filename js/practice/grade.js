// Checking an answer: locally where possible, with Gemini for free writing. Returns the
// grade and the feedback HTML.
import * as store from '../store.js';
import * as gemini from '../gemini.js';
import { t } from '../i18n.js';
import { compare, compareAny, compareExact, checkRecall, needsPlural } from '../check.js';
import { recLang, lemmaOf, wordTitle } from '../languages.js';
import { icon } from '../icons.js';
import { poolOf, addToPool, gapLevel } from '../gappool.js';
import { esc, $ } from '../ui/dom.js';
import { gem } from '../ui/context.js';
import { tl, jt, furiShown, toneLabel, diffHtml, correctionHtml, naturalBlock } from '../ui/text.js';
import { ruleCompare, transformGrade, strictGrade, isExact } from '../answer.js';

// Checks the answer to a task: locally where it can be, otherwise with Gemini. Returns the
// grade, the feedback to show and the mistakes Gemini found.
export async function gradeTask(task, a1, a2, fb) {
  let grade = 'wrong', html = '', canOverride = false, mistakes = [], almostKey = null;
  if (task.kind === 'recall') {
    const r = checkRecall(task.word, a1, a2);
    grade = r.grade;
    if (r.byReading) almostKey = 'session.almostReading';
    canOverride = grade !== 'correct';
    html = wordReveal(task.word);
  } else if (task.kind === 'order') {
    grade = compare(a1, lemmaOf(task.word));
    canOverride = grade !== 'correct';
    html = sentenceReveal(task.word);
  } else if (task.kind === 'say') {
    const w = task.word;
    if (gem()) {
      fb.innerHTML = `<div class="loading">${esc(t('session.grading'))}</div>`;
      const r = await gemini.gradeTranslation(w, a1);
      mistakes = r.mistakes || [];
      grade = r.correct && !mistakes.length ? 'correct' : 'wrong';
      html = `<p>${esc(r.feedback)}</p>
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
    grade = compare(a1, task.gap.answer);
    canOverride = grade !== 'correct';
    html = `<div class="reveal" ${tl()}><b>${esc(task.gap.answer)}</b><div class="sentence">${jt(task.gap.sentence.replace('___', task.gap.answer), task.word)}</div>
      ${task.gap.translation ? `<div class="muted small" lang="en">${esc(task.gap.translation)}</div>` : ''}</div>`;
  } else if (task.kind === 'rule') {
    ({ grade, html, canOverride, mistakes } = await checkRule(task, a1, fb));
  } else if (task.kind === 'write') {
    fb.innerHTML = `<div class="loading">${esc(t('session.grading'))}</div>`;
    const r = await gemini.gradeWordSentence(task.word, a1);
    mistakes = r.mistakes || [];
    grade = r.usesWordCorrectly && !mistakes.length ? 'correct' : 'wrong';
    // The learner's own sentence, corrected, becomes one of the word's gap sentences.
    if (r.usesWordCorrectly && r.gapSentence) {
      const w = store.getWord(task.word.id);
      if (w) store.updateWord(w.id, { gapPool: addToPool(poolOf(w), [{ sentence: r.gapSentence, answer: r.gapAnswer }],
        { level: gapLevel(task.item.reps || 0), source: 'own' }) });
    }
    html = `<p>${esc(r.feedback)}</p>${correctionHtml(a1, r.correctedText, mistakes)}
      ${naturalBlock(r.natural, r.naturalReason)}`;
  } else if (task.kind === 'drill') {
    const d = task.drill;
    if (task.drillKind === 'gapfill') {
      grade = compareAny(a1, [d.answer, ...(d.acceptableAnswers || [])]);
      canOverride = grade !== 'correct';
      html = `<div class="reveal"><b ${tl()}>${esc(d.answer)}</b>${d.prompt ? `<div class="sentence" ${tl()}>${jt(d.prompt.replace('___', d.answer), d)}</div>` : ''}
        <div class="muted small">${esc(d.explanation)}</div></div>`;
    } else {
      fb.innerHTML = `<div class="loading">${esc(t('session.grading'))}</div>`;
      const r = await gemini.gradeAnswer({ instruction: d.instruction, prompt: d.prompt, model: d.answer, answer: a1, category: task.category });
      mistakes = r.mistakes || [];
      grade = r.correct ? 'correct' : 'wrong';
      html = `<p>${esc(r.feedback)}</p>
        ${correctionHtml(a1, r.correctedText, mistakes)}
        <div class="reveal"><div class="muted small">${esc(t('session.answer'))}</div><div class="sentence" ${tl()}>${jt(d.answer, d)}</div>
        <div class="muted small">${esc(d.explanation)}</div></div>`;
    }
  }
  return { grade, html, canOverride, mistakes, almostKey };
}

// Checks a rule exercise. Choices, gaps and transformations are checked here; a corrected
// text that differs from the model and a free sentence go to Gemini.
async function checkRule(task, a1, fb) {
  const { rule, ex: e } = task;
  const why = (x) => (x ? `<div class="muted small">${esc(x)}</div>` : '');
  const ruleLine = rule.statement ? `<div class="tip"><b>${esc(rule.name)}</b> ${esc(rule.statement)}</div>` : '';
  let grade = 'wrong', html = '', canOverride = false, mistakes = [];
  if (task.ruleKind === 'pair') {
    grade = a1 === e.correct ? 'correct' : 'wrong';
    html = `<div class="reveal"><div class="sentence" ${tl()}>${jt(e.correct, e)}</div>${why(e.explanation)}</div>`;
  } else if (task.ruleKind === 'gap') {
    grade = ruleCompare(rule, a1, [e.answer, ...(e.acceptable || [])]);
    canOverride = grade !== 'correct';
    html = `<div class="reveal"><b ${tl()}>${esc(e.answer)}</b><div class="sentence" ${tl()}>${jt(e.sentence.replace('___', e.answer), e)}</div>${why(e.explanation)}</div>`;
  } else if (task.ruleKind === 'transform') {
    const answers = e.items.map((_, i) => $(i ? `#t${i}` : '#a1').value);
    const grades = e.items.map((x, i) => ruleCompare(rule, answers[i], [x.answer, ...(x.acceptable || [])]));
    grade = transformGrade(grades);
    canOverride = grade !== 'correct';
    task.answerText = answers.join(' / ');
    html = `<div class="reveal">${e.items.map((x, i) => `<div class="tf-result ${grades[i] === 'correct' ? 'ok' : 'bad'}">
      ${grades[i] === 'correct' ? icon('check', 16) : icon('close', 16)} <span ${tl()}>${jt(x.answer, e)}</span></div>`).join('')}${why(e.explanation)}</div>`;
  } else if (task.ruleKind === 'spot') {
    grade = isExact(rule) ? compareExact(a1, e.corrected) : compare(a1, e.corrected);
    if (grade !== 'correct' && gem()) {
      fb.innerHTML = `<div class="loading">${esc(t('session.grading'))}</div>`;
      const r = await gemini.gradeAnswer({ instruction: 'Find and correct the mistakes against the rule in this text. Change nothing else.',
        prompt: e.text, model: e.corrected, answer: a1, category: rule.category, rule });
      grade = r.correct ? 'correct' : 'wrong';
      html = `<p>${esc(r.feedback)}</p>`;
    }
    canOverride = grade !== 'correct' && !gem();
    html += `<div class="reveal"><div class="sentence" ${tl()}>${diffHtml(e.text, e.corrected)}</div>${why(e.explanation)}</div>`;
  } else {
    fb.innerHTML = `<div class="loading">${esc(t('session.grading'))}</div>`;
    const r = await gemini.gradeAnswer({ instruction: e.instruction, prompt: '', model: e.model, answer: a1, category: rule.category, rule });
    mistakes = r.mistakes || [];
    grade = r.correct ? 'correct' : 'wrong';
    html = `<p>${esc(r.feedback)}</p>
      ${correctionHtml(a1, r.correctedText, mistakes)}
      <div class="reveal"><div class="muted small">${esc(t('session.answer'))}</div><div class="sentence" ${tl()}>${jt(e.model, e)}</div>${why(e.explanation)}</div>`;
  }
  grade = strictGrade(rule, grade);
  return { grade, html: html + (grade === 'correct' ? '' : ruleLine), canOverride, mistakes };
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
