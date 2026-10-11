// Small DOM helpers shared by every screen.
import { t } from '../i18n.js';

export const main = document.getElementById('main');
export const titleEl = document.getElementById('title');

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), ms);
}

export function errorBox(e) {
  return `<div class="notice error">${esc(e.message || e)}</div>`;
}

// While Gemini works: the waiting text in el with an "Abbrechen" button. Returns the signal the
// button aborts, to pass to the Gemini call. cls is added to the box (e.g. 'card').
export function waitBox(el, text, cls = '', ctl = new AbortController()) {
  el.innerHTML = `<div class="waiting ${cls}"><span class="loading">${esc(text)}</span>
    <button type="button" class="btn small text" data-cancel>${esc(t('common.cancel'))}</button></div>`;
  el.querySelector('[data-cancel]').addEventListener('click', () => ctl.abort());
  return ctl.signal;
}

// A failed call: the message and "Nochmal versuchen", which runs retry.
export function retryBox(el, e, retry) {
  el.innerHTML = `${errorBox(e)}<button type="button" class="btn small" data-retry>${esc(t('common.retry'))}</button>`;
  el.querySelector('[data-retry]').addEventListener('click', retry);
}

export const inputAttrs = 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"';

// Small per-device UI preferences (last lookup mode and tone). Storage can be unavailable.
export function pref(key, fallback) {
  try { return localStorage.getItem(`gt.ui.${key}`) || fallback; } catch { return fallback; }
}
export function setPref(key, value) {
  try { localStorage.setItem(`gt.ui.${key}`, value); } catch { /* not kept */ }
}

