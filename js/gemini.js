// Gemini calls. Every call asks for structured JSON so lookups and mistakes can be stored
// and counted. The API key comes from this device's settings and is sent only to Google.
import { getApiKey, getSettings, setSettings, activeLanguage } from './store.js';
import { categoriesFor, categoryGuide, categoryLabel, finishCategories } from './categories.js';
import { lemmaOf, cleanExamples, MORE_EXAMPLES } from './languages.js';
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
  if (hasFurigana(L)) {
    p.exampleFurigana = furiganaOf('The example');
    p.gapFurigana = furiganaOf('gapSentence');
  }
  return p;
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
    wordToLearn: S(toLearn, ['lemma', 'pos', 'meaning']),
  }, ['original', 'corrected', 'explanation', 'category', 'sentence', 'correctedSentence']);
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
- Write explanations in ${explainLang(L)}.`;
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

const target = (word) => (word.article ? `${word.article} ${lemmaOf(word)}` : lemmaOf(word));

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
    type: 'ARRAY', items: S({ text: STR, translation: STR, ...(hasFurigana(L) ? { furigana: furiganaOf('text') } : {}) }),
    description: `Exactly ${MORE_EXAMPLES} more natural ${name} example sentences for a learner at ${levelText(L)}, each with its English translation. Each shows the word in a different situation or form than the example and each other.`,
  };
  if (hasFurigana(L) && context) props.contextFurigana = furiganaOf('The context sentence');
  const schema = S({ found: { type: 'BOOLEAN' }, ...props }, ['found', ...Object.keys(props)]);
  const r = cleanWord(await generate(prompt, schema));
  const extra = cleanExamples(r.moreExamples, r.example);
  r.moreExamples = extra.map(({ text, translation }) => ({ text, translation }));
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

export async function correctText(text) {
  const L = learner();
  const prompt = `You correct ${L.english} written by a learner at ${levelText(L)}. Correct this text:
"""${text}"""

${correctionRules(L)}
Separately, if the text would sound clearly more natural phrased differently, put that version in natural. That is a suggestion, not a mistake.`;
  const r = cleanMistakes(await generate(prompt, S({ ...correctionProps(L), ...naturalProps(L) })));
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
export async function gradeTranslation(item, answer) {
  const L = learner();
  const prompt = `A ${L.english} learner at ${levelText(L)} had to say this in ${L.english}, in the ${item.tone || 'everyday'} tone: "${item.meaning}"
A model answer: """${lemmaOf(item)}"""
Learner's answer: """${answer}"""
correct: true if the answer says the same thing in grammatically correct ${L.english}. Other correct phrasings than the model count as correct. The tone does NOT affect correct and is never a mistake.
toneMatches: false only if the answer clearly uses a different tone. Then toneHint says, in ${explainLang(L)}, how it would usually be said in the ${item.tone || 'everyday'} tone (give the phrasing).

${toneGuide(L)}

${correctionRules(L)}
- Never report the tone or register of the answer as a mistake.
Separately, if a correct answer would sound clearly more natural phrased differently, put that in natural.`;
  const r = cleanMistakes(await generate(prompt, S({
    correct: { type: 'BOOLEAN' },
    toneMatches: { type: 'BOOLEAN' },
    toneHint: { type: 'STRING', description: 'Empty when toneMatches is true.' },
    feedback: { type: 'STRING', description: `One or two encouraging sentences in ${explainLang(L)}.` },
    ...correctionProps(L),
    ...naturalProps(L),
  })));
  // Belt and braces: a tone mismatch never lands in the mistake profile.
  r.mistakes = (r.mistakes || []).filter((m) => m.category !== 'register');
  if (r.toneMatches) r.toneHint = '';
  return cleanNatural(r, r.correctedText);
}

// "Write a sentence" exercise: correct it and judge whether the target word is used well.
export async function gradeWordSentence(word, sentence) {
  const L = learner();
  const prompt = `A ${L.english} learner at ${levelText(L)} had to write an original sentence using "${target(word)}" (${word.meaning}).
Their sentence: """${sentence}"""
Judge whether the word is used correctly and naturally, and correct the sentence.

${correctionRules(L)}
Separately, if the sentence would sound clearly more natural phrased differently (still using the word), put that in natural.`;
  const r = cleanMistakes(await generate(prompt, S({
    usesWordCorrectly: { type: 'BOOLEAN' },
    feedback: { type: 'STRING', description: `One or two encouraging sentences in ${explainLang(L)}.` },
    ...correctionProps(L),
    ...naturalProps(L),
  })));
  return cleanNatural(r, r.correctedText);
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
    constraint: `A free-writing task: the instruction asks the learner to write one sentence that must use a specific structure from this category${word ? ` and the word "${target(word)}"` : ''}. prompt may be empty. answer is one model sentence.`,
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
export async function gradeAnswer({ instruction, prompt: shown, model, answer, category }) {
  const L = learner();
  const prompt = `A ${L.english} learner at ${levelText(L)} is doing a grammar exercise (focus: ${categoryLabel(category, 'en', categoriesFor(L))}).
Instruction: ${instruction}
${shown ? `Given: """${shown}"""` : ''}
A model answer: """${model}"""
Learner's answer: """${answer}"""
Decide if the learner's answer fulfils the task and is grammatically correct ${L.english}. Other correct solutions than the model answer count as correct.
Then list the learner's mistakes, if any.

${correctionRules(L)}`;
  return cleanMistakes(await generate(prompt, S({
    correct: { type: 'BOOLEAN' },
    feedback: { type: 'STRING', description: `One or two sentences in ${explainLang(L)}.` },
    ...correctionProps(L),
  })));
}

// Describes a language the learner wants to add: its code, how its words are written and
// learnt, and the grammar areas its learners most often get wrong. Called once per language.
export async function setupLanguage(name) {
  const prompt = `A learner wants to practise this language in a vocabulary and writing app: "${name}".
Describe it for the app. Explanations in the app are in English or German.
If this is not a real language with a written standard, set found to false.`;
  const r = await generate(prompt, S({
    found: { type: 'BOOLEAN' },
    code: { type: 'STRING', description: 'ISO 639-1 code, or ISO 639-3 if there is none. Lowercase.' },
    english: { type: 'STRING', description: 'The language name in English.' },
    articles: { type: 'ARRAY', items: STR, description: 'Article forms that show a noun\'s gender or class and that learners memorise with each noun, e.g. ["el", "la"] for Spanish or ["le", "la"] for French. Empty if the language has none.' },
    reading: { type: 'STRING', description: 'If the normal script does not show pronunciation (e.g. Chinese characters), the reading system to store with each word, e.g. "pinyin with tone marks". Otherwise empty.' },
    romanized: { type: 'STRING', description: 'If the language is not written in Latin script, the romanisation learners commonly type, e.g. "pinyin". Otherwise empty.' },
    categories: {
      type: 'ARRAY',
      description: '8 to 10 grammar areas where learners of this language most often make mistakes in writing, specific to this language. Do not include word choice, register, spelling or "other": the app adds those.',
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
