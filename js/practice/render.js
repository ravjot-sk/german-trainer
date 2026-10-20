// The session screen: one exercise at a time, its answer boxes, checking and feedback.
import * as store from '../store.js';
import { t, lang } from '../i18n.js';
import { joinArticle, needsPlural, gapFor, chunksFor, joinChunks, shuffled } from '../check.js';
import { categoryLabel } from '../categories.js';
import { ruleText } from '../rules.js';
import { recLang, lemmaOf, isSentence, wordTitle } from '../languages.js';
import { icon } from '../icons.js';
import { practicePool, newInPool } from '../session.js';
import { segmentsFor, cutChunks, toHtml } from '../furigana.js';
import { html, raw, setHtml, main, titleEl, $, $$, errorBox, waitBox, inputAttrs } from '../ui/dom.js';
import { gem, code, langName, cats, sessionArgs, ui } from '../ui/context.js';
import { tl, furiMode, jt, gapped, marked, readingLine, toneLabel, bindNatural } from '../ui/text.js';
import { go } from '../router.js';
import { logTaskMistakes, topUpPractice, advance, nextRound, retryPrepare, waitTag, saveSession, clearSession, resumeSession } from './runtime.js';
import { promote, isCancel } from '../gemini.js';
import { gradeTask } from './grade.js';
import { revealFor } from './feedback.js';
import { englishButton, bindEnglish } from './english.js';
import { pickGap, poolOf, addToPool, gapLevel } from '../gappool.js';
import { bindSuggest } from '../ui/suggest.js';
import { openReport } from '../ui/report.js';
import { confirmSheet } from '../ui/sheet.js';

export function viewSession() {
  // Opened without a session (the app was restarted): carry on with today's, else go home.
  if (!ui.session && !resumeSession()) return go('today');
  if (ui.session.practice) topUpPractice();
  titleEl.textContent = t(ui.session.practice ? 'practice.title' : 'today.title');
  const { tasks, idx } = ui.session;
  if (ui.session.ended || (!ui.session.practice && idx >= tasks.length)) clearSession(); else saveSession();
  if (ui.session.ended || idx >= tasks.length) return renderSessionEnd();
  const task = tasks[idx];
  task.state = { phase: 'answer' };

  // Practice has no end to show progress towards: it counts answers and right ones instead.
  const top = ui.session.practice
    ? html`<div class="grow"></div>
      <span class="count" aria-label="${t('practice.score', { c: ui.session.correct, n: ui.session.answered })}">✓ ${ui.session.correct}/${ui.session.answered}</span>`
    : html`<div class="progress"><div style="width:${Math.round((idx / tasks.length) * 100)}%"></div></div>
      <span class="count" aria-label="${t('session.of', { i: idx + 1, n: tasks.length })}">${idx + 1}/${tasks.length}</span>`;
  setHtml(main, html`
    <div class="session-top">
      <button class="icon-btn" id="quit" aria-label="${t('session.quit')}">${icon('close', 24)}</button>
      ${top}
      <button class="icon-btn report" id="sessreport" aria-label="${t('report.title')}">${icon('bug', 22)}</button>
    </div>
    <section class="card exercise" id="ex"></section>
    <div class="dock" id="dock"></div>
  `);
  // The header (with its report icon) is hidden during a session, so the session has its own.
  $('#sessreport').addEventListener('click', openReport);
  $('#quit').addEventListener('click', async () => {
    // A daily session asks first; practice has no end, so its X is how it ends.
    if (!ui.session.practice && !(await confirmSheet(t('session.confirmQuit'), { ok: t('session.quit') }))) return;
    if (task.state.phase === 'feedback') commit(task);
    ui.session.ended = true;
    viewSession();
  });
  renderTask(task);
}

