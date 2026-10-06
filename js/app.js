import * as store from './store.js';
import { t, lang } from './i18n.js';
import * as gemini from './gemini.js';
import * as sync from './sync.js';
import { logMistakes } from './actions.js';
import { buildSession, summarizeDue, practicePool, nextPracticeTask, PRACTICE_FOCUS, ruleTask } from './session.js';
import { schedule, schedulePractice, isNew, dayStart } from './srs.js';
import { compare, compareAny, compareExact, compareAnyExact, checkRecall, joinArticle, needsPlural, gapFor, wordDiff, chunksFor, joinChunks, shuffled } from './check.js';
import { categoriesFor, categoryLabel, drillableIds, isCurated, migrateCategory } from './categories.js';
import { nextExercise, kindOf, addSet, useExercise, afterAnswer, topUpList, status as ruleStatus, ruleItemId, KINDS } from './rules.js';
import { catKey, parseCatKey, recLang, lemmaOf, displayName, isSentence, examplesToText, examplesFromText } from './languages.js';
import { icon } from './icons.js';
import { pickGap, afterGap, poolOf, addToPool, poolFromLookup, replaceInPool, refillList, gapLevel } from './gappool.js';
import { segmentsFor, cutChunks, toHtml, missing, strip, poolTexts } from './furigana.js';
import { main, titleEl, esc, $, $$, toast, errorBox, inputAttrs, pref, setPref } from './ui/dom.js';
import { gem, L, code, langName, cats, noGemini, sessionArgs, ui, resetViews, forgetWord, forgetResults } from './ui/context.js';
import { tl, furiMode, jt, furiShown, readingLine, toneLabel, fmtDate, fmtPast, diffHtml, mistakeList, correctionHtml, naturalBlock, bindNatural } from './ui/text.js';
import { wordTitle } from './languages.js';
import { fillFurigana, latestItem, generateRuleSets, topUpRules, classifyOldMistakes, refillGaps } from './background.js';
import { categoryStats, byRecent, writingMistakes } from './stats.js';
import { ruleCompare, transformGrade, strictGrade, isExact, ownMistake, followUpIds, answerRecord, requeueAt } from './answer.js';
import { registerRoutes, route, routeName, go } from './router.js';
import { mountSheet, openSheet, sheetHead, moreFields } from './ui/sheet.js';

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
    ${cur && !isCurated(cur.code) ? `<p class="muted small gen-note">${esc(t('profile.generatedNote', { l: langName(cur) }))}</p>` : ''}
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

