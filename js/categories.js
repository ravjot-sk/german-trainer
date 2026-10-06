// Grammar categories, one fixed list per language so mistake counts stay comparable over time.
// German follows the MERLIN learner-error annotation scheme (a CEFR-rated learner corpus) and
// Japanese the NAIST Goyo Corpus error tagset, each adapted so a category is something a
// learner can practise. An added language gets a list from Gemini once, built from a fixed
// checklist of areas (SKELETON) and stored with the language. "other" catches anything that
// fits none of them, so it never pollutes a real category's count; it gets no drills.

const WORD_CHOICE = { id: 'word_choice', de: 'Wortwahl und Kollokationen', en: 'Word choice and collocations' };
const REGISTER = { id: 'register', de: 'Register', en: 'Register (too formal or too casual)' };
const SPELLING = { id: 'spelling', de: 'Rechtschreibung', en: 'Spelling' };
const OTHER = { id: 'other', de: 'Sonstiges', en: 'Other' };

export const CATEGORIES = [
  { id: 'word_order_main', de: 'Wortstellung im Hauptsatz', en: 'Word order in main clauses',
    hint: 'verb second, Satzklammer, separable verb prefix at the end, position of nicht and objects' },
  { id: 'word_order_sub', de: 'Wortstellung im Nebensatz', en: 'Word order in subordinate clauses',
    hint: 'verb last after weil, dass, wenn, ob, relative pronouns; verb clusters at the end' },
  { id: 'case', de: 'Kasus', en: 'Case', hint: 'wrong case of a noun, article, pronoun or adjective, after a verb or a preposition' },
  { id: 'gender', de: 'Genus', en: 'Noun gender' },
  { id: 'number', de: 'Numerus und Plural', en: 'Number and plural forms' },
  { id: 'adjective_endings', de: 'Adjektivendungen', en: 'Adjective endings' },
  { id: 'articles', de: 'Artikel', en: 'Articles', hint: 'missing, unnecessary or wrong article (definite vs indefinite vs none)' },
  { id: 'prepositions', de: 'Präpositionen', en: 'Prepositions',
    hint: 'choice of preposition, verbs and adjectives with a fixed preposition (warten auf, stolz auf), contractions' },
  { id: 'agreement', de: 'Konjugation und Kongruenz', en: 'Conjugation and agreement',
    hint: 'verb form does not match the subject, wrong or non-existent verb forms' },
  { id: 'tense', de: 'Tempus', en: 'Tense', hint: 'choice of tense, sequence of tenses, Präteritum vs Perfekt' },
  { id: 'verb_complex', de: 'Verbkomplex', en: 'Verb complex',
    hint: 'haben or sein in the Perfekt, participles, zu + infinitive, modal verbs' },
  { id: 'mood', de: 'Modus (Konjunktiv)', en: 'Mood (Konjunktiv I and II)', hint: 'Konjunktiv II for wishes and conditions, indirect speech' },
  { id: 'passive', de: 'Passiv', en: 'Passive voice', hint: 'werden-passive, sein-passive, passive with modals' },
  { id: 'valency', de: 'Valenz und Reflexivität', en: 'Verb complements and reflexives',
    hint: 'missing or extra object, sich missing or wrong' },
  { id: 'connectors', de: 'Konnektoren', en: 'Connectors', hint: 'weil/denn/deshalb, obwohl/trotzdem, als/wenn, damit/um zu' },
  { id: 'negation', de: 'Negation', en: 'Negation', hint: 'nicht vs kein, position of nicht' },
  { id: 'capitalisation', de: 'Groß- und Kleinschreibung', en: 'Capitalisation',
    hint: 'nouns and nominalised verbs and adjectives capitalised, Sie, words that look like nouns but are not' },
  { id: 'spelling', de: 'Rechtschreibung', en: 'Spelling', hint: 'letters, ss/ß, words written together or apart' },
  { id: 'punctuation', de: 'Zeichensetzung', en: 'Punctuation', hint: 'commas before subordinate clauses and infinitive groups' },
  WORD_CHOICE,
  REGISTER,
  OTHER,
];

