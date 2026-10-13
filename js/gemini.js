// Gemini calls, as the rest of the app uses them. Every call asks for structured JSON so
// lookups and mistakes can be stored and counted. This file only connects the pieces:
// gemini/client.js sends the request, and the feature files (gemini/words.js, sentences.js,
// grading.js, grammar.js, setup.js) build each prompt and clean each reply without reading
// the app's data, so they can be tested in Node. Here the learner context comes from the store.
import { activeLanguage, reviewItems } from './store.js';
import { knownRules } from './rules.js';
import { t, lang } from './i18n.js';
import { RECOMMENDED_MODEL } from './gemclient.js';
import { GeminiError, generate } from './gemini/client.js';
import * as words from './gemini/words.js';
import * as sentences from './gemini/sentences.js';
import * as grading from './gemini/grading.js';
import * as grammar from './gemini/grammar.js';
import { setupLanguage as setup } from './gemini/setup.js';

export { GeminiError, isCancel, canUseGemini, promote, listModels, testKey } from './gemini/client.js';
export { TONES } from './gemini/shared.js';
export { GAP_LEVELS } from './gemini/words.js';
export { RECOMMENDED_MODEL };

// The language being practised, with the learner's level, the interface language and the rules
// the learner already has. Every prompt needs them.
function learner() {
  const L = activeLanguage();
  if (!L) throw new GeminiError(t('err.noLanguage'));
  if (!L.level) throw new GeminiError(t('err.noLevel'));
  return { L, ui: lang(), get rules() { return knownRules(reviewItems(), L.code); } };
}

// Builds a feature's request, sends it and cleans the reply. args are what the feature gets.
async function ask(feature, c, call, ...args) {
  return feature.read(await generate(call, feature.ask(c, ...args)), c, ...args);
}

export const lookup = async (query, context, call = {}) => ask(words.lookup, learner(), call, query, context);
export const suggestWords = async (n, opts = {}, call = {}) => ask(words.suggestWords, learner(), call, n, opts);
export const correctText = async (text, opts = {}, call = {}) => ask(sentences.correctText, learner(), call, text, opts);
export const translateSentence = async (text, tone = 'everyday', opts = {}, call = {}) => ask(sentences.translateSentence, learner(), call, text, tone, opts);
export const gradeTranslation = async (item, answer, opts = {}, call = {}) => ask(grading.gradeTranslation, learner(), call, item, answer, opts);
export const gradeWordSentence = async (word, sentence, opts = {}, call = {}) => ask(grading.gradeWordSentence, learner(), call, word, sentence, opts);
export const gapSentences = async (list, n = 3, call = {}) => ask(words.gapSentences, learner(), call, list, n);
export const checkGap = async (word, gap, answer, opts = {}, call = {}) => ask(grading.checkGap, learner(), call, word, gap, answer, opts);
export const generateDrill = async (category, kind, opts = {}, call = {}) => ask(grammar.generateDrill, learner(), call, category, kind, opts);
export const gradeAnswer = async (args, call = {}) => ask(grading.gradeAnswer, learner(), call, args);
export const judgeAnswer = async (args, call = {}) => ask(grading.judgeAnswer, learner(), call, args);

export async function ruleExercises(list, call = {}) {
  if (!list.length) return [];
  return ask(grammar.ruleExercises, learner(), call, list);
}

export async function classifyMistakes(list, call = {}) {
  if (!list.length) return [];
  return ask(grammar.classifyMistakes, learner(), call, list);
}

// Furigana for Japanese texts saved before Gemini added it (needs no learner context).
export async function annotate(texts, call = {}) {
  if (!texts.length) return [];
  return ask(words.annotate, null, call, texts);
}

export async function translateTexts(texts, call = {}) {
  if (!texts.length) return [];
  return ask(words.translateTexts, learner(), call, texts);
}

export async function setupLanguage(name, call = {}) {
  return setup.read(await generate(call, setup.ask(name)), name);
}