// ---------- Language sheet (from the pill) ----------
function openLangSheet() {
  const { el: back, close } = mountSheet(`<div class="sheet form">
    <div class="sheet-head"><h2>${esc(t('settings.langSheet'))}</h2>
      <button type="button" class="icon-btn" data-act="close" aria-label="${esc(t('edit.close'))}">${icon('close', 22)}</button></div>
    ${learnCard()}
    <p class="muted small">${esc(t('settings.learningHelp'))}</p>
  </div>`);
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

// ---------- Session ----------
// Starts generating a drill as soon as its task is queued, so it is ready when it comes up.
function prepare(task) {
  if (task.kind === 'rule') return prepareRule(task);
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
  ui.session = { tasks, lang: code(), idx: 0, correct: 0, answered: 0, requeued: new Set(), mistakesLogged: 0, followed: new Set() };
  if (code() === 'ja') fillFurigana(tasks.map((x) => x.word).filter(Boolean));
  refillGaps();
  topUpRules();
  classifyOldMistakes();
}

// A rule task takes the exercise for the rule's rung from its pool, or has one generated.
function prepareRule(task) {
  task.item = latestItem(task.item);
  const ready = nextExercise(task.item);
  if (ready) {
    task.ruleKind = ready.kind;
    task.ex = ready.ex;
    return;
  }
  task.ruleKind = kindOf(task.item);
  task.exPromise = generateRuleSets([task.item])
    .then(() => {
      task.item = latestItem(task.item);
      const r = nextExercise(task.item);
      if (!r) throw new Error(t('session.genFailed'));
      task.ruleKind = r.kind;
      task.ex = r.ex;
    })
    .catch((e) => { task.exError = e; });
}

// A rule the learner just broke in their own writing comes up a few tasks later, once.
function followUp(mistakes) {
  const s = ui.session;
  if (!s || !gem()) return;
  for (const id of followUpIds(mistakes, s)) {
    const item = store.reviewItems().find((r) => r.id === id);
    if (!item) continue;
    s.followed.add(id);
    const task = ruleTask(item);
    prepare(task);
    s.tasks.splice(Math.min(s.idx + 3, s.tasks.length), 0, task);
  }
}

// Practice never runs out: it keeps a few tasks queued ahead of the current one.
const PRACTICE_AHEAD = 3;

function startPractice(focus) {
  ui.session = { practice: true, focus, tasks: [], lang: code(), idx: 0, correct: 0, answered: 0, requeued: new Set(), mistakesLogged: 0, followed: new Set() };
  topUpPractice();
  refillGaps();
  topUpRules();
  classifyOldMistakes();
}

function topUpPractice() {
  const s = ui.session;
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
  if (!ui.session) startSession();
  if (ui.session.practice) topUpPractice();
  titleEl.textContent = t(ui.session.practice ? 'practice.title' : 'today.title');
  const { tasks, idx } = ui.session;
  if (ui.session.ended || idx >= tasks.length) return renderSessionEnd();
  const task = tasks[idx];
  task.state = { phase: 'answer' };

  // Practice has no end to show progress towards: it counts answers and right ones instead.
  const top = ui.session.practice
    ? `<div class="grow"></div>
      <span class="count" aria-label="${esc(t('practice.score', { c: ui.session.correct, n: ui.session.answered }))}">✓ ${ui.session.correct}/${ui.session.answered}</span>`
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
  $('#quit').addEventListener('click', () => { ui.session.ended = true; viewSession(); });
  renderTask(task);
}

function renderSessionEnd() {
  const s = ui.session;
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
  $('#home').addEventListener('click', () => { ui.session = null; go('today'); });
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
      <div class="muted small">${esc(t(`pos.${w.pos || 'other'}`))}${styleNote(w)}</div>
      ${recallBoxes(w)}`;
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
    // A word's sentence comes from its pool; a task shown again in the same session keeps it.
    const gap = task.gap || (isSentence(w) ? gapFor(w) : pickGap(store.getWord(w.id) || w, task.item.reps || 0));
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
  } else if (task.kind === 'rule') {
    if (!task.ex && !task.exError) {
      ex.innerHTML = `<div class="loading">${esc(t('session.loading'))}</div>`;
      $('#dock').innerHTML = '';
      await task.exPromise;
      if (ui.session?.tasks[ui.session.idx] !== task) return; // user moved on
    }
    if (task.exError || !task.ex) {
      ex.innerHTML = `${errorBox(task.exError || t('session.genFailed'))}<p class="muted">${esc(t('session.genFailed'))}</p>`;
      $('#dock').innerHTML = `<button class="btn primary" id="next">${esc(t('session.next'))}</button>`;
      $('#next').addEventListener('click', () => { ui.session.idx++; viewSession(); });
      return;
    }
    body = ruleBody(task);
  } else if (task.kind === 'drill') {
    if (!task.drill && !task.drillError) {
      ex.innerHTML = `<div class="loading">${esc(t('session.loading'))}</div>`;
      $('#dock').innerHTML = '';
      await task.drillPromise;
      if (ui.session?.tasks[ui.session.idx] !== task) return; // user moved on
    }
    if (task.drillError || !task.drill) {
      ex.innerHTML = `${errorBox(task.drillError || t('session.genFailed'))}<p class="muted">${esc(t('session.genFailed'))}</p>`;
      $('#dock').innerHTML = `<button class="btn primary" id="next">${esc(t('session.next'))}</button>`;
      $('#next').addEventListener('click', () => { ui.session.idx++; viewSession(); });
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

  $('#ex input.answer, #ex textarea.answer')?.focus({ preventScroll: true });
  if (task.kind === 'order') bindOrder(task);
  if (task.ruleKind === 'pair' && task.kind === 'rule') {
    // Picking a sentence is the answer.
    $('#check').style.display = 'none';
    $$('#ex .choice').forEach((b) => b.addEventListener('click', () => {
      if (task.state.phase !== 'answer') return;
      $('#a1').value = b.dataset.v;
      $$('#ex .choice').forEach((x) => x.classList.toggle('picked', x === b));
      onCheck(task);
    }));
  }
  $('#check')?.addEventListener('click', () => onCheck(task));
  $('#skip').addEventListener('click', () => { ui.session.idx++; viewSession(); });
  $$('input.answer', ex).forEach((el) => el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Enter moves on to the next empty box, and checks from the last one.
    const boxes = $$('input.answer', ex);
    const empty = boxes.slice(boxes.indexOf(el) + 1).find((x) => !x.value.trim());
    if (task.state.phase === 'answer' && empty) empty.focus();
    else (task.state.phase === 'answer' ? onCheck(task) : next(task));
  }));
}

// The exercise for a rule at its rung. Every rung shows which rule is being practised.
function ruleBody(task) {
  const { rule, ex: e } = task;
  const head = `<div class="ex-label">${esc(t('ex.rule', { c: categoryLabel(rule.category, lang(), cats()) }))} · ${esc(t('rule.rung', { n: task.item.rung || 2 }))}</div>
    <div class="rule-name">${esc(rule.name)}</div>`;
  switch (task.ruleKind) {
    case 'pair': {
      task.order ||= Math.random() < 0.5 ? [e.correct, e.wrong] : [e.wrong, e.correct];
      return `${head}<div class="instruction">${esc(t('ex.pair'))}</div>
        <div class="choices">${task.order.map((x) => `<button type="button" class="choice" data-v="${esc(x)}" ${tl()}>${jt(x, e)}</button>`).join('')}</div>
        <input type="hidden" id="a1">`;
    }
    case 'gap':
      return `${head}<div class="instruction">${esc(t('ex.ruleGap'))}</div>
        <div class="prompt sentence" ${tl()}>${jt(e.sentence, e).replace('___', '<span class="gap">___</span>')}</div>
        <input class="answer" id="a1" ${inputAttrs} ${tl()} placeholder="${esc(t('ex.yourAnswer'))}">`;
    case 'transform':
      return `${head}<div class="instruction">${esc(e.instruction)}</div>
        ${e.items.map((x, i) => `<div class="tf-item"><div class="sentence" ${tl()}>${jt(x.prompt, e)}</div>
          <input class="answer" id="${i ? `t${i}` : 'a1'}" ${inputAttrs} ${tl()} placeholder="${esc(t('ex.yourAnswer'))}"></div>`).join('')}`;
    case 'spot':
      return `${head}<div class="instruction">${esc(t('ex.spot'))}</div>
        <textarea class="answer" id="a1" rows="5" ${inputAttrs} ${tl()}>${esc(e.text)}</textarea>`;
    default:
      return `${head}<div class="instruction">${esc(e.instruction)}</div>
        <textarea class="answer" id="a1" rows="3" ${inputAttrs} ${tl()} placeholder="${esc(t('ex.yourAnswer'))}"></textarea>`;
  }
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

// The register note, except "neutral", which next to "Nomen" reads like a grammatical gender.
function styleNote(w) {
  const r = (w.register || '').trim();
  return r && !/^neutral\b/i.test(r) ? ` · ${esc(t('edit.register'))}: ${esc(r)}` : '';
}

// German nouns get labelled boxes for the article, the word and the plural. The labels stay
// visible while typing, unlike placeholders.
function recallBoxes(w) {
  const input = (id, hint) => `<input class="answer" id="${id}" ${inputAttrs} ${tl()} placeholder="${esc(hint)}">`;
  if (w.pos !== 'noun' || recLang(w) !== 'de' || !w.article) return input('a1', recallHint(w));
  const box = (label, html) => `<label class="answer-field"><span class="field-label">${esc(label)}</span>${html}</label>`;
  return `<div class="row2">${box(t('edit.article'), input('art', 'der/die/das'))}${box(t('ex.word'), input('a1', t('ex.word')))}</div>`
    + (needsPlural(w) ? box(t('ex.plural'), input('a2', t('ex.plural'))) : '');
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
  const a1 = $('#art') ? joinArticle($('#art').value, $('#a1').value) : $('#a1').value;
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
          ${correctionHtml(a1, r.correctedText, mistakes)}
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
      html = `<div class="reveal" ${tl()}><b>${esc(task.gap.answer)}</b><div class="sentence">${jt(task.gap.sentence.replace('___', task.gap.answer), task.word)}</div>
        ${task.gap.translation ? `<div class="muted small" lang="en">${esc(task.gap.translation)}</div>` : ''}</div>`;
    } else if (task.kind === 'rule') {
      ({ grade, html, canOverride, mistakes } = await checkRule(task, a1, fb));
    } else if (task.kind === 'write') {
      fb.innerHTML = `<div class="loading">${esc(t('session.grading'))}</div>`;
      const r = await gemini.gradeWordSentence(task.word, a1);
      mistakes = r.mistakes || [];
      grade = r.usesWordCorrectly && !mistakes.length ? 'correct' : 'wrong';
      // The learner's own sentence, corrected, becomes one of the word's gap sentences.
      if (r.usesWordCorrectly && r.gapSentence) {
        const w = store.getWord(task.word.id);
        if (w) store.updateWord(w.id, { gapPool: addToPool(poolOf(w), [{ sentence: r.gapSentence, answer: r.gapAnswer }],
          { level: gapLevel(task.item.reps || 0), source: 'own' }) });
      }
      html = `<p>${esc(r.feedback)}</p>${correctionHtml(a1, r.correctedText, mistakes)}
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
          ${correctionHtml(a1, r.correctedText, mistakes)}
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
    const own = (m) => ownMistake(task, m);
    const logged = [
      ...logMistakes(mistakes.filter((m) => !own(m)), 'exercise', ui.session.lang).mistakes,
      ...logMistakes(mistakes.filter(own), 'drill', ui.session.lang).mistakes,
    ];
    ui.session.mistakesLogged += logged.filter((m) => m.source !== 'drill').length;
    followUp(logged);
  }

  task.state = { phase: 'feedback', grade, almostKey, answer: a1 + (a2 ? ` / ${a2}` : ''), feedback: html };
  showFeedback(task, canOverride);
}

