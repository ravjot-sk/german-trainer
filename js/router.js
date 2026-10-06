// Hash routing (#/today, #/settings/backup …). Screens register themselves from app.js, so
// this module imports none of them and any screen can import go() and route().
import { t, lang } from './i18n.js';
import { icon } from './icons.js';
import { main, esc, $, $$ } from './ui/dom.js';
import { L, code, langName } from './ui/context.js';
import { furiMode } from './ui/text.js';

let routes = {};
// Pages opened from another page get a back button to it; the tab bar marks their parent.
const parents = { profile: 'today', 'settings/advanced': 'settings', 'settings/backup': 'settings' };

export function registerRoutes(table) { routes = table; }

export const routeName = () => (location.hash.replace(/^#\/?/, '') || 'today').split('?')[0];

export function route() {
  const name = routeName();
  // Until a language and level are chosen, every page except Settings shows that choice.
  const view = !L()?.level && !name.startsWith('settings') ? routes.today : routes[name] || routes.today;
  const parent = parents[name];
  $$('#tabs a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === (parent || name));
    $('span', a).textContent = t(`tab.${a.dataset.route}`);
  });
  const back = $('#back');
  back.classList.toggle('hidden', !parent);
  back.setAttribute('aria-label', t('nav.back'));
  back.dataset.to = parent || '';
  $('#gear').classList.toggle('hidden', name.startsWith('settings'));
  $('#gear').setAttribute('aria-label', t('settings.title'));
  updatePill(name);
  document.documentElement.lang = lang();
  document.body.classList.toggle('in-session', name === 'session');
  document.body.classList.toggle('furi-tap', furiMode() === 'tap');
  main.scrollTop = 0;
  window.scrollTo(0, 0);
  view();
}

export function go(name) {
  if (location.hash === `#/${name}`) route(); else location.hash = `#/${name}`;
}

// ---------- Language pill ----------
const PILL_ROUTES = ['today', 'lookup', 'correct', 'words', 'profile'];

function updatePill(name) {
  const pill = $('#langpill');
  const cur = L();
  const show = !!cur?.level && PILL_ROUTES.includes(name);
  pill.classList.toggle('hidden', !show);
  if (show) {
    pill.innerHTML = `<span class="ellipsis">${esc(code().toUpperCase())} · ${esc(cur.level)}</span>${icon('down', 14)}`;
    pill.title = `${langName()} · ${cur.level}`;
    pill.setAttribute('aria-label', t('settings.langSheet'));
  }
}
