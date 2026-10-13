// The language and level picker, on Today, in Settings and in the sheet behind the language pill.
import * as store from '../store.js';
import * as gemini from '../gemini.js';
import { t } from '../i18n.js';
import { isCurated } from '../categories.js';
import { icon } from '../icons.js';
import { html, setHtml, $, toast, errorBox, waitBox, inputAttrs } from '../ui/dom.js';
import { L, code, langName, resetViews } from '../ui/context.js';
import { mountSheet } from '../ui/sheet.js';

export function learnCard() {
  const cur = L();
  const opts = store.knownLanguages().map((x) =>
    html`<option value="${x.code}" ${cur?.code === x.code ? 'selected' : ''}>${langName(x)}</option>`);
  const levels = cur ? cur.levels.map((l) => html`<option ${l === cur.level ? 'selected' : ''}>${l}</option>`) : '';
  return html`
    <label>${t('settings.learning')}
      <select id="target">${cur ? '' : html`<option value="" selected disabled>${t('settings.chooseLanguage')}</option>`}${opts}
        <option value="__add">${t('settings.addLanguage')}</option></select>
    </label>
    <div id="addlang" class="hidden">
      <div class="inline"><input id="newlang" ${inputAttrs} placeholder="${t('settings.newLanguage')}">
      <button class="btn small" id="addbtn">${t('settings.add')}</button></div>
      <p class="muted small">${t('settings.addHelp')}</p>
    </div>
    ${cur && !isCurated(cur.code) ? html`<p class="muted small gen-note">${t('profile.generatedNote', { l: langName(cur) })}</p>` : ''}
    ${cur ? html`<label>${t('settings.level')}<select id="level">${cur.level ? '' : html`<option value="" selected disabled>${t('settings.chooseLevel')}</option>`}${levels}</select></label>` : ''}
    <div id="learnres"></div>`;
}

export function bindLearnCard(redraw) {
  $('#target')?.addEventListener('change', (e) => {
    if (e.target.value === '__add') {
      $('#addlang').classList.remove('hidden');
      $('#newlang').focus();
      return;
    }
    store.setActiveLanguage(e.target.value);
    resetViews();
    redraw();
  });
  $('#level')?.addEventListener('change', (e) => {
    store.saveLanguage(code(), { level: e.target.value });
    toast(t('settings.saved'));
    redraw();
  });
  $('#addbtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const name = $('#newlang').value.trim();
    if (!name) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    const signal = waitBox($('#learnres'), t('settings.adding'));
    try {
      const d = await gemini.setupLanguage(name, { signal });
      if (!d) { setHtml($('#learnres'), errorBox(t('settings.langNotFound'))); return; }
      // A language that is already here (built in or added before) keeps its categories.
      if (!store.knownLanguages().some((x) => x.code === d.code)) {
        const { code: c, ...desc } = d;
        store.saveLanguage(c, desc);
      }
      store.setActiveLanguage(d.code);
      resetViews();
      redraw();
    } catch (err) {
      setHtml($('#learnres'), gemini.isCancel(err) ? '' : errorBox(err));
    } finally {
      btn.disabled = false;
    }
  });
}

export function openLangSheet() {
  const { el: back, close } = mountSheet(html`<div class="sheet form">
    <div class="sheet-head"><h2>${t('settings.langSheet')}</h2>
      <button type="button" class="icon-btn" data-act="close" aria-label="${t('edit.close')}">${icon('close', 22)}</button></div>
    ${learnCard()}
    <p class="muted small">${t('settings.learningHelp')}</p>
  </div>`);
  $('[data-act=close]', back).addEventListener('click', close);
  bindLearnCard(close);
}
