// The languages a learner can practise. German and Japanese are built in; any other language
// is described once by Gemini (gemini.setupLanguage) and kept as a record in the synced
// `languages` collection, which also holds the learner's level for each language. Pure
// definitions and helpers only, so they can be unit-tested in Node.

export const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1'].map((l) => `JLPT ${l}`);

// english: name used inside Gemini prompts. articles: forms learnt with each noun.
// reading: how to write a word's pronunciation when the script doesn't show it.
// romanized: the Latin spelling a learner may type into a lookup.
export const BUILTIN = {
  de: { code: 'de', english: 'German', articles: ['der', 'die', 'das'], reading: '', romanized: '', levels: CEFR },
  ja: {
    code: 'ja', english: 'Japanese', articles: [], romanized: 'romaji', levels: [...JLPT, ...CEFR],
    reading: 'kana (hiragana; katakana for loanwords)',
    forms: 'Verbs and adjectives: the verb group plus polite, te-form, past and negative forms, e.g. "ichidan; 食べます, 食べて, 食べた, 食べない". Others: empty.',
  },
};

export const isBuiltin = (code) => code in BUILTIN;

// Records made before languages existed are German.
export const recLang = (r) => (r && r.lang) || 'de';

// Whole sentences live in the word list too, marked kind: 'sentence'. lemma holds the sentence
// in the language being learnt, meaning its English, tone how it was said.
export const isSentence = (w) => !!w && w.kind === 'sentence';

// Words were stored under `german` before other languages existed.
export const lemmaOf = (w) => (w && (w.lemma ?? w.german)) || '';

// Merges a built-in definition with the stored record (level, or the whole description for an
// added language). Returns null for an unknown code.
export function describe(code, record) {
  const base = BUILTIN[code];
  if (!base && !record) return null;
  return { articles: [], reading: '', romanized: '', levels: CEFR, english: code, ...base, ...(record || {}), code };
}

// Name of a language in the app's interface language ("Japanisch" / "Japanese").
export function displayName(L, ui) {
  if (!L) return '';
  try {
    const n = new Intl.DisplayNames([ui === 'en' ? 'en' : 'de'], { type: 'language' }).of(L.code);
    if (n && n !== L.code) return n;
  } catch { /* unknown code or no Intl support */ }
  return L.english;
}

// Grammar categories are counted per language. German keys stay bare so existing review
// items keep working; every other language prefixes its code ("ja:particles").
export const catKey = (code, id) => (code === 'de' ? id : `${code}:${id}`);
export function parseCatKey(key) {
  const i = (key || '').indexOf(':');
  return i < 0 ? { lang: 'de', id: key } : { lang: key.slice(0, i), id: key.slice(i + 1) };
}
