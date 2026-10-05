import * as store from './store.js';
import { t, lang } from './i18n.js';
import * as gemini from './gemini.js';
import * as sync from './sync.js';
import { logMistakes } from './actions.js';
import { buildSession, summarizeDue, practicePool, nextPracticeTask, PRACTICE_FOCUS } from './session.js';
import { schedule, schedulePractice, isNew, dayStart } from './srs.js';
import { compare, compareAny, checkRecall, needsPlural, gapFor, wordDiff, chunksFor, joinChunks, shuffled } from './check.js';
import { categoriesFor, categoryLabel, drillableIds } from './categories.js';
import { catKey, parseCatKey, recLang, lemmaOf, displayName, isSentence, examplesToText, examplesFromText } from './languages.js';
import { icon } from './icons.js';
import { segmentsFor, cutChunks, toHtml, missing, strip } from './furigana.js';

const main = document.getElementById('main');
const titleEl = document.getElementById('title');

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), ms);
}

function fmtDate(ts) {
  const days = Math.round((dayStart(ts) - dayStart(Date.now())) / 864e5);
  if (days <= 0) return lang() === 'en' ? 'today' : 'heute';
  if (days === 1) return lang() === 'en' ? 'tomorrow' : 'morgen';
  return new Date(ts).toLocaleDateString(lang() === 'en' ? 'en-GB' : 'de-DE', { day: 'numeric', month: 'short' });
}

const wordTitle = (w) => (w.article ? `${w.article} ${lemmaOf(w)}` : lemmaOf(w));
const gem = () => gemini.canUseGemini();

// The language being learnt (null until one is chosen) and its name in the interface language.
const L = () => store.activeLanguage();
const code = () => L()?.code || 'de';
const langName = (x = L()) => displayName(x, lang());
const cats = (x = L()) => categoriesFor(x);
// Marks text in the language being learnt, so iOS picks the right glyphs (Japanese kanji,
// not Chinese) and right-to-left text runs the right way.
const tl = (c = code()) => `lang="${esc(c)}" dir="auto"`;
// Furigana over Japanese kanji: 'tap' (shown when the text is tapped), 'always' or 'off'.
const furiMode = () => store.getSettings().furigana || 'tap';
// Text in the language being learnt, with furigana when the record has it for exactly this text.
function jt(text, rec, c = code()) {
  const segs = c === 'ja' && furiMode() !== 'off' ? segmentsFor(text, rec) : null;
  return segs ? `<span class="furi">${toHtml(segs)}</span>` : esc(text);
}
// The separate reading line is only needed when the word itself shows no furigana.
const furiShown = (w) => recLang(w) === 'ja' && furiMode() !== 'off' && !!segmentsFor(lemmaOf(w), w);
const readingLine = (w) => (w.reading && !furiShown(w) ? `<div class="reading" ${tl(recLang(w))}>${esc(w.reading)}</div>` : '');
const inputAttrs = 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"';

// Small per-device UI preferences (last lookup mode and tone). Storage can be unavailable.
function pref(key, fallback) {
  try { return localStorage.getItem(`gt.ui.${key}`) || fallback; } catch { return fallback; }
}
function setPref(key, value) {
  try { localStorage.setItem(`gt.ui.${key}`, value); } catch { /* not kept */ }
}

const toneLabel = (tone) => t(`tone.${tone || 'everyday'}`);

function errorBox(e) {
  return `<div class="notice error">${esc(e.message || e)}</div>`;
}

// Japanese texts saved without furigana get it from Gemini once, in one call for a batch of
// records; redraw runs when anything was added.
const furiAsked = new Set();
async function fillFurigana(recs, redraw) {
  if (furiMode() === 'off' || !gem()) return;
  const todo = recs.filter((r) => r && !furiAsked.has(r.id) && missing(r).length);
  if (!todo.length) return;
  todo.forEach((r) => furiAsked.add(r.id));
  try {
    const marked = await gemini.annotate([...new Set(todo.flatMap(missing))].slice(0, 40));
    let added = false;
    for (const r of todo) {
      const need = missing(r);
      const add = marked.filter((m) => need.includes(strip(m)));
      if (!add.length) continue;
      // Markup for texts that were edited since is dropped.
      const texts = [lemmaOf(r), r.example, ...(r.moreExamples || []).map((e) => e.text), r.contextSentence, r.gapSentence];
      store.updateWord(r.id, { furigana: [...(r.furigana || []).filter((m) => texts.includes(strip(m))), ...add] });
      added = true;
    }
    if (added && redraw) redraw();
  } catch (e) {
    console.warn('furigana', e);
  }
}

function diffHtml(a, b) {
  return wordDiff(a, b).map((p) =>
    p.type === 'same' ? esc(p.text) : p.type === 'del' ? `<del>${esc(p.text)}</del>` : `<ins>${esc(p.text)}</ins>`
  ).join('');
}

function mistakeList(list, c = code()) {
  return `<ul class="mistakes">${list.map((m) => `
    <li>
      <span class="chip">${esc(categoryLabel(m.category, lang(), cats(store.language(m.lang || c))))}</span>
      <div class="fix" ${tl(m.lang || c)}><del>${esc(m.original)}</del> → <ins>${esc(m.corrected)}</ins></div>
      <div class="muted">${esc(m.explanation)}</div>
    </li>`).join('')}</ul>`;
}

// "More natural" suggestion under a correction, with a button that saves it as a sentence.
function naturalBlock(text, reason, c = code()) {
  if (!text) return '';
  const saved = store.findWord(text, c);
  return `<div class="natural">
    <div class="natural-title">${icon('bulb', 18)} ${esc(t('natural.title'))}</div>
    <div class="natural-text" ${tl(c)}>${esc(text)}</div>
    ${reason ? `<div class="muted small">${esc(reason)}</div>` : ''}
    ${saved ? `<div class="saved-note">${icon('check', 16)} ${esc(t('natural.inList'))}</div>`
      : `<button type="button" class="btn small" data-natural="${esc(text)}" data-lang="${esc(c)}">${icon('plus', 16)} ${esc(t('natural.add'))}</button>`}
  </div>`;
}

function bindNatural(root) {
  $$('[data-natural]', root).forEach((b) => b.addEventListener('click', async () => {
    const text = b.dataset.natural;
    const c = b.dataset.lang;
    b.disabled = true;
    b.textContent = t('natural.saving');
    try {
      // Gemini describes the sentence (English, tone, pieces) so it can be practised.
      const r = c === code() && gem() ? await gemini.translateSentence(text, null, { keep: true }) : { sentence: text };
      store.addSentence(r, c, 'suggestion');
      b.outerHTML = `<div class="saved-note">${icon('check', 16)} ${esc(t('natural.saved'))}</div>`;
    } catch (e) {
      b.disabled = false;
      b.innerHTML = `${icon('plus', 16)} ${esc(t('natural.add'))}`;
      toast(e.message || String(e));
    }
  }));
}

// Everything the session needs, limited to the active language.
function sessionArgs() {
  const c = code();
  const words = store.words(c);
  const mistakes = store.mistakes(c);
  const wordIds = new Set(words.map((w) => w.id));
  const mistakeIds = new Set(mistakes.map((m) => m.id));
  const items = store.reviewItems().filter((r) => (r.itemType === 'word' ? wordIds.has(r.itemId)
    : r.itemType === 'mistake' ? mistakeIds.has(r.itemId) : parseCatKey(r.itemId).lang === c));
  return {
    items, words, mistakes, reviews: store.reviews(c), settings: store.getSettings(),
    gemini: gem() && !!L()?.level, drillable: drillableIds(cats()).map((id) => catKey(c, id)),
    hasChunks: (w) => !!chunksFor(w),
  };
}

// Forgets screen state that belongs to the previous language.
function resetViews() {
  session = null;
  lastLookup = null;
  lastCorrection = null;
  correctOpen = false;
  wordQuery = '';
}

// ---------- language and level (Today and Settings) ----------
function learnCard() {
  const cur = L();
  const opts = store.knownLanguages().map((x) =>
    `<option value="${esc(x.code)}" ${cur?.code === x.code ? 'selected' : ''}>${esc(langName(x))}</option>`).join('');
  const levels = cur ? cur.levels.map((l) => `<option ${l === cur.level ? 'selected' : ''}>${esc(l)}</option>`).join('') : '';
  return `
    <label>${esc(t('settings.learning'))}
      <select id="target">${cur ? '' : `<option value="" selected disabled>${esc(t('settings.chooseLanguage'))}</option>`}${opts}
        <option value="__add">${esc(t('settings.addLanguage'))}</option></select>
    </label>
    <div id="addlang" class="hidden">
      <div class="inline"><input id="newlang" ${inputAttrs} placeholder="${esc(t('settings.newLanguage'))}">
      <button class="btn small" id="addbtn">${esc(t('settings.add'))}</button></div>
      <p class="muted small">${esc(t('settings.addHelp'))}</p>
    </div>
    ${cur ? `<label>${esc(t('settings.level'))}<select id="level">${cur.level ? '' : `<option value="" selected disabled>${esc(t('settings.chooseLevel'))}</option>`}${levels}</select></label>` : ''}
    <div id="learnres"></div>`;
}

