import * as store from './store.js';
import { t, lang } from './i18n.js';
import * as gemini from './gemini.js';
import * as sync from './sync.js';
import { logMistakes } from './actions.js';
import { buildSession, summarizeDue } from './session.js';
import { schedule, isNew, dayStart } from './srs.js';
import { compare, compareAny, checkRecall, needsPlural, gapFor, wordDiff, chunksFor, joinChunks, shuffled } from './check.js';
import { categoriesFor, categoryLabel, drillableIds } from './categories.js';
import { catKey, parseCatKey, recLang, lemmaOf, displayName, isSentence } from './languages.js';

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
const readingLine = (w) => (w.reading ? `<div class="reading" ${tl(recLang(w))}>${esc(w.reading)}</div>` : '');
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
    <div class="natural-title">💡 ${esc(t('natural.title'))}</div>
    <div class="sentence" ${tl(c)}>${esc(text)}</div>
    ${reason ? `<div class="muted small">${esc(reason)}</div>` : ''}
    ${saved ? `<div class="saved-note">✓ ${esc(t('natural.inList'))}</div>`
      : `<button type="button" class="btn small" data-natural="${esc(text)}" data-lang="${esc(c)}">＋ ${esc(t('natural.add'))}</button>`}
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
      b.outerHTML = `<div class="saved-note">✓ ${esc(t('natural.saved'))}</div>`;
    } catch (e) {
      b.disabled = false;
      b.textContent = `＋ ${t('natural.add')}`;
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
  words: viewWords, profile: viewProfile, settings: viewSettings };

