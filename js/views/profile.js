// The mistake profile: categories by recent mistakes, and the rules under each.
import * as store from '../store.js';
import { t } from '../i18n.js';
import { isCurated } from '../categories.js';
import { main, titleEl, esc } from '../ui/dom.js';
import { L, code, langName } from '../ui/context.js';
import { mistakeList } from '../ui/text.js';
import { sortedStats, catList } from '../ui/catlist.js';
import { classifyOldMistakes } from '../background.js';
import { writingMistakes } from '../stats.js';
import { routeName } from '../router.js';

// Languages without a hand-made category list say so wherever the categories show.
const generatedNote = () => (L() && !isCurated(code()) ? `<p class="muted small gen-note">${esc(t('profile.generatedNote', { l: langName() }))}</p>` : '');

export function viewProfile() {
  titleEl.textContent = t('profile.title');
  // Older mistakes get their rules in the background; the profile redraws when they arrive.
  classifyOldMistakes(() => { if (routeName() === 'profile') viewProfile(); });
  const stats = sortedStats();
  if (!stats.length) {
    main.innerHTML = `${generatedNote()}<p class="muted center">${esc(t('profile.empty'))}</p>`;
    return;
  }
  const recentMistakes = writingMistakes(store.mistakes(code())).slice(0, 10);
  main.innerHTML = `${generatedNote()}
    <section class="card">${catList(stats, { withRules: true })}</section>
    ${recentMistakes.length ? `<div class="group-label">${esc(t('profile.recent'))}</div><section class="card">${mistakeList(recentMistakes)}</section>` : ''}`;
}