function bindLearnCard(redraw) {
  $('#target')?.addEventListener('change', (e) => {
    if (e.target.value === '__add') {
      $('#addlang').classList.remove('hidden');
      $('#newlang').focus();
      return;
    }
    store.setActiveLanguage(e.target.value);
    resetViews();
    redraw();
  });
  $('#level')?.addEventListener('change', (e) => {
    store.saveLanguage(code(), { level: e.target.value });
    toast(t('settings.saved'));
    redraw();
  });
  $('#addbtn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const name = $('#newlang').value.trim();
    if (!name) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    $('#learnres').innerHTML = `<div class="loading">${esc(t('settings.adding'))}</div>`;
    try {
      const d = await gemini.setupLanguage(name);
      if (!d) { $('#learnres').innerHTML = errorBox(t('settings.langNotFound')); return; }
      // A language that is already here (built in or added before) keeps its categories.
      if (!store.knownLanguages().some((x) => x.code === d.code)) {
        const { code: c, ...desc } = d;
        store.saveLanguage(c, desc);
      }
      store.setActiveLanguage(d.code);
      resetViews();
      redraw();
    } catch (err) {
      $('#learnres').innerHTML = errorBox(err);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- routing ----------
const routes = { today: viewToday, session: viewSession, lookup: viewLookup, correct: viewCorrect,
  words: viewWords, profile: viewProfile, settings: viewSettings,
  'settings/advanced': viewAdvanced, 'settings/backup': viewBackup };
// Pages opened from another page get a back button to it; the tab bar marks their parent.
const parents = { profile: 'today', 'settings/advanced': 'settings', 'settings/backup': 'settings' };

const routeName = () => (location.hash.replace(/^#\/?/, '') || 'today').split('?')[0];

function route() {
  const name = routeName();
  // Until a language and level are chosen, every page except Settings shows that choice.
  const view = !L()?.level && !name.startsWith('settings') ? viewToday : routes[name] || viewToday;
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

function go(name) {
  if (location.hash === `#/${name}`) route(); else location.hash = `#/${name}`;
}

// ---------- Language pill and sheet ----------
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

function openLangSheet() {
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `<div class="sheet form">
    <div class="sheet-head"><h2>${esc(t('settings.langSheet'))}</h2>
      <button type="button" class="icon-btn" data-act="close" aria-label="${esc(t('edit.close'))}">${icon('close', 22)}</button></div>
    ${learnCard()}
    <p class="muted small">${esc(t('settings.learningHelp'))}</p>
  </div>`;
  document.body.appendChild(back);
  document.body.classList.add('no-scroll');
  const close = () => { back.remove(); document.body.classList.remove('no-scroll'); route(); };
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  $('[data-act=close]', back).addEventListener('click', close);
  bindLearnCard(close);
}

// ---------- Today ----------
function viewToday() {
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
  $('#start')?.addEventListener('click', () => { session = null; go('session'); });
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

// ---------- Session ----------
let session = null;

// Starts generating a drill as soon as its task is queued, so it is ready when it comes up.
function prepare(task) {
  if (task.kind !== 'drill') return;
  const examples = store.mistakes(code()).filter((m) => m.category === task.category).slice(0, 4);
  const words = store.words(code()).filter((w) => !isSentence(w));
  const word = task.drillKind === 'constraint' && words.length ? words[Math.floor(Math.random() * Math.min(words.length, 30))] : null;
  task.drillPromise = gemini.generateDrill(task.category, task.drillKind, { examples, word })
    .then((d) => (task.drill = d))
    .catch((e) => { task.drillError = e; });
}

function startSession() {
  const tasks = buildSession(sessionArgs());
  tasks.forEach(prepare);
  session = { tasks, lang: code(), idx: 0, correct: 0, answered: 0, requeued: new Set(), mistakesLogged: 0 };
  if (code() === 'ja') fillFurigana(tasks.map((x) => x.word).filter(Boolean));
}

// Practice never runs out: it keeps a few tasks queued ahead of the current one.
const PRACTICE_AHEAD = 3;

function startPractice(focus) {
  session = { practice: true, focus, tasks: [], lang: code(), idx: 0, correct: 0, answered: 0, requeued: new Set(), mistakesLogged: 0 };
  topUpPractice();
}

function topUpPractice() {
  const s = session;
  if (s.ended) return;
  const want = s.idx + PRACTICE_AHEAD;
  if (s.tasks.length >= want) return;
  // Built from current data each time, so answers already given change what comes next.
  const pool = practicePool({ ...sessionArgs(), focus: s.focus });
  const added = [];
  while (s.tasks.length < want) {
    const task = nextPracticeTask(pool, s.tasks.map((x) => x.item.id), { focus: s.focus });
    if (!task) break;
    prepare(task);
    s.tasks.push(task);
    added.push(task);
  }
  if (code() === 'ja') fillFurigana(added.map((x) => x.word).filter(Boolean));
}

function viewSession() {
  if (!session) startSession();
  if (session.practice) topUpPractice();
  titleEl.textContent = t(session.practice ? 'practice.title' : 'today.title');
  const { tasks, idx } = session;
  if (session.ended || idx >= tasks.length) return renderSessionEnd();
  const task = tasks[idx];
  task.state = { phase: 'answer' };

  // Practice has no end to show progress towards: it counts answers and right ones instead.
  const top = session.practice
    ? `<div class="grow"></div>
      <span class="count" aria-label="${esc(t('practice.score', { c: session.correct, n: session.answered }))}">✓ ${session.correct}/${session.answered}</span>`
    : `<div class="progress"><div style="width:${Math.round((idx / tasks.length) * 100)}%"></div></div>
      <span class="count" aria-label="${esc(t('session.of', { i: idx + 1, n: tasks.length }))}">${idx + 1}/${tasks.length}</span>`;
  main.innerHTML = `
    <div class="session-top">
      <button class="icon-btn" id="quit" aria-label="${esc(t('session.quit'))}">${icon('close', 24)}</button>
      ${top}
    </div>
    <section class="card exercise" id="ex"></section>
    <div class="dock" id="dock"></div>
  `;
  $('#quit').addEventListener('click', () => { session.ended = true; viewSession(); });
  renderTask(task);
}

function renderSessionEnd() {
  const s = session;
  // Practice only ends by itself when there is nothing saved to practise.
  const empty = s.practice && !s.tasks.length;
  main.innerHTML = `
    <section class="card hero end">
      <div class="hero-num">${empty ? '📭' : '🎉'}</div>
      <h2>${esc(t(empty ? 'practice.empty' : s.practice ? 'practice.done' : 'session.done'))}</h2>
      ${empty ? `<p class="muted">${esc(t('practice.emptyHelp'))}</p>`
        : `<p>${esc(t('session.summary', { c: s.correct, n: s.answered }))}</p>`}
      ${s.mistakesLogged ? `<p class="muted small">${esc(t('session.mistakesLogged', { n: s.mistakesLogged }))}</p>` : ''}
      ${empty && gem() ? `<button class="btn" data-suggest>${icon('sparkle', 18)} ${esc(t('suggest.open'))}</button>` : ''}
      <button class="btn primary big" id="home">${esc(t('session.backHome'))}</button>
    </section>`;
  $('#home').addEventListener('click', () => { session = null; go('today'); });
  bindSuggest(main);
}

async function renderTask(task) {
  const ex = $('#ex');
  const w = task.word;
  let body = '';
  if (task.kind === 'recall') {
    body = `
      <div class="ex-label">${esc(t('ex.recall', { l: langName() }))}</div>
      <div class="prompt">${esc(w.meaning)}</div>
      <div class="muted small">${esc(t(`pos.${w.pos || 'other'}`))}${w.register ? ` · ${esc(w.register)}` : ''}</div>
      <input class="answer" id="a1" ${inputAttrs} ${tl()} placeholder="${esc(recallHint(w))}">
      ${needsPlural(w) ? `<input class="answer" id="a2" ${inputAttrs} ${tl()} placeholder="${esc(t('ex.plural'))}">` : ''}`;
  } else if (task.kind === 'say') {
    body = `
      <div class="ex-label">${esc(t('ex.say', { l: langName() }))}</div>
      <div class="prompt">${esc(w.meaning)}</div>
      <div class="muted small"><span class="chip">${esc(toneLabel(w.tone))}</span> ${esc(t(`tone.${w.tone || 'everyday'}.help`))}</div>
      <textarea class="answer" id="a1" rows="3" ${inputAttrs} ${tl()} placeholder="${esc(t('ex.yourAnswer'))}"></textarea>`;
  } else if (task.kind === 'order') {
    task.parts = chunksFor(w);
    const furi = code() === 'ja' && furiMode() !== 'off' ? cutChunks(segmentsFor(lemmaOf(w), w), task.parts) : null;
    task.pool = shuffled(task.parts.map((p, i) => ({ p, i, html: furi ? `<span class="furi">${toHtml(furi[i])}</span>` : esc(p) })));
    task.built = [];
    body = `
      <div class="ex-label">${esc(t('ex.order'))}</div>
      <div class="prompt">${esc(w.meaning)}</div>
      <div class="built" id="built" ${tl()}><span class="muted small">${esc(t('ex.orderHint'))}</span></div>
      <div class="pool" id="pool" ${tl()}></div>
      <input type="hidden" id="a1">`;
  } else if (task.kind === 'gap') {
    const gap = gapFor(w);
    task.gap = gap;
    body = `
      <div class="ex-label">${esc(t(isSentence(w) ? 'ex.sgap' : 'ex.gap'))}</div>
      <div class="prompt sentence" ${tl()}>${jt(gap.sentence, w).replace('___', '<span class="gap">___</span>')}</div>
      <div class="muted small">${esc(t('ex.meaning'))}: ${esc(w.meaning)}</div>
      <input class="answer" id="a1" ${inputAttrs} ${tl()} placeholder="${esc(t('ex.yourAnswer'))}">`;
  } else if (task.kind === 'write') {
    body = `
      <div class="ex-label">${esc(t('ex.write'))}</div>
      <div class="prompt" ${tl()}>${jt(wordTitle(w), w)}</div>${readingLine(w)}
      <div class="muted small">${esc(w.meaning)}</div>
      <textarea class="answer" id="a1" rows="3" ${inputAttrs} ${tl()} placeholder="${esc(t('ex.yourAnswer'))}"></textarea>`;
  } else if (task.kind === 'fix') {
    const m = task.mistake;
    body = `
      <div class="ex-label">${esc(t('ex.fix'))}</div>
      <div class="prompt sentence" ${tl()}>${esc(m.fullSentence)}</div>
      <div class="muted small">${esc(t('ex.fixHint', { c: categoryLabel(m.category, lang(), cats()) }))}</div>
      <textarea class="answer" id="a1" rows="3" ${inputAttrs} ${tl()}>${esc(m.fullSentence)}</textarea>`;
  } else if (task.kind === 'drill') {
    if (!task.drill && !task.drillError) {
      ex.innerHTML = `<div class="loading">${esc(t('session.loading'))}</div>`;
      $('#dock').innerHTML = '';
      await task.drillPromise;
      if (session?.tasks[session.idx] !== task) return; // user moved on
    }
    if (task.drillError || !task.drill) {
      ex.innerHTML = `${errorBox(task.drillError || t('session.genFailed'))}<p class="muted">${esc(t('session.genFailed'))}</p>`;
      $('#dock').innerHTML = `<button class="btn primary" id="next">${esc(t('session.next'))}</button>`;
      $('#next').addEventListener('click', () => { session.idx++; viewSession(); });
      return;
    }
    const d = task.drill;
    const isGap = task.drillKind === 'gapfill';
    body = `
      <div class="ex-label">${esc(t('ex.drill', { c: categoryLabel(task.category, lang(), cats()) }))}</div>
      <div class="instruction">${esc(d.instruction)}</div>
      ${d.prompt ? `<div class="prompt sentence" ${tl()}>${jt(d.prompt, d).replace('___', '<span class="gap">___</span>')}</div>` : ''}
      ${isGap ? `<input class="answer" id="a1" ${inputAttrs} ${tl()} placeholder="${esc(t('ex.yourAnswer'))}">`
        : `<textarea class="answer" id="a1" rows="3" ${inputAttrs} ${tl()} placeholder="${esc(t('ex.yourAnswer'))}"></textarea>`}`;
  }

  ex.innerHTML = `${body}
    <div id="feedback"></div>`;
  $('#dock').innerHTML = `
    <button class="btn primary" id="check">${esc(t('session.check'))}</button>
    <button class="btn text" id="skip">${esc(t('session.skip'))}</button>`;

  const a1 = $('#a1');
  a1.focus({ preventScroll: true });
  if (task.kind === 'order') bindOrder(task);
  $('#check').addEventListener('click', () => onCheck(task));
  $('#skip').addEventListener('click', () => { session.idx++; viewSession(); });
  $$('input.answer', ex).forEach((el) => el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (el.id === 'a1' && $('#a2') && !$('#a2').value) $('#a2').focus();
    else (task.state.phase === 'answer' ? onCheck(task) : next(task));
  }));
}

// Word-order exercise: tap pieces to build the sentence, tap a placed piece to put it back.
function bindOrder(task) {
  const draw = () => {
    const used = new Set(task.built.map((x) => x.i));
    $('#built').innerHTML = task.built.length
      ? task.built.map((x, k) => `<button type="button" class="chunk placed" data-k="${k}">${x.html}</button>`).join('')
      : `<span class="muted small">${esc(t('ex.orderHint'))}</span>`;
    $('#pool').innerHTML = task.pool.map((x, k) =>
      `<button type="button" class="chunk" data-p="${k}" ${used.has(x.i) ? 'disabled' : ''}>${x.html}</button>`).join('');
    $('#a1').value = joinChunks(task.built.map((x) => x.p));
    $$('#pool .chunk').forEach((b) => b.addEventListener('click', () => {
      if (task.state.phase !== 'answer') return;
      task.built.push(task.pool[+b.dataset.p]);
      draw();
    }));
    $$('#built .chunk').forEach((b) => b.addEventListener('click', () => {
      if (task.state.phase !== 'answer') return;
      task.built.splice(+b.dataset.k, 1);
      draw();
    }));
  };
  draw();
}

// What to type in recall: German nouns with article, other languages' nouns with article
// when the language has them.
function recallHint(w) {
  if (w.pos !== 'noun') return t('ex.yourAnswer');
  if (recLang(w) === 'de') return t('ex.recallNoun');
  return store.language(recLang(w))?.articles.length ? t('ex.recallArticle') : t('ex.yourAnswer');
}

async function onCheck(task) {
  if (task.state.phase !== 'answer') return;
  const a1 = $('#a1').value;
  const a2 = $('#a2')?.value || '';
  if (!a1.trim()) return;
  task.state.phase = 'checking';
  const fb = $('#feedback');
  const checkBtn = $('#check');
  checkBtn.disabled = true;
  $('#skip').disabled = true;
  let grade = 'wrong', html = '', canOverride = false, mistakes = [], almostKey = null;

  try {
    if (task.kind === 'recall') {
      const r = checkRecall(task.word, a1, a2);
      grade = r.grade;
      if (r.byReading) almostKey = 'session.almostReading';
      canOverride = grade !== 'correct';
      html = wordReveal(task.word);
    } else if (task.kind === 'order') {
      grade = compare(a1, lemmaOf(task.word));
      canOverride = grade !== 'correct';
      html = sentenceReveal(task.word);
    } else if (task.kind === 'say') {
      const w = task.word;
      if (gem()) {
        fb.innerHTML = `<div class="loading">${esc(t('session.grading'))}</div>`;
        const r = await gemini.gradeTranslation(w, a1);
        mistakes = r.mistakes || [];
        grade = r.correct && !mistakes.length ? 'correct' : 'wrong';
        html = `<p>${esc(r.feedback)}</p>
          ${mistakes.length ? `<div class="sentence" ${tl()}>${diffHtml(a1, r.correctedText)}</div>${mistakeList(mistakes)}` : ''}
          ${r.toneHint ? `<div class="tip"><b>${esc(t('ex.toneTip', { tone: toneLabel(w.tone) }))}</b> ${esc(r.toneHint)}</div>` : ''}
          ${sentenceReveal(w)}
          ${grade === 'correct' ? naturalBlock(r.natural, r.naturalReason) : ''}`;
      } else {
        grade = compare(a1, lemmaOf(w));
        canOverride = grade !== 'correct';
        html = sentenceReveal(w);
      }
    } else if (task.kind === 'gap') {
      grade = compare(a1, task.gap.answer);
      canOverride = grade !== 'correct';
      html = `<div class="reveal" ${tl()}><b>${esc(task.gap.answer)}</b><div class="sentence">${jt(task.gap.sentence.replace('___', task.gap.answer), task.word)}</div></div>`;
    } else if (task.kind === 'fix') {
      const m = task.mistake;
      grade = compare(a1, m.correctedSentence);
      if (grade === 'wrong' && gem()) {
        fb.innerHTML = `<div class="loading">${esc(t('session.grading'))}</div>`;
        const r = await gemini.gradeAnswer({ instruction: 'Correct the mistakes in this sentence.', prompt: m.fullSentence,
          model: m.correctedSentence, answer: a1, category: m.category });
        grade = r.correct ? 'correct' : 'wrong';
        mistakes = r.mistakes || [];
        html = `<p>${esc(r.feedback)}</p>`;
      }
      canOverride = grade === 'wrong' && !gem();
      html += `<div class="reveal"><div class="sentence" ${tl()}>${diffHtml(m.fullSentence, m.correctedSentence)}</div>
        <div class="muted small">${esc(m.explanation)}</div></div>`;
    } else if (task.kind === 'write') {
      fb.innerHTML = `<div class="loading">${esc(t('session.grading'))}</div>`;
      const r = await gemini.gradeWordSentence(task.word, a1);
      mistakes = r.mistakes || [];
      grade = r.usesWordCorrectly && !mistakes.length ? 'correct' : 'wrong';
      html = `<p>${esc(r.feedback)}</p>${mistakes.length ? `<div class="sentence" ${tl()}>${diffHtml(a1, r.correctedText)}</div>${mistakeList(mistakes)}` : ''}
        ${naturalBlock(r.natural, r.naturalReason)}`;
    } else if (task.kind === 'drill') {
      const d = task.drill;
      if (task.drillKind === 'gapfill') {
        grade = compareAny(a1, [d.answer, ...(d.acceptableAnswers || [])]);
        canOverride = grade !== 'correct';
        html = `<div class="reveal"><b ${tl()}>${esc(d.answer)}</b>${d.prompt ? `<div class="sentence" ${tl()}>${jt(d.prompt.replace('___', d.answer), d)}</div>` : ''}
          <div class="muted small">${esc(d.explanation)}</div></div>`;
      } else {
        fb.innerHTML = `<div class="loading">${esc(t('session.grading'))}</div>`;
        const r = await gemini.gradeAnswer({ instruction: d.instruction, prompt: d.prompt, model: d.answer, answer: a1, category: task.category });
        mistakes = r.mistakes || [];
        grade = r.correct ? 'correct' : 'wrong';
        html = `<p>${esc(r.feedback)}</p>
          ${mistakes.length ? `<div class="sentence" ${tl()}>${diffHtml(a1, r.correctedText)}</div>${mistakeList(mistakes)}` : ''}
          <div class="reveal"><div class="muted small">${esc(t('session.answer'))}</div><div class="sentence" ${tl()}>${jt(d.answer, d)}</div>
          <div class="muted small">${esc(d.explanation)}</div></div>`;
      }
    }
  } catch (e) {
    task.state.phase = 'answer';
    checkBtn.disabled = false;
    $('#skip').disabled = false;
    fb.innerHTML = errorBox(e);
    return;
  }

  if (mistakes.length) {
    // Sentences written in exercises count as new writing; drill answers only feed drill accuracy.
    const source = ['write', 'say'].includes(task.kind) ? 'exercise' : 'drill';
    session.mistakesLogged += logMistakes(mistakes, source, session.lang).mistakes.length;
  }

  task.state = { phase: 'feedback', grade, almostKey, answer: a1 + (a2 ? ` / ${a2}` : ''), feedback: html };
  showFeedback(task, canOverride);
}

function sentenceReveal(w) {
  return `<div class="reveal"><div class="muted small">${esc(t('ex.saved'))} · ${esc(toneLabel(w.tone))}</div>
    <div class="sentence" ${tl(recLang(w))}>${jt(lemmaOf(w), w, recLang(w))}${w.reading && !furiShown(w) ? `<div class="reading">${esc(w.reading)}</div>` : ''}</div>
    ${w.toneNote ? `<div class="muted small">${esc(w.toneNote)}</div>` : ''}</div>`;
}

function wordReveal(w) {
  const forms = w.verbForms || w.forms;
  const c = recLang(w);
  return `<div class="reveal">
    <div class="kv"><span>${esc(t('session.answer'))}</span><b ${tl(c)}>${jt(wordTitle(w), w, c)}</b></div>
    ${w.reading ? `<div class="kv"><span>${esc(t('edit.reading'))}</span><span ${tl(c)}>${esc(w.reading)}</span></div>` : ''}
    ${needsPlural(w) ? `<div class="kv"><span>${esc(t('ex.plural'))}</span><b ${tl(c)}>${esc(w.plural)}</b></div>` : ''}
    ${forms ? `<div class="kv"><span>${esc(t('edit.forms'))}</span><span ${tl(c)}>${esc(forms)}</span></div>` : ''}
    ${w.example ? `<div class="sentence" ${tl(c)}>${jt(w.example, w, c)}</div>` : ''}
  </div>`;
}

function showFeedback(task, canOverride) {
  const { grade, feedback, almostKey } = task.state;
  const cls = grade === 'correct' ? 'ok' : grade === 'almost' ? 'almost' : 'bad';
  const label = grade === 'correct' ? t('session.correct') : grade === 'almost' ? t(almostKey || 'session.almost') : t('session.wrong');
  $('#feedback').innerHTML = `<div class="result ${cls}"><div class="result-title">${esc(label)}</div>${feedback}</div>`;
  bindNatural($('#feedback'));
  $$('#ex .chunk').forEach((b) => (b.disabled = true));
  $('#dock').innerHTML = `
    <button class="btn primary" id="next">${esc(t('session.next'))}</button>
    ${canOverride ? `<button class="btn text" id="override">${esc(t('session.iWasRight'))}</button>` : ''}`;
  $('#override')?.addEventListener('click', () => { task.state.grade = 'correct'; next(task); });
  $('#next').addEventListener('click', () => next(task));
  $('#next').focus({ preventScroll: true });
  $$('#ex .answer').forEach((el) => (el.readOnly = true));
}

function next(task) {
  const { grade, answer } = task.state;
  const firstTry = !session.requeued.has(task);
  if (firstTry) {
    const now = Date.now();
    // The latest copy: in practice the same item can come up again before an earlier answer was saved.
    task.item = store.reviewItems().find((r) => r.id === task.item.id) || task.item;
    // Practice only moves the schedule for misses and for new or due items.
    const scheduled = session.practice ? schedulePractice(task.item, grade, now) : schedule(task.item, grade, now);
    const updated = scheduled === task.item ? { ...task.item } : scheduled;
    if (scheduled !== task.item) {
      if (task.word) updated.exerciseType = task.kind;
      if (task.kind === 'drill') updated.exerciseType = task.drillKind;
    }
    store.saveReview(updated, {
      reviewItemId: task.item.id, itemType: task.item.itemType, itemId: task.item.itemId,
      lang: session.lang, category: task.category || task.mistake?.category || null, exerciseType: task.drillKind || task.kind,
      answer, correct: grade !== 'wrong', grade, reviewedAt: now, ...(session.practice ? { mode: 'practice' } : {}),
    });
    task.item = updated;
    session.answered++;
    if (grade !== 'wrong') session.correct++;
    // Locally checked items answered wrong come back once: at the end of the daily session,
    // a few tasks later in practice.
    if (grade === 'wrong' && ['recall', 'gap', 'fix', 'order'].includes(task.kind)) {
      session.requeued.add(task);
      if (session.practice) session.tasks.splice(session.idx + 4, 0, task);
      else session.tasks.push(task);
    }
  }
  session.idx++;
  viewSession();
}

// ---------- Look up ----------
let lastLookup = null;

function viewLookup() {
  titleEl.textContent = t('lookup.title');
  const all = store.words(code());
  const recent = [...all].sort((a, b) => b.addedAt - a.addedAt).slice(0, 5);
  const mode = pref('lookupMode', 'word');
  const tone = pref('tone', 'everyday');
  const romanized = L()?.romanized ? `<p class="muted small">${esc(t('lookup.romanized', { r: L().romanized }))}</p>` : '';
  const seg = (id, options, current) => `<div class="seg" id="${id}">${options.map(([v, label]) =>
    `<button type="button" data-v="${esc(v)}" class="${v === current ? 'on' : ''}">${esc(label)}</button>`).join('')}</div>`;
  const form = mode === 'sentence'
    ? `<textarea id="q" rows="3" class="big-input" ${inputAttrs} placeholder="${esc(t('lookup.sentencePlaceholder', { l: langName() }))}"></textarea>
      <div class="field-label">${esc(t('lookup.tone'))}</div>
      ${seg('tone', gemini.TONES.map((x) => [x, toneLabel(x)]), tone)}
      <p class="muted small" id="tonehelp">${esc(t(`tone.${tone}.help`))}</p>
      <button class="btn primary" type="submit">${esc(t('lookup.translate'))}</button>`
    : `<div class="search-field"><input id="q" class="big-input" ${inputAttrs} placeholder="${esc(t('lookup.placeholder', { l: langName() }))}" enterkeyhint="search">
      <button class="go" type="submit" aria-label="${esc(t('lookup.go'))}">${icon('search', 20)}</button></div>
      ${romanized}
      <button type="button" class="btn link small" id="addctx">${esc(t('lookup.addContext'))}</button>
      <textarea id="ctx" rows="2" class="hidden" ${tl()} placeholder="${esc(t('lookup.context'))}"></textarea>`;
  main.innerHTML = `
    <form class="card" id="lf">
      ${seg('mode', [['word', t('lookup.modeWord')], ['sentence', t('lookup.modeSentence')]], mode)}
      ${form}
    </form>
    <div id="lres">${lastLookup ? lookupResult(lastLookup) : ''}</div>
    ${recent.length ? `<div class="group-label">${esc(t('lookup.recent'))}</div>${wordRows(recent)}
      ${all.length > recent.length ? `<a class="more-link" href="#/words">${esc(t('words.all'))} (${all.length})${icon('chevron', 16)}</a>` : ''}` : ''}
  `;
  $$('#mode button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.v === mode) return;
    setPref('lookupMode', b.dataset.v);
    viewLookup();
    $('#q').focus();
  }));
  $$('#tone button').forEach((b) => b.addEventListener('click', () => {
    setPref('tone', b.dataset.v);
    $$('#tone button').forEach((x) => x.classList.toggle('on', x === b));
    $('#tonehelp').textContent = t(`tone.${b.dataset.v}.help`);
  }));
  $('#addctx')?.addEventListener('click', () => { $('#ctx').classList.remove('hidden'); $('#addctx').remove(); $('#ctx').focus(); });
  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#q').value.trim();
    if (!q) return;
    $('#q').blur();
    if (mode === 'sentence') translate(q, $('#tone .on')?.dataset.v || 'everyday');
    else lookupWord(q, $('#ctx').value.trim());
  });
  bindWordCard($('#lres'));
  bindWordRows(main);
  if (lastLookup && store.getWord(lastLookup.word.id)) {
    fillFurigana([store.getWord(lastLookup.word.id)], () => {
      const res = $('#lres');
      if (!res || !lastLookup) return;
      res.innerHTML = lookupResult(lastLookup);
      bindWordCard(res);
    });
  }
}

async function lookupWord(q, ctx) {
  const res = $('#lres');
  if (!gem()) {
    const local = store.findWord(q, code(), L()?.articles)
      || store.words(code()).find((w) => w.reading === q || w.meaning.toLowerCase().includes(q.toLowerCase()));
    if (local) { lastLookup = { word: local, note: t('lookup.offlineHit') }; res.innerHTML = lookupResult(lastLookup); bindWordCard(res); }
    else res.innerHTML = errorBox(store.getApiKey() ? t('err.offline') : t('err.noKey'));
    return;
  }
  res.innerHTML = `<div class="card loading">${esc(t('lookup.loading'))}</div>`;
  try {
    const r = await gemini.lookup(q, ctx);
    if (!r.found || !r.lemma) { res.innerHTML = `<div class="notice">${esc(t('lookup.notFound'))}</div>`; return; }
    const { found, ...fields } = r;
    const { word, created } = store.addWord({ ...fields, lang: code(), contextSentence: ctx, source: 'lookup' });
    lastLookup = { word, note: created ? t('lookup.saved') : t('lookup.already') };
    viewLookup();
  } catch (err) {
    res.innerHTML = errorBox(err);
  }
}

async function translate(q, tone) {
  const res = $('#lres');
  if (!gem()) { res.innerHTML = errorBox(store.getApiKey() ? t('err.offline') : t('err.noKey')); return; }
  res.innerHTML = `<div class="card loading">${esc(t('lookup.translating'))}</div>`;
  try {
    const r = await gemini.translateSentence(q, tone);
    if (!r.sentence) { res.innerHTML = `<div class="notice">${esc(t('lookup.notTranslated'))}</div>`; return; }
    const { word, created } = store.addSentence({ ...r, query: q }, code());
    lastLookup = { word, note: created ? t('lookup.sentenceSaved') : t('lookup.sentenceAlready') };
    viewLookup();
    $('#q').value = q;
  } catch (err) {
    res.innerHTML = errorBox(err);
  }
}

function lookupResult({ word, note }) {
  const w = store.getWord(word.id) || word;
  if (!store.getWord(word.id)) return '';
  if (isSentence(w)) return sentenceCard(w, note);
  const c = recLang(w);
  const forms = w.verbForms || w.forms;
  return `<article class="card word-card" data-id="${esc(w.id)}">
    <div class="word-head">
      <div>${readingLine(w)}<div class="word-title" ${tl(c)}>${jt(wordTitle(w), w, c)}</div>
      <div class="muted small">${esc(t(`pos.${w.pos || 'other'}`))}${w.plural && w.pos === 'noun' ? ` · ${esc(t('ex.plural'))}: <span ${tl(c)}>${esc(w.plural)}</span>` : ''}</div></div>
      <button class="icon-btn" data-edit="${esc(w.id)}" aria-label="${esc(t('edit.title'))}">${icon('edit', 20)}</button>
    </div>
    ${forms ? `<div class="forms" ${tl(c)}>${esc(forms)}</div>` : ''}
    <div class="meaning">${esc(w.meaning)}</div>
    ${w.register ? `<div class="muted small">${esc(w.register)}</div>` : ''}
    ${w.example ? `<div class="sentence"><span ${tl(c)}>${jt(w.example, w, c)}</span><div class="muted small">${esc(w.exampleTranslation)}</div></div>` : ''}
    ${(w.moreExamples || []).map((e) => `<div class="sentence"><span ${tl(c)}>${jt(e.text, w, c)}</span><div class="muted small">${esc(e.translation)}</div></div>`).join('')}
    ${w.contextSentence ? `<div class="sentence ctx" ${tl(c)}>${jt(w.contextSentence, w, c)}</div>` : ''}
    <div class="saved-note">${icon('check', 16)} ${esc(note)}</div>
  </article>`;
}

function sentenceCard(w, note) {
  const c = recLang(w);
  const keyWords = (w.keyWords || []).map((k) => {
    const have = store.findWord(k.lemma, c, store.language(c)?.articles);
    return `<button type="button" class="kw ${have ? 'have' : ''}" data-kw="${esc(k.lemma)}" ${have ? 'disabled' : ''}>
      <span ${tl(c)}>${have ? '✓ ' : '＋ '}${esc(k.lemma)}</span> <span class="muted">${esc(k.meaning)}</span></button>`;
  }).join('');
  return `<article class="card word-card" data-id="${esc(w.id)}">
    <div class="word-head">
      <span class="chip">${esc(toneLabel(w.tone))}</span>
      <button class="icon-btn" data-edit="${esc(w.id)}" aria-label="${esc(t('edit.sentenceTitle'))}">${icon('edit', 20)}</button>
    </div>
    <div class="sentence-big" ${tl(c)}>${jt(lemmaOf(w), w, c)}</div>
    ${readingLine(w)}
    <div class="meaning">${esc(w.meaning)}</div>
    ${w.toneNote ? `<div class="muted small">${esc(w.toneNote)}</div>` : ''}
    ${keyWords ? `<div class="field-label">${esc(t('lookup.keyWords'))}</div><div class="keywords">${keyWords}</div>` : ''}
    <div class="saved-note">${icon('check', 16)} ${esc(note)}</div>
  </article>`;
}

function bindWordCard(root) {
  $$('[data-edit]', root).forEach((b) => b.addEventListener('click', () => openEditor(b.dataset.edit)));
  // Words from a translated sentence: a full lookup in the sentence's sense, then saved.
  $$('[data-kw]', root).forEach((b) => b.addEventListener('click', async () => {
    const sentence = store.getWord(b.closest('[data-id]').dataset.id);
    if (!gem()) { toast(store.getApiKey() ? t('err.offline') : t('err.noKey')); return; }
    b.disabled = true;
    try {
      const r = await gemini.lookup(b.dataset.kw, lemmaOf(sentence));
      if (!r.found || !r.lemma) throw new Error(t('lookup.notFound'));
      const { found, ...fields } = r;
      store.addWord({ ...fields, lang: recLang(sentence), contextSentence: lemmaOf(sentence), source: 'sentence' });
      b.classList.add('have');
      b.querySelector('span').textContent = `✓ ${r.lemma}`;
      toast(t('lookup.saved'));
    } catch (e) {
      b.disabled = false;
      toast(e.message || String(e));
    }
  }));
}

// ---------- Word list ----------
function wordRows(list) {
  return `<ul class="rows">${list.map((w) => {
    const item = store.reviewItemFor('word', w.id);
    const dueNow = item && !isNew(item) && item.due <= Date.now();
    const status = !item || isNew(item) ? `<span class="status">${esc(t('words.new'))}</span>`
      : `<span class="status ${dueNow ? 'due' : ''}">${esc(t('words.due', { d: fmtDate(item.due) }))}</span>`;
    if (isSentence(w)) {
      return `<li data-word="${esc(w.id)}"><div class="grow"><div class="ellipsis"><span class="kind">${icon('speech', 15)}</span><span ${tl(recLang(w))}>${esc(lemmaOf(w))}</span></div>
        <div class="muted small ellipsis">${esc(toneLabel(w.tone))} · ${esc(w.meaning)}</div></div>${status}</li>`;
    }
    const reading = w.reading ? ` <span class="muted small" ${tl(recLang(w))}>${esc(w.reading)}</span>` : '';
    return `<li data-word="${esc(w.id)}"><div><b ${tl(recLang(w))}>${esc(wordTitle(w))}</b>${reading}<div class="muted small ellipsis">${esc(w.meaning)}</div></div>${status}</li>`;
  }).join('')}</ul>`;
}

function bindWordRows(root) {
  $$('[data-word]', root).forEach((li) => li.addEventListener('click', () => openEditor(li.dataset.word)));
}

let wordQuery = '';
function viewWords() {
  titleEl.textContent = t('words.title');
  const all = store.words(code());
  let show = pref('wordFilter', 'all');
  main.innerHTML = `
    <div class="toolbar">
      <input id="search" type="search" ${inputAttrs} placeholder="${esc(t('words.search'))}" value="${esc(wordQuery)}">
      ${gem() ? `<button class="btn" data-suggest aria-label="${esc(t('suggest.open'))}">${icon('sparkle', 22)}</button>` : ''}
      <button class="btn" id="add" aria-label="${esc(t('words.add'))}">${icon('plus', 22)}</button>
    </div>
    ${all.some(isSentence) ? `<div class="seg" id="wfilter">${['all', 'words', 'sentences'].map((f) =>
      `<button type="button" data-v="${f}" class="${f === show ? 'on' : ''}">${esc(t(`words.filter.${f}`))}</button>`).join('')}</div>` : ''}
    <div id="wlist"></div>`;
  const draw = () => {
    const q = wordQuery.toLowerCase();
    const kind = all.some(isSentence) ? show : 'all';
    const list = all
      .filter((w) => kind === 'all' || (kind === 'sentences') === isSentence(w))
      .filter((w) => !q || [lemmaOf(w), w.reading, w.meaning].some((f) => (f || '').toLowerCase().includes(q)));
    $('#wlist').innerHTML = all.length
      ? `<p class="muted small">${esc(t(`words.count.${kind}`, { n: list.length }))}</p>${wordRows(list)}`
      : `<p class="muted center">${esc(t('words.empty'))}</p>`;
    bindWordRows($('#wlist'));
  };
  $$('#wfilter button').forEach((b) => b.addEventListener('click', () => {
    show = b.dataset.v;
    setPref('wordFilter', show);
    $$('#wfilter button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  }));
  $('#search').addEventListener('input', (e) => { wordQuery = e.target.value; draw(); });
  $('#add').addEventListener('click', () => openEditor(null));
  bindSuggest(main);
  draw();
}

// ---------- Suggested words ----------
// Gemini proposes words at the learner's level; they are shown ticked, and the learner
// unticks any they don't want before adding them.
function bindSuggest(root) {
  $$('[data-suggest]', root).forEach((b) => b.addEventListener('click', openSuggest));
}

const SUGGEST_COUNT = 8;

function openSuggest() {
  const c = code();
  let found = [];
  openSheet(`
    ${sheetHead(t('suggest.title'))}
    <p class="muted small">${esc(t('suggest.help', { l: langName(), level: L().level }))}</p>
    <div class="inline"><input name="topic" id="topic" ${inputAttrs} placeholder="${esc(t('suggest.topic'))}">
      <button type="button" class="btn small" id="sgo">${esc(t('suggest.go'))}</button></div>
    <div id="slist"></div>
    <button type="submit" class="btn primary wide hidden" id="sadd"></button>`, {
    onSave: () => {
      const picked = $$('#slist input:checked').map((x) => found[+x.value]);
      if (!picked.length) return false;
      let added = 0;
      for (const w of picked) if (store.addWord({ ...w, lang: c, source: 'suggested' }).created) added++;
      toast(t('suggest.added', { n: added }));
    },
  });
  const sheet = $('.sheet');
  const count = () => {
    const n = $$('#slist input:checked', sheet).length;
    const add = $('#sadd', sheet);
    add.textContent = t('suggest.add', { n });
    add.disabled = !n;
  };
  const load = async () => {
    const list = $('#slist', sheet);
    const go = $('#sgo', sheet);
    $('#sadd', sheet).classList.add('hidden');
    go.disabled = true;
    list.innerHTML = `<div class="loading">${esc(t('suggest.loading'))}</div>`;
    try {
      // The newest saved words are listed so Gemini avoids them; any that slip through are dropped here.
      const exclude = store.words(c).filter((w) => !isSentence(w)).slice(0, 300).map(lemmaOf);
      const seen = new Set();
      found = (await gemini.suggestWords(SUGGEST_COUNT, { topic: $('#topic', sheet).value.trim(), exclude })).filter((w) => {
        const key = store.normKey(w.lemma, store.language(c)?.articles);
        if (seen.has(key) || store.findWord(w.lemma, c, store.language(c)?.articles)) return false;
        seen.add(key);
        return true;
      });
      if (!found.length) { list.innerHTML = `<p class="muted">${esc(t('suggest.none'))}</p>`; return; }
      list.innerHTML = `<ul class="suggest">${found.map((w, i) => `<li><label>
        <input type="checkbox" value="${i}" checked>
        <div><b ${tl(c)}>${jt(wordTitle(w), w, c)}</b>${w.reading ? ` <span class="muted small" ${tl(c)}>${esc(w.reading)}</span>` : ''}
          <div class="muted small">${esc(t(`pos.${w.pos || 'other'}`))} · ${esc(w.meaning)}</div>
          ${w.example ? `<div class="small" ${tl(c)}>${jt(w.example, w, c)}</div>` : ''}</div>
      </label></li>`).join('')}</ul>`;
      $$('#slist input', sheet).forEach((x) => x.addEventListener('change', count));
      $('#sadd', sheet).classList.remove('hidden');
      count();
    } catch (e) {
      list.innerHTML = errorBox(e);
    } finally {
      go.disabled = false;
      go.textContent = t(found.length ? 'suggest.again' : 'suggest.go');
    }
  };
  $('#sgo', sheet).addEventListener('click', load);
  $('#topic', sheet).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); load(); } });
  load();
}

function openEditor(id) {
  const saved = id ? store.getWord(id) : null;
  if (id && !saved) return;
  if (isSentence(saved)) return openSentenceEditor(saved);
  const Lw = store.language(saved ? recLang(saved) : code()) || store.language('de');
  const de = Lw.code === 'de';
  const w = saved ? { ...saved, lemma: lemmaOf(saved) } : { lemma: '', article: '', pos: 'noun', meaning: '' };
  // target: the field holds text in the language being learnt.
  const field = (k, label, type = 'input', target = true) => {
    const attrs = target ? tl(Lw.code) : '';
    return type === 'textarea'
      ? `<label>${esc(label)}<textarea name="${k}" rows="2" ${attrs}>${esc(w[k])}</textarea></label>`
      : `<label>${esc(label)}<input name="${k}" value="${esc(w[k])}" ${inputAttrs} ${attrs}></label>`;
  };
  const articleSelect = Lw.articles.length
    ? `<label>${esc(t('edit.article'))}<select name="article" ${tl(Lw.code)}>${['', ...Lw.articles].map((a) => `<option ${a === (w.article || '') ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>`
    : '';
  const lemmaField = field('lemma', t(Lw.articles.length ? 'edit.lemmaNoArticle' : 'edit.lemma'));
  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop';
  sheet.innerHTML = `<form class="sheet">
    ${sheetHead(id ? t('edit.title') : t('edit.newTitle'))}
    ${articleSelect ? `<div class="row2">${articleSelect}${lemmaField}</div>` : lemmaField}
    ${Lw.reading ? field('reading', t('edit.reading')) : ''}
    ${field('meaning', t('edit.meaning'), 'input', false)}
    <label>${esc(t('edit.pos'))}<select name="pos">${['noun', 'verb', 'adjective', 'adverb', 'phrase', 'other'].map((p) => `<option value="${p}" ${p === w.pos ? 'selected' : ''}>${esc(t(`pos.${p}`))}</option>`).join('')}</select></label>
    ${de ? `${field('plural', t('edit.plural'))}${field('verbForms', t('edit.verbForms'))}`
      : `${field('forms', t('edit.forms'))}${field('recallAnswer', t('edit.recallAnswer'))}`}
    ${moreFields(`
      ${field('register', t('edit.register'), 'input', false)}
      ${field('example', t('edit.example'), 'textarea')}
      <label>${esc(t('edit.moreExamples'))}<textarea name="moreExamples" rows="5" ${tl(Lw.code)}>${esc(examplesToText(w.moreExamples))}</textarea></label>
      <p class="muted small">${esc(t('edit.moreExamplesHelp'))}</p>
      ${field('contextSentence', t('edit.context'), 'textarea')}
      ${field('gapSentence', t('edit.gapSentence'), 'textarea')}
      ${field('gapAnswer', t('edit.gapAnswer'))}`)}
    <button type="submit" class="btn primary wide">${esc(t('edit.save'))}</button>
    ${id ? `<button type="button" class="btn danger wide" data-act="delete">${esc(t('edit.delete'))}</button>` : ''}
  </form>`;
  document.body.appendChild(sheet);
  document.body.classList.add('no-scroll');
  const close = () => { sheet.remove(); document.body.classList.remove('no-scroll'); route(); };
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  $('[data-act=cancel]', sheet).addEventListener('click', close);
  $('[data-act=delete]', sheet)?.addEventListener('click', () => {
    if (!confirm(t('edit.confirmDelete', { w: wordTitle(w) }))) return;
    store.deleteWord(id);
    if (lastLookup?.word.id === id) lastLookup = null;
    close();
  });
  $('form', sheet).addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    if (!fd.lemma.trim()) return;
    fd.moreExamples = examplesFromText(fd.moreExamples);
    if (id) store.updateWord(id, fd); else store.addWord({ ...fd, lang: Lw.code, source: 'manual' });
    close();
  });
}

// Sheet title with a close button (it cancels), and the fields most edits don't need.
function sheetHead(title) {
  return `<div class="sheet-head"><h2>${esc(title)}</h2>
    <button type="button" class="icon-btn" data-act="cancel" aria-label="${esc(t('edit.cancel'))}">${icon('close', 22)}</button></div>`;
}
const moreFields = (html) => `<details class="more"><summary>${esc(t('edit.more'))} ${icon('down', 16)}</summary><div>${html}</div></details>`;

// Opens a bottom sheet with a form; onSave gets the form fields.
function openSheet(html, { onSave, onDelete }) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop';
  sheet.innerHTML = `<form class="sheet">${html}</form>`;
  document.body.appendChild(sheet);
  document.body.classList.add('no-scroll');
  const close = () => { sheet.remove(); document.body.classList.remove('no-scroll'); route(); };
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  $('[data-act=cancel]', sheet).addEventListener('click', close);
  $('[data-act=delete]', sheet)?.addEventListener('click', () => { if (onDelete()) close(); });
  $('form', sheet).addEventListener('submit', (e) => {
    e.preventDefault();
    if (onSave(Object.fromEntries(new FormData(e.target).entries())) !== false) close();
  });
}

function openSentenceEditor(w) {
  const c = recLang(w);
  const Lw = store.language(c) || store.language('de');
  const field = (k, label, { area = false, target = true } = {}) => {
    const attrs = target ? tl(c) : '';
    return area
      ? `<label>${esc(label)}<textarea name="${k}" rows="2" ${attrs}>${esc(k === 'lemma' ? lemmaOf(w) : w[k])}</textarea></label>`
      : `<label>${esc(label)}<input name="${k}" value="${esc(w[k])}" ${inputAttrs} ${attrs}></label>`;
  };
  openSheet(`
    ${sheetHead(t('edit.sentenceTitle'))}
    ${field('lemma', t('edit.sentence'), { area: true })}
    ${Lw.reading ? field('reading', t('edit.reading'), { area: true }) : ''}
    ${field('meaning', t('edit.meaning'), { area: true, target: false })}
    <label>${esc(t('lookup.tone'))}<select name="tone">${gemini.TONES.map((x) =>
      `<option value="${x}" ${x === (w.tone || 'everyday') ? 'selected' : ''}>${esc(toneLabel(x))}</option>`).join('')}</select></label>
    ${moreFields(`
      ${field('toneNote', t('edit.toneNote'), { target: false })}
      ${field('gapSentence', t('edit.gapSentence'), { area: true })}
      ${field('gapAnswer', t('edit.gapAnswer'))}`)}
    <button type="submit" class="btn primary wide">${esc(t('edit.save'))}</button>
    <button type="button" class="btn danger wide" data-act="delete">${esc(t('edit.delete'))}</button>`, {
    onSave: (fd) => {
      if (!fd.lemma.trim()) return false;
      store.updateWord(w.id, fd);
    },
    onDelete: () => {
      if (!confirm(t('edit.confirmDelete', { w: lemmaOf(w) }))) return false;
      store.deleteWord(w.id);
      if (lastLookup?.word.id === w.id) lastLookup = null;
      return true;
    },
  });
}

// ---------- Correct ----------
let lastCorrection = null;

// After a correction the result comes first; the text collapses to one line until reopened.
let correctOpen = false;

function viewCorrect() {
  titleEl.textContent = t('correct.title');
  const draft = sessionStorage.getItem('gt.draft') || '';
  const collapsed = lastCorrection && !correctOpen;
  main.innerHTML = `
    ${collapsed ? `<section class="card draft-row" id="reopen">
        <div class="grow"><div class="muted small">${esc(t('correct.yourText'))}</div><div class="ellipsis" ${tl(lastCorrection.lang)}>${esc(lastCorrection.text)}</div></div>
        ${icon('down', 18)}
      </section>` : ''}
    <form class="card ${collapsed ? 'hidden' : ''}" id="cf">
      <textarea id="text" rows="6" spellcheck="false" ${tl()} placeholder="${esc(t('correct.placeholder', { l: langName() }))}">${esc(draft)}</textarea>
      <button class="btn primary" type="submit">${esc(t('correct.go'))}</button>
    </form>
    <div id="cres">${lastCorrection ? correctionResult(lastCorrection) : ''}</div>
    ${lastCorrection ? `<button class="btn" id="newtext">${icon('plus', 18)} ${esc(t('correct.newText'))}</button>` : ''}`;
  $('#reopen')?.addEventListener('click', () => { correctOpen = true; viewCorrect(); $('#text').focus(); });
  $('#newtext')?.addEventListener('click', () => {
    sessionStorage.removeItem('gt.draft');
    lastCorrection = null;
    correctOpen = false;
    viewCorrect();
    $('#text').focus();
  });
  $('#text').addEventListener('input', (e) => sessionStorage.setItem('gt.draft', e.target.value));
  $('#cf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#text').value.trim();
    if (!text) return;
    $('#text').blur();
    const res = $('#cres');
    res.innerHTML = `<div class="card loading">${esc(t('correct.loading'))}</div>`;
    try {
      const r = await gemini.correctText(text);
      const logged = logMistakes(r.mistakes, 'correction', code());
      lastCorrection = { text, lang: code(), ...r, newWords: logged.words.map(wordTitle) };
      correctOpen = false;
      if (routeName() === 'correct') { viewCorrect(); window.scrollTo(0, 0); }
    } catch (err) {
      res.innerHTML = errorBox(err);
    }
  });
  bindCopy();
}

function correctionResult(c) {
  return `<section class="card">
    <div class="card-head"><h3>${esc(t('correct.result'))}</h3>
      <button class="btn small text" id="copy">${icon('copy', 16)} ${esc(t('correct.copy'))}</button></div>
    <div class="sentence corrected" ${tl(c.lang)}>${diffHtml(c.text, c.correctedText)}</div>
    ${c.mistakes.length ? `<h3>${esc(t('correct.mistakes', { n: c.mistakes.length }))}</h3>${mistakeList(c.mistakes, c.lang)}
      <p class="muted small">${esc(t('correct.logged'))}</p>` : `<p>${esc(t('correct.noMistakes'))}</p>`}
    ${c.newWords?.length ? `<p class="muted small">${esc(t('correct.wordsAdded', { w: c.newWords.join(', ') }))}</p>` : ''}
    ${naturalBlock(c.natural, c.naturalReason, c.lang)}
  </section>`;
}

function bindCopy() {
  bindNatural($('#cres'));
  $('#copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(lastCorrection.correctedText); toast(t('correct.copied')); } catch { /* ignore */ }
  });
}

// ---------- Profile ----------
export function categoryStats(now = Date.now()) {
  const d14 = now - 14 * 864e5, d28 = now - 28 * 864e5;
  const writing = store.mistakes(code()).filter((m) => m.source !== 'drill');
  const reviews = store.reviews(code());
  return cats().map((c) => {
    const mine = writing.filter((m) => m.category === c.id);
    const recent = mine.filter((m) => m.createdAt >= d14).length;
    const prev = mine.filter((m) => m.createdAt >= d28 && m.createdAt < d14).length;
    const drills = reviews.filter((r) => r.category === c.id).slice(-10);
    const acc = drills.length ? drills.filter((r) => r.correct).length / drills.length : null;
    let trend = 'steady';
    if (prev > 0 && recent > prev) trend = 'worse';
    else if (recent < prev && drills.length >= 3 && acc >= 0.7) trend = 'improving';
    return { ...c, total: mine.length, recent, prev, drills: drills.length, acc, trend };
  }).filter((s) => s.total || s.drills);
}

const sortedStats = () => categoryStats().sort((a, b) => b.recent - a.recent || b.total - a.total);

function catList(stats) {
  const max = Math.max(...stats.map((s) => s.recent), 1);
  const trendLabel = { improving: `↘ ${t('profile.improving')}`, worse: `↗ ${t('profile.worse')}`, steady: `→ ${t('profile.steady')}` };
  return `<ul class="cats">${stats.map((s) => `
    <li>
      <div class="cat-head"><b>${esc(lang() === 'en' ? s.en : s.de)}</b><span class="trend ${s.trend}">${esc(trendLabel[s.trend])}</span></div>
      <div class="bar"><div style="width:${Math.round((s.recent / max) * 100)}%"></div></div>
      <div class="muted small">${s.recent} · ${esc(t('profile.last14'))} &nbsp;|&nbsp; ${s.total} ${esc(t('profile.total'))}
        ${s.drills ? ` &nbsp;|&nbsp; ${esc(t('profile.drills'))}: ${esc(t('profile.accuracy', { p: Math.round(s.acc * 100) }))}` : ''}</div>
    </li>`).join('')}</ul>`;
}

function viewProfile() {
  titleEl.textContent = t('profile.title');
  const stats = sortedStats();
  if (!stats.length) {
    main.innerHTML = `<p class="muted center">${esc(t('profile.empty'))}</p>`;
    return;
  }
  const recentMistakes = store.mistakes(code()).filter((m) => m.source !== 'drill').slice(0, 10);
  main.innerHTML = `
    <section class="card">${catList(stats)}</section>
    ${recentMistakes.length ? `<div class="group-label">${esc(t('profile.recent'))}</div><section class="card">${mistakeList(recentMistakes)}</section>` : ''}`;
}

// ---------- Settings ----------
const standalone = () => navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;

function viewSettings() {
  titleEl.textContent = t('settings.title');
  const s = store.getSettings();
  main.innerHTML = `
    <div class="group-label">${esc(t('settings.groupLearn'))}</div>
    <section class="card form" id="learncard">
      ${learnCard()}
      <div class="row-label"><span>${esc(t('settings.newPerDay'))}</span>
        <div class="stepper"><button type="button" id="npdminus" aria-label="−">−</button><output id="npd">${esc(s.newPerDay)}</output><button type="button" id="npdplus" aria-label="+">+</button></div></div>
      <p class="muted small">${esc(t('settings.learningHelp'))}</p>
      ${code() === 'ja' ? `<div class="row-label"><span>${esc(t('settings.furigana'))}</span>
        <div class="seg" id="furi" style="min-width:210px">${['tap', 'always', 'off'].map((v) =>
          `<button type="button" data-v="${v}" class="${furiMode() === v ? 'on' : ''}">${esc(t(`settings.furigana.${v}`))}</button>`).join('')}</div></div>
      <p class="muted small">${esc(t('settings.furiganaHelp'))}</p>` : ''}
    </section>
    <div class="group-label">${esc(t('sync.title'))}</div>
    <section class="card form" id="synccard"></section>
    <div class="group-label">Gemini</div>
    <section class="card form">
      <label>${esc(t('settings.apiKey'))}
        <div class="inline"><input id="key" type="password" ${inputAttrs} value="${esc(store.getApiKey())}" placeholder="AIza…">
        <button class="btn small text" id="showkey">${esc(t('settings.show'))}</button></div>
      </label>
      <p class="muted small">${esc(t('settings.apiKeyHelp'))} <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></p>
      <button class="btn" id="test">${esc(t('settings.test'))}</button>
      <div id="testres"></div>
    </section>
    <nav class="list">
      <a href="#/settings/advanced"><span>${esc(t('settings.advanced'))}</span><span class="val"><span class="ellipsis">${esc(s.model)}</span>${icon('chevron', 18)}</span></a>
    </nav>
    <div class="group-label">${esc(t('settings.groupApp'))}</div>
    <section class="card form">
      <div class="row-label"><span>${esc(t('settings.language'))}</span>
        <div class="seg" id="lang" style="min-width:180px">
          <button data-lang="de" class="${s.lang !== 'en' ? 'on' : ''}">Deutsch</button>
          <button data-lang="en" class="${s.lang === 'en' ? 'on' : ''}">English</button>
        </div>
      </div>
    </section>
    <nav class="list">
      <a href="#/settings/backup"><span>${esc(t('settings.backup'))}</span><span class="val">${icon('chevron', 18)}</span></a>
    </nav>
    ${standalone() ? '' : `<p class="muted small center">${esc(t('settings.install'))}</p>`}
    <p class="muted small center">Language Trainer v2</p>`;

  bindLearnCard(viewSettings);
  $$('#lang button').forEach((b) => b.addEventListener('click', () => { store.setSettings({ lang: b.dataset.lang }); route(); }));
  $$('#furi button').forEach((b) => b.addEventListener('click', () => {
    store.setSettings({ furigana: b.dataset.v });
    $$('#furi button').forEach((x) => x.classList.toggle('on', x === b));
    document.body.classList.toggle('furi-tap', furiMode() === 'tap');
  }));
  $('#key').addEventListener('change', (e) => { store.setApiKey(e.target.value); toast(t('settings.saved')); });
  $('#showkey').addEventListener('click', (e) => {
    const k = $('#key');
    k.type = k.type === 'password' ? 'text' : 'password';
    e.target.textContent = k.type === 'password' ? t('settings.show') : t('settings.hide');
  });
  bindTest();
  const step = (d) => {
    const n = Math.min(50, Math.max(0, (store.getSettings().newPerDay || 0) + d));
    store.setSettings({ newPerDay: n });
    $('#npd').textContent = n;
  };
  $('#npdminus').addEventListener('click', () => step(-1));
  $('#npdplus').addEventListener('click', () => step(1));
  renderSync();
}

function bindTest() {
  $('#test').addEventListener('click', async () => {
    if ($('#key')) store.setApiKey($('#key').value);
    $('#testres').innerHTML = `<div class="loading">…</div>`;
    try {
      const r = await gemini.testKey();
      if ($('#model')) $('#model').value = r.model;
      $('#testres').innerHTML = `<div class="notice ok">${esc(t('settings.testOk', { m: r.model }))}</div>`;
    } catch (e) { $('#testres').innerHTML = errorBox(e); }
  });
}

// Settings › Advanced: which Gemini model to use.
function viewAdvanced() {
  titleEl.textContent = t('settings.advanced');
  const s = store.getSettings();
  main.innerHTML = `
    <section class="card form">
      <label>${esc(t('settings.model'))}
        <div class="inline"><input id="model" list="models" ${inputAttrs} value="${esc(s.model)}">
        <button class="btn small" id="loadmodels">${esc(t('settings.loadModels'))}</button></div>
        <datalist id="models"></datalist>
      </label>
      <p class="muted small">${esc(t('settings.advancedHelp'))}</p>
      <button class="btn" id="test">${esc(t('settings.test'))}</button>
      <div id="testres"></div>
    </section>`;
  $('#model').addEventListener('change', (e) => { store.setSettings({ model: e.target.value.trim() || 'gemini-flash-latest' }); toast(t('settings.saved')); });
  $('#loadmodels').addEventListener('click', async () => {
    try {
      const names = await gemini.listModels();
      $('#models').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
      $('#testres').innerHTML = `<p class="muted small">${esc(names.join(', '))}</p>`;
    } catch (e) { $('#testres').innerHTML = errorBox(e); }
  });
  bindTest();
}

// Settings › Backup: export, import and deleting everything.
function viewBackup() {
  titleEl.textContent = t('settings.backup');
  main.innerHTML = `
    <section class="card form">
      <p class="muted small">${esc(t(accountSynced() ? 'settings.backupHelpSynced' : 'settings.backupHelp'))}</p>
      <div class="actions">
        <button class="btn" id="export">${esc(t('settings.export'))}</button>
        <label class="btn" for="importfile">${esc(t('settings.import'))}</label>
        <input id="importfile" type="file" accept="application/json,.json" class="hidden">
      </div>
    </section>
    <button class="btn danger" id="reset">${esc(t('settings.reset'))}</button>`;
  $('#export').addEventListener('click', exportBackup);
  $('#importfile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const r = store.importData(await f.text());
      toast(t('settings.imported', { w: r.words, m: r.mistakes }));
    } catch (err) { toast(err.message); }
  });
  $('#reset').addEventListener('click', () => {
    if (confirm(t(accountSynced() ? 'settings.confirmResetSynced' : 'settings.confirmReset'))) { store.resetData(); resetViews(); toast('OK'); }
  });
}

// ---------- Account & sync (part of Settings) ----------
const SIGNED_IN = ['synced', 'syncing', 'offline', 'error'];
const accountSynced = () => SIGNED_IN.includes(sync.getState().status) && !!sync.getState().email;

const AUTH_ERRORS = {
  'auth/invalid-credential': 'credentials', 'auth/invalid-login-credentials': 'credentials',
  'auth/wrong-password': 'credentials', 'auth/user-not-found': 'credentials',
  'auth/email-already-in-use': 'inUse', 'auth/weak-password': 'weak',
  'auth/invalid-email': 'email', 'auth/missing-email': 'email',
  'auth/too-many-requests': 'tooMany', 'auth/network-request-failed': 'network',
};
const syncError = (e) => (AUTH_ERRORS[e.code] ? t(`sync.err.${AUTH_ERRORS[e.code]}`) : e.message || String(e));

function syncStatusLine(st) {
  return `<span class="muted" id="syncstatus">${esc(t(`sync.status.${st.status}`, { n: st.pending, m: st.error }))}</span>`;
}

// Runs a button's action with the button disabled; shows errors under the card.
function syncAction(id, fn) {
  $(`#${id}`)?.addEventListener('click', async (e) => {
    e.preventDefault();
    const btn = e.currentTarget;
    btn.disabled = true;
    $('#syncres').innerHTML = '';
    try { await fn(); } catch (err) { if ($('#syncres')) $('#syncres').innerHTML = errorBox(syncError(err)); }
    finally { btn.disabled = false; }
  });
}