const routeName = () => (location.hash.replace(/^#\/?/, '') || 'today').split('?')[0];

function route() {
  const name = routeName();
  // Until a language and level are chosen, every page except Settings shows that choice.
  const view = !L()?.level && name !== 'settings' ? viewToday : routes[name] || viewToday;
  $$('#tabs a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === name);
    $('span', a).textContent = t(`tab.${a.dataset.route}`);
  });
  document.documentElement.lang = lang();
  document.body.classList.toggle('in-session', name === 'session');
  main.scrollTop = 0;
  window.scrollTo(0, 0);
  view();
}

function go(name) {
  if (location.hash === `#/${name}`) route(); else location.hash = `#/${name}`;
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
  const doneToday = store.reviews(code()).filter((r) => r.reviewedAt >= today).length;

  main.innerHTML = `
    <section class="card hero">
      <div class="hero-label">${esc(t('today.due'))}</div>
      <div class="hero-num">${s.total}</div>
      <div class="hero-split">
        <span><b>${s.words}</b> ${esc(t('today.words'))}${s.newWords ? ` (${s.newWords} ${esc(t('today.newWords'))})` : ''}</span>
        ${s.sentences ? `<span><b>${s.sentences}</b> ${esc(t('today.sentences'))}</span>` : ''}
        <span><b>${s.grammar}</b> ${esc(t('today.drills'))}</span>
      </div>
      ${s.total ? `<button class="btn primary big" id="start">${esc(t('today.start'))}</button>`
        : `<p class="muted">${esc(t('today.nothing'))}</p>`}
      ${doneToday ? `<p class="muted small">${esc(t('today.doneToday', { n: doneToday }))}</p>` : ''}
    </section>
    ${notes.join('')}
    <p class="muted center small"><a href="#/settings">${esc(langName())} · ${esc(cur.level)}</a> ·
      ${esc(t('today.stats', { w: store.words(code()).length, m: store.mistakes(code()).length }))}</p>
  `;
  $('#start')?.addEventListener('click', () => { session = null; go('session'); });
}

// ---------- Session ----------
let session = null;

function startSession() {
  const tasks = buildSession(sessionArgs());
  for (const task of tasks) {
    if (task.kind === 'drill') {
      const examples = store.mistakes(code()).filter((m) => m.category === task.category).slice(0, 4);
      const words = store.words(code()).filter((w) => !isSentence(w));
      const word = task.drillKind === 'constraint' && words.length ? words[Math.floor(Math.random() * Math.min(words.length, 30))] : null;
      task.drillPromise = gemini.generateDrill(task.category, task.drillKind, { examples, word })
        .then((d) => (task.drill = d))
        .catch((e) => { task.drillError = e; });
    }
  }
  session = { tasks, lang: code(), idx: 0, correct: 0, answered: 0, requeued: new Set(), mistakesLogged: 0 };
}

function viewSession() {
  if (!session) startSession();
  titleEl.textContent = t('today.title');
  const { tasks, idx } = session;
  if (idx >= tasks.length) return renderSessionEnd();
  const task = tasks[idx];
  task.state = { phase: 'answer' };

  main.innerHTML = `
    <div class="progress"><div style="width:${Math.round((idx / tasks.length) * 100)}%"></div></div>
    <div class="session-top">
      <span class="muted small">${esc(t('session.of', { i: idx + 1, n: tasks.length }))}</span>
      <button class="btn link" id="quit">${esc(t('session.quit'))}</button>
    </div>
    <section class="card exercise" id="ex"></section>
  `;
  $('#quit').addEventListener('click', () => { session.idx = session.tasks.length; viewSession(); });
  renderTask(task);
}

function renderSessionEnd() {
  const s = session;
  main.innerHTML = `
    <section class="card hero">
      <div class="hero-num">🎉</div>
      <h2>${esc(t('session.done'))}</h2>
      <p>${esc(t('session.summary', { c: s.correct, n: s.answered }))}</p>
      ${s.mistakesLogged ? `<p class="muted small">${esc(t('session.mistakesLogged', { n: s.mistakesLogged }))}</p>` : ''}
      <button class="btn primary" id="home">${esc(t('session.backHome'))}</button>
    </section>`;
  $('#home').addEventListener('click', () => { session = null; go('today'); });
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
    task.pool = shuffled(task.parts.map((p, i) => ({ p, i })));
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
      <div class="prompt sentence" ${tl()}>${esc(gap.sentence).replace('___', '<span class="gap">___</span>')}</div>
      <div class="muted small">${esc(t('ex.meaning'))}: ${esc(w.meaning)}</div>
      <input class="answer" id="a1" ${inputAttrs} ${tl()} placeholder="${esc(t('ex.yourAnswer'))}">`;
  } else if (task.kind === 'write') {
    body = `
      <div class="ex-label">${esc(t('ex.write'))}</div>
      <div class="prompt" ${tl()}>${esc(wordTitle(w))}</div>${readingLine(w)}
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
      await task.drillPromise;
      if (session?.tasks[session.idx] !== task) return; // user moved on
    }
    if (task.drillError || !task.drill) {
      ex.innerHTML = `${errorBox(task.drillError || t('session.genFailed'))}<p class="muted">${esc(t('session.genFailed'))}</p>
        <div class="actions"><button class="btn primary" id="next">${esc(t('session.next'))}</button></div>`;
      $('#next').addEventListener('click', () => { session.idx++; viewSession(); });
      return;
    }
    const d = task.drill;
    const isGap = task.drillKind === 'gapfill';
    body = `
      <div class="ex-label">${esc(t('ex.drill', { c: categoryLabel(task.category, lang(), cats()) }))}</div>
      <div class="instruction">${esc(d.instruction)}</div>
      ${d.prompt ? `<div class="prompt sentence" ${tl()}>${esc(d.prompt).replace('___', '<span class="gap">___</span>')}</div>` : ''}
      ${isGap ? `<input class="answer" id="a1" ${inputAttrs} ${tl()} placeholder="${esc(t('ex.yourAnswer'))}">`
        : `<textarea class="answer" id="a1" rows="3" ${inputAttrs} ${tl()} placeholder="${esc(t('ex.yourAnswer'))}"></textarea>`}`;
  }

  ex.innerHTML = `${body}
    <div id="feedback"></div>
    <div class="actions">
      <button class="btn" id="skip">${esc(t('session.skip'))}</button>
      <button class="btn primary" id="check">${esc(t('session.check'))}</button>
    </div>`;

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
      ? task.built.map((x, k) => `<button type="button" class="chunk placed" data-k="${k}">${esc(x.p)}</button>`).join('')
      : `<span class="muted small">${esc(t('ex.orderHint'))}</span>`;
    $('#pool').innerHTML = task.pool.map((x, k) =>
      `<button type="button" class="chunk" data-p="${k}" ${used.has(x.i) ? 'disabled' : ''}>${esc(x.p)}</button>`).join('');
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
      html = `<div class="reveal" ${tl()}><b>${esc(task.gap.answer)}</b><div class="sentence">${esc(task.gap.sentence.replace('___', task.gap.answer))}</div></div>`;
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
        html = `<div class="reveal"><b ${tl()}>${esc(d.answer)}</b>${d.prompt ? `<div class="sentence" ${tl()}>${esc(d.prompt.replace('___', d.answer))}</div>` : ''}
          <div class="muted small">${esc(d.explanation)}</div></div>`;
      } else {
        fb.innerHTML = `<div class="loading">${esc(t('session.grading'))}</div>`;
        const r = await gemini.gradeAnswer({ instruction: d.instruction, prompt: d.prompt, model: d.answer, answer: a1, category: task.category });
        mistakes = r.mistakes || [];
        grade = r.correct ? 'correct' : 'wrong';
        html = `<p>${esc(r.feedback)}</p>
          ${mistakes.length ? `<div class="sentence" ${tl()}>${diffHtml(a1, r.correctedText)}</div>${mistakeList(mistakes)}` : ''}
          <div class="reveal"><div class="muted small">${esc(t('session.answer'))}</div><div class="sentence" ${tl()}>${esc(d.answer)}</div>
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
    <div class="sentence" ${tl(recLang(w))}>${esc(lemmaOf(w))}${w.reading ? `<div class="reading">${esc(w.reading)}</div>` : ''}</div>
    ${w.toneNote ? `<div class="muted small">${esc(w.toneNote)}</div>` : ''}</div>`;
}

