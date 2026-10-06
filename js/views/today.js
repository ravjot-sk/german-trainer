// Today: what is due, free practice and the top weak spots.
import * as store from '../store.js';
import { t } from '../i18n.js';
import { summarizeDue, practicePool, PRACTICE_FOCUS } from '../session.js';
import { dayStart } from '../srs.js';
import { icon } from '../icons.js';
import { main, titleEl, esc, $, $$, pref, setPref } from '../ui/dom.js';
import { gem, L, code, langName, sessionArgs, ui } from '../ui/context.js';
import { route, go } from '../router.js';
import { learnCard, bindLearnCard } from './learncard.js';
import { startPractice } from '../practice/runtime.js';
import { bindSuggest } from './suggest.js';
import { sortedStats, catList } from './profile.js';

export function viewToday() {
  titleEl.textContent = t('today.title');
  const notes = [];
  if (!store.getApiKey()) notes.push(`<div class="notice">${esc(t('today.noKey'))} <a href="#/settings">${esc(t('settings.title'))}</a></div>`);
  else if (navigator.onLine === false) notes.push(`<div class="notice">${esc(t('today.offline'))}</div>`);

  // First the language, then the level: nothing is assumed for either.
  const cur = L();
  if (!cur || !cur.level) {
    main.innerHTML = `
      <section class="card form">
        <h2>${esc(cur ? t('today.levelTitle', { l: langName() }) : t('today.chooseTitle'))}</h2>
        ${cur ? `<p class="muted small">${esc(t('today.levelHelp'))}</p>` : ''}
        ${learnCard()}
      </section>
      ${notes.join('')}`;
    bindLearnCard(route);
    return;
  }

  const s = summarizeDue(sessionArgs());
  const today = dayStart(Date.now());
  const reviewedToday = store.reviews(code()).filter((r) => r.reviewedAt >= today);
  const doneToday = reviewedToday.filter((r) => r.mode !== 'practice').length;
  const practisedToday = reviewedToday.length - doneToday;
  const stat = (n, label) => `<span class="stat"><b>${n}</b> ${esc(label)}</span>`;

  main.innerHTML = `
    <section class="card hero">
      <div class="hero-label">${esc(t('today.due'))}</div>
      <div class="hero-num">${s.total}</div>
      <div class="chips">
        <span class="stat"><b>${s.words}</b> ${esc(t('today.words'))}${s.newWords ? ` · ${esc(t('today.newShort', { n: s.newWords }))}` : ''}</span>
        ${s.sentences ? stat(s.sentences, t('today.sentences')) : ''}
        ${stat(s.grammar, t('today.drills'))}
      </div>
      ${s.total ? `<button class="btn primary big" id="start">${esc(t('today.start'))}</button>`
        : `<p class="muted">${esc(t('today.nothing'))}</p>
          <div class="empty-actions">
            <a class="btn" href="#/lookup">${icon('search', 18)} ${esc(t('today.goLookup'))}</a>
            <a class="btn" href="#/correct">${icon('edit', 18)} ${esc(t('today.goCorrect'))}</a>
          </div>`}
      ${doneToday ? `<p class="muted small">${esc(t('today.doneToday', { n: doneToday }))}</p>` : ''}
    </section>
    ${practiceCard(practisedToday)}
    ${notes.join('')}
    ${weakSpots()}
  `;
  $('#start')?.addEventListener('click', () => { ui.session = null; go('session'); });
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
  return `<section class="card practice">
    <div class="card-head"><h3>${esc(t('practice.title'))}</h3></div>
    <p class="muted small">${esc(t('practice.help'))}</p>
    ${focuses.length > 1 ? `<div class="seg wrap" id="pfocus">${focuses.map((f) =>
      `<button type="button" data-v="${f}" class="${f === cur ? 'on' : ''}">${esc(t(`practice.focus.${f}`))}</button>`).join('')}</div>` : ''}
    <button class="btn primary" id="practice">${esc(t('practice.start'))}</button>
    ${few && gem() ? `<button class="btn" data-suggest>${icon('sparkle', 18)} ${esc(t('suggest.open'))}</button>` : ''}
    ${practised ? `<p class="muted small">${esc(t('practice.doneToday', { n: practised }))}</p>` : ''}
  </section>`;
}

function bindPracticeCard() {
  $$('#pfocus button').forEach((b) => b.addEventListener('click', () => {
    setPref('practiceFocus', b.dataset.v);
    $$('#pfocus button').forEach((x) => x.classList.toggle('on', x === b));
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
  const head = `<div class="group-label">${esc(t('today.weak'))}</div>`;
  if (!stats.length) return `${head}<section class="card"><p class="muted small">${esc(t('today.weakEmpty'))}</p></section>`;
  return `${head}<section class="card">${catList(stats)}
    <a class="more-link" href="#/profile">${esc(t('today.fullProfile'))}${icon('chevron', 16)}</a></section>`;
}
