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
import { esc, $$, toast } from './dom.js';
import { code, cats, gem } from './context.js';

// Marks text in the language being learnt, so iOS picks the right glyphs (Japanese kanji,
// not Chinese) and right-to-left text runs the right way.
export const tl = (c = code()) => `lang="${esc(c)}" dir="auto"`;
// Furigana over Japanese kanji: 'tap' (shown when the text is tapped), 'always' or 'off'.
export const furiMode = () => store.getSettings().furigana || 'tap';
// Text in the language being learnt, with furigana when the record has it for exactly this text.
export function jt(text, rec, c = code()) {
  const segs = c === 'ja' && furiMode() !== 'off' ? segmentsFor(text, rec) : null;
  return segs ? `<span class="furi">${toHtml(segs)}</span>` : esc(text);
}
// The separate reading line is only needed when the word itself shows no furigana.
export const furiShown = (w) => recLang(w) === 'ja' && furiMode() !== 'off' && !!segmentsFor(lemmaOf(w), w);
export const readingLine = (w) => (w.reading && !furiShown(w) ? `<div class="reading" ${tl(recLang(w))}>${esc(w.reading)}</div>` : '');

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
  return wordDiff(a, b).map((p) =>
    p.type === 'same' ? esc(p.text) : p.type === 'del' ? `<del>${esc(p.text)}</del>` : `<ins>${esc(p.text)}</ins>`
  ).join('');
}

export function mistakeList(list, c = code()) {
  return `<ul class="mistakes">${list.map((m) => `
    <li>
      <span class="chip">${esc(categoryLabel(migrateCategory(m.lang || c, m.category), lang(), cats(store.language(m.lang || c))))}</span>
      <div class="fix" ${tl(m.lang || c)}><del>${esc(m.original)}</del> → <ins>${esc(m.corrected)}</ins></div>
      <div class="muted">${esc(m.explanation)}</div>
    </li>`).join('')}</ul>`;
}

// The learner's text with Gemini's corrections marked, and the list of mistakes.
export const correctionHtml = (answer, corrected, mistakes) =>
  (mistakes.length ? `<div class="sentence" ${tl()}>${diffHtml(answer, corrected)}</div>${mistakeList(mistakes)}` : '');

// "More natural" suggestion under a correction, with a button that saves it as a sentence.
export function naturalBlock(text, reason, c = code()) {
  if (!text) return '';
  const saved = store.findWord(text, c);
  return `<div class="natural">
    <div class="natural-title">${icon('bulb', 18)} ${esc(t('natural.title'))}</div>
    <div class="natural-text" ${tl(c)}>${esc(text)}</div>
    ${reason ? `<div class="muted small">${esc(reason)}</div>` : ''}
    ${saved ? `<div class="saved-note">${icon('check', 16)} ${esc(t('natural.inList'))}</div>`
      : `<button type="button" class="btn small" data-natural="${esc(text)}" data-lang="${esc(c)}">${icon('plus', 16)} ${esc(t('natural.add'))}</button>`}
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
      b.outerHTML = `<div class="saved-note">${icon('check', 16)} ${esc(t('natural.saved'))}</div>`;
    } catch (e) {
      b.disabled = false;
      b.innerHTML = `${icon('plus', 16)} ${esc(t('natural.add'))}`;
      toast(e.message || String(e));
    }
  }));
}
