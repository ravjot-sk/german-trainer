// The mistake categories as a list with bars and trends, and the rules under each. Shown on
// Profil, and the top of it on Heute.
import * as store from '../store.js';
import { t, lang } from '../i18n.js';
import { categoryLabel } from '../categories.js';
import { status as ruleStatus } from '../rules.js';
import { categoryStats, byRecent, writingMistakes } from '../stats.js';
import { html } from './dom.js';
import { code, cats } from './context.js';
import { tl, fmtPast } from './text.js';

export const sortedStats = () => categoryStats({ mistakes: store.mistakes(code()), reviews: store.reviews(code()), cats: cats(), lang: code() }).sort(byRecent);

// withRules: list each category's rules under it (the full profile; Today shows only the top).
export function catList(stats, { withRules = false } = {}) {
  const max = Math.max(...stats.map((s) => s.recent), 1);
  const trendLabel = { improving: `↘ ${t('profile.improving')}`, worse: `↗ ${t('profile.worse')}`, steady: `→ ${t('profile.steady')}` };
  return html`<ul class="cats">${stats.map((s) => html`
    <li>
      <div class="cat-head"><b>${categoryLabel(s.id, lang(), cats())}</b><span class="trend ${s.trend}">${trendLabel[s.trend]}</span></div>
      <div class="bar"><div style="width:${Math.round((s.recent / max) * 100)}%"></div></div>
      <div class="muted small">${s.recent} · ${t('profile.last14')} &nbsp;|&nbsp; ${s.total} ${t('profile.total')}
        ${s.drills ? html` &nbsp;|&nbsp; ${t('profile.drills')}: ${t('profile.accuracy', { p: Math.round(s.acc * 100) })}` : ''}</div>
      ${withRules ? ruleList(s.id) : ''}
    </li>`)}</ul>`;
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
  return html`<ul class="rules">${rules.map(({ item, ms, st, last }) => html`
    <li><details>
      <summary><span class="rule-title">${item.rule.name}</span><span class="status ${st}">${t(`rule.${st}`)}</span></summary>
      <div class="muted small">${t('rule.meta', { n: ms.length, d: last ? fmtPast(last) : '–' })}${item.rule.level ? html` · ${item.rule.level}` : ''}</div>
      ${item.rule.statement ? html`<p class="small">${item.rule.statement}</p>` : ''}
      ${ms.slice(0, 3).map((m) => html`<div class="fix small" ${tl()}><del>${m.original}</del> → <ins>${m.corrected}</ins></div>`)}
    </details></li>`)}</ul>`;
}