// Which version of the account card a state needs; the card is redrawn when this changes.
let shownSync = '';
const syncShape = (st) => (SIGNED_IN.includes(st.status) && st.email ? `in:${st.email}` : st.status);

function renderSync() {
  const el = $('#synccard');
  if (!el) return;
  const st = sync.getState();
  shownSync = syncShape(st);
  const head = '';
  const res = '<div id="syncres"></div>';
  const signOutBtn = `<button class="btn" id="ssignout">${esc(t('sync.signOut'))}</button>`;
  if (st.status === 'off') {
    el.innerHTML = `${head}<p class="muted small">${esc(t('sync.off'))}</p>`;
  } else if (st.status === 'signedOut') {
    el.innerHTML = `${head}
      <p class="muted small">${esc(t('sync.help'))}</p>
      <label>${esc(t('sync.email'))}<input id="semail" type="email" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <label>${esc(t('sync.password'))}<input id="spass" type="password" autocomplete="current-password"></label>
      <div class="actions">
        <button class="btn primary" id="ssignin">${esc(t('sync.signIn'))}</button>
        <button class="btn" id="ssignup">${esc(t('sync.signUp'))}</button>
      </div>
      <button class="btn link" id="sforgot">${esc(t('sync.forgot'))}</button>
      ${res}`;
    const creds = () => {
      const email = $('#semail').value.trim();
      const pass = $('#spass').value;
      if (!email || !pass) throw new Error(t('sync.needEmail'));
      return [email, pass];
    };
    syncAction('ssignin', () => sync.signIn(...creds()));
    syncAction('ssignup', () => sync.signUp(...creds()));
    syncAction('sforgot', async () => {
      if (!$('#semail').value.trim()) throw new Error(t('sync.needEmail'));
      await sync.resetPassword($('#semail').value);
      $('#syncres').innerHTML = `<div class="notice ok">${esc(t('sync.resetSent'))}</div>`;
    });
  } else if (st.status === 'unverified') {
    el.innerHTML = `${head}
      <p class="small">${esc(t('sync.unverified', { e: st.email }))}</p>
      <div class="actions">
        <button class="btn primary" id="sverified">${esc(t('sync.verified'))}</button>
        <button class="btn" id="sresend">${esc(t('sync.resend'))}</button>
      </div>
      ${signOutBtn}${res}`;
    syncAction('sverified', async () => {
      await sync.recheck();
      if (sync.getState().status === 'unverified') throw new Error(t('sync.stillUnverified'));
    });
    syncAction('sresend', async () => {
      await sync.resendVerification();
      $('#syncres').innerHTML = `<div class="notice ok">${esc(t('sync.resent'))}</div>`;
    });
  } else if (st.status === 'notInvited') {
    el.innerHTML = `${head}
      <div class="notice">${esc(t('sync.notInvited', { e: st.email }))}</div>
      <div class="actions"><button class="btn primary" id="sretry">${esc(t('sync.retry'))}</button>${signOutBtn}</div>
      ${res}`;
    syncAction('sretry', () => sync.recheck());
  } else if (!st.email) {
    // Still connecting, or offline before the account could be loaded.
    el.innerHTML = `${head}<p class="small">${syncStatusLine(st)}</p>`;
  } else {
    el.innerHTML = `${head}
      <p class="small">${esc(t('sync.signedInAs', { e: st.email }))}<br>${syncStatusLine(st)}</p>
      ${signOutBtn}
      <p class="muted small">${esc(t('sync.signOutHelp'))}</p>
      ${res}`;
  }
  syncAction('ssignout', async () => {
    let r = await sync.signOut();
    if (r.pending) {
      if (!confirm(t('sync.confirmPending', { n: r.pending }))) return;
      r = await sync.signOut({ force: true });
    }
    lastLookup = null;
    lastCorrection = null;
  });
}

async function exportBackup() {
  const name = `language-trainer-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([store.exportData()], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- boot ----------
window.addEventListener('hashchange', route);
// Furigana on tap: tapping Japanese text shows its readings, tapping again hides them.
// Word-order pieces are buttons, so they always show theirs.
document.addEventListener('click', (e) => {
  const f = e.target.closest('.furi');
  if (f && document.body.classList.contains('furi-tap') && !e.target.closest('button')) f.classList.toggle('open');
});
window.addEventListener('online', () => { if (!session) route(); });
window.addEventListener('offline', () => { if (!session) route(); });
$('#gear').addEventListener('click', () => go('settings'));
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
sync.onState((st) => {
  // While signed in, a status change only updates its line; anything else redraws the card.
  const line = $('#syncstatus');
  if (line && syncShape(st) === shownSync) line.outerHTML = syncStatusLine(st);
  else renderSync();
});
route();
sync.init();
