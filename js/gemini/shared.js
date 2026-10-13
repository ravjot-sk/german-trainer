// Schema pieces, prompt pieces and reply cleaners shared by the Gemini features. Pure: every
// function gets what it needs in c, the learner context { L, ui, rules }: the language being
// learnt (with its level), the interface language ('de' or 'en') and the rules the learner
// already has (rules.js knownRules).
import { categoriesFor, categoryGuide, NO_RULES } from '../categories.js';
import { seedGuide } from '../ruleseeds.js';
import { parse as parseFurigana } from '../furigana.js';

// propertyOrdering makes Gemini write the fields in the order listed. Without it the REST API
// writes them alphabetically, so a mistake's category came before its sentence and its rule,
// and fields meant to be thought through first came last (#30).
export const S = (props, required) => ({ type: 'OBJECT', properties: props, required: required || Object.keys(props), propertyOrdering: Object.keys(props) });
export const STR = { type: 'STRING' };

// Furigana for Japanese texts, as {kanji|reading} markup (see furigana.js).
export const hasFurigana = (L) => L.code === 'ja';
export const FURIGANA_RULE = 'write every kanji or run of kanji as {kanji|reading in hiragana}, reading it as it is read in this sentence, e.g. "{毎朝|まいあさ}{水|みず}を{飲|の}む". Only kanji go inside the braces, never the kana after them. Kana, punctuation, spaces and "___" stay exactly as they are.';
export const furiganaOf = (what) => ({ type: 'STRING', description: `${what} again with furigana: ${FURIGANA_RULE}` });

// Moves the *Furigana fields of a reply into one list kept on the record, dropping any whose
// text does not match what it annotates.
export function collectFurigana(r, pairs) {
  const list = [];
  for (const [field, plainOf] of pairs) {
    const marked = r[field];
    delete r[field];
    const plain = plainOf(r);
    if (marked && plain && parseFurigana(marked, plain)) list.push(marked);
  }
  r.furigana = list;
  return r;
}

export const isGerman = (L) => L.code === 'de';
export const levelText = (L) => `${L.level} level`;

// simpler: one level below the learner's, for explanations that must be quick to read.
const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export function explainLang({ L, ui }, { simpler = false } = {}) {
  if (ui === 'en') return simpler ? 'plain, simple English' : 'English';
  if (!isGerman(L)) return 'German (simple, clear German)';
  const i = CEFR.indexOf(L.level);
  const level = simpler && i > 0 ? `${CEFR[i - 1]} level` : levelText(L);
  return `German (simple, clear German at ${level})`;
}

// Other right fillings of a word's gap, so a correct answer in another form isn't marked wrong.
export const GAP_ACCEPTABLE = { type: 'ARRAY', items: STR, description: 'Other forms of the word that would be just as correct and natural in the gap (e.g. plain instead of polite, another tense that fits), in normal script. Empty if only the answer fits.' };

// Word fields Gemini fills. German keeps its plural and verb forms (the recall check uses
// them); other languages get one free "forms" note and the exact recall answer.
export function wordProps(L) {
  const name = L.english;
  const p = {
    lemma: { type: 'STRING', description: isGerman(L)
      ? 'Dictionary form (lemma) without article. Nouns capitalised. Reflexive verbs as "sich ...".'
      : `Dictionary form in normal ${name} script${L.articles.length ? ', without article' : ''}.` },
  };
  if (L.articles.length) {
    p.article = { type: 'STRING', enum: [...L.articles, 'none'], description: 'Only for nouns; "none" for other words.' };
  }
  if (L.reading) p.reading = { type: 'STRING', description: `How the lemma is read, in ${L.reading}.` };
  p.pos = { type: 'STRING', enum: ['noun', 'verb', 'adjective', 'adverb', 'phrase', 'other'] };
  p.meaning = { type: 'STRING', description: 'Short English meaning; separate senses with "; ".' };
  if (isGerman(L)) {
    p.plural = { type: 'STRING', description: 'Nouns: plural form without article, or "-" if none. Others: empty.' };
    p.verbForms = { type: 'STRING', description: 'Verbs: "3rd person present, Präteritum, Perfekt" e.g. "fährt, fuhr, ist gefahren", plus the governed preposition and case if any. Others: empty.' };
  } else {
    p.forms = { type: 'STRING', description: L.forms || `Key forms a learner must know, comma-separated (irregular plurals, main verb forms, the preposition or case the word governs). Empty if nothing notable.` };
    p.recallAnswer = { type: 'STRING', description: `Exactly what the learner must type to produce this word from its English meaning: the dictionary form${L.articles.length ? ' with its article for nouns' : ''}, in normal ${name} script${L.reading ? ' (not the reading)' : ''}.` };
  }
  p.register = { type: 'STRING', description: 'One short note on register/usage (formal, colloquial, regional, neutral).' };
  p.example = { type: 'STRING', description: `One natural ${name} example sentence for a learner at ${levelText(L)}.` };
  p.exampleTranslation = { type: 'STRING', description: 'English translation of the example.' };
  p.gapSentence = { type: 'STRING', description: `The context sentence if given (else the example) with the exact inflected form of the word replaced by "___".${isGerman(L) ? ' For separable verbs gap only the verb stem part.' : ''}` };
  p.gapAnswer = { type: 'STRING', description: 'The exact text that was replaced by ___.' };
  p.gapAcceptable = GAP_ACCEPTABLE;
  if (hasFurigana(L)) {
    p.exampleFurigana = furiganaOf('The example');
    p.gapFurigana = furiganaOf('gapSentence');
  }
  return p;
}

