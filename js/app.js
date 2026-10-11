// Starts the app: registers the screens with the router and the page-wide listeners.
import * as store from './store.js';
import * as sync from './sync.js';
import * as localdb from './localdb.js';
import { t } from './i18n.js';
import { $, esc } from './ui/dom.js';
import { ui } from './ui/context.js';
import { registerRoutes, route, routeName, go } from './router.js';
import { openLangSheet } from './views/learncard.js';
import { viewToday } from './views/today.js';
import { viewSession } from './practice/render.js';
import { viewLookup } from './views/lookup.js';
import { viewWords } from './views/words.js';
import { viewCorrect } from './views/correct.js';
import { viewProfile } from './views/profile.js';
import { viewSettings, viewAdvanced, viewBackup } from './views/settings.js';
import { showSyncState } from './views/account.js';
import { openReport } from './views/report.js';

registerRoutes({ today: viewToday, session: viewSession, lookup: viewLookup, correct: viewCorrect,
  words: viewWords, profile: viewProfile, settings: viewSettings,
  'settings/advanced': viewAdvanced, 'settings/backup': viewBackup });
window.addEventListener('hashchange', route);
// Furigana on tap: tapping Japanese text shows its readings, tapping again hides them.
// Word-order pieces are buttons, so they always show theirs.
document.addEventListener('click', (e) => {
  const f = e.target.closest('.furi');
  if (f && document.body.classList.contains('furi-tap') && !e.target.closest('button')) f.classList.toggle('open');
});
window.addEventListener('online', () => { if (!ui.session) route(); });
window.addEventListener('offline', () => { if (!ui.session) route(); });
$('#gear').addEventListener('click', () => go('settings'));
$('#report').addEventListener('click', openReport);
$('#back').addEventListener('click', () => go($('#back').dataset.to || 'today'));
$('#langpill').addEventListener('click', openLangSheet);
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then(watchUpdates).catch(() => {});
}

// The app runs from the cached version (sw.js). A newer one, once downloaded, is offered in a
// bar; one that was already waiting when the app starts is switched to straight away.
// Pending saves are written first, since switching reloads the page.
function watchUpdates(reg) {
  let switching = false;
  const apply = async () => {
    if (switching || !reg.waiting) return;
    switching = true;
    await localdb.flushAll().catch(() => {});
    reg.waiting.postMessage('skipWaiting');
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (switching) location.reload(); });
  const bar = $('#updatebar');
  bar.textContent = t('app.update');
  bar.addEventListener('click', apply);
  const offer = () => { if (reg.waiting && navigator.serviceWorker.controller) bar.classList.remove('hidden'); };
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(); });
  });
  if (reg.waiting && navigator.serviceWorker.controller) apply();
  // A home-screen app coming back from the background doesn't reload, so it checks then.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });
}
// Changes merged in from another device: refresh the overview pages (not forms or sessions).
store.onChange(({ remote } = {}) => {
  if (remote && ['today', 'profile'].includes(routeName())) route({ keepScroll: true });
});
sync.onState(showSyncState);
// Saving: pending writes go out when the app is sent to the background, and a failed save
// shows a banner until a save works again.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') localdb.flushAll(); });
window.addEventListener('pagehide', () => localdb.flushAll());
function showSaveProblem(e) {
  const el = $('#savewarn');
  el.classList.toggle('hidden', !e);
  if (e) el.innerHTML = `${esc(t('save.failed'))} <a href="#/settings/backup">${esc(t('save.backup'))}</a>`;
}
localdb.onProblem(showSaveProblem);
store.ready().catch((e) => console.warn('loading data failed', e)).then(() => {
  route();
  sync.init();
});