// Checks a rule exercise. Choices, gaps and transformations are checked here; a corrected
// text that differs from the model and a free sentence go to Gemini.
async function checkRule(task, a1, fb) {
  const { rule, ex: e } = task;
  const why = (x) => (x ? `<div class="muted small">${esc(x)}</div>` : '');
  const ruleLine = rule.statement ? `<div class="tip"><b>${esc(rule.name)}</b> ${esc(rule.statement)}</div>` : '';
  let grade = 'wrong', html = '', canOverride = false, mistakes = [];
  if (task.ruleKind === 'pair') {
    grade = a1 === e.correct ? 'correct' : 'wrong';
    html = `<div class="reveal"><div class="sentence" ${tl()}>${jt(e.correct, e)}</div>${why(e.explanation)}</div>`;
  } else if (task.ruleKind === 'gap') {
    grade = ruleCompare(rule, a1, [e.answer, ...(e.acceptable || [])]);
    canOverride = grade !== 'correct';
    html = `<div class="reveal"><b ${tl()}>${esc(e.answer)}</b><div class="sentence" ${tl()}>${jt(e.sentence.replace('___', e.answer), e)}</div>${why(e.explanation)}</div>`;
  } else if (task.ruleKind === 'transform') {
    const answers = e.items.map((_, i) => $(i ? `#t${i}` : '#a1').value);
    const grades = e.items.map((x, i) => ruleCompare(rule, answers[i], [x.answer, ...(x.acceptable || [])]));
    grade = transformGrade(grades);
    canOverride = grade !== 'correct';
    task.answerText = answers.join(' / ');
    html = `<div class="reveal">${e.items.map((x, i) => `<div class="tf-result ${grades[i] === 'correct' ? 'ok' : 'bad'}">
      ${grades[i] === 'correct' ? icon('check', 16) : icon('close', 16)} <span ${tl()}>${jt(x.answer, e)}</span></div>`).join('')}${why(e.explanation)}</div>`;
  } else if (task.ruleKind === 'spot') {
    grade = isExact(rule) ? compareExact(a1, e.corrected) : compare(a1, e.corrected);
    if (grade !== 'correct' && gem()) {
      fb.innerHTML = `<div class="loading">${esc(t('session.grading'))}</div>`;
      const r = await gemini.gradeAnswer({ instruction: 'Find and correct the mistakes against the rule in this text. Change nothing else.',
        prompt: e.text, model: e.corrected, answer: a1, category: rule.category, rule });
      grade = r.correct ? 'correct' : 'wrong';
      html = `<p>${esc(r.feedback)}</p>`;
    }
    canOverride = grade !== 'correct' && !gem();
    html += `<div class="reveal"><div class="sentence" ${tl()}>${diffHtml(e.text, e.corrected)}</div>${why(e.explanation)}</div>`;
  } else {
    fb.innerHTML = `<div class="loading">${esc(t('session.grading'))}</div>`;
    const r = await gemini.gradeAnswer({ instruction: e.instruction, prompt: '', model: e.model, answer: a1, category: rule.category, rule });
    mistakes = r.mistakes || [];
    grade = r.correct ? 'correct' : 'wrong';
    html = `<p>${esc(r.feedback)}</p>
      ${correctionHtml(a1, r.correctedText, mistakes)}
      <div class="reveal"><div class="muted small">${esc(t('session.answer'))}</div><div class="sentence" ${tl()}>${jt(e.model, e)}</div>${why(e.explanation)}</div>`;
  }
  grade = strictGrade(rule, grade);
  return { grade, html: html + (grade === 'correct' ? '' : ruleLine), canOverride, mistakes };
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
  const firstTry = !ui.session.requeued.has(task);
  if (firstTry) {
    const now = Date.now();
    // The latest copy: in practice the same item can come up again before an earlier answer was saved.
    task.item = latestItem(task.item);
    const { saved, review } = answerRecord(task, task.item, { grade, answer, practice: ui.session.practice, lang: ui.session.lang, now });
    store.saveReview(saved, review);
    task.item = saved;
    // Right: that sentence is retired. Wrong: it comes back at the word's next gap fill.
    if (task.kind === 'gap' && !isSentence(task.word) && task.gap) {
      const w = store.getWord(task.word.id);
      if (w) store.updateWord(w.id, afterGap(w, task.gap.sentence, grade, now));
    }
    ui.session.answered++;
    if (grade !== 'wrong') ui.session.correct++;
    const at = requeueAt(task, grade, { practice: ui.session.practice, idx: ui.session.idx, length: ui.session.tasks.length });
    if (at >= 0) {
      ui.session.requeued.add(task);
      ui.session.tasks.splice(at, 0, task);
    }
  }
  ui.session.idx++;
  viewSession();
}