function wordReveal(w) {
  const forms = w.verbForms || w.forms;
  return `<div class="reveal" ${tl(recLang(w))}>
    <b>${esc(wordTitle(w))}</b>${needsPlural(w) ? ` · ${esc(t('ex.plural'))}: <b>${esc(w.plural)}</b>` : ''}
    ${readingLine(w)}
    ${forms ? `<div class="small">${esc(forms)}</div>` : ''}
    ${w.example ? `<div class="sentence">${esc(w.example)}</div>` : ''}
  </div>`;
}

function showFeedback(task, canOverride) {
  const { grade, feedback, almostKey } = task.state;
  const cls = grade === 'correct' ? 'ok' : grade === 'almost' ? 'almost' : 'bad';
  const label = grade === 'correct' ? t('session.correct') : grade === 'almost' ? t(almostKey || 'session.almost') : t('session.wrong');
  $('#feedback').innerHTML = `<div class="result ${cls}"><div class="result-title">${esc(label)}</div>${feedback}</div>`;
  bindNatural($('#feedback'));
  $$('#ex .chunk').forEach((b) => (b.disabled = true));
  $('#ex .actions').innerHTML = `
    ${canOverride ? `<button class="btn" id="override">${esc(t('session.iWasRight'))}</button>` : ''}
    <button class="btn primary" id="next">${esc(t('session.next'))}</button>`;
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
    const updated = schedule(task.item, grade, now);
    if (task.word) updated.exerciseType = task.kind;
    if (task.kind === 'drill') updated.exerciseType = task.drillKind;
    store.saveReview(updated, {
      reviewItemId: task.item.id, itemType: task.item.itemType, itemId: task.item.itemId,
      lang: session.lang, category: task.category || task.mistake?.category || null, exerciseType: task.drillKind || task.kind,
      answer, correct: grade !== 'wrong', grade, reviewedAt: now,
    });
    task.item = updated;
    session.answered++;
    if (grade !== 'wrong') session.correct++;
    // Locally checked items answered wrong come back once at the end of the session.
    if (grade === 'wrong' && ['recall', 'gap', 'fix', 'order'].includes(task.kind)) {
      session.requeued.add(task);
      session.tasks.push(task);
    }
  }
  session.idx++;
  viewSession();
}

// ---------- Look up ----------
let lastLookup = null;

