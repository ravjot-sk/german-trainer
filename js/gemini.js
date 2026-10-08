// Gemini calls. Every call asks for structured JSON so lookups and mistakes can be stored
// and counted. The API key comes from this device's settings and is sent only to Google.
import { getApiKey, getSettings, setSettings, activeLanguage, reviewItems } from './store.js';
import { categoriesFor, categoryGuide, categoryLabel, finishCategories, NO_RULES, SKELETON } from './categories.js';
import { knownRules, KINDS } from './rules.js';
import { seedGuide } from './ruleseeds.js';
import { lemmaOf, wordTitle, cleanExamples, MORE_EXAMPLES } from './languages.js';
import { parse as parseFurigana } from './furigana.js';
import { t, lang } from './i18n.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {}

export function canUseGemini() {
  return !!getApiKey() && navigator.onLine !== false;
}

async function request(model, body) {
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': getApiKey() },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function generate(prompt, schema, { temperature = 0.2 } = {}) {
  if (!getApiKey()) throw new GeminiError(t('err.noKey'));
  if (navigator.onLine === false) throw new GeminiError(t('err.offline'));
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema },
  };
  let model = getSettings().model || 'gemini-flash-latest';
  let { res, json } = await request(model, body);
  if (res.status === 404) {
    // The saved model name no longer exists: pick a current Flash model and retry once.
    const fallback = await pickDefaultModel();
    if (fallback && fallback !== model) {
      model = fallback;
      setSettings({ model });
      ({ res, json } = await request(model, body));
    }
  }
  if (!res.ok) {
    throw new GeminiError(t('err.api', { m: json?.error?.message || res.status }));
  }
  const text = (json.candidates?.[0]?.content?.parts || [])
    .filter((p) => !p.thought).map((p) => p.text || '').join('');
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new GeminiError(t('err.api', { m: 'invalid JSON' }));
  }
}

export async function listModels() {
  if (!getApiKey()) throw new GeminiError(t('err.noKey'));
  const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': getApiKey() } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new GeminiError(t('err.api', { m: json?.error?.message || res.status }));
  return (json.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => n.startsWith('gemini'));
}

async function pickDefaultModel() {
  try {
    const names = await listModels();
    const flash = names.filter((n) => /flash/.test(n) && !/lite|image|tts|audio|live|exp|preview/.test(n));
    if (names.includes('gemini-flash-latest')) return 'gemini-flash-latest';
    flash.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return flash[0] || names[0];
  } catch { return null; }
}

export async function testKey() {
  const r = await generate('Reply with {"ok": true}.', {
    type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'],
  });
  return { ok: !!r.ok, model: getSettings().model };
}

// ---------- schemas ----------
const S = (props, required) => ({ type: 'OBJECT', properties: props, required: required || Object.keys(props) });
const STR = { type: 'STRING' };

// Furigana for Japanese texts, as {kanji|reading} markup (see furigana.js).
const hasFurigana = (L) => L.code === 'ja';
const FURIGANA_RULE = 'write every kanji or run of kanji as {kanji|reading in hiragana}, reading it as it is read in this sentence, e.g. "{毎朝|まいあさ}{水|みず}を{飲|の}む". Only kanji go inside the braces, never the kana after them. Kana, punctuation, spaces and "___" stay exactly as they are.';
const furiganaOf = (what) => ({ type: 'STRING', description: `${what} again with furigana: ${FURIGANA_RULE}` });

