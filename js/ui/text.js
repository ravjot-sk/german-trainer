// Pieces of HTML shared by several screens: text in the language being learnt (with furigana),
// dates, corrections and the "more natural" suggestion.
import * as store from '../store.js';
import { t, lang } from '../i18n.js';
import * as gemini from '../gemini.js';
import { dayStart, DAY } from '../srs.js';
import { wordDiff } from '../check.js';
import { categoryLabel, migrateCategory } from '../categories.js';
import { recLang, lemmaOf } from '../languages.js';
import { segmentsFor, toHtml } from '../furigana.js';
import { icon } from '../icons.js';
import { html, raw, setHtml, replaceHtml, $$, toast } from './dom.js';
import { code, cats, gem } from './context.js';
import { furiMode } from '../appstate.js';

// Marks text in the language being learnt, so iOS picks the right glyphs (Japanese kanji,
// not Chinese) and right-to-left text runs the right way.
export const tl = (c = code()) => html`lang="${c}" dir="auto"`;
// Furigana over Japanese kanji: 'tap' (shown when the text is tapped), 'always' or 'off'.
export { furiMode };
// Text in the language being learnt, with furigana when the record has it for exactly this text.
export function jt(text, rec, c = code()) {
  const segs = c === 'ja' && furiMode() !== 'off' ? segmentsFor(text, rec) : null;
  // toHtml escapes the text and readings itself.
  return segs ? html`<span class="furi">${raw(toHtml(segs))}</span>` : html`${text}`;
}
// A sentence with a gap (___), shown with the gap marked.
export const gapped = (text, rec, c) => raw(jt(text, rec, c).toString().replace('___', '<span class="gap">___</span>'));
// The separate reading line is only needed when the word itself shows no furigana.
export const furiShown = (w) => recLang(w) === 'ja' && furiMode() !== 'off' && !!segmentsFor(lemmaOf(w), w);
export const readingLine = (w) => (w.reading && !furiShown(w) ? html`<div class="reading" ${tl(recLang(w))}>${w.reading}</div>` : '');

export const toneLabel = (tone) => t(`tone.${tone || 'everyday'}`);

// A day near today: "today", "tomorrow" (ahead) or "yesterday" (past), otherwise the date.
function nearDay(ts, past) {
  const days = Math.round((past ? dayStart(Date.now()) - dayStart(ts) : dayStart(ts) - dayStart(Date.now())) / DAY);
  if (days <= 0) return t('date.today');
  if (days === 1) return t(past ? 'date.yesterday' : 'date.tomorrow');
  return new Date(ts).toLocaleDateString(lang() === 'en' ? 'en-GB' : 'de-DE', { day: 'numeric', month: 'short' });
}
export const fmtDate = (ts) => nearDay(ts, false);
export const fmtPast = (ts) => nearDay(ts, true);

export function diffHtml(a, b) {
  return html`${wordDiff(a, b).map((p) =>
    p.type === 'same' ? p.text : p.type === 'del' ? html`<del>${p.text}</del>` : html`<ins>${p.text}</ins>`
  )}`;
}

export function mistakeList(list, c = code()) {
  return html`<ul class="mistakes">${list.map((m) => html`
    <li>
      <span class="chip">${categoryLabel(migrateCategory(m.lang || c, m.category), lang(), cats(store.language(m.lang || c)))}</span>
      <div class="fix" ${tl(m.lang || c)}><del>${m.original}</del> → <ins>${m.corrected}</ins></div>
      <div class="muted">${m.explanation}</div>
    </li>`)}</ul>`;
}

// The learner's text with Gemini's corrections marked, and the list of mistakes.
export const correctionHtml = (answer, corrected, mistakes) =>
  (mistakes.length ? html`<div class="sentence" ${tl()}>${diffHtml(answer, corrected)}</div>${mistakeList(mistakes)}` : '');

// "More natural" suggestion under a correction, with a button that saves it as a sentence.
export function naturalBlock(text, reason, c = code()) {
  if (!text) return '';
  const saved = store.findWord(text, c);
  return html`<div class="natural">
    <div class="natural-title">${icon('bulb', 18)} ${t('natural.title')}</div>
    <div class="natural-text" ${tl(c)}>${text}</div>
    ${reason ? html`<div class="muted small">${reason}</div>` : ''}
    ${saved ? html`<div class="saved-note">${icon('check', 16)} ${t('natural.inList')}</div>`
      : html`<button type="button" class="btn small" data-natural="${text}" data-lang="${c}">${icon('plus', 16)} ${t('natural.add')}</button>`}
  </div>`;
}

export function bindNatural(root) {
  $$('[data-natural]', root).forEach((b) => b.addEventListener('click', async () => {
    const text = b.dataset.natural;
    const c = b.dataset.lang;
    b.disabled = true;
    b.textContent = t('natural.saving');
    try {
      // Gemini describes the sentence (English, tone, pieces) so it can be practised.
      const r = c === code() && gem() ? await gemini.translateSentence(text, null, { keep: true }) : { sentence: text };
      store.addSentence(r, c, 'suggestion');
      replaceHtml(b, html`<div class="saved-note">${icon('check', 16)} ${t('natural.saved')}</div>`);
    } catch (e) {
      b.disabled = false;
      setHtml(b, html`${icon('plus', 16)} ${t('natural.add')}`);
      toast(e.message || String(e));
    }
  }));
}
