// Local answer checking and a small word diff for showing corrections.
import { lemmaOf, recLang, isSentence } from './languages.js';
import { align, toHira, hasKanji } from './furigana.js';

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
    // Trimmed first, so a space after the final full stop (iPhone types ". " on a double
    // space) doesn't keep the stop in the answer.
    .trim()
    .replace(/\s*[.!?…。]+$/g, '')
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

// German nouns are typed in separate article and word boxes. A word typed with its article
// already in the word box is taken as it is.
export function joinArticle(article, word) {
  const a = (article || '').trim();
  const w = (word || '').trim();
  return !a || /^(der|die|das)\s/i.test(w) ? w : `${a} ${w}`;
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

// Gap fill for a word. gap: { sentence, answer, acceptable } as gappool.pickGap returns it.
// Besides the expected form and any other forms Gemini listed as correct, two answers that
// show the learner knows the word count as almost, so the sentence doesn't come back forever:
// - the form typed in kana (たべます for 食べます), worked out from the word's reading;
// - in Japanese, the word's dictionary form (食べる), which is often just as grammatical in the
//   sentence (plain instead of polite) and can't be told apart without its translation.
// Returns { grade, byReading, byForm }.
export function checkGap(word, gap, answer) {
  const accepted = [gap.answer, ...(gap.acceptable || [])].filter(Boolean);
  const grade = compareAny(answer, accepted);
  if (grade !== 'wrong') return { grade, byReading: false, byForm: false };
  const kana = toHira(normalize(answer).replace(/\s+/g, ''));
  if (kana && accepted.some((a) => kanaForm(a, word) === kana)) return { grade: 'almost', byReading: true, byForm: false };
  if (isUnspaced(gap.answer)) {
    const forms = [word.recallAnswer, lemmaOf(word)].filter(Boolean);
    const dict = compareAny(answer, forms) !== 'wrong' || (!!word.reading && kana === kanaForm(lemmaOf(word), word));
    if (dict) return { grade: 'almost', byReading: false, byForm: true };
  }
  return { grade: 'wrong', byReading: false, byForm: false };
}

// A form of a word written in kana, using the readings its kanji have in the word's dictionary
// form (食べます with 食べる/たべる gives たべます). Null when some kanji can't be read that way.
export function kanaForm(form, word) {
  const segs = align(lemmaOf(word), word.reading);
  let out = normalize(form).replace(/\s+/g, '');
  if (!hasKanji(out)) return toHira(out) || null;
  if (!segs) return null;
  for (const s of segs) if (s.rt) out = out.split(s.text).join(s.rt);
  return hasKanji(out) ? null : toHira(out);
}

export function needsPlural(word) {
  if (word.pos !== 'noun') return false;
  const p = stripArticle(word.plural || '');
  return !!p && !/^(-|–|—|kein|no plural|nur singular|ohne plural)/i.test(p);
}

// The gap written the way exercises expect it ("___"). Japanese text from Gemini may mark it
// with full-width ＿ or a longer run of underscores, which would otherwise make the sentence
// unusable and leave a word with a single sentence to repeat.
export const gapMark = (s) => String(s || '').replace(/＿+|_{3,}/g, '___');

// Gap sentence for a word: the stored one, or a best-effort local guess.
export function gapFor(word) {
  const stored = gapMark(word.gapSentence);
  if (stored.includes('___') && word.gapAnswer) {
    return { sentence: stored, answer: word.gapAnswer, acceptable: word.gapAcceptable || [] };
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

// For rules where case and punctuation are the point (capitalisation, commas, spelling):
// only spacing and quote styles may differ.
export function compareExact(answer, expected) {
  const n = (s) => String(s || '').normalize('NFKC').replace(/[„“”«»]/g, '"').replace(/[‚‘’]/g, "'").replace(/\s+/g, ' ').trim();
  return n(answer) && n(answer) === n(expected) ? 'correct' : 'wrong';
}

export function compareAnyExact(answer, expectedList) {
  return expectedList.filter(Boolean).some((e) => compareExact(answer, e) === 'correct') ? 'correct' : 'wrong';
}