// Moves the *Furigana fields of a reply into one list kept on the record, dropping any whose
// text does not match what it annotates.
function collectFurigana(r, pairs) {
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

// The language being practised, with the learner's level. Every prompt needs both.
function learner() {
  const L = activeLanguage();
  if (!L) throw new GeminiError(t('err.noLanguage'));
  if (!L.level) throw new GeminiError(t('err.noLevel'));
  return L;
}

const isGerman = (L) => L.code === 'de';
const levelText = (L) => `${L.level} level`;

function explainLang(L) {
  if (lang() === 'en') return 'English';
  return isGerman(L) ? `German (simple, clear German at ${levelText(L)})` : 'German (simple, clear German)';
}

// Word fields Gemini fills. German keeps its plural and verb forms (the recall check uses
// them); other languages get one free "forms" note and the exact recall answer.
function wordProps(L) {
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

// Other right fillings of a word's gap, so a correct answer in another form isn't marked wrong.
const GAP_ACCEPTABLE = { type: 'ARRAY', items: STR, description: 'Other forms of the word that would be just as correct and natural in the gap (e.g. plain instead of polite, another tense that fits), in normal script. Empty if only the answer fits.' };

// A sentence with the word blanked out, for the gap-fill exercise.
function gapProps(L, of) {
  return {
    gapSentence: { type: 'STRING', description: `${of} with the exact inflected form of the word replaced by "___".${isGerman(L) ? ' For separable verbs gap only the verb stem part.' : ''}` },
    gapAnswer: { type: 'STRING', description: 'The exact text that was replaced by ___.' },
    gapAcceptable: GAP_ACCEPTABLE,
  };
}

function mistakeSchema(L) {
  const wp = wordProps(L);
  const keep = ['lemma', 'article', 'reading', 'pos', 'meaning', 'plural', 'verbForms', 'forms', 'recallAnswer'];
  const toLearn = Object.fromEntries(keep.filter((k) => wp[k]).map((k) => [k, wp[k]]));
  return S({
    original: { type: 'STRING', description: 'The wrong words exactly as the learner wrote them.' },
    corrected: { type: 'STRING', description: 'The corrected words.' },
    explanation: { type: 'STRING', description: 'One-line explanation.' },
    category: { type: 'STRING', enum: categoriesFor(L).map((c) => c.id) },
    sentence: { type: 'STRING', description: 'The full original sentence containing the mistake, verbatim.' },
    correctedSentence: { type: 'STRING', description: 'That sentence fully corrected.' },
    ...ruleProps(L),
    wordToLearn: S(toLearn, ['lemma', 'pos', 'meaning']),
  }, ['original', 'corrected', 'explanation', 'category', 'sentence', 'correctedSentence', 'rule', 'ruleName', 'ruleStatement', 'ruleLevel']);
}

// The grammar rule a mistake breaks. Shared by mistake records and classifyMistakes.
function ruleProps(L) {
  return {
    rule: { type: 'STRING', description: `snake_case English key of the one grammar rule this mistake breaks (see "Rules for rule keys"). Empty for ${NO_RULES.join(', ')}.` },
    ruleName: { type: 'STRING', description: `Short name of that rule in ${explainLang(L)}, at most 6 words, e.g. "${isGerman(L) ? 'Perfekt mit sein bei Zustandswechsel' : 'は und が'}". Empty if rule is empty.` },
    ruleStatement: { type: 'STRING', description: `The rule itself in one short sentence in ${explainLang(L)}, general enough to apply to other sentences. Empty if rule is empty.` },
    ruleLevel: { type: 'STRING', description: `The level at which the rule is usually taught (${L.code === 'ja' ? 'JLPT N5 to N1, e.g. "N4"' : 'CEFR A1 to C2, e.g. "B1"'}). Empty if rule is empty.` },
  };
}

// How Gemini names rules: reuse a key the learner already has, else one of the starting
// rules, else a new one of the same grain.
function ruleRules(L) {
  const mine = knownRules(reviewItems(), L.code);
  const seeds = seedGuide(L.code);
  return `Rules for rule keys:
- A rule is one specific, teachable grammar point (narrower than the category), e.g. "perfekt_sein_movement_change", not "verbs".
- Two mistakes that break the same rule must get the same key, even in different sentences.
${mine.length ? `- The learner already has these rules. Reuse the key when the mistake is the same rule:\n${mine.map((r) => `  - ${r.category}/${r.key}: ${r.name}`).join('\n')}\n` : ''}${seeds ? `- Otherwise prefer one of these standard rules when it fits:\n${seeds}\n` : ''}- Only when none fits, make a new key of the same grain.
- The rule's category must be the mistake's category. For ${NO_RULES.join(', ')} leave rule, ruleName, ruleStatement and ruleLevel empty.`;
}

// The three tones a sentence can be translated into. Shared with the app (labels) and tests.
export const TONES = ['everyday', 'formal', 'informal'];

function toneGuide(L) {
  const de = isGerman(L);
  const ja = L.code === 'ja';
  return `Tones:
- everyday: natural spoken ${L.english} as people actually talk day to day (shops, colleagues, neighbours): relaxed but not slang${de ? ', common contractions such as "hab" or "gibt\'s" are fine' : ''}.
- formal: polite and professional (letters, officials, people you don't know well)${de ? ', with Sie' : ja ? ', in keigo (teineigo, plus sonkeigo or kenjougo where natural)' : ''}.
- informal: casual, with friends and family${de ? ', with du' : ja ? ', plain form' : ''}, colloquial expressions welcome.`;
}

// A more natural phrasing, offered next to corrections. Not a mistake: only a suggestion.
function naturalProps(L) {
  return {
    natural: { type: 'STRING', description: `A more natural, idiomatic way a native ${L.english} speaker would say the whole text, keeping its meaning and tone. Only when the (corrected) text is clearly stiff, unidiomatic or a word-for-word translation; otherwise an empty string. Never just repeat the corrected text.` },
    naturalReason: { type: 'STRING', description: `If natural is set: one short line in ${explainLang(L)} on why it sounds more natural. Otherwise empty.` },
  };
}

function cleanNatural(r, corrected) {
  const n = (r.natural || '').trim();
  if (!n || n === (corrected || '').trim()) { r.natural = ''; r.naturalReason = ''; }
  return r;
}

const correctionProps = (L) => ({
  correctedText: { type: 'STRING', description: 'The whole text corrected, keeping the learner\'s meaning and style.' },
  mistakes: { type: 'ARRAY', items: mistakeSchema(L) },
});

function correctionRules(L) {
  return `Rules for mistakes:
- One record per distinct mistake. Do not report stylistic preferences when the original is correct and natural.
- Pick exactly one category from this fixed list:
${categoryGuide(categoriesFor(L))}
- For word_choice mistakes, fill wordToLearn with the right word to learn (dictionary form). Leave wordToLearn out otherwise.
- Write explanations in ${explainLang(L)}.

${ruleRules(L)}`;
}

// The schema uses "none" because empty enum values are not allowed.
function cleanWord(w) {
  if (w && w.article === 'none') w.article = '';
  return w;
}

function cleanMistakes(r) {
  for (const m of r.mistakes || []) if (m.wordToLearn) cleanWord(m.wordToLearn);
  return r;
}

// "Check again": the learner thinks the first verdict ({ correct, feedback }) was wrong.
// Gemini looks again from scratch, at temperature 0, without giving in just because it was asked.
function recheckNote(prev) {
  if (!prev) return '';
  return `\n\nThis is a second check, because the learner thinks the first verdict may be wrong. First verdict: ${prev.correct ? 'correct' : 'not correct'}${prev.feedback ? ` ("${prev.feedback}")` : ''}.
Check again carefully from scratch. Change the verdict if it was wrong; keep it if it was right. Do not change it only because the learner asked.`;
}
const recheckTemp = (prev, temperature = 0.2) => ({ temperature: prev ? 0 : temperature });

// ---------- features ----------
export async function lookup(query, context) {
  const L = learner();
  const name = L.english;
  const prompt = `You are a ${name} dictionary for a learner at ${levelText(L)} whose working language is English.
Query: "${query}"
${context ? `Context sentence where the learner found it: "${context}"\nUse the sense that fits this context.` : ''}
If the query is English${L.romanized ? ` or ${name} written in ${L.romanized}` : ''}, return the most common ${name} equivalent. If it is an inflected ${name} form, return the dictionary form.
If the query is not a real word in either language, set found to false.`;
  const props = wordProps(L);
  props.moreExamples = {
    type: 'ARRAY', items: S({ text: STR, translation: STR, ...gapProps(L, 'text'), ...(hasFurigana(L) ? { furigana: furiganaOf('text') } : {}) }),
    description: `Exactly ${MORE_EXAMPLES} more natural ${name} example sentences for a learner at ${levelText(L)}, each with its English translation. Each shows the word in a different situation or form than the example and each other.`,
  };
  if (hasFurigana(L) && context) props.contextFurigana = furiganaOf('The context sentence');
  const schema = S({ found: { type: 'BOOLEAN' }, ...props }, ['found', ...Object.keys(props)]);
  const r = cleanWord(await generate(prompt, schema));
  const extra = cleanExamples(r.moreExamples, r.example);
  r.moreExamples = extra.map(({ text, translation }) => ({ text, translation }));
  // The gapped extras only seed the word's gap sentences (gappool.poolFromLookup).
  r.moreGaps = extra.map(({ gapSentence, gapAnswer, gapAcceptable, translation }) => ({ gapSentence, gapAnswer, gapAcceptable, translation }));
  if (!hasFurigana(L)) return r;
  collectFurigana(r, [['exampleFurigana', (x) => x.example], ['gapFurigana', (x) => x.gapSentence],
    ['contextFurigana', () => context]]);
  for (const e of extra) if (e.furigana && parseFurigana(e.furigana, e.text)) r.furigana.push(e.furigana);
  return r;
}

// Random words that fit the learner's level, as full dictionary entries like a lookup.
// exclude: dictionary forms the learner already has. topic: optional theme.
export async function suggestWords(n, { topic = '', exclude = [] } = {}) {
  const L = learner();
  const name = L.english;
  const prompt = `You pick new ${name} vocabulary for a learner at ${levelText(L)} whose working language is English.
Suggest ${n} different words that suit this level: useful words the learner will need to speak and write, not ones every beginner knows and not rare or specialist ones. Mix nouns, verbs, adjectives and a phrase or two.
${topic ? `Topic: "${topic}". All words should fit it.` : 'Vary the topics (work, everyday life, feelings, society, travel, ...).'}
${exclude.length ? `The learner already has these, so do not suggest them: ${exclude.join(', ')}` : ''}
Fill every field for each word as a dictionary entry would.`;
  const props = wordProps(L);
  const r = await generate(prompt, S({ words: { type: 'ARRAY', items: S(props) } }), { temperature: 1 });
  return (r.words || []).filter((w) => w && w.lemma).map((w) => {
    cleanWord(w);
    return hasFurigana(L) ? collectFurigana(w, [['exampleFurigana', (x) => x.example], ['gapFurigana', (x) => x.gapSentence]]) : w;
  });
}

export async function correctText(text, { recheck } = {}) {
  const L = learner();
  const prompt = `You correct ${L.english} written by a learner at ${levelText(L)}. Correct this text:
"""${text}"""

${correctionRules(L)}
Separately, if the text would sound clearly more natural phrased differently, put that version in natural. That is a suggestion, not a mistake.${recheckNote(recheck)}`;
  const r = cleanMistakes(await generate(prompt, S({ ...correctionProps(L), ...naturalProps(L) }), recheckTemp(recheck)));
  return cleanNatural(r, r.correctedText);
}

// Translates a sentence (English or any language) into the language being learnt, in a tone.
// keep: the text is already in that language (a suggestion being saved), so only describe it;
// tone is then detected.
export async function translateSentence(text, tone = 'everyday', { keep = false } = {}) {
  const L = learner();
  const name = L.english;
  const unspaced = L.code === 'ja' || /^(zh|th|lo|km|my)$/.test(L.code);
  const task = keep
    ? `This ${name} text is correct and natural. Keep it exactly as given in sentence, and work out which tone it has.
Text: """${text}"""`
    : `Translate this text into natural ${name} in the ${tone} tone. If it is already ${name}, rewrite it in that tone.
Text: """${text}"""
Match what a native speaker would really say in that tone, not a word-for-word translation.`;
  const props = {
    sentence: { type: 'STRING', description: `The ${name} sentence (or short text) in normal ${name} script.` },
    ...(L.reading ? { reading: { type: 'STRING', description: `The sentence read aloud, in ${L.reading}.` } } : {}),
    translation: { type: 'STRING', description: 'Natural English meaning of the sentence.' },
    tone: { type: 'STRING', enum: TONES },
    toneNote: { type: 'STRING', description: `One short line in ${explainLang(L)} on what makes it sound ${keep ? 'like this tone' : tone} (forms of address, verb forms, word choice, contractions).` },
    chunks: { type: 'ARRAY', items: STR, description: `The sentence split, in order, into 3 to 9 meaningful pieces for a word-order exercise (short phrases or single words, punctuation attached to the piece before it). Joined ${unspaced ? 'without spaces' : 'with single spaces'} they must give the sentence exactly.` },
    gapSentence: { type: 'STRING', description: 'The sentence with its most useful phrase or expression (the part a learner would most likely not produce on their own) replaced by "___".' },
    gapAnswer: { type: 'STRING', description: 'The exact text that was replaced by ___.' },
    ...(hasFurigana(L) ? { sentenceFurigana: furiganaOf('The sentence'), gapFurigana: furiganaOf('gapSentence') } : {}),
    keyWords: {
      type: 'ARRAY', description: `Up to 4 words or expressions from the sentence worth learning for a learner at ${levelText(L)}, in dictionary form. Skip very basic words.`,
      items: S({ lemma: STR, meaning: { type: 'STRING', description: 'Short English meaning.' } }),
    },
  };
  const prompt = `You help a ${name} learner at ${levelText(L)} whose working language is English say whole sentences.
${task}

${toneGuide(L)}`;
  const r = await generate(prompt, S(props), { temperature: 0.4 });
  if (keep) r.sentence = text.trim();
  if (!TONES.includes(r.tone)) r.tone = keep ? 'everyday' : tone;
  if (hasFurigana(L)) collectFurigana(r, [['sentenceFurigana', (x) => (x.sentence || '').trim()], ['gapFurigana', (x) => x.gapSentence]]);
  return r;
}

// "Say this sentence" exercise: the learner translates a saved sentence's English meaning.
// A different tone than the saved one is not a mistake, only a hint.
export async function gradeTranslation(item, answer, { recheck } = {}) {
  const L = learner();
  const prompt = `A ${L.english} learner at ${levelText(L)} had to say this in ${L.english}, in the ${item.tone || 'everyday'} tone: "${item.meaning}"
A model answer: """${lemmaOf(item)}"""
Learner's answer: """${answer}"""
correct: true if the answer says the same thing in grammatically correct ${L.english}. Other correct phrasings than the model count as correct. The tone does NOT affect correct and is never a mistake.
toneMatches: false only if the answer clearly uses a different tone. Then toneHint says, in ${explainLang(L)}, how it would usually be said in the ${item.tone || 'everyday'} tone (give the phrasing).

${toneGuide(L)}

${correctionRules(L)}
- Never report the tone or register of the answer as a mistake.
Separately, if a correct answer would sound clearly more natural phrased differently, put that in natural.${recheckNote(recheck)}`;
  const r = cleanMistakes(await generate(prompt, S({
    correct: { type: 'BOOLEAN' },
    toneMatches: { type: 'BOOLEAN' },
    toneHint: { type: 'STRING', description: 'Empty when toneMatches is true.' },
    feedback: { type: 'STRING', description: `One or two encouraging sentences in ${explainLang(L)}.` },
    ...correctionProps(L),
    ...naturalProps(L),
  }), recheckTemp(recheck)));
  // Belt and braces: a tone mismatch never lands in the mistake profile.
  r.mistakes = (r.mistakes || []).filter((m) => m.category !== 'register');
  if (r.toneMatches) r.toneHint = '';
  return cleanNatural(r, r.correctedText);
}

// "Write a sentence" exercise: correct it and judge whether the target word is used well.
export async function gradeWordSentence(word, sentence, { recheck } = {}) {
  const L = learner();
  const prompt = `A ${L.english} learner at ${levelText(L)} had to write an original sentence using "${wordTitle(word)}" (${word.meaning}).
Their sentence: """${sentence}"""
Judge whether the word is used correctly and naturally, and correct the sentence.

${correctionRules(L)}
Separately, if the sentence would sound clearly more natural phrased differently (still using the word), put that in natural.${recheckNote(recheck)}`;
  const r = cleanMistakes(await generate(prompt, S({
    usesWordCorrectly: { type: 'BOOLEAN' },
    gapSentence: { type: 'STRING', description: 'If the word is used correctly: the corrected sentence with the exact form of the word replaced by "___". Otherwise empty.' },
    gapAnswer: { type: 'STRING', description: 'The exact text replaced by ___, or empty.' },
    gapAcceptable: GAP_ACCEPTABLE,
    feedback: { type: 'STRING', description: `One or two encouraging sentences in ${explainLang(L)}.` },
    ...correctionProps(L),
    ...naturalProps(L),
  }), recheckTemp(recheck)));
  return cleanNatural(r, r.correctedText);
}

// New gap-fill sentences for several words in one call. list: [{ word, level, existing }],
// level 1-3 (1: short everyday sentence, 3: demanding context). Returns one list per word,
// in order: [{ sentence (with ___), answer, translation }].
export const GAP_LEVELS = {
  1: 'short, everyday sentences using the most common form of the word',
  2: 'sentences using a different form, case or tense than the basic one, in a less obvious situation',
  3: 'longer sentences with a subordinate clause or an idiomatic, less common use of the word',
};
export async function gapSentences(list, n = 3) {
  const L = learner();
  const name = L.english;
  const lines = list.map((x, i) => `${i + 1}. "${wordTitle(x.word)}" (${x.word.meaning}). Difficulty: ${GAP_LEVELS[x.level] || GAP_LEVELS[1]}.${x.existing.length
    ? ` Already used, so write different ones: ${x.existing.map((s) => `"${s}"`).join('; ')}` : ''}`).join('\n');
  const prompt = `Write gap-fill exercises for a ${name} learner at ${levelText(L)}. For each word below write ${n} new, natural ${name} sentences, each showing the word in a different situation, then replace the exact form of the word in the sentence with "___".${isGerman(L) ? ' For separable verbs gap only the verb stem part.' : ''}
Return one entry per word, in the same order.
${lines}`;
  const r = await generate(prompt, S({
    words: { type: 'ARRAY', items: S({
      sentences: { type: 'ARRAY', items: S({
        sentence: { type: 'STRING', description: 'The sentence with the word replaced by "___".' },
        answer: { type: 'STRING', description: 'The exact text replaced by ___.' },
        acceptable: GAP_ACCEPTABLE,
        translation: { type: 'STRING', description: 'English translation of the full sentence.' },
      }) },
    }) },
  }), { temperature: 0.8 });
  return list.map((_, i) => r.words?.[i]?.sentences || []);
}

// A second opinion on a gap answer the local check found wrong: whether it is the word, in a
// form that is correct and natural in that sentence. Returns { correct, feedback }.
export async function checkGap(word, gap, answer, { recheck } = {}) {
  const L = learner();
  const prompt = `A ${L.english} learner at ${levelText(L)} is filling a gap with a form of "${wordTitle(word)}" (${word.meaning}).
Sentence: """${gap.sentence}"""
Expected: """${gap.answer}"""${(gap.acceptable || []).length ? ` (also fine: ${gap.acceptable.map((x) => `"${x}"`).join(', ')})` : ''}
Learner's answer: """${answer}"""
correct is true when the learner's answer is a form of this word that makes the sentence grammatical and natural, even if it differs from the expected one (another politeness level or tense${L.reading ? `, or written in ${L.reading} instead of its usual script` : ''}). It is false for another word, a form that doesn't fit the sentence, or a misspelling.${recheckNote(recheck)}`;
  const r = await generate(prompt, S({
    correct: { type: 'BOOLEAN' },
    feedback: { type: 'STRING', description: `One short sentence in ${explainLang(L)}.` },
  }), { temperature: 0 });
  return { correct: !!r.correct, feedback: String(r.feedback || '') };
}

// Grammar drills for a weak category. kind: gapfill | transform | constraint.
export async function generateDrill(category, kind, { examples = [], word = null } = {}) {
  const L = learner();
  const name = L.english;
  const list = categoriesFor(L);
  const label = categoryLabel(category, 'en', list);
  const hint = list.find((c) => c.id === category)?.hint;
  const own = examples.length
    ? `The learner's own past mistakes in this category (use them as inspiration, but do not copy them):\n${examples.map((m) => `- wrote "${m.original}" instead of "${m.corrected}"`).join('\n')}`
    : '';
  const kinds = {
    gapfill: `A single ${name} sentence with exactly one gap written as "___" that tests this category (e.g. ${isGerman(L) ? 'an ending, a preposition, an auxiliary' : 'an ending, a particle, a verb form'}). answer is the exact text for the gap; acceptableAnswers lists other fully correct fillings.`,
    transform: isGerman(L)
      ? 'A transformation task: give one or two German sentences in prompt and an instruction such as combining with "weil", moving to the Perfekt, or switching to indirect speech, so that the result tests this category. answer is the model result sentence.'
      : `A transformation task: give one or two ${name} sentences in prompt and an instruction such as combining them, changing the tense, or changing the politeness level, so that the result tests this category. answer is the model result sentence.`,
    constraint: `A free-writing task: the instruction asks the learner to write one sentence that must use a specific structure from this category${word ? ` and the word "${wordTitle(word)}"` : ''}. prompt may be empty. answer is one model sentence.`,
  };
  const prompt = `Create one ${name} grammar exercise for a learner at ${levelText(L)}.
Category: ${label}${hint ? ` (${hint})` : ''}
Exercise type: ${kinds[kind]}
${own}
Write the instruction in ${explainLang(L)}. Keep sentences natural and everyday (work, travel, friends, news), with vocabulary and grammar that suit the learner's level.`;
  const r = await generate(prompt, S({
    instruction: STR,
    prompt: { type: 'STRING', description: `${name} sentence(s) shown to the learner; for gapfill it contains ___.` },
    answer: STR,
    acceptableAnswers: { type: 'ARRAY', items: STR },
    explanation: { type: 'STRING', description: `Why the answer is right, in ${explainLang(L)}.` },
    ...(hasFurigana(L) ? { promptFurigana: furiganaOf('prompt (empty if prompt is empty)'), answerFurigana: furiganaOf('answer') } : {}),
  }), { temperature: 0.9 });
  if (!hasFurigana(L)) return r;
  // A gapfill answer is shown in its sentence afterwards, so the filled sentence gets furigana too.
  const valid = (m, plain) => (m && plain && parseFurigana(m, plain) ? m : '');
  const pm = valid(r.promptFurigana, r.prompt);
  const am = valid(r.answerFurigana, r.answer) || r.answer || '';
  collectFurigana(r, [['promptFurigana', (x) => x.prompt], ['answerFurigana', (x) => x.answer]]);
  if (pm.includes('___')) r.furigana.push(pm.replace('___', am));
  return r;
}

// One set of exercises per rule, one for each rung of the ladder (see rules.js). Each set
// trains the rule itself: new sentences every time, the learner's own mistakes only as a hint
// of what goes wrong. list: [{ rule, examples: [mistake] }]. Returns one set per rule, in order.
export async function ruleExercises(list) {
  if (!list.length) return [];
  const L = learner();
  const name = L.english;
  const lines = list.map(({ rule, examples = [] }, i) => `${i + 1}. ${rule.name}${rule.statement ? `: ${rule.statement}` : ''} (category ${categoryLabel(rule.category, 'en', categoriesFor(L))}${rule.level ? `, level ${rule.level}` : ''})${examples.length
    ? `\n   The learner got it wrong like this: ${examples.slice(0, 3).map((m) => `"${m.original}" instead of "${m.corrected}"`).join('; ')}` : ''}`).join('\n');
  const prompt = `Write grammar exercises for a ${name} learner at ${levelText(L)}. Each exercise must train exactly the rule named, in fresh everyday sentences (work, travel, friends, home, news) with vocabulary that suits the learner's level. Never reuse the learner's own sentences.
For each rule below, write one exercise of each kind:
- pair: two versions of the same ${name} sentence that differ only where the rule decides. correct follows the rule, wrong breaks it the way learners do.
- gap: one sentence with "___" exactly where the rule decides (e.g. the auxiliary, the ending, the particle, the comma). answer is the exact text for the gap; acceptable lists other fully correct fillings. If the gap needs a base form to be fair, put it in brackets after the gap, e.g. "___ (passieren)".
- transform: an instruction and 3 short items, each a ${name} sentence or phrase to change (into another tense, into a subordinate clause, into a noun phrase …) so that the result needs the rule. Use different verbs or nouns in each item. answer is the model result, acceptable other correct results.
- spot: a short text of 2 or 3 ${name} sentences with 1 or 2 mistakes against this rule and no other mistakes. corrected is the same text with only those mistakes fixed.
- produce: an instruction to write one new sentence that needs the rule, in a situation the learner has not seen (give the situation and, if useful, a word to use). model is one model sentence.
Write instructions and explanations in ${explainLang(L)}. Give each kind a one-line explanation of the rule as it applies there.

Rules:
${lines}`;
  const alt = { type: 'ARRAY', items: STR };
  const r = await generate(prompt, S({
    sets: { type: 'ARRAY', items: S({
      pair: S({ correct: STR, wrong: STR, explanation: STR }),
      gap: S({ sentence: { type: 'STRING', description: 'Contains ___ once.' }, answer: STR, acceptable: alt, explanation: STR }),
      transform: S({ instruction: STR, items: { type: 'ARRAY', items: S({ prompt: STR, answer: STR, acceptable: alt }) }, explanation: STR }),
      spot: S({ text: STR, corrected: STR, explanation: STR }),
      produce: S({ instruction: STR, model: STR, explanation: STR }),
    }) },
  }), { temperature: 0.9 });
  return list.map((_, i) => {
    const set = r.sets?.[i] || {};
    for (const k of KINDS) if (set[k]) set[k].id = `${Date.now().toString(36)}${i}${k}`;
    return set;
  });
}

// Sorts older mistakes into the current categories and gives each its rule. list: mistakes.
// Returns one { category, rule, ruleName, ruleStatement, ruleLevel } per mistake, in order.
export async function classifyMistakes(list) {
  if (!list.length) return [];
  const L = learner();
  const cats = categoriesFor(L);
  const prompt = `These are mistakes a ${L.english} learner at ${levelText(L)} made in writing, with their corrections.
For each one, pick its category from this fixed list and name the grammar rule it breaks.
${categoryGuide(cats)}

${ruleRules(L)}

Mistakes:
${list.map((m, i) => `${i + 1}. wrote "${m.original}" instead of "${m.corrected}"${m.fullSentence ? ` in "${m.fullSentence}"` : ''}${m.explanation ? ` (${m.explanation})` : ''}`).join('\n')}`;
  const r = await generate(prompt, S({
    mistakes: { type: 'ARRAY', items: S({ category: { type: 'STRING', enum: cats.map((c) => c.id) }, ...ruleProps(L) }) },
  }));
  return list.map((_, i) => r.mistakes?.[i] || null);
}

// Furigana for Japanese texts saved before Gemini added it. Returns the markup for each text
// that came back valid.
export async function annotate(texts) {
  if (!texts.length) return [];
  const prompt = `Add furigana to each of these Japanese texts. For each text, in the same order, ${FURIGANA_RULE}
${texts.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
  const r = await generate(prompt, S({ texts: { type: 'ARRAY', items: STR, description: 'The texts with furigana, same order and count.' } }), { temperature: 0 });
  return (r.texts || []).filter((m, i) => texts[i] && parseFurigana(m, texts[i]));
}

// Grades a free answer to a drill (transform, constraint or "fix your sentence").
export async function gradeAnswer({ instruction, prompt: shown, model, answer, category, rule = null, recheck = null }) {
  const L = learner();
  const prompt = `A ${L.english} learner at ${levelText(L)} is doing a grammar exercise (focus: ${categoryLabel(category, 'en', categoriesFor(L))}${rule ? `, rule: ${rule.name}${rule.statement ? ` (${rule.statement})` : ''}` : ''}).
Instruction: ${instruction}
${shown ? `Given: """${shown}"""` : ''}
A model answer: """${model}"""
Learner's answer: """${answer}"""
Decide if the learner's answer fulfils the task and is grammatically correct ${L.english}. Other correct solutions than the model answer count as correct.
Then list the learner's mistakes, if any.

${correctionRules(L)}${recheckNote(recheck)}`;
  return cleanMistakes(await generate(prompt, S({
    correct: { type: 'BOOLEAN' },
    feedback: { type: 'STRING', description: `One or two sentences in ${explainLang(L)}.` },
    ...correctionProps(L),
  }), recheckTemp(recheck)));
}

// "Check again" on an exercise the app checks itself (a word, a gap, word order, a choice):
// Gemini judges the answer against the expected one. Other correct answers count; a small slip
// in an otherwise right answer (a typo, a missing accent) is minor. Returns
// { correct, minor, feedback }.
export async function judgeAnswer({ instruction, shown = '', expected, answer, recheck = null }) {
  const L = learner();
  const prompt = `A ${L.english} learner at ${levelText(L)} is doing an exercise.
Task: ${instruction}
${shown ? `Shown to the learner: """${shown}"""\n` : ''}Expected answer: """${expected}"""
Learner's answer: """${answer}"""
correct is true when the learner's answer fulfils the task and is correct ${L.english}, even if it differs from the expected answer (another correct word, form or word order). minor is true when the answer is right except for a small slip such as a typo or a missing accent; then correct is false.${recheckNote(recheck)}`;
  const r = await generate(prompt, S({
    correct: { type: 'BOOLEAN' },
    minor: { type: 'BOOLEAN' },
    feedback: { type: 'STRING', description: `One or two short sentences in ${explainLang(L)}.` },
  }), { temperature: 0 });
  return { correct: !!r.correct, minor: !r.correct && !!r.minor, feedback: String(r.feedback || '') };
}

// English translations of texts in the language being learnt, in the same order.
export async function translateTexts(texts) {
  if (!texts.length) return [];
  const L = learner();
  const prompt = `Translate each of these ${L.english} texts into natural English, keeping the meaning and tone. Return them in the same order.
${texts.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
  const r = await generate(prompt, S({ translations: { type: 'ARRAY', items: STR, description: 'The English translations, same order and count.' } }), { temperature: 0 });
  return texts.map((_, i) => String(r.translations?.[i] || '').trim());
}

// Describes a language the learner wants to add: its code, how its words are written and
// learnt, and the grammar areas its learners most often get wrong. Called once per language.
export async function setupLanguage(name) {
  const prompt = `A learner wants to practise this language in a vocabulary and writing app: "${name}".
Describe it for the app. Explanations in the app are in English or German.
If this is not a real language with a written standard, set found to false.

For categories, go through this checklist of grammar areas, which comes from research on
learner errors. For each area that exists in this language, give one category named the way
it is taught for this language (split an area in two when learners of this language treat
the halves as separate topics, e.g. particles vs postpositions). Leave out areas the language
does not have (e.g. articles in a language without them). Then add any area that is central
for learners of this language but missing from the list (e.g. tones, aspect pairs, counters).
Aim for 8 to 16 categories in total.
${SKELETON.map((x) => `- ${x}`).join('\n')}`;
  const r = await generate(prompt, S({
    found: { type: 'BOOLEAN' },
    code: { type: 'STRING', description: 'ISO 639-1 code, or ISO 639-3 if there is none. Lowercase.' },
    english: { type: 'STRING', description: 'The language name in English.' },
    articles: { type: 'ARRAY', items: STR, description: 'Article forms that show a noun\'s gender or class and that learners memorise with each noun, e.g. ["el", "la"] for Spanish or ["le", "la"] for French. Empty if the language has none.' },
    reading: { type: 'STRING', description: 'If the normal script does not show pronunciation (e.g. Chinese characters), the reading system to store with each word, e.g. "pinyin with tone marks". Otherwise empty.' },
    romanized: { type: 'STRING', description: 'If the language is not written in Latin script, the romanisation learners commonly type, e.g. "pinyin". Otherwise empty.' },
    categories: {
      type: 'ARRAY',
      description: 'The grammar areas where learners of this language make mistakes in writing (see the checklist in the prompt), named for this language. Do not include word choice, register, spelling or "other": the app adds those.',
      items: S({
        id: { type: 'STRING', description: 'Short snake_case English id.' },
        en: { type: 'STRING', description: 'Short English label.' },
        de: { type: 'STRING', description: 'The same label in German.' },
        hint: { type: 'STRING', description: 'A few typical examples in the language.' },
      }),
    },
  }, ['found', 'code', 'english', 'articles', 'reading', 'romanized', 'categories']));
  if (!r.found || !/^[a-z]{2,3}$/.test((r.code || '').toLowerCase())) return null;
  return {
    code: r.code.toLowerCase(), english: r.english || name,
    articles: (r.articles || []).map((a) => String(a).trim()).filter(Boolean).slice(0, 8),
    reading: r.reading || '', romanized: r.romanized || '',
    categories: finishCategories(r.categories),
  };
}
