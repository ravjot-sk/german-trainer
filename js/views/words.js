// The word list, with search and a words/sentences filter.
import * as store from '../store.js';
import { t } from '../i18n.js';
import { isNew } from '../srs.js';
import { recLang, lemmaOf, isSentence, wordTitle } from '../languages.js';
import { icon } from '../icons.js';
import { html, setHtml, main, titleEl, $, $$, inputAttrs, pref, setPref, pressedAttrs, choose } from '../ui/dom.js';
import { gem, code, ui } from '../ui/context.js';
import { tl, toneLabel, fmtDate } from '../ui/text.js';
import { bindSuggest } from '../ui/suggest.js';
import { openEditor } from './editor.js';

export function wordRows(list) {
  return html`<ul class="rows">${list.map((w) => {
    const item = store.reviewItemFor('word', w.id);
    const dueNow = item && !isNew(item) && item.due <= Date.now();
    const status = !item || isNew(item) ? html`<span class="status">${t('words.new')}</span>`
      : html`<span class="status ${dueNow ? 'due' : ''}">${t('words.due', { d: fmtDate(item.due) })}</span>`;
    if (isSentence(w)) {
      return html`<li data-word="${w.id}"><div class="grow"><div class="ellipsis"><span class="kind">${icon('speech', 15)}</span><span ${tl(recLang(w))}>${lemmaOf(w)}</span></div>
        <div class="muted small ellipsis">${toneLabel(w.tone)} · ${w.meaning}</div></div>${status}</li>`;
    }
    const reading = w.reading ? html` <span class="muted small" ${tl(recLang(w))}>${w.reading}</span>` : '';
    return html`<li data-word="${w.id}"><div><b ${tl(recLang(w))}>${wordTitle(w)}</b>${reading}<div class="muted small ellipsis">${w.meaning}</div></div>${status}</li>`;
  })}</ul>`;
}

export function bindWordRows(root) {
  $$('[data-word]', root).forEach((li) => li.addEventListener('click', () => openEditor(li.dataset.word)));
}

export function viewWords() {
  titleEl.textContent = t('words.title');
  const all = store.words(code());
  let show = pref('wordFilter', 'all');
  setHtml(main, html`
    <div class="toolbar">
      <input id="search" type="search" ${inputAttrs} placeholder="${t('words.search')}" value="${ui.wordQuery}">
      ${gem() ? html`<button class="btn" data-suggest aria-label="${t('suggest.open')}">${icon('sparkle', 22)}</button>` : ''}
      <button class="btn" id="add" aria-label="${t('words.add')}">${icon('plus', 22)}</button>
    </div>
    ${all.some(isSentence) ? html`<div class="seg" id="wfilter">${['all', 'words', 'sentences'].map((f) =>
      html`<button type="button" data-v="${f}" ${pressedAttrs(f === show)}>${t(`words.filter.${f}`)}</button>`)}</div>` : ''}
    <div id="wlist"></div>`);
  const draw = () => {
    const q = ui.wordQuery.toLowerCase();
    const kind = all.some(isSentence) ? show : 'all';
    const list = all
      .filter((w) => kind === 'all' || (kind === 'sentences') === isSentence(w))
      .filter((w) => !q || [lemmaOf(w), w.reading, w.meaning].some((f) => (f || '').toLowerCase().includes(q)));
    setHtml($('#wlist'), all.length
      ? html`<p class="muted small">${t(`words.count.${kind}`, { n: list.length })}</p>${wordRows(list)}`
      : html`<p class="muted center">${t('words.empty')}</p>`);
    bindWordRows($('#wlist'));
  };
  $$('#wfilter button').forEach((b) => b.addEventListener('click', () => {
    show = b.dataset.v;
    setPref('wordFilter', show);
    choose($$('#wfilter button'), b);
    draw();
  }));
  $('#search').addEventListener('input', (e) => { ui.wordQuery = e.target.value; draw(); });
  $('#add').addEventListener('click', () => openEditor(null));
  bindSuggest(main);
  draw();
}
