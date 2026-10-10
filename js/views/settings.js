// Settings, and its Advanced (Gemini model) and Backup pages.
import * as store from '../store.js';
import * as gemini from '../gemini.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { main, titleEl, esc, $, $$, toast, errorBox, inputAttrs } from '../ui/dom.js';
import { code, resetViews } from '../ui/context.js';
import { furiMode } from '../ui/text.js';
import { route } from '../router.js';
import { learnCard, bindLearnCard } from './learncard.js';
import { accountSynced, renderSync, renderAdmin } from './account.js';

const standalone = () => navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;

export function viewSettings() {
  titleEl.textContent = t('settings.title');
  const s = store.getSettings();
  main.innerHTML = `
    <div class="group-label">${esc(t('settings.groupLearn'))}</div>
    <section class="card form" id="learncard">
      ${learnCard()}
      <div class="row-label"><span>${esc(t('settings.newPerDay'))}</span>
        <div class="stepper"><button type="button" id="npdminus" aria-label="−">−</button><output id="npd">${esc(s.newPerDay)}</output><button type="button" id="npdplus" aria-label="+">+</button></div></div>
      <p class="muted small">${esc(t('settings.learningHelp'))}</p>
      ${code() === 'ja' ? `<div class="row-label"><span>${esc(t('settings.furigana'))}</span>
        <div class="seg" id="furi" style="min-width:210px">${['tap', 'always', 'off'].map((v) =>
          `<button type="button" data-v="${v}" class="${furiMode() === v ? 'on' : ''}">${esc(t(`settings.furigana.${v}`))}</button>`).join('')}</div></div>
      <p class="muted small">${esc(t('settings.furiganaHelp'))}</p>` : ''}
    </section>
    <div class="group-label">${esc(t('sync.title'))}</div>
    <section class="card form" id="synccard"></section>
    <div id="admincard" class="contents"></div>
    <div class="group-label">Gemini</div>
    <section class="card form">
      <label>${esc(t('settings.apiKey'))}
        <div class="inline"><input id="key" type="password" ${inputAttrs} value="${esc(store.getApiKey())}" placeholder="AIza…">
        <button class="btn small text" id="showkey">${esc(t('settings.show'))}</button></div>
      </label>
      <p class="muted small">${esc(t('settings.apiKeyHelp'))} <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></p>
      <button class="btn" id="test">${esc(t('settings.test'))}</button>
      <div id="testres"></div>
    </section>
    <nav class="list">
      <a href="#/settings/advanced"><span>${esc(t('settings.advanced'))}</span><span class="val"><span class="ellipsis">${esc(s.model)}</span>${icon('chevron', 18)}</span></a>
    </nav>
    <div class="group-label">${esc(t('settings.groupApp'))}</div>
    <section class="card form">
      <div class="row-label"><span>${esc(t('settings.language'))}</span>
        <div class="seg" id="lang" style="min-width:180px">
          <button data-lang="de" class="${s.lang !== 'en' ? 'on' : ''}">Deutsch</button>
          <button data-lang="en" class="${s.lang === 'en' ? 'on' : ''}">English</button>
        </div>
      </div>
    </section>
    <nav class="list">
      <a href="#/settings/backup"><span>${esc(t('settings.backup'))}</span><span class="val">${icon('chevron', 18)}</span></a>
    </nav>
    ${standalone() ? '' : `<p class="muted small center">${esc(t('settings.install'))}</p>`}
    <p class="muted small center">Language Trainer v2</p>`;

  bindLearnCard(viewSettings);
  $$('#lang button').forEach((b) => b.addEventListener('click', () => { store.setSettings({ lang: b.dataset.lang }); route(); }));
  $$('#furi button').forEach((b) => b.addEventListener('click', () => {
    store.setSettings({ furigana: b.dataset.v });
    $$('#furi button').forEach((x) => x.classList.toggle('on', x === b));
    document.body.classList.toggle('furi-tap', furiMode() === 'tap');
  }));
  $('#key').addEventListener('change', (e) => { store.setApiKey(e.target.value); toast(t('settings.saved')); });
  $('#showkey').addEventListener('click', (e) => {
    const k = $('#key');
    k.type = k.type === 'password' ? 'text' : 'password';
    e.target.textContent = k.type === 'password' ? t('settings.show') : t('settings.hide');
  });
  bindTest();
  const step = (d) => {
    const n = Math.min(50, Math.max(0, (store.getSettings().newPerDay || 0) + d));
    store.setSettings({ newPerDay: n });
    $('#npd').textContent = n;
  };
  $('#npdminus').addEventListener('click', () => step(-1));
  $('#npdplus').addEventListener('click', () => step(1));
  renderSync();
  renderAdmin();
}

function bindTest() {
  $('#test').addEventListener('click', async () => {
    if ($('#key')) store.setApiKey($('#key').value);
    $('#testres').innerHTML = `<div class="loading">…</div>`;
    try {
      const r = await gemini.testKey();
      if ($('#model')) $('#model').value = r.model;
      $('#testres').innerHTML = `<div class="notice ok">${esc(t('settings.testOk', { m: r.model }))}</div>`;
    } catch (e) { $('#testres').innerHTML = errorBox(e); }
  });
}

// Settings › Advanced: which Gemini model to use.
export function viewAdvanced() {
  titleEl.textContent = t('settings.advanced');
  const s = store.getSettings();
  main.innerHTML = `
    <section class="card form">
      <label>${esc(t('settings.model'))}
        <div class="inline"><input id="model" list="models" ${inputAttrs} value="${esc(s.model)}">
        <button class="btn small" id="loadmodels">${esc(t('settings.loadModels'))}</button></div>
        <datalist id="models"></datalist>
      </label>
      <p class="muted small">${esc(t('settings.advancedHelp'))}</p>
      <button class="btn" id="test">${esc(t('settings.test'))}</button>
      <div id="testres"></div>
    </section>`;
  $('#model').addEventListener('change', (e) => { store.setSettings({ model: e.target.value.trim() || 'gemini-flash-latest' }); toast(t('settings.saved')); });
  $('#loadmodels').addEventListener('click', async () => {
    try {
      const names = await gemini.listModels();
      $('#models').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
      $('#testres').innerHTML = `<p class="muted small">${esc(names.join(', '))}</p>`;
    } catch (e) { $('#testres').innerHTML = errorBox(e); }
  });
  bindTest();
}

// Settings › Backup: export, import and deleting everything.
export function viewBackup() {
  titleEl.textContent = t('settings.backup');
  main.innerHTML = `
    <section class="card form">
      <p class="muted small">${esc(t(accountSynced() ? 'settings.backupHelpSynced' : 'settings.backupHelp'))}</p>
      <div class="actions">
        <button class="btn" id="export">${esc(t('settings.export'))}</button>
        <label class="btn" for="importfile">${esc(t('settings.import'))}</label>
        <input id="importfile" type="file" accept="application/json,.json" class="hidden">
      </div>
    </section>
    <button class="btn danger" id="reset">${esc(t('settings.reset'))}</button>`;
  $('#export').addEventListener('click', exportBackup);
  $('#importfile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const r = store.importData(await f.text());
      toast(t('settings.imported', { w: r.words, m: r.mistakes }));
    } catch (err) { toast(err.message); }
  });
  $('#reset').addEventListener('click', () => {
    if (confirm(t(accountSynced() ? 'settings.confirmResetSynced' : 'settings.confirmReset'))) { store.resetData(); resetViews(); toast('OK'); }
  });
}

async function exportBackup() {
  const name = `language-trainer-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([store.exportData()], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