// A sentence with the word blanked out, for the gap-fill exercise.
export function gapProps(L, of) {
  return {
    gapSentence: { type: 'STRING', description: `${of} with the exact inflected form of the word replaced by "___".${isGerman(L) ? ' For separable verbs gap only the verb stem part.' : ''}` },
    gapAnswer: { type: 'STRING', description: 'The exact text that was replaced by ___.' },
    gapAcceptable: GAP_ACCEPTABLE,
  };
}

// Facts first, then the reasoning, then the decisions: Gemini writes fields in this order,
// so it has written the corrected sentence and named the pattern before it picks a rule and
// a category.
function mistakeSchema(c) {
  const wp = wordProps(c.L);
  const keep = ['lemma', 'article', 'reading', 'pos', 'meaning', 'plural', 'verbForms', 'forms', 'recallAnswer'];
  const toLearn = Object.fromEntries(keep.filter((k) => wp[k]).map((k) => [k, wp[k]]));
  const { rulePattern, rule, ...ruleRest } = ruleProps(c);
  return S({
    original: { type: 'STRING', description: 'The wrong words exactly as the learner wrote them.' },
    corrected: { type: 'STRING', description: 'The corrected words.' },
    sentence: { type: 'STRING', description: 'The full original sentence containing the mistake, verbatim.' },
    correctedSentence: { type: 'STRING', description: 'That sentence fully corrected.' },
    explanation: { type: 'STRING', description: 'One-line explanation.' },
    rulePattern, rule,
    category: { type: 'STRING', enum: categoriesFor(c.L).map((x) => x.id) },
    ...ruleRest,
    wordToLearn: S(toLearn, ['lemma', 'pos', 'meaning']),
  }, ['original', 'corrected', 'sentence', 'correctedSentence', 'explanation', 'rulePattern', 'rule', 'category', 'ruleName', 'ruleStatement', 'ruleLevel']);
}

// The grammar rule a mistake breaks. Shared by mistake records and classifyMistakes; the
// pattern comes first so the rule is chosen after it is named.
export function ruleProps(c) {
  const { L } = c;
  return {
    rulePattern: { type: 'STRING', description: 'English, at most 12 words: the general pattern behind this mistake, as it would apply to other words and sentences. "typo" if it is a one-off misspelling of one word.' },
    rule: { type: 'STRING', description: `The key of the one rule this mistake breaks (see "Rules for rule keys"), or "" for a typo and for ${NO_RULES.join(', ')}.` },
    ruleName: { type: 'STRING', description: `Only for a new key: a short name of the rule in ${explainLang(c)}, at most 6 words, e.g. "${isGerman(L) ? 'Perfekt mit sein bei Zustandswechsel' : 'は und が'}". Otherwise "".` },
    ruleStatement: { type: 'STRING', description: `Only for a new key: the rule in one short sentence in ${explainLang(c)}, general enough to apply to other sentences. Otherwise "".` },
    ruleLevel: { type: 'STRING', description: `Only for a new key: the level at which the rule is usually taught (${L.code === 'ja' ? 'JLPT N5 to N1, e.g. "N4"' : 'CEFR A1 to C2, e.g. "B1"'}). Otherwise "".` },
  };
}

// Worked examples from real misfiled mistakes (#30, #31). A small model follows a few
// concrete cases better than any amount of description.
const RULE_EXAMPLES = {
  de: `Examples:
- "Herauseforderung" → "Herausforderung": rulePattern "typo", rule "".
- "schon" → "schön" (missing umlaut): rulePattern "typo", rule "".
- "Strasse" → "Straße": rulePattern "ß after a long vowel", rule "ss_eszett".
- "Sie hofft die Prüfung bestehen" → "Sie hofft, die Prüfung zu bestehen": rulePattern "zu + infinitive after hoffen", rule "zu_infinitive" (not damit_um_zu: there is no purpose and no damit or um).
- "Ich gehe in die Stadt, damit ich einkaufe" → "…, um einzukaufen": rulePattern "um … zu when the subject is the same", rule "damit_um_zu".`,
  ja: `Examples:
- "勉境" → "勉強" (wrong kanji in one word): rulePattern "typo", rule "".
- "私が学生です" → "私は学生です": rulePattern "topic marked with は", rule "wa_vs_ga".`,
};

