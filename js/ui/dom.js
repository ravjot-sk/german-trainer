// Small DOM helpers shared by every screen.
import { t } from '../i18n.js';
import { html, raw, esc, toMarkup } from '../html.js';

export { html, raw, esc };

export const main = document.getElementById('main');
export const titleEl = document.getElementById('title');

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), ms);
}

// Puts HTML built with html`…` into el (or in place of el). Anything else is shown as text.
export function setHtml(el, h) { el.innerHTML = toMarkup(h); }
export function replaceHtml(el, h) { el.outerHTML = toMarkup(h); }

export function errorBox(e) {
  return html`<div class="notice error">${e.message || e}</div>`;
}

// Segmented buttons: marks b as the chosen one of its group, for sight and screen readers.
export const pressedAttrs = (on) => html`class="${on ? 'on' : ''}" aria-pressed="${on}"`;
export function choose(group, b) {
  group.forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
}

// While Gemini works: the waiting text in el with an "Abbrechen" button. Returns the signal the
// button aborts, to pass to the Gemini call. cls is added to the box (e.g. 'card').
export function waitBox(el, text, cls = '', ctl = new AbortController()) {
  setHtml(el, html`<div class="waiting ${cls}"><span class="loading">${text}</span>
    <button type="button" class="btn small text" data-cancel>${t('common.cancel')}</button></div>`);
  el.querySelector('[data-cancel]').addEventListener('click', () => ctl.abort());
  return ctl.signal;
}

// A failed call: the message and "Nochmal versuchen", which runs retry.
export function retryBox(el, e, retry) {
  setHtml(el, html`${errorBox(e)}<button type="button" class="btn small" data-retry>${t('common.retry')}</button>`);
  el.querySelector('[data-retry]').addEventListener('click', retry);
}

export const inputAttrs = raw('autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"');

// Small per-device UI preferences (last lookup mode and tone). Storage can be unavailable.
export function pref(key, fallback) {
  try { return localStorage.getItem(`gt.ui.${key}`) || fallback; } catch { return fallback; }
}
export function setPref(key, value) {
  try { localStorage.setItem(`gt.ui.${key}`, value); } catch { /* not kept */ }
}

