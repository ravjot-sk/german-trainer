// Look up: a word (dictionary entry, saved to the list) or a sentence (translated and saved).
import * as store from '../store.js';
import * as gemini from '../gemini.js';
import { t } from '../i18n.js';
import { recLang, lemmaOf, isSentence, wordTitle } from '../languages.js';
import { icon } from '../icons.js';
import { poolOf, addToPool, poolFromLookup } from '../gappool.js';
import { main, titleEl, esc, $, $$, toast, errorBox, inputAttrs, pref, setPref } from '../ui/dom.js';
import { gem, L, code, langName, noGemini, ui } from '../ui/context.js';
import { tl, jt, readingLine, toneLabel } from '../ui/text.js';
import { fillFurigana } from '../background.js';
import { wordRows, bindWordRows } from './words.js';
import { openEditor } from './editor.js';

export function viewLookup() {
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
