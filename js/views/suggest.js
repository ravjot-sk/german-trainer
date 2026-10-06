// Suggested words: Gemini proposes words at the learner's level; they are shown ticked, and the
// learner unticks any they don't want before adding them.
import * as store from '../store.js';
import * as gemini from '../gemini.js';
import { t } from '../i18n.js';
import { lemmaOf, isSentence, wordTitle } from '../languages.js';
import { esc, $, $$, toast, errorBox, inputAttrs } from '../ui/dom.js';
import { L, code, langName } from '../ui/context.js';
import { tl, jt } from '../ui/text.js';
import { openSheet, sheetHead } from '../ui/sheet.js';

// Gemini proposes words at the learner's level; they are shown ticked, and the learner
// unticks any they don't want before adding them.
export function bindSuggest(root) {
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
