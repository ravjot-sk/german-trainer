// The feedback shown after an answer is checked, and the answer shown when the learner doesn't
// know it. grade.js decides; this file only draws.
import * as store from '../store.js';
import { needsPlural, fillGap, stripHint, compareAny } from '../check.js';
import { ruleText } from '../rules.js';
import { t, lang } from '../i18n.js';
import { recLang, lemmaOf, wordTitle } from '../languages.js';
import { icon } from '../icons.js';
import { poolOf } from '../gappool.js';
import { html } from '../ui/dom.js';
import { tl, jt, furiShown, toneLabel, diffHtml, correctionHtml, naturalBlock } from '../ui/text.js';
import { fixPairs } from '../answer.js';

export const para = (x) => (x ? html`<p>${x}</p>` : '');

// A wrong answer the app checked itself, corrected: what the learner wrote with the wrong
// words crossed out and the right ones marked. parts: [answer, right answer(s)].
export function fixHtml(grade, parts, c) {
  const pairs = fixPairs(grade, parts);
  return pairs.length ? html`<div class="your-fix"><div class="muted small">${t('session.yourFix')}</div>
    ${pairs.map(([a, e]) => html`<div class="sentence" ${tl(c)}>${diffHtml(a, e)}</div>`)}</div>` : '';
}

// A verdict, the learner's answer corrected where it was wrong, then the answer (reveal).
export const checked = (verdict, grade, parts, c, reveal) => html`${para(verdict)}${fixHtml(grade, parts, c)}${reveal}`;

// Gemini's feedback on a free answer, the answer corrected, then the model answer (reveal).
export const graded = (a1, r, mistakes, reveal) => html`${para(r.feedback)}
  ${correctionHtml(a1, r.correctedText, mistakes)}
  ${reveal}`;

// "Say this sentence": a different tone is only a tip; a more natural phrasing shows when right.
export const sayHtml = (w, a1, r, mistakes, grade) => html`${para(r.feedback)}
  ${correctionHtml(a1, r.correctedText, mistakes)}
  ${r.toneHint ? html`<div class="tip"><b>${t('ex.toneTip', { tone: toneLabel(w.tone) })}</b> ${r.toneHint}</div>` : ''}
  ${sentenceReveal(w)}
  ${grade === 'correct' ? naturalBlock(r.natural, r.naturalReason) : ''}`;

// "Write a sentence": the sentence corrected and a more natural phrasing.
export const writeHtml = (a1, r, mistakes) => html`${para(r.feedback)}${correctionHtml(a1, r.correctedText, mistakes)}
  ${naturalBlock(r.natural, r.naturalReason)}`;

// A transformation with several sentences: each marked right or wrong. A right sentence shows
// the model answer; a wrong one shows the learner's answer corrected.
export function transformHtml(e, grades, answers, rights, notes) {
  // A right answer that isn't the model (Gemini accepted it) shows as the learner wrote it.
  const line = (x, i) => {
    const [fix] = fixPairs(grades[i], [[answers[i], rights[i]]]);
    if (fix) return diffHtml(...fix);
    return jt(grades[i] === 'correct' && answers[i]?.trim() && compareAny(answers[i], rights[i]) !== 'correct' ? answers[i].trim() : x.answer, e);
  };
  return html`<div class="reveal">${e.items.map((x, i) => html`<div class="tf-result ${grades[i] === 'correct' ? 'ok' : 'bad'}">
    ${grades[i] === 'correct' ? icon('check', 16) : icon('close', 16)} <span ${tl()}>${line(x, i)}</span></div>${why(notes[i])}`)}${why(e.explanation)}</div>`;
}

// "Correct the errors": the learner's answer corrected replaces the corrected exercise text,
// which would otherwise look like a second correction of their answer.
// After a second check that accepts the learner's text, that text is what shows.
export function spotHtml(verdict, grade, a1, task, rechecked = false) {
  const fix = fixHtml(grade, [[a1, task.ex.corrected]]);
  if (fix) return html`${para(verdict)}${fix}${why(task.ex.explanation)}`;
  if (rechecked && grade === 'correct' && a1.trim() !== task.ex.corrected.trim()) return html`${para(verdict)}${ownReveal(a1, '', task.ex.explanation, task.ex)}`;
  return html`${para(verdict)}${ruleReveal(task)}`;
}

// The learner's own answer as the solution, when a second check accepted it although it is
// not the stored one. A whole sentence typed into a gap shows as it is; a filling shows in
// its sentence.
export function ownReveal(a1, sentence, explanation, rec) {
  const own = String(a1 || '').trim();
  const whole = !sentence || own.split(/\s+/).length > 3 || own.length > stripHint(sentence).length / 2;
  return html`<div class="reveal"><div class="muted small">${t('session.yourAnswer')}</div>
    <div class="sentence" ${tl()}>${jt(whole ? own : fillGap(sentence, own), rec)}</div>${why(explanation)}</div>`;
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
    case 'rule': return html`${ruleReveal(task)}${ruleLine(task.rule)}`;
    case 'drill': return drillReveal(task);
    default: return '';
  }
}