// ---------- Look up ----------
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
    <div id="lres">${ui.lastLookup ? lookupResult(ui.lastLookup) : ''}</div>
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
  if (ui.lastLookup && store.getWord(ui.lastLookup.word.id)) {
    fillFurigana([store.getWord(ui.lastLookup.word.id)], () => {
      const res = $('#lres');
      if (!res || !ui.lastLookup) return;
      res.innerHTML = lookupResult(ui.lastLookup);
      bindWordCard(res);
    });
  }
}

// Saves a lookup. Its gap sentences start the word's pool, or join the pool of a word saved before.
function saveLookup(r, extra) {
  const { found, moreGaps, ...fields } = r;
  const seed = poolFromLookup(r, !!extra.contextSentence);
  const res = store.addWord({ ...fields, ...extra, gapPool: seed });
  if (!res.created && seed.length) store.updateWord(res.word.id, { gapPool: addToPool(poolOf(res.word), seed) });
  return res;
}

async function lookupWord(q, ctx) {
  const res = $('#lres');
  if (!gem()) {
    const local = store.findWord(q, code(), L()?.articles)
      || store.words(code()).find((w) => w.reading === q || w.meaning.toLowerCase().includes(q.toLowerCase()));
    if (local) { ui.lastLookup = { word: local, note: t('lookup.offlineHit') }; res.innerHTML = lookupResult(ui.lastLookup); bindWordCard(res); }
    else res.innerHTML = errorBox(noGemini());
    return;
  }
  res.innerHTML = `<div class="card loading">${esc(t('lookup.loading'))}</div>`;
  try {
    const r = await gemini.lookup(q, ctx);
    if (!r.found || !r.lemma) { res.innerHTML = `<div class="notice">${esc(t('lookup.notFound'))}</div>`; return; }
    const { word, created } = saveLookup(r, { lang: code(), contextSentence: ctx, source: 'lookup' });
    ui.lastLookup = { word, note: created ? t('lookup.saved') : t('lookup.already') };
    viewLookup();
  } catch (err) {
    res.innerHTML = errorBox(err);
  }
}