export const JAPANESE = [
  { id: 'particles', de: 'Partikeln', en: 'Particles', hint: 'は/が, を, に/で, へ, と, も, の' },
  { id: 'verb_conjugation', de: 'Konjugation von Verben', en: 'Verb conjugation',
    hint: 'te-form, past, negative, potential, volitional; verb groups' },
  { id: 'transitivity', de: 'Transitive und intransitive Verben', en: 'Transitive and intransitive verb pairs',
    hint: '開ける/開く, 始める/始まる' },
  { id: 'aspect', de: 'Tempus und Aspekt', en: 'Tense and aspect', hint: 'た, ている, てある, てしまう, ongoing action vs resulting state' },
  { id: 'voice', de: 'Passiv und Kausativ', en: 'Passive and causative', hint: 'られる, させる, させられる' },
  { id: 'adjectives', de: 'Adjektive', en: 'Adjectives', hint: 'i- and na-adjective forms, past and negative' },
  { id: 'copula', de: 'Kopula だ', en: 'The copula だ', hint: 'だ/です, な or の before nouns, だ inside clauses' },
  { id: 'nominalisation', de: 'Nominalisierung', en: 'Nominalisation', hint: 'の vs こと' },
  { id: 'clause_linking', de: 'Satzverbindung und Nebensätze', en: 'Connectors and complex sentences',
    hint: 'te-form linking, から/ので, のに, relative clauses' },
  { id: 'conditionals', de: 'Konditionalformen', en: 'Conditionals', hint: 'と, ば, たら, なら' },
  { id: 'giving_receiving', de: 'Geben und Bekommen', en: 'Giving and receiving', hint: 'あげる, くれる, もらう, てあげる/てくれる/てもらう' },
  { id: 'demonstratives', de: 'Demonstrativa', en: 'Demonstratives', hint: 'こ/そ/あ/ど: これ, それ, あれ, どれ, この, そこ' },
  { id: 'negation', de: 'Verneinung', en: 'Negation', hint: 'なくて vs ないで, negative forms' },
  { id: 'word_order', de: 'Wortstellung', en: 'Word order' },
  { id: 'politeness', de: 'Höflichkeit und Keigo', en: 'Politeness level and keigo',
    hint: 'です/ます vs plain form, mixing levels, sonkeigo, kenjōgo' },
  { id: 'counters', de: 'Zählwörter', en: 'Counters and numbers' },
  WORD_CHOICE,
  { id: 'spelling', de: 'Kanji- und Kana-Schreibung', en: 'Kanji and kana spelling', hint: 'wrong kanji, okurigana, long vowels, small っ' },
  OTHER,
];

// Older category ids, mapped to where their mistakes belong now. Where an old category was
// split in two, this is the more common half; Gemini re-sorts those mistakes when it assigns
// them a rule (see rules.js).
export const LEGACY = {
  de: {
    verb_position: 'word_order_main', separable_verbs: 'word_order_main', case_prepositions: 'case',
    gender_plural: 'gender', perfekt_auxiliary: 'verb_complex', verb_prepositions: 'prepositions',
    reflexive_verbs: 'valency', konjunktiv: 'mood',
  },
  ja: { conjugation: 'verb_conjugation' },
};

// Old categories that became two; their mistakes are worth re-sorting.
export const SPLIT = {
  de: ['verb_position', 'case_prepositions', 'gender_plural', 'spelling'],
  ja: ['conjugation', 'clause_linking'],
};

export function migrateCategory(code, id) {
  return LEGACY[code]?.[id] || id;
}

// Added to every list Gemini makes for another language.
export const SHARED = [WORD_CHOICE, REGISTER, SPELLING, OTHER];

// The areas Gemini works through when it builds the list for an added language, so the list
// has the same shape as the hand-made ones: MERLIN's grammar and orthography groups.
export const SKELETON = [
  'word order (main and subordinate clauses)',
  'inflection: case, gender, number of nouns, articles, pronouns and adjectives',
  'agreement and verb conjugation',
  'tense and aspect',
  'mood and voice (subjunctive, conditional, passive, causative)',
  'function words: articles, prepositions or postpositions, particles',
  'verb complements, reflexives and auxiliaries',
  'connectors and complex sentences',
  'negation',
  'capitalisation and punctuation, where the language has rules for them',
];

// Languages with a hand-made, research-based list. Any other list was generated.
export const CURATED = ['de', 'ja'];
export const isCurated = (code) => CURATED.includes(code);

// Fallback for an added language whose own list is missing.
const GENERIC = [{ id: 'grammar', de: 'Grammatik', en: 'Grammar' }, ...SHARED];

export function categoriesFor(L) {
  if (!L || L.code === 'de') return CATEGORIES;
  if (L.code === 'ja') return JAPANESE;
  return L.categories?.length ? L.categories : GENERIC;
}

export const drillableIds = (list) => list.map((c) => c.id).filter((id) => id !== 'other');

// Categories whose mistakes get a rule of their own. Word choice is learnt through the word
// list, and register and "other" have no rule to practise.
export const NO_RULES = ['word_choice', 'register', 'other'];
export const hasRules = (id) => !NO_RULES.includes(id);

// Kept for the German defaults used in tests and older call sites.
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const DRILLABLE = drillableIds(CATEGORIES);

export function categoryLabel(id, ui, list = CATEGORIES) {
  const c = list.find((x) => x.id === id) || list.find((x) => x.id === 'other') || OTHER;
  return ui === 'en' ? c.en : c.de;
}

// Text used inside Gemini prompts so the model picks categories consistently.
export function categoryGuide(list = CATEGORIES) {
  return list.map((c) => `- ${c.id}: ${c.en}${c.hint ? ` (${c.hint})` : ''}`).join('\n');
}

// Cleans a list Gemini proposed for a new language: snake_case ids, no duplicates, and the
// shared categories at the end.
export function finishCategories(proposed) {
  const out = [];
  const seen = new Set(SHARED.map((c) => c.id));
  for (const c of proposed || []) {
    const id = String(c.id || c.en || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    if (!id || seen.has(id) || !c.en) continue;
    seen.add(id);
    out.push({ id, en: String(c.en), de: String(c.de || c.en), ...(c.hint ? { hint: String(c.hint) } : {}) });
    if (out.length >= 16) break;
  }
  return [...out, ...SHARED];
}
