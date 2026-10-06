// The session screen: one exercise at a time, its answer boxes, checking and feedback.
import * as store from '../store.js';
import { t, lang } from '../i18n.js';
import { joinArticle, needsPlural, gapFor, chunksFor, joinChunks, shuffled } from '../check.js';
import { categoryLabel } from '../categories.js';
import { recLang, lemmaOf, isSentence, wordTitle } from '../languages.js';
import { icon } from '../icons.js';
import { pickGap } from '../gappool.js';
import { segmentsFor, cutChunks, toHtml } from '../furigana.js';
import { main, titleEl, esc, $, $$, errorBox, inputAttrs } from '../ui/dom.js';
import { gem, code, langName, cats, ui } from '../ui/context.js';
import { tl, furiMode, jt, readingLine, toneLabel, bindNatural } from '../ui/text.js';
import { go } from '../router.js';
import { startSession, logTaskMistakes, topUpPractice, advance } from './runtime.js';
import { gradeTask } from './grade.js';
import { bindSuggest } from '../views/suggest.js';

export function viewSession() {
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
  let result;
  try {
    result = await gradeTask(task, a1, a2, fb);
  } catch (e) {
    task.state.phase = 'answer';
    checkBtn.disabled = false;
    $('#skip').disabled = false;
    fb.innerHTML = errorBox(e);
    return;
  }
  const { grade, html, canOverride, mistakes, almostKey } = result;
  if (mistakes.length) logTaskMistakes(task, mistakes);
  task.state = { phase: 'feedback', grade, almostKey, answer: a1 + (a2 ? ` / ${a2}` : ''), feedback: html };
  showFeedback(task, canOverride);
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
  advance(task);
  viewSession();
}