export const why = (x) => (x ? html`<div class="muted small">${x}</div>` : '');
export function ruleLine(rule) {
  const r = ruleText(rule, lang());
  return r.statement ? html`<div class="tip"><b>${r.name}</b> ${r.statement}</div>` : '';
}

export function ruleReveal(task) {
  const e = task.ex;
  switch (task.ruleKind) {
    case 'pair': return html`<div class="reveal"><div class="sentence" ${tl()}>${jt(e.correct, e)}</div>${why(e.explanation)}</div>`;
    case 'gap': return html`<div class="reveal"><b ${tl()}>${e.answer}</b><div class="sentence" ${tl()}>${jt(fillGap(e.sentence, e.answer), e)}</div>${why(e.explanation)}</div>`;
    case 'transform': return html`<div class="reveal">${e.items.map((x) => html`<div class="sentence" ${tl()}>${jt(x.answer, e)}</div>`)}${why(e.explanation)}</div>`;
    case 'spot': return html`<div class="reveal"><div class="sentence" ${tl()}>${diffHtml(e.text, e.corrected)}</div>${why(e.explanation)}</div>`;
    default: return html`<div class="reveal"><div class="muted small">${t('session.answer')}</div><div class="sentence" ${tl()}>${jt(e.model, e)}</div>${why(e.explanation)}</div>`;
  }
}

export function drillReveal(task) {
  const d = task.drill;
  if (task.drillKind === 'gapfill') {
    return html`<div class="reveal"><b ${tl()}>${d.answer}</b>${d.prompt ? html`<div class="sentence" ${tl()}>${jt(fillGap(d.prompt, d.answer), d)}</div>` : ''}
      ${why(d.explanation)}</div>`;
  }
  return html`<div class="reveal"><div class="muted small">${t('session.answer')}</div><div class="sentence" ${tl()}>${jt(d.answer, d)}</div>
    ${why(d.explanation)}</div>`;
}

export function gapReveal(task) {
  const g = task.gap;
  return html`<div class="reveal" ${tl()}><b>${g.answer}</b><div class="sentence">${jt(fillGap(g.sentence, g.answer), task.word)}</div>
    ${g.translation ? html`<div class="muted small" lang="en">${g.translation}</div>` : ''}</div>`;
}

// Sentences with the word, for "I don't know" in the write exercise.
export function writeExamples(w, n = 3) {
  const own = [w.example, ...poolOf(store.getWord(w.id) || w).map((e) => fillGap(e.sentence, e.answer))];
  return [...new Set(own.map((x) => (x || '').trim()).filter(Boolean))].slice(0, n);
}

function writeReveal(w) {
  const c = recLang(w);
  const list = writeExamples(w);
  return html`<div class="reveal">
    <div class="kv"><span>${t('ex.word')}</span><b ${tl(c)}>${jt(wordTitle(w), w, c)}</b></div>
    ${list.length ? html`<div class="muted small">${t('session.examples')}</div>` : ''}
    ${list.map((x) => html`<div class="sentence" ${tl(c)}>${jt(x, w, c)}</div>`)}
  </div>`;
}

export function sentenceReveal(w) {
  return html`<div class="reveal"><div class="muted small">${t('ex.saved')} · ${toneLabel(w.tone)}</div>
    <div class="sentence" ${tl(recLang(w))}>${jt(lemmaOf(w), w, recLang(w))}${w.reading && !furiShown(w) ? html`<div class="reading">${w.reading}</div>` : ''}</div>
    ${w.toneNote ? html`<div class="muted small">${w.toneNote}</div>` : ''}</div>`;
}

export function wordReveal(w) {
  const forms = w.verbForms || w.forms;
  const c = recLang(w);
  return html`<div class="reveal">
    <div class="kv"><span>${t('session.answer')}</span><b ${tl(c)}>${jt(wordTitle(w), w, c)}</b></div>
    ${w.reading ? html`<div class="kv"><span>${t('edit.reading')}</span><span ${tl(c)}>${w.reading}</span></div>` : ''}
    ${needsPlural(w) ? html`<div class="kv"><span>${t('ex.plural')}</span><b ${tl(c)}>${w.plural}</b></div>` : ''}
    ${forms ? html`<div class="kv"><span>${t('edit.forms')}</span><span ${tl(c)}>${forms}</span></div>` : ''}
    ${w.example ? html`<div class="sentence" ${tl(c)}>${jt(w.example, w, c)}</div>` : ''}
  </div>`;
}