function viewLookup() {
  titleEl.textContent = t('lookup.title');
  const recent = [...store.words(code())].sort((a, b) => b.addedAt - a.addedAt).slice(0, 12);
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
    : `<input id="q" class="big-input" ${inputAttrs} placeholder="${esc(t('lookup.placeholder', { l: langName() }))}" enterkeyhint="search">
      ${romanized}
      <button type="button" class="btn link small" id="addctx">${esc(t('lookup.addContext'))}</button>
      <textarea id="ctx" rows="2" class="hidden" ${tl()} placeholder="${esc(t('lookup.context'))}"></textarea>
      <button class="btn primary" type="submit">${esc(t('lookup.go'))}</button>`;
  main.innerHTML = `
    <form class="card" id="lf">
      ${seg('mode', [['word', t('lookup.modeWord')], ['sentence', t('lookup.modeSentence')]], mode)}
      ${form}
    </form>
    <div id="lres">${lastLookup ? lookupResult(lastLookup) : ''}</div>
    ${recent.length ? `<h3>${esc(t('lookup.recent'))}</h3>${wordRows(recent)}` : ''}
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
      <div>${readingLine(w)}<div class="word-title" ${tl(c)}>${esc(wordTitle(w))}</div>
      <div class="muted small">${esc(t(`pos.${w.pos || 'other'}`))}${w.plural && w.pos === 'noun' ? ` · ${esc(t('ex.plural'))}: <span ${tl(c)}>${esc(w.plural)}</span>` : ''}</div></div>
      <button class="btn small" data-edit="${esc(w.id)}">✎</button>
    </div>
    ${forms ? `<div class="forms" ${tl(c)}>${esc(forms)}</div>` : ''}
    <div class="meaning">${esc(w.meaning)}</div>
    ${w.register ? `<div class="muted small">${esc(w.register)}</div>` : ''}
    ${w.example ? `<div class="sentence"><span ${tl(c)}>${esc(w.example)}</span><div class="muted small">${esc(w.exampleTranslation)}</div></div>` : ''}
    ${w.contextSentence ? `<div class="sentence ctx" ${tl(c)}>${esc(w.contextSentence)}</div>` : ''}
    <div class="saved-note">✓ ${esc(note)}</div>
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
      <button class="btn small" data-edit="${esc(w.id)}">✎</button>
    </div>
    <div class="sentence-big" ${tl(c)}>${esc(lemmaOf(w))}</div>
    ${readingLine(w)}
    <div class="meaning">${esc(w.meaning)}</div>
    ${w.toneNote ? `<div class="muted small">${esc(w.toneNote)}</div>` : ''}
    ${keyWords ? `<div class="field-label">${esc(t('lookup.keyWords'))}</div><div class="keywords">${keyWords}</div>` : ''}
    <div class="saved-note">✓ ${esc(note)}</div>
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
    const status = !item || isNew(item) ? `<span class="chip new">${esc(t('words.new'))}</span>`
      : `<span class="muted small">${esc(t('words.due', { d: fmtDate(item.due) }))}</span>`;
    if (isSentence(w)) {
      return `<li data-word="${esc(w.id)}"><div class="grow"><div class="ellipsis" ${tl(recLang(w))}>${esc(lemmaOf(w))}</div>
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
      <button class="btn" id="add">＋</button>
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
  draw();
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
    <h2>${esc(id ? t('edit.title') : t('edit.newTitle'))}</h2>
    ${articleSelect ? `<div class="row2">${articleSelect}${lemmaField}</div>` : lemmaField}
    ${Lw.reading ? field('reading', t('edit.reading')) : ''}
    <label>${esc(t('edit.pos'))}<select name="pos">${['noun', 'verb', 'adjective', 'adverb', 'phrase', 'other'].map((p) => `<option value="${p}" ${p === w.pos ? 'selected' : ''}>${esc(t(`pos.${p}`))}</option>`).join('')}</select></label>
    ${field('meaning', t('edit.meaning'), 'input', false)}
    ${de ? `${field('plural', t('edit.plural'))}${field('verbForms', t('edit.verbForms'))}`
      : `${field('forms', t('edit.forms'))}${field('recallAnswer', t('edit.recallAnswer'))}`}
    ${field('register', t('edit.register'), 'input', false)}
    ${field('example', t('edit.example'), 'textarea')}
    ${field('contextSentence', t('edit.context'), 'textarea')}
    ${field('gapSentence', t('edit.gapSentence'), 'textarea')}
    ${field('gapAnswer', t('edit.gapAnswer'))}
    <div class="actions">
      <button type="button" class="btn" data-act="cancel">${esc(t('edit.cancel'))}</button>
      <button type="submit" class="btn primary">${esc(t('edit.save'))}</button>
    </div>
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
    if (id) store.updateWord(id, fd); else store.addWord({ ...fd, lang: Lw.code, source: 'manual' });
    close();
  });
}

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
    <h2>${esc(t('edit.sentenceTitle'))}</h2>
    ${field('lemma', t('edit.sentence'), { area: true })}
    ${Lw.reading ? field('reading', t('edit.reading'), { area: true }) : ''}
    ${field('meaning', t('edit.meaning'), { area: true, target: false })}
    <label>${esc(t('lookup.tone'))}<select name="tone">${gemini.TONES.map((x) =>
      `<option value="${x}" ${x === (w.tone || 'everyday') ? 'selected' : ''}>${esc(toneLabel(x))}</option>`).join('')}</select></label>
    ${field('toneNote', t('edit.toneNote'), { target: false })}
    ${field('gapSentence', t('edit.gapSentence'), { area: true })}
    ${field('gapAnswer', t('edit.gapAnswer'))}
    <div class="actions">
      <button type="button" class="btn" data-act="cancel">${esc(t('edit.cancel'))}</button>
      <button type="submit" class="btn primary">${esc(t('edit.save'))}</button>
    </div>
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

