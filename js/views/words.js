// The word list, with search and a words/sentences filter.
import * as store from '../store.js';
import { t } from '../i18n.js';
import { isNew } from '../srs.js';
import { recLang, lemmaOf, isSentence, wordTitle } from '../languages.js';
import { icon } from '../icons.js';
import { main, titleEl, esc, $, $$, inputAttrs, pref, setPref } from '../ui/dom.js';
import { gem, code, ui } from '../ui/context.js';
import { tl, toneLabel, fmtDate } from '../ui/text.js';
import { bindSuggest } from './suggest.js';
import { openEditor } from './editor.js';

export function wordRows(list) {
  return `<ul class="rows">${list.map((w) => {
    const item = store.reviewItemFor('word', w.id);
    const dueNow = item && !isNew(item) && item.due <= Date.now();
    const status = !item || isNew(item) ? `<span class="status">${esc(t('words.new'))}</span>`
      : `<span class="status ${dueNow ? 'due' : ''}">${esc(t('words.due', { d: fmtDate(item.due) }))}</span>`;
    if (isSentence(w)) {
      return `<li data-word="${esc(w.id)}"><div class="grow"><div class="ellipsis"><span class="kind">${icon('speech', 15)}</span><span ${tl(recLang(w))}>${esc(lemmaOf(w))}</span></div>
        <div class="muted small ellipsis">${esc(toneLabel(w.tone))} · ${esc(w.meaning)}</div></div>${status}</li>`;
    }
    const reading = w.reading ? ` <span class="muted small" ${tl(recLang(w))}>${esc(w.reading)}</span>` : '';
    return `<li data-word="${esc(w.id)}"><div><b ${tl(recLang(w))}>${esc(wordTitle(w))}</b>${reading}<div class="muted small ellipsis">${esc(w.meaning)}</div></div>${status}</li>`;
  }).join('')}</ul>`;
}

export function bindWordRows(root) {
  $$('[data-word]', root).forEach((li) => li.addEventListener('click', () => openEditor(li.dataset.word)));
}

export function viewWords() {
  titleEl.textContent = t('words.title');
  const all = store.words(code());
  let show = pref('wordFilter', 'all');
  main.innerHTML = `
    <div class="toolbar">
      <input id="search" type="search" ${inputAttrs} placeholder="${esc(t('words.search'))}" value="${esc(ui.wordQuery)}">
      ${gem() ? `<button class="btn" data-suggest aria-label="${esc(t('suggest.open'))}">${icon('sparkle', 22)}</button>` : ''}
      <button class="btn" id="add" aria-label="${esc(t('words.add'))}">${icon('plus', 22)}</button>
    </div>
    ${all.some(isSentence) ? `<div class="seg" id="wfilter">${['all', 'words', 'sentences'].map((f) =>
      `<button type="button" data-v="${f}" class="${f === show ? 'on' : ''}">${esc(t(`words.filter.${f}`))}</button>`).join('')}</div>` : ''}
    <div id="wlist"></div>`;
  const draw = () => {
    const q = ui.wordQuery.toLowerCase();
    const kind = all.some(isSentence) ? show : 'all';
    const list = all
      .filter((w) => kind === 'all' || (kind === 'sentences') === isSentence(w))
      .filter((w) => !q || [lemmaOf(w), w.reading, w.meaning].some((f) => (f || '').toLowerCase().includes(q)));
    $('#wlist').innerHTML = all.length
      ? `<p class="muted small">${esc(t(`words.count.${kind}`, { n: list.length }))}</p>${wordRows(list)}`
      : `<p class="muted center">${esc(t('words.empty'))}</p>`;
    bindWordRows($('#wlist'));
  };
  $$('#wfilter button').forEach((b) => b.addEventListener('click', () => {
    show = b.dataset.v;
    setPref('wordFilter', show);
    $$('#wfilter button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));
  $('#search').addEventListener('input', (e) => { ui.wordQuery = e.target.value; draw(); });
  $('#add').addEventListener('click', () => openEditor(null));
  bindSuggest(main);
  draw();
}
