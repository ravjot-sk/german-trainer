// "In English": the English of the sentences an exercise showed, once it is answered. Stored
// translations are shown as they are; the rest come from one Gemini call and are kept (a gap
// sentence's and a word's example on the word, so they are not asked for again).
import * as store from '../store.js';
import * as gemini from '../gemini.js';
import { t } from '../i18n.js';
import { isSentence } from '../languages.js';
import { poolOf } from '../gappool.js';
import { esc, $, errorBox } from '../ui/dom.js';
import { gem } from '../ui/context.js';
import { tl } from '../ui/text.js';
import { writeExamples } from './grade.js';

const filled = (s, a) => (s || '').replace('___', a || '');
const one = (text, en = '', save = null) => ({ text: (text || '').trim(), en: en || '', save });

// The sentences in the language being learnt that the answered task showed:
// [{ text, en (the stored translation, or ''), save(en) (keeps a new one, or null) }].
// Say and word order are left out: their prompt is the English already.
export function englishSources(task) {
  const w = task.word;
  const st = task.state || {};
  let list = [];
  if (task.kind === 'recall') {
    if (w.example) list = [one(w.example, w.exampleTranslation, (en) => store.getWord(w.id) && store.updateWord(w.id, { exampleTranslation: en }))];
  } else if (task.kind === 'gap') {
    if (!isSentence(w) && task.gap) list = [one(filled(task.gap.sentence, task.gap.answer), task.gap.translation, (en) => saveGap(w, task.gap, en))];
  } else if (task.kind === 'write') {
    list = st.dontKnow ? writeExamples(w).map((x) => one(x, x === w.example ? w.exampleTranslation : '')) : [one(st.corrected), one(st.natural)];
  } else if (task.kind === 'rule' && task.ex) {
    const e = task.ex;
    list = task.ruleKind === 'pair' ? [one(e.correct)]
      : task.ruleKind === 'gap' ? [one(filled(e.sentence, e.answer))]
      : task.ruleKind === 'transform' ? e.items.map((x) => one(x.answer))
      : task.ruleKind === 'spot' ? [one(e.corrected)]
      : [one(e.model)];
  } else if (task.kind === 'drill' && task.drill) {
    const d = task.drill;
    list = task.drillKind === 'gapfill' ? [one(d.prompt ? filled(d.prompt, d.answer) : d.answer)] : [one(d.prompt), one(d.answer)];
  }
  const seen = new Set();
  return list.filter((x) => x.text && !seen.has(x.text) && seen.add(x.text));
}

// A new translation for a gap sentence goes into the word's sentence pool.
function saveGap(w, gap, en) {
  gap.translation = en;
  const word = store.getWord(w.id);
  if (!word) return;
  store.updateWord(word.id, { gapPool: poolOf(word).map((e) => (e.sentence === gap.sentence && !e.translation ? { ...e, translation: en } : e)) });
}

// The button, when there is something to translate and a way to get it.
export function englishButton(task) {
  const list = englishSources(task);
  if (!list.length || (!gem() && list.some((x) => !x.en))) return '';
  return `<div id="english"><button type="button" class="btn small" id="showEnglish">${esc(t('session.english'))}</button></div>`;
}

export function bindEnglish(task) {
  $('#showEnglish')?.addEventListener('click', async () => {
    const slot = $('#english');
    const list = englishSources(task);
    task.english ||= {};
    for (const x of list) if (x.en) task.english[x.text] = x.en;
    const missing = list.filter((x) => !task.english[x.text]);
    if (missing.length) {
      slot.innerHTML = `<div class="loading">${esc(t('session.translating'))}</div>`;
      try {
        const out = await gemini.translateTexts(missing.map((x) => x.text));
        missing.forEach((x, i) => {
          if (!out[i]) return;
          task.english[x.text] = out[i];
          x.save?.(out[i]);
        });
      } catch (e) {
        if (task.state?.phase !== 'feedback' || !document.contains(slot)) return;
        slot.innerHTML = errorBox(e);
        return;
      }
      if (!document.contains(slot)) return; // the learner moved on
    }
    slot.innerHTML = `<div class="english">
      <div class="english-title">${esc(t('session.englishTitle'))}</div>
      ${list.map((x) => `<div class="english-pair"><div class="muted small" ${tl()}>${esc(x.text)}</div>
        <div lang="en">${esc(task.english[x.text] || '—')}</div></div>`).join('')}
    </div>`;
  });
}
