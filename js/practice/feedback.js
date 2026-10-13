// The feedback shown after an answer is checked, and the answer shown when the learner doesn't
// know it. grade.js decides; this file only draws.
import * as store from '../store.js';
import { t } from '../i18n.js';
import { needsPlural } from '../check.js';
import { recLang, lemmaOf, wordTitle } from '../languages.js';
import { icon } from '../icons.js';
import { poolOf } from '../gappool.js';
import { esc } from '../ui/dom.js';
import { tl, jt, furiShown, toneLabel, diffHtml, correctionHtml, naturalBlock } from '../ui/text.js';
import { fixPairs } from '../answer.js';

export const para = (x) => (x ? `<p>${esc(x)}</p>` : '');

// A wrong answer the app checked itself, corrected: what the learner wrote with the wrong
// words crossed out and the right ones marked. parts: [answer, right answer(s)].
export function fixHtml(grade, parts, c) {
  const pairs = fixPairs(grade, parts);
  return pairs.length ? `<div class="your-fix"><div class="muted small">${esc(t('session.yourFix'))}</div>
    ${pairs.map(([a, e]) => `<div class="sentence" ${tl(c)}>${diffHtml(a, e)}</div>`).join('')}</div>` : '';
}

// A verdict, the learner's answer corrected where it was wrong, then the answer (reveal).
export const checked = (verdict, grade, parts, c, reveal) => para(verdict) + fixHtml(grade, parts, c) + reveal;

// Gemini's feedback on a free answer, the answer corrected, then the model answer (reveal).
export const graded = (a1, r, mistakes, reveal) => `${para(r.feedback)}
  ${correctionHtml(a1, r.correctedText, mistakes)}
  ${reveal}`;

// "Say this sentence": a different tone is only a tip; a more natural phrasing shows when right.
export const sayHtml = (w, a1, r, mistakes, grade) => `${para(r.feedback)}
  ${correctionHtml(a1, r.correctedText, mistakes)}
  ${r.toneHint ? `<div class="tip"><b>${esc(t('ex.toneTip', { tone: toneLabel(w.tone) }))}</b> ${esc(r.toneHint)}</div>` : ''}
  ${sentenceReveal(w)}
  ${grade === 'correct' ? naturalBlock(r.natural, r.naturalReason) : ''}`;

// "Write a sentence": the sentence corrected and a more natural phrasing.
export const writeHtml = (a1, r, mistakes) => `${para(r.feedback)}${correctionHtml(a1, r.correctedText, mistakes)}
  ${naturalBlock(r.natural, r.naturalReason)}`;

// A transformation with several sentences: each marked right or wrong. A right sentence shows
// the model answer; a wrong one shows the learner's answer corrected.
export function transformHtml(e, grades, answers, rights, notes) {
  const line = (x, i) => {
    const [fix] = fixPairs(grades[i], [[answers[i], rights[i]]]);
    return fix ? diffHtml(...fix) : jt(x.answer, e);
  };
  return `<div class="reveal">${e.items.map((x, i) => `<div class="tf-result ${grades[i] === 'correct' ? 'ok' : 'bad'}">
    ${grades[i] === 'correct' ? icon('check', 16) : icon('close', 16)} <span ${tl()}>${line(x, i)}</span></div>${why(notes[i])}`).join('')}${why(e.explanation)}</div>`;
}

// "Correct the errors": the learner's answer corrected replaces the corrected exercise text,
// which would otherwise look like a second correction of their answer.
export function spotHtml(verdict, grade, a1, task) {
  const fix = fixHtml(grade, [[a1, task.ex.corrected]]);
  return para(verdict) + (fix ? fix + why(task.ex.explanation) : ruleReveal(task));
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

export const why = (x) => (x ? `<div class="muted small">${esc(x)}</div>` : '');
export const ruleLine = (rule) => (rule.statement ? `<div class="tip"><b>${esc(rule.name)}</b> ${esc(rule.statement)}</div>` : '');

export function ruleReveal(task) {
  const e = task.ex;
  switch (task.ruleKind) {
    case 'pair': return `<div class="reveal"><div class="sentence" ${tl()}>${jt(e.correct, e)}</div>${why(e.explanation)}</div>`;
    case 'gap': return `<div class="reveal"><b ${tl()}>${esc(e.answer)}</b><div class="sentence" ${tl()}>${jt(e.sentence.replace('___', e.answer), e)}</div>${why(e.explanation)}</div>`;
    case 'transform': return `<div class="reveal">${e.items.map((x) => `<div class="sentence" ${tl()}>${jt(x.answer, e)}</div>`).join('')}${why(e.explanation)}</div>`;
    case 'spot': return `<div class="reveal"><div class="sentence" ${tl()}>${diffHtml(e.text, e.corrected)}</div>${why(e.explanation)}</div>`;
    default: return `<div class="reveal"><div class="muted small">${esc(t('session.answer'))}</div><div class="sentence" ${tl()}>${jt(e.model, e)}</div>${why(e.explanation)}</div>`;
  }
}

export function drillReveal(task) {
  const d = task.drill;
  if (task.drillKind === 'gapfill') {
    return `<div class="reveal"><b ${tl()}>${esc(d.answer)}</b>${d.prompt ? `<div class="sentence" ${tl()}>${jt(d.prompt.replace('___', d.answer), d)}</div>` : ''}
      ${why(d.explanation)}</div>`;
  }
  return `<div class="reveal"><div class="muted small">${esc(t('session.answer'))}</div><div class="sentence" ${tl()}>${jt(d.answer, d)}</div>
    ${why(d.explanation)}</div>`;
}

export function gapReveal(task) {
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

export function sentenceReveal(w) {
  return `<div class="reveal"><div class="muted small">${esc(t('ex.saved'))} · ${esc(toneLabel(w.tone))}</div>
    <div class="sentence" ${tl(recLang(w))}>${jt(lemmaOf(w), w, recLang(w))}${w.reading && !furiShown(w) ? `<div class="reading">${esc(w.reading)}</div>` : ''}</div>
    ${w.toneNote ? `<div class="muted small">${esc(w.toneNote)}</div>` : ''}</div>`;
}

export function wordReveal(w) {
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
