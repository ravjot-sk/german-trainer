// The mistake profile: categories by recent mistakes, and the rules under each.
import * as store from '../store.js';
import { t } from '../i18n.js';
import { isCurated } from '../categories.js';
import { html, setHtml, main, titleEl } from '../ui/dom.js';
import { L, code, langName } from '../ui/context.js';
import { mistakeList } from '../ui/text.js';
import { sortedStats, catList, bindRuleDelete } from '../ui/catlist.js';
import { classifyOldMistakes, recheckRules } from '../background.js';
import { writingMistakes } from '../stats.js';
import { routeName } from '../router.js';

// Languages without a hand-made category list say so wherever the categories show.
const generatedNote = () => (L() && !isCurated(code()) ? html`<p class="muted small gen-note">${t('profile.generatedNote', { l: langName() })}</p>` : '');

export function viewProfile() {
  titleEl.textContent = t('profile.title');
  // Older mistakes get their rules in the background; the profile redraws when they arrive.
  const redraw = () => { if (routeName() === 'profile') viewProfile(); };
  classifyOldMistakes(redraw);
  recheckRules(redraw);
  const stats = sortedStats();
  if (!stats.length) {
    setHtml(main, html`${generatedNote()}<p class="muted center">${t('profile.empty')}</p>`);
    return;
  }
  const recentMistakes = writingMistakes(store.mistakes(code())).slice(0, 10);
  setHtml(main, html`${generatedNote()}
    <section class="card">${catList(stats, { withRules: true })}</section>
    ${recentMistakes.length ? html`<div class="group-label">${t('profile.recent')}</div><section class="card">${mistakeList(recentMistakes)}</section>` : ''}`);
  bindRuleDelete(main);
}
