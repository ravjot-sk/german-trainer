// Furigana for Japanese: small kana readings shown above kanji. Two sources:
// - a saved word's reading, lined up with its kanji here (食べる + たべる gives 食(た)べる);
// - text Gemini marked up as {kanji|reading}, e.g. "{食|た}べる{前|まえ}に". Markup is only used
//   when removing it gives back the exact text, so a sloppy answer shows plain text, never
//   wrong furigana.
// Text becomes a list of segments { text, rt }, rt empty for text shown as is. Pure functions
// only, so they can be unit-tested in Node.

const KANJI = /[㐀-䶿一-鿿豈-﫿々〆ヶ]/;
const KANA_ONLY = /^[ぁ-ゟ゠-ヿー]+$/;
const MARK = /\{([^{}|]+)\|([^{}|]+)\}/g;

export const hasKanji = (s) => KANJI.test(s || '');

// Katakana to hiragana, so a reading in either matches the word.
export const toHira = (s) => String(s || '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// Runs of kanji and of everything else, in order.
function runs(s) {
  const out = [];
  for (const ch of s) {
    const k = KANJI.test(ch);
    const last = out[out.length - 1];
    if (last && last.kanji === k) last.text += ch;
    else out.push({ text: ch, kanji: k });
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Lines a word up with its kana reading. The kana in the word must appear in the reading, and
// each kanji run takes the reading between them. Null when they don't fit together.
export function align(word, reading) {
  word = String(word || '');
  reading = String(reading || '').replace(/\s+/g, '');
  if (!hasKanji(word) || !reading || !KANA_ONLY.test(reading)) return null;
  const parts = runs(word);
  const re = new RegExp(`^${parts.map((p) => (p.kanji ? '(.+?)' : escapeRe(toHira(p.text)))).join('')}$`);
  const m = toHira(reading).match(re);
  if (!m) return null;
  let g = 1;
  return parts.map((p) => ({ text: p.text, rt: p.kanji ? m[g++] : '' }));
}

// Text without its {kanji|reading} markup.
export const strip = (marked) => String(marked || '').replace(MARK, '$1');

// Segments for marked-up text, or null unless it is valid furigana for exactly `plain`.
export function parse(marked, plain) {
  marked = String(marked || '');
  if (!marked || strip(marked) !== plain) return null;
  const out = [];
  let at = 0;
  for (const m of marked.matchAll(MARK)) {
    const [whole, base, rt] = m;
    if (!hasKanji(base) || !KANA_ONLY.test(rt)) return null;
    if (m.index > at) out.push({ text: marked.slice(at, m.index), rt: '' });
    out.push({ text: base, rt });
    at = m.index + whole.length;
  }
  if (at < marked.length) out.push({ text: marked.slice(at), rt: '' });
  return out.some((s) => s.rt) ? out : null;
}

// Furigana for one piece of text on a record: the word's own reading for its dictionary form,
// otherwise a stored markup that matches the text.
export function segmentsFor(text, rec) {
  if (!text || !rec || !hasKanji(text)) return null;
  if (rec.kind !== 'sentence' && rec.reading && text === (rec.lemma ?? rec.german)) {
    const a = align(text, rec.reading);
    if (a) return a;
  }
  for (const marked of rec.furigana || []) {
    const s = parse(marked, text);
    if (s) return s;
  }
  return null;
}

// Cuts a sentence's segments along the pieces of a word-order exercise. A reading that spans two
// pieces is dropped rather than split. Null when the pieces don't add up to the sentence.
export function cutChunks(segments, chunks) {
  if (!segments) return null;
  const text = segments.map((s) => s.text).join('');
  if (chunks.join('') !== text) return null;
  const bounds = [];
  let pos = 0;
  for (const c of chunks) { bounds.push([pos, pos + c.length]); pos += c.length; }
  const spans = [];
  pos = 0;
  for (const s of segments) { spans.push({ ...s, from: pos, to: pos + s.text.length }); pos += s.text.length; }
  return bounds.map(([from, to]) => spans
    .filter((s) => s.to > from && s.from < to)
    .map((s) => {
      const inside = s.from >= from && s.to <= to;
      return { text: s.text.slice(Math.max(0, from - s.from), Math.min(s.text.length, to - s.from)), rt: inside ? s.rt : '' };
    }));
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// HTML with <ruby> for the segments that have a reading.
export function toHtml(segments) {
  return segments.map((s) => (s.rt ? `<ruby>${escHtml(s.text)}<rt>${escHtml(s.rt)}</rt></ruby>` : escHtml(s.text))).join('');
}

// A word's gap sentences, as shown in the exercise and filled in on the answer.
export const poolTexts = (rec) => (Array.isArray(rec?.gapPool) ? rec.gapPool : [])
  .flatMap((g) => (g?.sentence ? [g.sentence, g.sentence.replace('___', g.answer || '')] : []));

// Texts on a record that could carry furigana but have none yet (Gemini fills them in).
export function missing(rec) {
  if (!rec || (rec.lang || 'de') !== 'ja') return [];
  const texts = [rec.example, ...(rec.moreExamples || []).map((e) => e.text), rec.contextSentence, rec.gapSentence, ...poolTexts(rec)];
  if (rec.kind === 'sentence') texts.unshift(rec.lemma);
  else if (!align(rec.lemma ?? rec.german, rec.reading)) texts.unshift(rec.lemma ?? rec.german);
  return [...new Set(texts.filter((x) => hasKanji(x)))]
    .filter((x) => !(rec.furigana || []).some((m) => parse(m, x)));
}
