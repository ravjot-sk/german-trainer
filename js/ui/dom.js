// Small DOM helpers shared by every screen.

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

// Segmented buttons: marks b as the chosen one of its group, for sight and screen readers.
export const pressedAttrs = (on) => `class="${on ? 'on' : ''}" aria-pressed="${on}"`;
export function choose(group, b) {
  group.forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
}

export const inputAttrs = 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"';

// Small per-device UI preferences (last lookup mode and tone). Storage can be unavailable.
export function pref(key, fallback) {
  try { return localStorage.getItem(`gt.ui.${key}`) || fallback; } catch { return fallback; }
}
export function setPref(key, value) {
  try { localStorage.setItem(`gt.ui.${key}`, value); } catch { /* not kept */ }
}

