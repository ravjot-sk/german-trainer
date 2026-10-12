// Suggested words: Gemini proposes words at the learner's level; they are shown ticked, and the
// learner unticks any they don't want before adding them.
import * as store from '../store.js';
import * as gemini from '../gemini.js';
import { t } from '../i18n.js';
import { lemmaOf, isSentence, wordTitle } from '../languages.js';
import { html, setHtml, $, $$, toast, errorBox, waitBox, inputAttrs } from './dom.js';
import { L, code, langName } from './context.js';
import { tl, jt } from './text.js';
import { openSheet, sheetHead } from './sheet.js';

// Gemini proposes words at the learner's level; they are shown ticked, and the learner
// unticks any they don't want before adding them.
// onAdded(n) runs after the learner added n suggested words.
export function bindSuggest(root, onAdded) {
  $$('[data-suggest]', root).forEach((b) => b.addEventListener('click', () => openSuggest(onAdded)));
}

const SUGGEST_COUNT = 8;

function openSuggest(onAdded) {
  const c = code();
  let found = [];
  openSheet(html`
    ${sheetHead(t('suggest.title'))}
    <p class="muted small">${t('suggest.help', { l: langName(), level: L().level })}</p>
    <div class="inline"><input name="topic" id="topic" ${inputAttrs} placeholder="${t('suggest.topic')}">
      <button type="button" class="btn small" id="sgo">${t('suggest.go')}</button></div>
    <div id="slist"></div>
    <button type="submit" class="btn primary wide hidden" id="sadd"></button>`, {
    onSave: () => {
      const picked = $$('#slist input:checked').map((x) => found[+x.value]);
      if (!picked.length) return false;
      let added = 0;
      for (const w of picked) if (store.addWord({ ...w, lang: c, source: 'suggested' }).created) added++;
      toast(t('suggest.added', { n: added }));
      onAdded?.(added);
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
    const signal = waitBox(list, t('suggest.loading'));
    try {
      // The newest saved words are listed so Gemini avoids them; any that slip through are dropped here.
      const exclude = store.words(c).filter((w) => !isSentence(w)).slice(0, 300).map(lemmaOf);
      const seen = new Set();
      found = (await gemini.suggestWords(SUGGEST_COUNT, { topic: $('#topic', sheet).value.trim(), exclude }, { signal })).filter((w) => {
        const key = store.normKey(w.lemma, store.language(c)?.articles);
        if (seen.has(key) || store.findWord(w.lemma, c, store.language(c)?.articles)) return false;
        seen.add(key);
        return true;
      });
      if (!found.length) { setHtml(list, html`<p class="muted">${t('suggest.none')}</p>`); return; }
      setHtml(list, html`<ul class="suggest">${found.map((w, i) => html`<li><label>
        <input type="checkbox" value="${i}" checked>
        <div><b ${tl(c)}>${jt(wordTitle(w), w, c)}</b>${w.reading ? html` <span class="muted small" ${tl(c)}>${w.reading}</span>` : ''}
          <div class="muted small">${t(`pos.${w.pos || 'other'}`)} · ${w.meaning}</div>
          ${w.example ? html`<div class="small" ${tl(c)}>${jt(w.example, w, c)}</div>` : ''}</div>
      </label></li>`)}</ul>`);
      $$('#slist input', sheet).forEach((x) => x.addEventListener('change', count));
      $('#sadd', sheet).classList.remove('hidden');
      count();
    } catch (e) {
      setHtml(list, gemini.isCancel(e) ? '' : errorBox(e));
    } finally {
      go.disabled = false;
      go.textContent = t(found.length ? 'suggest.again' : 'suggest.go');
    }
  };
  $('#sgo', sheet).addEventListener('click', load);
  $('#topic', sheet).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); load(); } });
  load();
}
