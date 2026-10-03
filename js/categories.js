// The fixed grammar categories from the spec. "other" catches anything that fits none of
// them, so it never pollutes a real category's count; it gets no drills of its own.
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
  { id: 'word_choice', de: 'Wortwahl und Kollokationen', en: 'Word choice and collocations' },
  { id: 'register', de: 'Register', en: 'Register (too formal or too casual)' },
  { id: 'spelling', de: 'Rechtschreibung und Großschreibung', en: 'Spelling and capitalisation' },
  { id: 'other', de: 'Sonstiges', en: 'Other' },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const DRILLABLE = CATEGORY_IDS.filter((id) => id !== 'other');

export function categoryLabel(id, lang) {
  const c = CATEGORIES.find((x) => x.id === id) || CATEGORIES[CATEGORIES.length - 1];
  return lang === 'en' ? c.en : c.de;
}

// Text used inside Gemini prompts so the model picks categories consistently.
export function categoryGuide() {
  return CATEGORIES.map((c) => `- ${c.id}: ${c.en}${c.hint ? ` (${c.hint})` : ''}`).join('\n');
}
