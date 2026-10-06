// Editing a saved word or sentence in a bottom sheet.
import * as store from '../store.js';
import * as gemini from '../gemini.js';
import { t } from '../i18n.js';
import { recLang, lemmaOf, isSentence, examplesToText, examplesFromText, wordTitle } from '../languages.js';
import { poolOf, replaceInPool } from '../gappool.js';
import { esc, inputAttrs } from '../ui/dom.js';
import { code, forgetWord } from '../ui/context.js';
import { tl, toneLabel } from '../ui/text.js';
import { openSheet, sheetHead, moreFields } from '../ui/sheet.js';

export function openEditor(id) {
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
        fd.gapAcceptable = [];
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
