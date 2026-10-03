// Gemini calls. Every call asks for structured JSON so lookups and mistakes can be stored
// and counted. The API key comes from this device's settings and is sent only to Google.
import { getApiKey, getSettings, setSettings } from './store.js';
import { CATEGORY_IDS, categoryGuide, categoryLabel } from './categories.js';
import { t, lang } from './i18n.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {}

export function canUseGemini() {
  return !!getApiKey() && navigator.onLine !== false;
}

function explainLang() {
  return lang() === 'en' ? 'English' : 'German (simple, clear B2-level German)';
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

const WORD_PROPS = {
  german: { type: 'STRING', description: 'Dictionary form (lemma) without article. Nouns capitalised. Reflexive verbs as "sich ...".' },
  article: { type: 'STRING', enum: ['der', 'die', 'das', 'none'], description: 'Only for nouns; "none" for other words.' },
  pos: { type: 'STRING', enum: ['noun', 'verb', 'adjective', 'adverb', 'phrase', 'other'] },
  meaning: { type: 'STRING', description: 'Short English meaning; separate senses with "; ".' },
  plural: { type: 'STRING', description: 'Nouns: plural form without article, or "-" if none. Others: empty.' },
  verbForms: { type: 'STRING', description: 'Verbs: "3rd person present, Präteritum, Perfekt" e.g. "fährt, fuhr, ist gefahren", plus the governed preposition and case if any. Others: empty.' },
  register: { type: 'STRING', description: 'One short note on register/usage (formal, colloquial, regional, neutral).' },
  example: { type: 'STRING', description: 'One natural German example sentence at B2 level.' },
  exampleTranslation: { type: 'STRING', description: 'English translation of the example.' },
  gapSentence: { type: 'STRING', description: 'The context sentence if given (else the example) with the exact inflected form of the word replaced by "___". For separable verbs gap only the verb stem part.' },
  gapAnswer: { type: 'STRING', description: 'The exact text that was replaced by ___.' },
};

const MISTAKE_SCHEMA = S({
  original: { type: 'STRING', description: 'The wrong words exactly as the learner wrote them.' },
  corrected: { type: 'STRING', description: 'The corrected words.' },
  explanation: { type: 'STRING', description: 'One-line explanation.' },
  category: { type: 'STRING', enum: CATEGORY_IDS },
  sentence: { type: 'STRING', description: 'The full original sentence containing the mistake, verbatim.' },
  correctedSentence: { type: 'STRING', description: 'That sentence fully corrected.' },
  wordToLearn: S({
    german: WORD_PROPS.german, article: WORD_PROPS.article, pos: WORD_PROPS.pos,
    meaning: WORD_PROPS.meaning, plural: WORD_PROPS.plural, verbForms: WORD_PROPS.verbForms,
  }, ['german', 'pos', 'meaning']),
}, ['original', 'corrected', 'explanation', 'category', 'sentence', 'correctedSentence']);

const CORRECTION_PROPS = {
  correctedText: { type: 'STRING', description: 'The whole text corrected, keeping the learner\'s meaning and style.' },
  mistakes: { type: 'ARRAY', items: MISTAKE_SCHEMA },
};

function correctionRules() {
  return `Rules for mistakes:
- One record per distinct mistake. Do not report stylistic preferences when the original is correct and natural.
- Pick exactly one category from this fixed list:
${categoryGuide()}
- For word_choice mistakes, fill wordToLearn with the right word to learn (dictionary form). Leave wordToLearn out otherwise.
- Write explanations in ${explainLang()}.`;
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

// ---------- features ----------
export async function lookup(query, context) {
  const prompt = `You are a German dictionary for a B2 learner whose native working language is English.
Query: "${query}"
${context ? `Context sentence where the learner found it: "${context}"\nUse the sense that fits this context.` : ''}
If the query is English, return the most common German equivalent. If it is an inflected German form, return the dictionary form.
If the query is not a real word in either language, set found to false.`;
  const schema = S({ found: { type: 'BOOLEAN' }, ...WORD_PROPS }, ['found', ...Object.keys(WORD_PROPS)]);
  return cleanWord(await generate(prompt, schema));
}

export async function correctText(text) {
  const prompt = `You correct German written by a B2 learner. Correct this text:
"""${text}"""

${correctionRules()}`;
  return cleanMistakes(await generate(prompt, S(CORRECTION_PROPS)));
}

// "Write a sentence" exercise: correct it and judge whether the target word is used well.
export async function gradeWordSentence(word, sentence) {
  const target = word.article ? `${word.article} ${word.german}` : word.german;
  const prompt = `A B2 German learner had to write an original sentence using "${target}" (${word.meaning}).
Their sentence: """${sentence}"""
Judge whether the word is used correctly and naturally, and correct the sentence.

${correctionRules()}`;
  return cleanMistakes(await generate(prompt, S({
    usesWordCorrectly: { type: 'BOOLEAN' },
    feedback: { type: 'STRING', description: `One or two encouraging sentences in ${explainLang()}.` },
    ...CORRECTION_PROPS,
  })));
}

// Grammar drills for a weak category. kind: gapfill | transform | constraint.
export async function generateDrill(category, kind, { examples = [], word = null } = {}) {
  const label = categoryLabel(category, 'en');
  const own = examples.length
    ? `The learner's own past mistakes in this category (use them as inspiration, but do not copy them):\n${examples.map((m) => `- wrote "${m.original}" instead of "${m.corrected}"`).join('\n')}`
    : '';
  const kinds = {
    gapfill: 'A single German sentence with exactly one gap written as "___" that tests this category (e.g. an ending, a preposition, an auxiliary). answer is the exact text for the gap; acceptableAnswers lists other fully correct fillings.',
    transform: 'A transformation task: give one or two German sentences in prompt and an instruction such as combining with "weil", moving to the Perfekt, or switching to indirect speech, so that the result tests this category. answer is the model result sentence.',
    constraint: `A free-writing task: the instruction asks the learner to write one sentence that must use a specific structure from this category${word ? ` and the word "${word.article ? word.article + ' ' : ''}${word.german}"` : ''}. prompt may be empty. answer is one model sentence.`,
  };
  const prompt = `Create one German grammar exercise for a B2 learner.
Category: ${label}
Exercise type: ${kinds[kind]}
${own}
Write the instruction in ${explainLang()}. Keep sentences natural and everyday (work, travel, friends, news).`;
  return generate(prompt, S({
    instruction: STR,
    prompt: { type: 'STRING', description: 'German sentence(s) shown to the learner; for gapfill it contains ___.' },
    answer: STR,
    acceptableAnswers: { type: 'ARRAY', items: STR },
    explanation: { type: 'STRING', description: `Why the answer is right, in ${explainLang()}.` },
  }), { temperature: 0.9 });
}

// Grades a free answer to a drill (transform, constraint or "fix your sentence").
export async function gradeAnswer({ instruction, prompt: shown, model, answer, category }) {
  const prompt = `A B2 German learner is doing a grammar exercise (focus: ${categoryLabel(category, 'en')}).
Instruction: ${instruction}
${shown ? `Given: """${shown}"""` : ''}
A model answer: """${model}"""
Learner's answer: """${answer}"""
Decide if the learner's answer fulfils the task and is grammatically correct German. Other correct solutions than the model answer count as correct.
Then list the learner's mistakes, if any.

${correctionRules()}`;
  return cleanMistakes(await generate(prompt, S({
    correct: { type: 'BOOLEAN' },
    feedback: { type: 'STRING', description: `One or two sentences in ${explainLang()}.` },
    ...CORRECTION_PROPS,
  })));
}
