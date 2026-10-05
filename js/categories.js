// Grammar categories, one fixed list per language so mistake counts stay comparable over time.
// German and Japanese lists are written by hand; an added language gets a list from Gemini
// once, stored with the language. "other" catches anything that fits none of them, so it
// never pollutes a real category's count; it gets no drills of its own.

const WORD_CHOICE = { id: 'word_choice', de: 'Wortwahl und Kollokationen', en: 'Word choice and collocations' };
const REGISTER = { id: 'register', de: 'Register', en: 'Register (too formal or too casual)' };
const SPELLING = { id: 'spelling', de: 'Rechtschreibung', en: 'Spelling' };
const OTHER = { id: 'other', de: 'Sonstiges', en: 'Other' };

export const CATEGORIES = [
  { id: 'case_prepositions', de: 'Kasus nach Präpositionen', en: 'Case after prepositions',
    hint: 'Akkusativ, Dativ, Wechselpräpositionen' },
  { id: 'adjective_endings', de: 'Adjektivendungen', en: 'Adjective endings' },
  { id: 'verb_position', de: 'Verbstellung', en: 'Verb position',
    hint: 'verb second in main clauses, verb last in subordinate clauses' },
  { id: 'separable_verbs', de: 'Trennbare Verben', en: 'Separable verbs' },
  { id: 'gender_plural', de: 'Genus und Plural', en: 'Noun gender and plural' },
  { id: 'perfekt_auxiliary', de: 'Perfekt mit haben oder sein', en: 'Perfekt with haben or sein' },
  { id: 'verb_prepositions', de: 'Verben mit Präposition', en: 'Verbs with fixed prepositions',
    hint: 'warten auf, sich erinnern an' },
  { id: 'reflexive_verbs', de: 'Reflexive Verben', en: 'Reflexive verbs' },
  { id: 'konjunktiv', de: 'Konjunktiv II und indirekte Rede', en: 'Konjunktiv II and indirect speech' },
  WORD_CHOICE,
  REGISTER,
  { id: 'spelling', de: 'Rechtschreibung und Großschreibung', en: 'Spelling and capitalisation' },
  OTHER,
];

export const JAPANESE = [
  { id: 'particles', de: 'Partikeln', en: 'Particles', hint: 'は/が, を, に/で, へ, と, も, の' },
  { id: 'conjugation', de: 'Konjugation von Verben und Adjektiven', en: 'Verb and adjective conjugation',
    hint: 'te-form, past, negative, potential, i- and na-adjectives' },
  { id: 'politeness', de: 'Höflichkeit und Keigo', en: 'Politeness level and keigo',
    hint: 'です/ます vs plain form, mixing levels, sonkeigo, kenjōgo' },
  { id: 'aspect', de: 'ている und てある', en: 'ている, てある and aspect', hint: 'ongoing action vs resulting state' },
  { id: 'conditionals', de: 'Konditionalformen', en: 'Conditionals', hint: 'と, ば, たら, なら' },
  { id: 'giving_receiving', de: 'Geben und Bekommen', en: 'Giving and receiving', hint: 'あげる, くれる, もらう, てあげる/てくれる/てもらう' },
  { id: 'transitivity', de: 'Transitive und intransitive Verben', en: 'Transitive and intransitive verb pairs',
    hint: '開ける/開く, 始める/始まる' },
  { id: 'clause_linking', de: 'Satzverbindung und Satzbau', en: 'Clause linking and sentence structure',
    hint: 'ので/から, のに, relative clauses, word order, nominalisation with の/こと' },
  { id: 'counters', de: 'Zählwörter', en: 'Counters and numbers' },
  WORD_CHOICE,
  { id: 'spelling', de: 'Kanji- und Kana-Schreibung', en: 'Kanji and kana spelling', hint: 'wrong kanji, okurigana, long vowels, small っ' },
  OTHER,
];

// Added to every list Gemini makes for another language.
export const SHARED = [WORD_CHOICE, REGISTER, SPELLING, OTHER];

// Fallback for an added language whose own list is missing.
const GENERIC = [{ id: 'grammar', de: 'Grammatik', en: 'Grammar' }, ...SHARED];

export function categoriesFor(L) {
  if (!L || L.code === 'de') return CATEGORIES;
  if (L.code === 'ja') return JAPANESE;
  return L.categories?.length ? L.categories : GENERIC;
}

export const drillableIds = (list) => list.map((c) => c.id).filter((id) => id !== 'other');

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
    if (out.length >= 12) break;
  }
  return [...out, ...SHARED];
}
