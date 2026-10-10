// Starts the app: registers the screens with the router and the page-wide listeners.
import * as store from './store.js';
import * as sync from './sync.js';
import { $ } from './ui/dom.js';
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
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Changes merged in from another device: refresh the overview pages (not forms or sessions).
store.onChange(({ remote } = {}) => {
  if (remote && ['today', 'profile'].includes(routeName())) route();
});
sync.onState(showSyncState);
route();
sync.init();
