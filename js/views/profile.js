// The mistake profile: categories by recent mistakes, and the rules under each.
import * as store from '../store.js';
import { t, lang } from '../i18n.js';
import { isCurated } from '../categories.js';
import { status as ruleStatus } from '../rules.js';
import { main, titleEl, esc } from '../ui/dom.js';
import { L, code, langName, cats } from '../ui/context.js';
import { tl, fmtPast, mistakeList } from '../ui/text.js';
import { classifyOldMistakes } from '../background.js';
import { categoryStats, byRecent, writingMistakes } from '../stats.js';
import { routeName } from '../router.js';

export const sortedStats = () => categoryStats({ mistakes: store.mistakes(code()), reviews: store.reviews(code()), cats: cats(), lang: code() }).sort(byRecent);

// withRules: list each category's rules under it (the full profile; Today shows only the top).
export function catList(stats, { withRules = false } = {}) {
  const max = Math.max(...stats.map((s) => s.recent), 1);
  const trendLabel = { improving: `↘ ${t('profile.improving')}`, worse: `↗ ${t('profile.worse')}`, steady: `→ ${t('profile.steady')}` };
  return `<ul class="cats">${stats.map((s) => `
    <li>
      <div class="cat-head"><b>${esc(lang() === 'en' ? s.en : s.de)}</b><span class="trend ${s.trend}">${esc(trendLabel[s.trend])}</span></div>
      <div class="bar"><div style="width:${Math.round((s.recent / max) * 100)}%"></div></div>
      <div class="muted small">${s.recent} · ${esc(t('profile.last14'))} &nbsp;|&nbsp; ${s.total} ${esc(t('profile.total'))}
        ${s.drills ? ` &nbsp;|&nbsp; ${esc(t('profile.drills'))}: ${esc(t('profile.accuracy', { p: Math.round(s.acc * 100) }))}` : ''}</div>
      ${withRules ? ruleList(s.id) : ''}
    </li>`).join('')}</ul>`;
}

// The rules of one category: what still goes wrong first, mastered ones last.
function ruleList(category) {
  const writing = writingMistakes(store.mistakes(code())).filter((m) => m.category === category);
  const order = { shaky: 0, new: 1, solid: 2 };
  const rules = store.ruleItems(code()).filter((r) => r.rule.category === category).map((item) => {
    const ms = writing.filter((m) => m.rule === item.rule.key);
    return { item, ms, st: ruleStatus(item), last: ms[0]?.createdAt || 0 };
  }).sort((a, b) => order[a.st] - order[b.st] || b.last - a.last);
  if (!rules.length) return '';
  return `<ul class="rules">${rules.map(({ item, ms, st, last }) => `
    <li><details>
      <summary><span class="rule-title">${esc(item.rule.name)}</span><span class="status ${st}">${esc(t(`rule.${st}`))}</span></summary>
      <div class="muted small">${esc(t('rule.meta', { n: ms.length, d: last ? fmtPast(last) : '–' }))}${item.rule.level ? ` · ${esc(item.rule.level)}` : ''}</div>
      ${item.rule.statement ? `<p class="small">${esc(item.rule.statement)}</p>` : ''}
      ${ms.slice(0, 3).map((m) => `<div class="fix small" ${tl()}><del>${esc(m.original)}</del> → <ins>${esc(m.corrected)}</ins></div>`).join('')}
    </details></li>`).join('')}</ul>`;
}

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
