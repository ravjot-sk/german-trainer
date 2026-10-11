// Bottom sheets: a dialog over the page that closes on its close button, Escape or a tap
// outside it, and redraws the page underneath when it closes.
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { route } from '../router.js';
import { esc, $, $$ } from './dom.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
let sheetCount = 0;

// Shows the panel's HTML over a backdrop and returns the backdrop and its close function.
// redraw: false leaves the page as it was, for sheets that change nothing on it.
// onClose runs however it closes. While it is open, everything behind it is inert and Tab
// stays inside it; closing hands focus back to what opened it, or redraws in place.
export function mountSheet(panelHtml, { redraw = true, onClose } = {}) {
  const opener = document.activeElement;
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = panelHtml;
  const panel = back.firstElementChild;
  const title = $('h2', panel);
  if (title) title.id ||= `sheet-title-${++sheetCount}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  if (title) panel.setAttribute('aria-labelledby', title.id);
  panel.tabIndex = -1;
  const behind = [...document.body.children].filter((el) => !el.inert && el.id !== 'toast' && el.tagName !== 'SCRIPT');
  behind.forEach((el) => (el.inert = true));
  document.body.appendChild(back);
  document.body.classList.add('no-scroll');
  // The panel itself takes focus, so the keyboard doesn't pop up for its first field.
  panel.focus({ preventScroll: true });
  const close = () => {
    back.remove();
    behind.forEach((el) => (el.inert = false));
    if (!document.querySelector('.sheet-backdrop')) document.body.classList.remove('no-scroll');
    onClose?.();
    if (redraw) route({ keepScroll: true });
    else if (opener?.isConnected) opener.focus({ preventScroll: true });
  };
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = $$(FOCUSABLE, panel).filter((el) => el.offsetParent !== null);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  return { el: back, close };
}

// Asks before a step that can't be undone, in the app's own sheet instead of the browser's
// box. Resolves true when the learner confirms. ok: the confirm button's label.
export function confirmSheet(text, { ok, danger = true } = {}) {
  return new Promise((resolve) => {
    let answer = false;
    const { el, close } = mountSheet(`<div class="sheet confirm">
      <h2>${esc(text)}</h2>
      <div class="actions">
        <button type="button" class="btn" data-act="cancel">${esc(t('edit.cancel'))}</button>
        <button type="button" class="btn ${danger ? 'danger-solid' : 'primary'}" data-act="ok">${esc(ok)}</button>
      </div>
    </div>`, { redraw: false, onClose: () => resolve(answer) });
    $('[data-act=cancel]', el).addEventListener('click', close);
    $('[data-act=ok]', el).addEventListener('click', () => { answer = true; close(); });
  });
}

// Opens a bottom sheet with a form; onSave gets the form fields. Either returning false
// keeps the sheet open (onDelete may answer later, after asking).
export function openSheet(html, { onSave, onDelete }) {
  const { el, close } = mountSheet(`<form class="sheet">${html}</form>`);
  $('[data-act=cancel]', el).addEventListener('click', close);
  $('[data-act=delete]', el)?.addEventListener('click', async () => { if (await onDelete()) close(); });
  $('form', el).addEventListener('submit', (e) => {
    e.preventDefault();
    if (onSave(Object.fromEntries(new FormData(e.target).entries())) !== false) close();
  });
  return el;
}

// Sheet title with a close button (it cancels), and the fields most edits don't need.
export function sheetHead(title) {
  return `<div class="sheet-head"><h2>${esc(title)}</h2>
    <button type="button" class="icon-btn" data-act="cancel" aria-label="${esc(t('edit.cancel'))}">${icon('close', 22)}</button></div>`;
}
export const moreFields = (html) => `<details class="more"><summary>${esc(t('edit.more'))} ${icon('down', 16)}</summary><div>${html}</div></details>`;
