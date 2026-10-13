// Today: what is due, free practice and the top weak spots.
import * as store from '../store.js';
import { t } from '../i18n.js';
import { summarizeDue, practicePool, PRACTICE_FOCUS } from '../session.js';
import { dayStart } from '../srs.js';
import { icon } from '../icons.js';
import { html, setHtml, main, titleEl, $, $$, pref, setPref, pressedAttrs, choose } from '../ui/dom.js';
import { gem, L, code, langName, sessionArgs } from '../ui/context.js';
import { route, go } from '../router.js';
import { learnCard, bindLearnCard } from './learncard.js';
import { startPractice, startSession } from '../practice/runtime.js';
import { bindSuggest } from '../ui/suggest.js';
import { sortedStats, catList } from '../ui/catlist.js';

export function viewToday() {
  titleEl.textContent = t('today.title');
  const notes = [];
  if (!store.getApiKey()) notes.push(html`<div class="notice">${t('today.noKey')} <a href="#/settings">${t('settings.title')}</a></div>`);
  else if (navigator.onLine === false) notes.push(html`<div class="notice">${t('today.offline')}</div>`);

  // First the language, then the level: nothing is assumed for either.
  const cur = L();
  if (!cur || !cur.level) {
    setHtml(main, html`
      <section class="card form">
        <h2>${cur ? t('today.levelTitle', { l: langName() }) : t('today.chooseTitle')}</h2>
        ${cur ? html`<p class="muted small">${t('today.levelHelp')}</p>` : ''}
        ${learnCard()}
      </section>
      ${notes}`);
    bindLearnCard(route);
    return;
  }

  const s = summarizeDue(sessionArgs());
  const today = dayStart(Date.now());
  const reviewedToday = store.reviews(code()).filter((r) => r.reviewedAt >= today);
  const doneToday = reviewedToday.filter((r) => r.mode !== 'practice').length;
  const practisedToday = reviewedToday.length - doneToday;
  const stat = (n, label) => html`<span class="stat"><b>${n}</b> ${label}</span>`;

  setHtml(main, html`
    <section class="card hero">
      <div class="hero-label">${t('today.due')}</div>
      <div class="hero-num">${s.total}</div>
      <div class="chips">
        <span class="stat"><b>${s.words}</b> ${t(s.words === 1 ? 'today.word' : 'today.words')}${s.newWords ? ` · ${t('today.newShort', { n: s.newWords })}` : ''}</span>
        ${s.sentences ? stat(s.sentences, t(s.sentences === 1 ? 'today.sentence' : 'today.sentences')) : ''}
        ${stat(s.grammar, t('today.drills'))}
      </div>
      ${s.total ? html`<button class="btn primary big" id="start">${t('today.start')}</button>`
        : html`<p class="muted">${t('today.nothing')}</p>
          <div class="empty-actions">
            <a class="btn" href="#/lookup">${icon('search', 18)} ${t('today.goLookup')}</a>
            <a class="btn" href="#/correct">${icon('edit', 18)} ${t('today.goCorrect')}</a>
          </div>`}
      ${doneToday ? html`<p class="muted small">${t('today.doneToday', { n: doneToday })}</p>` : ''}
    </section>
    ${practiceCard(practisedToday)}
    ${notes}
    ${weakSpots()}
  `);
  $('#start')?.addEventListener('click', () => { startSession(); go('session'); });
  bindPracticeCard();
}

// Practice any time, as long as you like, with a focus to choose.
function practiceFocuses() {
  const args = sessionArgs();
  return PRACTICE_FOCUS.filter((f) => f === 'mix' || practicePool({ ...args, focus: f }).length);
}

function practiceCard(practised) {
  const focuses = practiceFocuses();
  const cur = focuses.includes(pref('practiceFocus', 'mix')) ? pref('practiceFocus', 'mix') : 'mix';
  const few = store.words(code()).length < 10;
  return html`<section class="card practice">
    <div class="card-head"><h3>${t('practice.title')}</h3></div>
    <p class="muted small">${t('practice.help')}</p>
    ${focuses.length > 1 ? html`<div class="seg wrap" id="pfocus">${focuses.map((f) =>
      html`<button type="button" data-v="${f}" ${pressedAttrs(f === cur)}>${t(`practice.focus.${f}`)}</button>`)}</div>` : ''}
    <button class="btn primary" id="practice">${t('practice.start')}</button>
    ${few && gem() ? html`<button class="btn" data-suggest>${icon('sparkle', 18)} ${t('suggest.open')}</button>` : ''}
    ${practised ? html`<p class="muted small">${t('practice.doneToday', { n: practised })}</p>` : ''}
  </section>`;
}

function bindPracticeCard() {
  $$('#pfocus button').forEach((b) => b.addEventListener('click', () => {
    setPref('practiceFocus', b.dataset.v);
    choose($$('#pfocus button'), b);
  }));
  $('#practice')?.addEventListener('click', () => {
    startPractice($('#pfocus .on')?.dataset.v || 'mix');
    go('session');
  });
  bindSuggest(main);
}

// The top of the mistake profile, with the full profile one tap away.
function weakSpots() {
  const stats = sortedStats().slice(0, 3);
  const head = html`<div class="group-label">${t('today.weak')}</div>`;
  if (!stats.length) return html`${head}<section class="card"><p class="muted small">${t('today.weakEmpty')}</p></section>`;
  return html`${head}<section class="card">${catList(stats)}
    <a class="more-link" href="#/profile">${t('today.fullProfile')}${icon('chevron', 16)}</a></section>`;
}