function renderSessionEnd() {
  const s = ui.session;
  // Practice stops by itself when there is nothing saved to practise, and pauses after each
  // round (everything once) to offer new words.
  const empty = s.practice && !s.tasks.length;
  if (s.practice && !empty && !s.ended) return renderRoundEnd();
  setHtml(main, html`
    <section class="card hero end">
      <div class="hero-num">${empty ? '📭' : '🎉'}</div>
      <h2>${t(empty ? 'practice.empty' : s.practice ? 'practice.done' : 'session.done')}</h2>
      ${empty ? html`<p class="muted">${t('practice.emptyHelp')}</p>`
        : html`<p>${t('session.summary', { c: s.correct, n: s.answered })}</p>`}
      ${s.mistakesLogged ? html`<p class="muted small">${t('session.mistakesLogged', { n: s.mistakesLogged })}</p>` : ''}
      ${empty && gem() ? html`<button class="btn" data-suggest>${icon('sparkle', 18)} ${t('suggest.open')}</button>` : ''}
      <button class="btn primary big" id="home">${t('session.backHome')}</button>
    </section>`);
  $('#home').addEventListener('click', () => { ui.session = null; clearSession(); go('today'); });
  bindSuggest(main);
}

// After a practice round: mix in saved words not started yet, else words Gemini suggests,
// or go round again with the same items at their new level.
function renderRoundEnd() {
  const s = ui.session;
  const waiting = newInPool(practicePool({ ...sessionArgs(), focus: s.focus }));
  const mix = waiting ? html`<button class="btn primary" id="mixnew">${icon('plus', 18)} ${t('practice.mixNew', { n: Math.min(waiting, store.getSettings().newPerDay ?? 8) })}</button>`
    : gem() ? html`<button class="btn primary" data-suggest>${icon('sparkle', 18)} ${t('suggest.open')}</button>` : '';
  setHtml(main, html`
    <section class="card hero end">
      <div class="hero-num">🎉</div>
      <h2>${t('practice.roundDone')}</h2>
      <p>${t('session.summary', { c: s.correct, n: s.answered })}</p>
      <p class="muted">${t(mix ? 'practice.roundHelp' : 'practice.roundHelpNoNew')}</p>
      ${mix}
      <button class="btn" id="again">${t('practice.nextRound')}</button>
      <button class="btn text" id="home">${t('session.backHome')}</button>
    </section>`);
  const round = (withNew) => { nextRound(withNew); viewSession(); };
  $('#mixnew')?.addEventListener('click', () => round(true));
  $('#again').addEventListener('click', () => round(false));
  $('#home').addEventListener('click', () => { ui.session = null; clearSession(); go('today'); });
  // Suggested words that were added start in the next round.
  bindSuggest(main, (added) => { if (added && ui.session === s) round(true); });
}