// How Gemini names rules: a standard rule only when its text describes this exact mistake,
// a rule the learner already has when it is the same pattern, else a new one of the same grain.
export function ruleRules({ L, rules: mine }) {
  const seeds = seedGuide(L.code);
  return `Rules for rule keys (fill rulePattern first, then rule, then category):
- A rule is a grammar or spelling pattern that would also cause mistakes in OTHER words or sentences, narrower than the category (e.g. "perfekt_sein_movement_change", not "verbs"). rulePattern names that pattern in plain English.
- A typo has no rule: one word misspelt with no pattern behind it (letters swapped, missing, extra or wrong${isGerman(L) ? ', a missing or extra umlaut' : ''}). Then rulePattern is "typo", rule, ruleName, ruleStatement and ruleLevel are "", and the category is spelling. The mistake is still recorded.
${seeds ? `- Standard rules (key: what it says [category]). Use a key ONLY if its text, read literally, describes this exact mistake. A rule about a similar topic, or in the same category, is wrong.
${seeds}
` : ''}${mine.length ? `- The learner's rules (category/key: name). Reuse one only if it is exactly the same pattern:
${mine.map((r) => `  - ${r.category}/${r.key}: ${r.name}`).join('\n')}
` : ''}- If nothing fits exactly, make a new snake_case key for the pattern, as narrow as the ones above, and fill ruleName, ruleStatement and ruleLevel.
- category: for a standard rule, the category in its brackets; otherwise the category from the list that fits the pattern. For ${NO_RULES.join(', ')}, rule is "".
${RULE_EXAMPLES[L.code] || ''}`;
}

// The three tones a sentence can be translated into. Shared with the app (labels) and tests.
export const TONES = ['everyday', 'formal', 'informal'];

export function toneGuide(L) {
  const de = isGerman(L);
  const ja = L.code === 'ja';
  return `Tones:
- everyday: natural spoken ${L.english} as people actually talk day to day (shops, colleagues, neighbours): relaxed but not slang${de ? ', common contractions such as "hab" or "gibt\'s" are fine' : ''}.
- formal: polite and professional (letters, officials, people you don't know well)${de ? ', with Sie' : ja ? ', in keigo (teineigo, plus sonkeigo or kenjougo where natural)' : ''}.
- informal: casual, with friends and family${de ? ', with du' : ja ? ', plain form' : ''}, colloquial expressions welcome.`;
}

// A more natural phrasing, offered next to corrections. Not a mistake: only a suggestion.
export function naturalProps(c) {
  return {
    natural: { type: 'STRING', description: `A more natural, idiomatic way a native ${c.L.english} speaker would say the whole text, keeping its meaning and tone. Only when the (corrected) text is clearly stiff, unidiomatic or a word-for-word translation; otherwise an empty string. Never just repeat the corrected text.` },
    naturalReason: { type: 'STRING', description: `If natural is set: one short line in ${explainLang(c)} on why it sounds more natural. Otherwise empty.` },
  };
}

export function cleanNatural(r, corrected) {
  const n = (r.natural || '').trim();
  if (!n || n === (corrected || '').trim()) { r.natural = ''; r.naturalReason = ''; }
  return r;
}

export const correctionProps = (c) => ({
  correctedText: { type: 'STRING', description: 'The whole text corrected, keeping the learner\'s meaning and style.' },
  mistakes: { type: 'ARRAY', items: mistakeSchema(c) },
});

export function correctionRules(c) {
  return `Rules for mistakes:
- One record per distinct mistake. Do not report stylistic preferences when the original is correct and natural.
- Pick exactly one category from this fixed list:
${categoryGuide(categoriesFor(c.L))}
- For word_choice mistakes, fill wordToLearn with the right word to learn (dictionary form). Leave wordToLearn out otherwise.
- Write explanations in ${explainLang(c)}.

${ruleRules(c)}`;
}

// The schema uses "none" because empty enum values are not allowed.
export function cleanWord(w) {
  if (w && w.article === 'none') w.article = '';
  return w;
}

export function cleanMistakes(r) {
  for (const m of r.mistakes || []) if (m.wordToLearn) cleanWord(m.wordToLearn);
  return r;
}

// "Check again": the learner thinks the first verdict ({ correct, feedback }) was wrong.
// Gemini looks again from scratch, at temperature 0, without giving in just because it was asked.
export function recheckNote(prev) {
  if (!prev) return '';
  return `\n\nThis is a second check, because the learner thinks the first verdict may be wrong. First verdict: ${prev.correct ? 'correct' : 'not correct'}${prev.feedback ? ` ("${prev.feedback}")` : ''}.
Check again carefully from scratch. Change the verdict if it was wrong; keep it if it was right. Do not change it only because the learner asked.`;
}
export const recheckTemp = (prev, temperature = 0.2) => (prev ? 0 : temperature);
