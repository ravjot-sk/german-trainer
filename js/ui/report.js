// "Report a problem": the bug icon in the header opens a sheet over the current screen. The
// screen (and, during practice, the exercise) is captured before the sheet opens, so the
// report shows what the learner saw. Closing the sheet leaves the screen as it was, so an
// answer on show is not lost. Reports become GitHub issues (see js/report.js).
import * as sync from '../sync.js';
import { t, lang } from '../i18n.js';
import { html, setHtml, main, titleEl, $, toast, errorBox } from './dom.js';
import { mountSheet, sheetHead } from './sheet.js';
import { L, ui } from './context.js';
import { routeName, go } from '../router.js';
import { screenText, exerciseData, buildReport, capturable, TEXT_MAX } from '../report.js';

const SEND_TIMEOUT = 15000;

// Settings screens are never captured: they show the account and the Gemini key.
function capture() {
  const screen = routeName();
  if (!capturable(screen)) return { screen, screenTextValue: '', exercise: '' };
  const task = screen === 'session' && ui.session ? ui.session.tasks[ui.session.idx] : null;
  const text = screenText(main);
  return { screen, screenTextValue: `${titleEl.textContent}\n${text}`, exercise: exerciseData(task) };
}

export function openReport() {
  if (!sync.canReport()) return signInFirst();
  const cap = capture();
  const canCapture = capturable(cap.screen);
  const preview = cap.screenTextValue + (cap.exercise ? `\n\n${t('report.exercise')}:\n${cap.exercise}` : '');
  const { el, close } = mountSheet(html`<form class="sheet report">
    ${sheetHead(t('report.title'))}
    <label>${t('report.what')}
      <textarea name="text" rows="4" maxlength="${TEXT_MAX}" required placeholder="${t('report.placeholder')}"></textarea></label>
    ${canCapture ? html`<label class="check"><input type="checkbox" name="capture" checked> <span>${t('report.capture')}</span></label>
    <details class="more"><summary>${t('report.preview')}</summary><pre class="report-preview">${preview}</pre></details>`
    : html`<p class="muted small">${t('report.noCapture')}</p>`}
    <p class="muted small">${t('report.public')}</p>
    <div id="reportres"></div>
    <button type="submit" class="btn primary wide">${t('report.send')}</button>
  </form>`, { redraw: false });
  $('[data-act=cancel]', el).addEventListener('click', close);
  $('[name=capture]', el)?.addEventListener('change', (e) => { $('details.more', el).hidden = !e.target.checked; });
  $('form', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const text = String(form.get('text') || '').trim();
    if (!text) return;
    const btn = $('button[type=submit]', el);
    const res = $('#reportres', el);
    if (navigator.onLine === false) { setHtml(res, errorBox(t('sync.err.network'))); return; }
    btn.disabled = true;
    setHtml(res, '');
    const Lx = L();
    const report = buildReport({
      ...cap, text, capture: canCapture && form.get('capture') === 'on',
      language: Lx ? [Lx.code, Lx.level].filter(Boolean).join(' ') : '', uiLang: lang(), userAgent: navigator.userAgent,
    });
    try {
      await Promise.race([sync.sendReport(report),
        new Promise((_, no) => setTimeout(() => no(new Error(t('report.timeout'))), SEND_TIMEOUT))]);
    } catch (err) {
      btn.disabled = false;
      setHtml(res, errorBox(err));
      return;
    }
    close();
    toast(t('report.sent'));
  });
}

// Signed out (or not invited yet): say why reports can't be sent, with a way to sign in.
function signInFirst() {
  const { el, close } = mountSheet(html`<div class="sheet">
    ${sheetHead(t('report.title'))}
    <p>${t('report.signIn')}</p>
    <button type="button" class="btn primary wide" id="gosettings">${t('sync.signIn')}</button>
  </div>`, { redraw: false });
  $('[data-act=cancel]', el).addEventListener('click', close);
  $('#gosettings', el).addEventListener('click', () => { close(); go('settings'); });
}
