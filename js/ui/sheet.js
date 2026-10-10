// Bottom sheets: a panel over the page that closes on its close button or a tap outside it,
// and redraws the page underneath when it closes.
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { route } from '../router.js';
import { esc, $ } from './dom.js';

// Shows the panel's HTML over a backdrop and returns the backdrop and its close function.
// redraw: false leaves the page as it was, for sheets that change nothing on it.
export function mountSheet(panelHtml, { redraw = true } = {}) {
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = panelHtml;
  document.body.appendChild(back);
  document.body.classList.add('no-scroll');
  const close = () => { back.remove(); document.body.classList.remove('no-scroll'); if (redraw) route(); };
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  return { el: back, close };
}

// Opens a bottom sheet with a form; onSave gets the form fields. Either returning false
// keeps the sheet open.
export function openSheet(html, { onSave, onDelete }) {
  const { el, close } = mountSheet(`<form class="sheet">${html}</form>`);
  $('[data-act=cancel]', el).addEventListener('click', close);
  $('[data-act=delete]', el)?.addEventListener('click', () => { if (onDelete()) close(); });
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