async function renderTask(task) {
  const ex = $('#ex');
  const w = task.word;
  let body = '';
  if (task.kind === 'recall') {
    body = html`
      <div class="ex-label">${t('ex.recall', { l: langName() })}</div>
      <div class="prompt">${w.meaning}</div>
      <div class="muted small">${t(`pos.${w.pos || 'other'}`)}${styleNote(w)}</div>
      ${recallBoxes(w)}`;
  } else if (task.kind === 'say') {
    body = html`
      <div class="ex-label">${t('ex.say', { l: langName() })}</div>
      <div class="prompt">${w.meaning}</div>
      <div class="muted small"><span class="chip">${toneLabel(w.tone)}</span> ${t(`tone.${w.tone || 'everyday'}.help`)}</div>
      <textarea class="answer" id="a1" rows="3" ${inputAttrs} ${tl()} placeholder="${t('ex.yourAnswer')}"></textarea>`;
  } else if (task.kind === 'order') {
    task.parts = chunksFor(w);
    const furi = code() === 'ja' && furiMode() !== 'off' ? cutChunks(segmentsFor(lemmaOf(w), w), task.parts) : null;
    task.pool = shuffled(task.parts.map((p, i) => ({ p, i, html: furi ? html`<span class="furi">${raw(toHtml(furi[i]))}</span>` : html`${p}` })));
    task.built = [];
    body = html`
      <div class="ex-label">${t('ex.order')}</div>
      <div class="prompt">${w.meaning}</div>
      <div class="built" id="built" ${tl()}><span class="muted small">${t('ex.orderHint')}</span></div>
      <div class="pool" id="pool" ${tl()}></div>
      <input type="hidden" id="a1">`;
  } else if (task.kind === 'gap') {
    // A word's sentence comes from its pool; a task shown again in the same session keeps it.
    const gap = task.gap || (isSentence(w) ? gapFor(w) : pickGap(store.getWord(w.id) || w, task.item.reps || 0));
    task.gap = gap;
    body = html`
      <div class="ex-label">${t(isSentence(w) ? 'ex.sgap' : 'ex.gap')}</div>
      <div class="prompt sentence" ${tl()}>${gapped(gap.sentence, w)}</div>
      <div class="muted small">${t('ex.meaning')}: ${w.meaning}</div>
      <input class="answer" id="a1" ${inputAttrs} ${tl()} placeholder="${t('ex.yourAnswer')}">`;
  } else if (task.kind === 'write') {
    body = html`
      <div class="ex-label">${t('ex.write')}</div>
      <div class="prompt" ${tl()}>${jt(wordTitle(w), w)}</div>${readingLine(w)}
      <div class="muted small">${w.meaning}</div>
      <textarea class="answer" id="a1" rows="3" ${inputAttrs} ${tl()} placeholder="${t('ex.yourAnswer')}"></textarea>`;
  } else if (task.kind === 'rule') {
    if (!(await generated(task, 'ex'))) return;
    body = ruleBody(task);
  } else if (task.kind === 'drill') {
    if (!(await generated(task, 'drill'))) return;
    const d = task.drill;
    const isGap = task.drillKind === 'gapfill';
    body = html`
      <div class="ex-label">${t('ex.drill', { c: categoryLabel(task.category, lang(), cats()) })}</div>
      <div class="instruction">${d.instruction}</div>
      ${d.prompt ? html`<div class="prompt sentence" ${tl()}>${isGap ? gapped(d.prompt, d) : marked(d.prompt, d.target, d)}</div>` : ''}
      ${isGap ? html`<input class="answer" id="a1" ${inputAttrs} ${tl()} placeholder="${t('ex.yourAnswer')}">`
        : html`<textarea class="answer" id="a1" rows="3" ${inputAttrs} ${tl()} placeholder="${t('ex.yourAnswer')}"></textarea>`}`;
  }

  setHtml(ex, html`${body}
    <div id="feedback"></div>`);
  setHtml($('#dock'), html`
    <button class="btn primary" id="check">${t('session.check')}</button>
    <div class="dock-row">
      <button class="btn text" id="dontKnow">${t('session.dontKnow')}</button>
      <button class="btn text" id="skip">${t('session.skip')}</button>
    </div>`);

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
  $('#dontKnow').addEventListener('click', () => onDontKnow(task));
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

// Waits for the exercise Gemini is generating for a task (task.ex or task.drill, with its
// Promise and Error next to it). False when there is nothing to show: the learner moved on
// meanwhile, or generation failed (then only a Next button is shown).
// Abbrechen stops waiting (the call may still finish for later); then, as after an error,
// "Nochmal versuchen" asks again and Weiter skips the task.
async function generated(task, key) {
  const ex = $('#ex');
  let error = task[`${key}Error`];
  if (!task[key] && !error) {
    promote(waitTag(task));
    const signal = waitBox(ex, t('session.loading'));
    setHtml($('#dock'), '');
    const cancelled = new Promise((resolve) => signal.addEventListener('abort', () => resolve('cancel')));
    if (await Promise.race([task[`${key}Promise`], cancelled]) === 'cancel') error = { kind: 'cancel' };
    if (ui.session?.tasks[ui.session.idx] !== task) return false; // user moved on
  }
  error ||= task[`${key}Error`];
  if (error || !task[key]) {
    setHtml(ex, isCancel(error) ? ''
      : html`${errorBox(error || t('session.genFailed'))}<p class="muted">${t('session.genFailed')}</p>`);
    setHtml($('#dock'), html`<button class="btn primary" id="next">${t('session.next')}</button>
      <div class="dock-row"><button class="btn text" id="regen">${t('common.retry')}</button><span></span></div>`);
    $('#next').addEventListener('click', () => { ui.session.idx++; viewSession(); });
    $('#regen').addEventListener('click', () => { retryPrepare(task); viewSession(); });
    return false;
  }
  return true;
}

// The exercise for a rule at its rung. Every rung shows which rule is being practised.
function ruleBody(task) {
  const { rule, ex: e } = task;
  const head = html`<div class="ex-label">${t('ex.rule', { c: categoryLabel(rule.category, lang(), cats()) })} · ${t('rule.rung', { n: task.item.rung || 2 })}</div>
    <div class="rule-name">${ruleText(rule, lang()).name}</div>`;
  switch (task.ruleKind) {
    case 'pair': {
      task.order ||= Math.random() < 0.5 ? [e.correct, e.wrong] : [e.wrong, e.correct];
      return html`${head}<div class="instruction">${t('ex.pair')}</div>
        <div class="choices">${task.order.map((x) => html`<button type="button" class="choice" data-v="${x}" ${tl()}>${jt(x, e)}</button>`)}</div>
        <input type="hidden" id="a1">`;
    }
    case 'gap':
      return html`${head}<div class="instruction">${t('ex.ruleGap')}</div>
        <div class="prompt sentence" ${tl()}>${gapped(e.sentence, e)}</div>
        <input class="answer" id="a1" ${inputAttrs} ${tl()} placeholder="${t('ex.yourAnswer')}">`;
    case 'transform':
      return html`${head}<div class="instruction">${e.instruction}</div>
        ${e.items.map((x, i) => html`<div class="tf-item"><div class="sentence" ${tl()}>${marked(x.prompt, x.target, e)}</div>
          <input class="answer" id="${i ? `t${i}` : 'a1'}" ${inputAttrs} ${tl()} placeholder="${t('ex.yourAnswer')}"></div>`)}`;
    case 'spot':
      return html`${head}<div class="instruction">${t('ex.spot')}</div>
        <textarea class="answer" id="a1" rows="5" ${inputAttrs} ${tl()}>${e.text}</textarea>`;
    default:
      return html`${head}<div class="instruction">${e.instruction}</div>
        <textarea class="answer" id="a1" rows="3" ${inputAttrs} ${tl()} placeholder="${t('ex.yourAnswer')}"></textarea>`;
  }
}

// Word-order exercise: tap pieces to build the sentence, tap a placed piece to put it back.
function bindOrder(task) {
  const draw = () => {
    const used = new Set(task.built.map((x) => x.i));
    setHtml($('#built'), task.built.length
      ? task.built.map((x, k) => html`<button type="button" class="chunk placed" data-k="${k}">${x.html}</button>`)
      : html`<span class="muted small">${t('ex.orderHint')}</span>`);
    setHtml($('#pool'), task.pool.map((x, k) =>
      html`<button type="button" class="chunk" data-p="${k}" ${used.has(x.i) ? 'disabled' : ''}>${x.html}</button>`));
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
  return r && !/^neutral\b/i.test(r) ? html` · ${t('edit.register')}: ${r}` : '';
}

// German nouns get labelled boxes for the article, the word and the plural. The labels stay
// visible while typing, unlike placeholders.
function recallBoxes(w) {
  const input = (id, hint) => html`<input class="answer" id="${id}" ${inputAttrs} ${tl()} placeholder="${hint}">`;
  if (w.pos !== 'noun' || recLang(w) !== 'de' || !w.article) return input('a1', recallHint(w));
  const box = (label, field) => html`<label class="answer-field"><span class="field-label">${label}</span>${field}</label>`;
  return html`<div class="row2">${box(t('edit.article'), input('art', 'der/die/das'))}${box(t('ex.word'), input('a1', t('ex.word')))}</div>${
    needsPlural(w) ? box(t('ex.plural'), input('a2', t('ex.plural'))) : ''}`;
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
  const buttons = $$('#dock button');
  buttons.forEach((b) => (b.disabled = true));
  let result;
  try {
    result = await gradeTask(task, a1, a2, fb);
  } catch (e) {
    if (ui.session?.tasks[ui.session.idx] !== task) return;
    // The answer stays, so checking again is one tap on the same button.
    task.state.phase = 'answer';
    buttons.forEach((b) => (b.disabled = false));
    setHtml(fb, isCancel(e) ? '' : errorBox(e));
    return;
  }
  task.state = feedbackState(result, a1, a2);
  showFeedback(task, result.canOverride);
}

const feedbackState = (r, a1, a2) => ({
  phase: 'feedback', grade: r.grade, almostKey: r.almostKey, a1, a2, answer: a1 + (a2 ? ` / ${a2}` : ''), feedback: r.html,
  verdict: r.verdict, mistakes: r.mistakes, ownGap: r.ownGap, corrected: r.corrected, natural: r.natural,
});

// "I don't know": the answer is shown, and it counts as a wrong answer (nothing is logged to
// the mistake profile).
function onDontKnow(task) {
  if (task.state.phase !== 'answer') return;
  task.state = { phase: 'feedback', grade: 'wrong', dontKnow: true, answer: '', feedback: revealFor(task), mistakes: [] };
  showFeedback(task, false);
}

// "Check again": Gemini looks at the same answer once more, and its verdict replaces the first.
async function onRecheck(task) {
  const st = task.state;
  if (st.phase !== 'feedback' || st.rechecked) return;
  st.phase = 'checking';
  const fb = $('#feedback');
  // The page's own markup, put back as it was.
  const shown = raw(fb.innerHTML);
  $$('#dock button').forEach((b) => (b.disabled = true));
  let result;
  try {
    result = await gradeTask(task, st.a1, st.a2, fb, { correct: st.grade === 'correct', feedback: st.verdict });
  } catch (e) {
    if (ui.session?.tasks[ui.session.idx] !== task) return;
    st.phase = 'feedback';
    setHtml(fb, html`${shown}${isCancel(e) ? '' : errorBox(e)}`);
    $$('#dock button').forEach((b) => (b.disabled = false));
    return;
  }
  if (ui.session?.tasks[ui.session.idx] !== task) return;
  task.state = { ...feedbackState(result, st.a1, st.a2), rechecked: true };
  showFeedback(task, result.canOverride);
}

function showFeedback(task, canOverride) {
  const { grade, feedback, almostKey, dontKnow, rechecked } = task.state;
  const cls = dontKnow ? 'shown' : grade === 'correct' ? 'ok' : grade === 'almost' ? 'almost' : 'bad';
  const label = dontKnow ? t('session.hereIsAnswer') : grade === 'correct' ? t('session.correct') : grade === 'almost' ? t(almostKey || 'session.almost') : t('session.wrong');
  setHtml($('#feedback'), html`<div class="result ${cls}"><div class="result-title">${label}</div>
    ${rechecked ? html`<div class="muted small">${t('session.rechecked')}</div>` : ''}${feedback}</div>
    ${englishButton(task)}`);
  bindNatural($('#feedback'));
  bindEnglish(task);
  $$('#ex .chunk').forEach((b) => (b.disabled = true));
  const recheck = !dontKnow && !rechecked && gem();
  setHtml($('#dock'), html`
    <button class="btn primary" id="next">${t('session.next')}</button>
    ${recheck || canOverride ? html`<div class="dock-row">
      ${recheck ? html`<button class="btn text" id="recheck">${t('session.recheck')}</button>` : html`<span></span>`}
      ${canOverride ? html`<button class="btn text" id="override">${t('session.iWasRight')}</button>` : ''}
    </div>` : ''}`);
  $('#recheck')?.addEventListener('click', () => onRecheck(task));
  $('#override')?.addEventListener('click', () => { task.state.grade = 'correct'; next(task); });
  $('#next').addEventListener('click', () => next(task));
  $('#next').focus({ preventScroll: true });
  $$('#ex .answer').forEach((el) => (el.readOnly = true));
}

// What a checked answer leaves behind once the learner moves on (or quits): the mistakes
// Gemini found, and the learner's own sentence as a new gap sentence for the word. Kept
// until then so that "Check again" can still change them.
function commit(task) {
  const st = task.state;
  if (st.committed) return;
  st.committed = true;
  if (st.mistakes?.length) logTaskMistakes(task, st.mistakes);
  if (st.ownGap) {
    const w = store.getWord(task.word.id);
    if (w) store.updateWord(w.id, { gapPool: addToPool(poolOf(w), [st.ownGap], { level: gapLevel(task.item.reps || 0), source: 'own' }) });
  }
}

function next(task) {
  commit(task);
  advance(task);
  viewSession();
}