function viewCorrect() {
  titleEl.textContent = t('correct.title');
  const draft = sessionStorage.getItem('gt.draft') || '';
  main.innerHTML = `
    <form class="card" id="cf">
      <textarea id="text" rows="6" spellcheck="false" ${tl()} placeholder="${esc(t('correct.placeholder', { l: langName() }))}">${esc(draft)}</textarea>
      <button class="btn primary" type="submit">${esc(t('correct.go'))}</button>
    </form>
    <div id="cres">${lastCorrection ? correctionResult(lastCorrection) : ''}</div>`;
  $('#text').addEventListener('input', (e) => sessionStorage.setItem('gt.draft', e.target.value));
  $('#cf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#text').value.trim();
    if (!text) return;
    const res = $('#cres');
    res.innerHTML = `<div class="card loading">${esc(t('correct.loading'))}</div>`;
    try {
      const r = await gemini.correctText(text);
      const logged = logMistakes(r.mistakes, 'correction', code());
      lastCorrection = { text, lang: code(), ...r, newWords: logged.words.map(wordTitle) };
      res.innerHTML = correctionResult(lastCorrection);
      bindCopy();
    } catch (err) {
      res.innerHTML = errorBox(err);
    }
  });
  bindCopy();
}

function correctionResult(c) {
  return `<section class="card">
    <div class="word-head"><h3>${esc(t('correct.result'))}</h3><button class="btn small" id="copy">${esc(t('correct.copy'))}</button></div>
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

function viewProfile() {
  titleEl.textContent = t('profile.title');
  const stats = categoryStats().sort((a, b) => b.recent - a.recent || b.total - a.total);
  if (!stats.length) {
    main.innerHTML = `<p class="muted center">${esc(t('profile.empty'))}</p>`;
    return;
  }
  const max = Math.max(...stats.map((s) => s.recent), 1);
  const trendLabel = { improving: `↘ ${t('profile.improving')}`, worse: `↗ ${t('profile.worse')}`, steady: `→ ${t('profile.steady')}` };
  const recentMistakes = store.mistakes(code()).filter((m) => m.source !== 'drill').slice(0, 10);
  main.innerHTML = `
    <section class="card">
      <ul class="cats">${stats.map((s) => `
        <li>
          <div class="cat-head"><b>${esc(lang() === 'en' ? s.en : s.de)}</b><span class="trend ${s.trend}">${esc(trendLabel[s.trend])}</span></div>
          <div class="bar"><div style="width:${Math.round((s.recent / max) * 100)}%"></div></div>
          <div class="muted small">${s.recent} · ${esc(t('profile.last14'))} &nbsp;|&nbsp; ${s.total} ${esc(t('profile.total'))}
            ${s.drills ? ` &nbsp;|&nbsp; ${esc(t('profile.drills'))}: ${esc(t('profile.accuracy', { p: Math.round(s.acc * 100) }))}` : ''}</div>
        </li>`).join('')}</ul>
    </section>
    ${recentMistakes.length ? `<h3>${esc(t('profile.recent'))}</h3><section class="card">${mistakeList(recentMistakes)}</section>` : ''}`;
}

// ---------- Settings ----------
function viewSettings() {
  titleEl.textContent = t('settings.title');
  const s = store.getSettings();
  main.innerHTML = `
    <section class="card form" id="learncard">
      ${learnCard()}
      <p class="muted small">${esc(t('settings.learningHelp'))}</p>
    </section>
    <section class="card form">
      <label>${esc(t('settings.language'))}
        <div class="seg" id="lang">
          <button data-lang="de" class="${s.lang !== 'en' ? 'on' : ''}">Deutsch</button>
          <button data-lang="en" class="${s.lang === 'en' ? 'on' : ''}">English</button>
        </div>
      </label>
    </section>
    <section class="card form" id="synccard"></section>
    <section class="card form">
      <label>${esc(t('settings.apiKey'))}
        <div class="inline"><input id="key" type="password" ${inputAttrs} value="${esc(store.getApiKey())}" placeholder="AIza…">
        <button class="btn small" id="showkey">${esc(t('settings.show'))}</button></div>
      </label>
      <p class="muted small">${esc(t('settings.apiKeyHelp'))} <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></p>
      <label>${esc(t('settings.model'))}
        <div class="inline"><input id="model" list="models" ${inputAttrs} value="${esc(s.model)}">
        <button class="btn small" id="loadmodels">${esc(t('settings.loadModels'))}</button></div>
        <datalist id="models"></datalist>
      </label>
      <button class="btn" id="test">${esc(t('settings.test'))}</button>
      <div id="testres"></div>
    </section>
    <section class="card form">
      <label>${esc(t('settings.newPerDay'))}<input id="npd" type="number" min="0" max="50" inputmode="numeric" value="${esc(s.newPerDay)}"></label>
    </section>
    <section class="card form">
      <b>${esc(t('settings.backup'))}</b>
      <p class="muted small" id="backuphelp"></p>
      <div class="actions left">
        <button class="btn" id="export">${esc(t('settings.export'))}</button>
        <label class="btn" for="importfile">${esc(t('settings.import'))}</label>
        <input id="importfile" type="file" accept="application/json,.json" class="hidden">
      </div>
      <button class="btn danger wide" id="reset">${esc(t('settings.reset'))}</button>
    </section>
    <p class="muted small center">${esc(t('settings.install'))}</p>
    <p class="muted small center">Language Trainer v2</p>`;

  bindLearnCard(viewSettings);
  $$('#lang button').forEach((b) => b.addEventListener('click', () => { store.setSettings({ lang: b.dataset.lang }); route(); }));
  $('#key').addEventListener('change', (e) => { store.setApiKey(e.target.value); toast(t('settings.saved')); });
  $('#showkey').addEventListener('click', (e) => {
    const k = $('#key');
    k.type = k.type === 'password' ? 'text' : 'password';
    e.target.textContent = k.type === 'password' ? t('settings.show') : t('settings.hide');
  });
  $('#model').addEventListener('change', (e) => { store.setSettings({ model: e.target.value.trim() || 'gemini-flash-latest' }); toast(t('settings.saved')); });
  $('#loadmodels').addEventListener('click', async () => {
    store.setApiKey($('#key').value);
    try {
      const names = await gemini.listModels();
      $('#models').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
      $('#testres').innerHTML = `<p class="muted small">${esc(names.join(', '))}</p>`;
    } catch (e) { $('#testres').innerHTML = errorBox(e); }
  });
  $('#test').addEventListener('click', async () => {
    store.setApiKey($('#key').value);
    $('#testres').innerHTML = `<div class="loading">…</div>`;
    try {
      const r = await gemini.testKey();
      $('#model').value = r.model;
      $('#testres').innerHTML = `<div class="notice ok">${esc(t('settings.testOk', { m: r.model }))}</div>`;
    } catch (e) { $('#testres').innerHTML = errorBox(e); }
  });
  renderSync();
  $('#npd').addEventListener('change', (e) => store.setSettings({ newPerDay: Math.max(0, parseInt(e.target.value, 10) || 0) }));
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
  $('#backuphelp').textContent = t(accountSynced() ? 'settings.backupHelpSynced' : 'settings.backupHelp');
  const head = `<b>${esc(t('sync.title'))}</b>`;
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
window.addEventListener('online', () => { if (!session) route(); });
window.addEventListener('offline', () => { if (!session) route(); });
$('#gear').addEventListener('click', () => go('settings'));
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
