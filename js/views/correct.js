// Write: Gemini corrects a text; its mistakes go to the profile.
import * as store from '../store.js';
import * as gemini from '../gemini.js';
import { t } from '../i18n.js';
import { logMistakes } from '../actions.js';
import { icon } from '../icons.js';
import { main, titleEl, esc, $, toast, errorBox } from '../ui/dom.js';
import { code, langName, gem, ui } from '../ui/context.js';
import { tl, diffHtml, mistakeList, naturalBlock, bindNatural } from '../ui/text.js';
import { wordTitle } from '../languages.js';
import { routeName } from '../router.js';

export function viewCorrect() {
  titleEl.textContent = t('correct.title');
  const draft = sessionStorage.getItem('gt.draft') || '';
  const collapsed = ui.lastCorrection && !ui.correctOpen;
  main.innerHTML = `
    ${collapsed ? `<section class="card draft-row" id="reopen">
        <div class="grow"><div class="muted small">${esc(t('correct.yourText'))}</div><div class="ellipsis" ${tl(ui.lastCorrection.lang)}>${esc(ui.lastCorrection.text)}</div></div>
        ${icon('down', 18)}
      </section>` : ''}
    <form class="card ${collapsed ? 'hidden' : ''}" id="cf">
      <textarea id="text" rows="6" spellcheck="false" ${tl()} placeholder="${esc(t('correct.placeholder', { l: langName() }))}">${esc(draft)}</textarea>
      <button class="btn primary" type="submit">${esc(t('correct.go'))}</button>
    </form>
    <div id="cres">${ui.lastCorrection ? correctionResult(ui.lastCorrection) : ''}</div>
    ${ui.lastCorrection ? `<button class="btn" id="newtext">${icon('plus', 18)} ${esc(t('correct.newText'))}</button>` : ''}`;
  $('#reopen')?.addEventListener('click', () => { ui.correctOpen = true; viewCorrect(); $('#text').focus(); });
  $('#newtext')?.addEventListener('click', () => {
    sessionStorage.removeItem('gt.draft');
    ui.lastCorrection = null;
    ui.correctOpen = false;
    viewCorrect();
    $('#text').focus();
  });
  $('#text').addEventListener('input', (e) => sessionStorage.setItem('gt.draft', e.target.value));
  $('#cf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#text').value.trim();
    if (!text) return;
    $('#text').blur();
    const res = $('#cres');
    res.innerHTML = `<div class="card loading">${esc(t('correct.loading'))}</div>`;
    try {
      const r = await gemini.correctText(text);
      const logged = logMistakes(r.mistakes, 'correction', code());
      ui.lastCorrection = { text, lang: code(), ...r, newWords: logged.words.map(wordTitle), mistakeIds: logged.mistakes.map((m) => m.id) };
      ui.correctOpen = false;
      if (routeName() === 'correct') { viewCorrect(); window.scrollTo(0, 0); }
    } catch (err) {
      res.innerHTML = errorBox(err);
    }
  });
  bindCopy();
  bindRecheck();
}

// "Check again": Gemini corrects the same text once more. Its result replaces the first one,
// and the mistakes the first check saved are swapped for the new ones.
function bindRecheck() {
  $('#recheck')?.addEventListener('click', async () => {
    const c = ui.lastCorrection;
    const btn = $('#recheck');
    btn.disabled = true;
    btn.textContent = t('correct.loading');
    try {
      const first = { correct: !c.mistakes.length, feedback: c.mistakes.map((m) => `${m.original} → ${m.corrected}`).join('; ') };
      const r = await gemini.correctText(c.text, { recheck: first });
      if (ui.lastCorrection !== c) return;
      store.removeMistakes(c.mistakeIds || []);
      const logged = logMistakes(r.mistakes, 'correction', c.lang);
      const newWords = [...new Set([...(c.newWords || []), ...logged.words.map(wordTitle)])];
      ui.lastCorrection = { text: c.text, lang: c.lang, ...r, newWords, mistakeIds: logged.mistakes.map((m) => m.id), rechecked: true };
      if (routeName() === 'correct') viewCorrect();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = t('correct.recheck');
      toast(err.message || String(err));
    }
  });
}

function correctionResult(c) {
  return `<section class="card">
    <div class="card-head"><h3>${esc(t('correct.result'))}</h3>
      <button class="btn small text" id="copy">${icon('copy', 16)} ${esc(t('correct.copy'))}</button></div>
    <div class="sentence corrected" ${tl(c.lang)}>${diffHtml(c.text, c.correctedText)}</div>
    ${c.mistakes.length ? `<h3>${esc(t('correct.mistakes', { n: c.mistakes.length }))}</h3>${mistakeList(c.mistakes, c.lang)}
      <p class="muted small">${esc(t('correct.logged'))}</p>` : `<p>${esc(t('correct.noMistakes'))}</p>`}
    ${c.newWords?.length ? `<p class="muted small">${esc(t('correct.wordsAdded', { w: c.newWords.join(', ') }))}</p>` : ''}
    ${naturalBlock(c.natural, c.naturalReason, c.lang)}
    ${c.rechecked ? `<p class="muted small">${esc(t('correct.rechecked'))}</p>`
      : gem() && c.lang === code() ? `<button class="btn small" id="recheck">${esc(t('correct.recheck'))}</button>` : ''}
  </section>`;
}

function bindCopy() {
  bindNatural($('#cres'));
  $('#copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ui.lastCorrection.correctedText); toast(t('correct.copied')); } catch { /* ignore */ }
  });
}