async function translate(q, tone) {
  const res = $('#lres');
  if (!gem()) { res.innerHTML = errorBox(noGemini()); return; }
  res.innerHTML = `<div class="card loading">${esc(t('lookup.translating'))}</div>`;
  try {
    const r = await gemini.translateSentence(q, tone);
    if (!r.sentence) { res.innerHTML = `<div class="notice">${esc(t('lookup.notTranslated'))}</div>`; return; }
    const { word, created } = store.addSentence({ ...r, query: q }, code());
    ui.lastLookup = { word, note: created ? t('lookup.sentenceSaved') : t('lookup.sentenceAlready') };
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
    if (!gem()) { toast(noGemini()); return; }
    b.disabled = true;
    try {
      const r = await gemini.lookup(b.dataset.kw, lemmaOf(sentence));
      if (!r.found || !r.lemma) throw new Error(t('lookup.notFound'));
      saveLookup(r, { lang: recLang(sentence), contextSentence: lemmaOf(sentence), source: 'sentence' });
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

function viewWords() {
  titleEl.textContent = t('words.title');
  const all = store.words(code());
  let show = pref('wordFilter', 'all');
  main.innerHTML = `
    <div class="toolbar">
      <input id="search" type="search" ${inputAttrs} placeholder="${esc(t('words.search'))}" value="${esc(ui.wordQuery)}">
      ${gem() ? `<button class="btn" data-suggest aria-label="${esc(t('suggest.open'))}">${icon('sparkle', 22)}</button>` : ''}
      <button class="btn" id="add" aria-label="${esc(t('words.add'))}">${icon('plus', 22)}</button>
    </div>
    ${all.some(isSentence) ? `<div class="seg" id="wfilter">${['all', 'words', 'sentences'].map((f) =>
      `<button type="button" data-v="${f}" class="${f === show ? 'on' : ''}">${esc(t(`words.filter.${f}`))}</button>`).join('')}</div>` : ''}
    <div id="wlist"></div>`;
  const draw = () => {
    const q = ui.wordQuery.toLowerCase();
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
  $('#search').addEventListener('input', (e) => { ui.wordQuery = e.target.value; draw(); });
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
  openSheet(`
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
    ${id ? `<button type="button" class="btn danger wide" data-act="delete">${esc(t('edit.delete'))}</button>` : ''}`, {
    onSave: (fd) => {
      if (!fd.lemma.trim()) return false;
      fd.moreExamples = examplesFromText(fd.moreExamples);
      if (id && !isSentence(w) && 'gapSentence' in fd && (fd.gapSentence !== (w.gapSentence || '') || fd.gapAnswer !== (w.gapAnswer || ''))) {
        fd.gapPool = replaceInPool(poolOf(w), w.gapSentence, { sentence: fd.gapSentence, answer: fd.gapAnswer });
        fd.gapCurrent = null;
      }
      if (id) store.updateWord(id, fd); else store.addWord({ ...fd, lang: Lw.code, source: 'manual' });
    },
    onDelete: () => {
      if (!confirm(t('edit.confirmDelete', { w: wordTitle(w) }))) return false;
      store.deleteWord(id);
      forgetWord(id);
      return true;
    },
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
      forgetWord(w.id);
      return true;
    },
  });
}

// ---------- Correct ----------
function viewCorrect() {
  titleEl.textContent = t('correct.title');
  const draft = sessionStorage.getItem('gt.draft') || '';
  const collapsed = ui.lastCorrection && !ui.correctOpen;
  main.innerHTML = `
    ${collapsed ? `<section class="card draft-row" id="reopen">
        <div class="grow"><div class="muted small">${esc(t('correct.yourText'))}</div><div class="ellipsis" ${tl(ui.lastCorrection.lang)}>${esc(ui.lastCorrection.text)}</div></div>
        ${icon('down', 18)}
      </section>` : ''}
    <form class="card ${collapsed ? 'hidden' : ''}" id="cf">
      <textarea id="text" rows="6" spellcheck="false" ${tl()} placeholder="${esc(t('correct.placeholder', { l: langName() }))}">${esc(draft)}</textarea>
      <button class="btn primary" type="submit">${esc(t('correct.go'))}</button>
    </form>
    <div id="cres">${ui.lastCorrection ? correctionResult(ui.lastCorrection) : ''}</div>
    ${ui.lastCorrection ? `<button class="btn" id="newtext">${icon('plus', 18)} ${esc(t('correct.newText'))}</button>` : ''}`;
  $('#reopen')?.addEventListener('click', () => { ui.correctOpen = true; viewCorrect(); $('#text').focus(); });
  $('#newtext')?.addEventListener('click', () => {
    sessionStorage.removeItem('gt.draft');
    ui.lastCorrection = null;
    ui.correctOpen = false;
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
      ui.lastCorrection = { text, lang: code(), ...r, newWords: logged.words.map(wordTitle) };
      ui.correctOpen = false;
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
    try { await navigator.clipboard.writeText(ui.lastCorrection.correctedText); toast(t('correct.copied')); } catch { /* ignore */ }
  });
}

// ---------- Profile ----------
const sortedStats = () => categoryStats({ mistakes: store.mistakes(code()), reviews: store.reviews(code()), cats: cats(), lang: code() }).sort(byRecent);

// withRules: list each category's rules under it (the full profile; Today shows only the top).
function catList(stats, { withRules = false } = {}) {
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

function viewProfile() {
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
    forgetResults();
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
