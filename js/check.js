// Local answer checking and a small word diff for showing corrections.
import { lemmaOf, recLang, isSentence } from './languages.js';

// Scripts written without spaces between words (Japanese, Chinese, Thai). Answers in them are
// compared without spaces, and corrections are diffed character by character.
const UNSPACED = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\u0e00-\u0e7f]/;
export const isUnspaced = (s) => UNSPACED.test(s || '');

export function normalize(s) {
  return (s || '')
    // NFKC folds full-width letters, digits and punctuation (Ａ, １, ！) to their usual forms.
    .normalize('NFKC')
    .replace(/[„“”"«»‚‘’'「」『』]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,;:、])\s*/g, '$1 ')
    .replace(/[.!?…。]+$/g, '')
    .trim();
}

// Returns 'correct', 'almost' (differs only in capitalisation) or 'wrong'.
export function compare(answer, expected) {
  let a = normalize(answer);
  let e = normalize(expected);
  if (isUnspaced(e)) {
    a = a.replace(/\s+/g, '');
    e = e.replace(/\s+/g, '');
  }
  if (!a || !e) return 'wrong';
  if (a === e) return 'correct';
  if (a.toLowerCase() === e.toLowerCase()) return 'almost';
  return 'wrong';
}

// Best result across several acceptable answers.
export function compareAny(answer, expectedList) {
  let best = 'wrong';
  for (const e of expectedList.filter(Boolean)) {
    const r = compare(answer, e);
    if (r === 'correct') return r;
    if (r === 'almost') best = r;
  }
  return best;
}

export function stripArticle(s) {
  return (s || '').trim().replace(/^(der|die|das)\s+/i, '');
}

// Typed recall for a word. German nouns need article + word, and the plural if the word has
// one. Other languages compare against the form Gemini says to type (recallAnswer); typing
// only the reading of a word normally written in kanji counts as almost.
export function checkRecall(word, answer, pluralAnswer) {
  const lemma = lemmaOf(word);
  if (recLang(word) !== 'de') {
    const target = word.recallAnswer || (word.pos === 'noun' && word.article ? `${word.article} ${lemma}` : lemma);
    let main = compare(answer, target);
    let byReading = false;
    if (main === 'wrong' && word.reading && compare(answer, word.reading) === 'correct') {
      main = 'almost';
      byReading = true;
    }
    return { grade: main, main, plural: null, target, pluralTarget: '', byReading };
  }
  const target = word.pos === 'noun' && word.article ? `${word.article} ${lemma}` : lemma;
  if (word.article && needsPlural(word) && compare(answer, word.article) === 'correct'
      && compare(pluralAnswer, lemma) !== 'wrong') {
    // Article in the first box and the word in the plural box: the word was known, but the
    // plural was never given, so it counts as almost.
    return { grade: 'almost', main: 'correct', plural: null, target, pluralTarget: stripArticle(word.plural), splitArticle: true };
  }
  let main = compare(answer, target);
  if (main === 'wrong' && word.pos !== 'noun') {
    // Accept "sich erinnern" when the stored form is "erinnern" and vice versa.
    main = compare(answer.replace(/^sich\s+/i, ''), target.replace(/^sich\s+/i, ''));
  }
  let plural = null;
  if (needsPlural(word)) {
    plural = compare(stripArticle(pluralAnswer), stripArticle(word.plural));
  }
  const parts = [main, plural].filter(Boolean);
  const grade = parts.includes('wrong') ? 'wrong' : parts.includes('almost') ? 'almost' : 'correct';
  return { grade, main, plural, target, pluralTarget: needsPlural(word) ? stripArticle(word.plural) : '' };
}

export function needsPlural(word) {
  if (word.pos !== 'noun') return false;
  const p = stripArticle(word.plural || '');
  return !!p && !/^(-|–|—|kein|no plural|nur singular|ohne plural)/i.test(p);
}

// Gap sentence for a word: the stored one, or a best-effort local guess.
export function gapFor(word) {
  if (word.gapSentence && word.gapSentence.includes('___') && word.gapAnswer) {
    return { sentence: word.gapSentence, answer: word.gapAnswer };
  }
  if (isSentence(word)) return null; // no single word to guess a gap from
  const source = word.contextSentence || word.example;
  const lemma = lemmaOf(word);
  if (!source || !lemma) return null;
  if (isUnspaced(source)) {
    // No word boundaries to find an inflected form by, so only the exact dictionary form works.
    const at = source.indexOf(lemma);
    return at < 0 ? null : { sentence: source.slice(0, at) + '___' + source.slice(at + lemma.length), answer: lemma };
  }
  const stem = lemma.toLowerCase().slice(0, Math.max(3, Math.min(5, lemma.length - 1)));
  const tokens = source.split(/(\s+)/);
  for (let i = 0; i < tokens.length; i++) {
    const bare = tokens[i].replace(/[.,!?;:„“"()]/g, '');
    if (bare.length > 1 && bare.toLowerCase().startsWith(stem)) {
      tokens[i] = tokens[i].replace(bare, '___');
      return { sentence: tokens.join(''), answer: bare };
    }
  }
  return null;
}

// Pieces of a saved sentence for the word-order exercise: Gemini's chunks when they still add
// up to the sentence (it may have been edited since), else its words. Null when too short.
export function chunksFor(item) {
  const sentence = lemmaOf(item);
  const squash = (s) => normalize(s).replace(/\s+/g, '');
  let parts = (item.chunks || []).map((c) => String(c).trim()).filter(Boolean);
  if (!parts.length || squash(parts.join('')) !== squash(sentence)) {
    parts = isUnspaced(sentence) ? [] : sentence.split(/\s+/).filter(Boolean);
  }
  return parts.length >= 3 ? parts : null;
}

// Joins chosen pieces back into a sentence.
export const joinChunks = (parts) => (isUnspaced(parts.join('')) ? parts.join('') : parts.join(' '));

// A shuffle that never returns the pieces in their original order (when that is possible).
export function shuffled(parts, rnd = Math.random) {
  const out = parts.slice();
  for (let tries = 0; tries < 10; tries++) {
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    if (out.some((p, i) => p !== parts[i])) return out;
  }
  return out;
}

// Word-level diff (LCS) returning [{type: 'same'|'del'|'add', text}]. Text without spaces
// between words is diffed by character.
export function wordDiff(a, b) {
  const split = isUnspaced(`${a}${b}`) ? (s) => Array.from(s || '') : (s) => (s || '').split(/(\s+)/).filter((p) => p !== '');
  const x = split(a);
  const y = split(b);
  const n = x.length, m = y.length;
  if (n * m > 250000) return [{ type: 'add', text: b }];
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  const push = (type, text) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text; else out.push({ type, text });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { push('same', x[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', x[i]); i++; }
    else { push('add', y[j]); j++; }
  }
  while (i < n) push('del', x[i++]);
  while (j < m) push('add', y[j++]);
  return out;
}
