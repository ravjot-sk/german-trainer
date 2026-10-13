// Gemini features that judge the learner's answers in exercises. ask/read pairs as in words.js.
import { lemmaOf, wordTitle } from '../languages.js';
import { categoryLabel, categoriesFor } from '../categories.js';
import { rulePrompt } from '../rules.js';
import { S, GAP_ACCEPTABLE, explainLang, levelText, toneGuide, naturalProps, cleanNatural,
  correctionProps, correctionRules, cleanMistakes, recheckNote, recheckTemp } from './shared.js';

// "Say this sentence" exercise: the learner translates a saved sentence's English meaning.
// A different tone than the saved one is not a mistake, only a hint.
export const gradeTranslation = {
  ask(c, item, answer, { recheck } = {}) {
    const { L } = c;
    const prompt = `A ${L.english} learner at ${levelText(L)} had to say this in ${L.english}, in the ${item.tone || 'everyday'} tone: "${item.meaning}"
A model answer: """${lemmaOf(item)}"""
Learner's answer: """${answer}"""
correct: true if the answer says the same thing in grammatically correct ${L.english}. Other correct phrasings than the model count as correct. The tone does NOT affect correct and is never a mistake.
toneMatches: false only if the answer clearly uses a different tone. Then toneHint says, in ${explainLang(c)}, how it would usually be said in the ${item.tone || 'everyday'} tone (give the phrasing).

${toneGuide(L)}

${correctionRules(c)}
- Never report the tone or register of the answer as a mistake.
Separately, if a correct answer would sound clearly more natural phrased differently, put that in natural.${recheckNote(recheck)}`;
    return { prompt, temperature: recheckTemp(recheck), schema: S({
      correct: { type: 'BOOLEAN' },
      toneMatches: { type: 'BOOLEAN' },
      toneHint: { type: 'STRING', description: 'Empty when toneMatches is true.' },
      feedback: { type: 'STRING', description: `One or two encouraging sentences in ${explainLang(c)}.` },
      ...correctionProps(c),
      ...naturalProps(c),
    }) };
  },
  read(reply) {
    const r = cleanMistakes(reply);
    // Belt and braces: a tone mismatch never lands in the mistake profile.
    r.mistakes = (r.mistakes || []).filter((m) => m.category !== 'register');
    if (r.toneMatches) r.toneHint = '';
    return cleanNatural(r, r.correctedText);
  },
};

// "Write a sentence" exercise: correct it and judge whether the target word is used well.
export const gradeWordSentence = {
  ask(c, word, sentence, { recheck } = {}) {
    const { L } = c;
    const prompt = `A ${L.english} learner at ${levelText(L)} had to write an original sentence using "${wordTitle(word)}" (${word.meaning}).
Their sentence: """${sentence}"""
Judge whether the word is used correctly and naturally, and correct the sentence.

${correctionRules(c)}
Separately, if the sentence would sound clearly more natural phrased differently (still using the word), put that in natural.${recheckNote(recheck)}`;
    // The verdict comes after the correction, as it did before fields kept their order.
    return { prompt, temperature: recheckTemp(recheck), schema: S({
      ...correctionProps(c),
      feedback: { type: 'STRING', description: `One or two encouraging sentences in ${explainLang(c)}.` },
      usesWordCorrectly: { type: 'BOOLEAN' },
      gapSentence: { type: 'STRING', description: 'If the word is used correctly: the corrected sentence with the exact form of the word replaced by "___". Otherwise empty.' },
      gapAnswer: { type: 'STRING', description: 'The exact text replaced by ___, or empty.' },
      gapAcceptable: GAP_ACCEPTABLE,
      ...naturalProps(c),
    }) };
  },
  read(reply) {
    const r = cleanMistakes(reply);
    return cleanNatural(r, r.correctedText);
  },
};

// A second opinion on a gap answer the local check found wrong: whether it is the word, in a
// form that is correct and natural in that sentence. Returns { correct, feedback }.
export const checkGap = {
  ask(c, word, gap, answer, { recheck } = {}) {
    const { L } = c;
    const prompt = `A ${L.english} learner at ${levelText(L)} is filling a gap with a form of "${wordTitle(word)}" (${word.meaning}).
Sentence: """${gap.sentence}"""
Expected: """${gap.answer}"""${(gap.acceptable || []).length ? ` (also fine: ${gap.acceptable.map((x) => `"${x}"`).join(', ')})` : ''}
Learner's answer: """${answer}"""
correct is true when the learner's answer is a form of this word that makes the sentence grammatical and natural, even if it differs from the expected one (another politeness level or tense${L.reading ? `, or written in ${L.reading} instead of its usual script` : ''}). It is false for another word, a form that doesn't fit the sentence, or a misspelling.${recheckNote(recheck)}`;
    return { prompt, temperature: 0, schema: S({
      correct: { type: 'BOOLEAN' },
      feedback: { type: 'STRING', description: `One short sentence in ${explainLang(c)}.` },
    }) };
  },
  read: (r) => ({ correct: !!r.correct, feedback: String(r.feedback || '') }),
};

// Grades a free answer to a drill (transform, constraint or "fix your sentence").
export const gradeAnswer = {
  ask(c, { instruction, prompt: shown, model, answer, category, rule = null, recheck = null }) {
    const { L } = c;
    const prompt = `A ${L.english} learner at ${levelText(L)} is doing a grammar exercise (focus: ${categoryLabel(category, 'en', categoriesFor(L))}${rule ? `, rule: ${rulePrompt(rule).name}${rulePrompt(rule).statement ? ` (${rulePrompt(rule).statement})` : ''}` : ''}).
Instruction: ${instruction}
${shown ? `Given: """${shown}"""` : ''}
A model answer: """${model}"""
Learner's answer: """${answer}"""
Decide if the learner's answer fulfils the task and is grammatically correct ${L.english}. Other correct solutions than the model answer count as correct.
Then list the learner's mistakes, if any.

${correctionRules(c)}${recheckNote(recheck)}`;
    return { prompt, temperature: recheckTemp(recheck), schema: S({
      correct: { type: 'BOOLEAN' },
      feedback: { type: 'STRING', description: `One or two sentences in ${explainLang(c)}.` },
      ...correctionProps(c),
    }) };
  },
  read: (r) => cleanMistakes(r),
};

// "Check again" on an exercise the app checks itself (a word, a gap, word order, a choice):
// Gemini judges the answer against the expected one. Other correct answers count; a small slip
// in an otherwise right answer (a typo, a missing accent) is minor. Returns
// { correct, minor, feedback }.
export const judgeAnswer = {
  ask(c, { instruction, shown = '', expected, answer, recheck = null }) {
    const { L } = c;
    const prompt = `A ${L.english} learner at ${levelText(L)} is doing an exercise.
Task: ${instruction}
${shown ? `Shown to the learner: """${shown}"""\n` : ''}Expected answer: """${expected}"""
Learner's answer: """${answer}"""
correct is true when the learner's answer fulfils the task and is correct ${L.english}, even if it differs from the expected answer (another correct word, form or word order). minor is true when the answer is right except for a small slip such as a typo or a missing accent; then correct is false.${recheckNote(recheck)}`;
    return { prompt, temperature: 0, schema: S({
      correct: { type: 'BOOLEAN' },
      minor: { type: 'BOOLEAN' },
      feedback: { type: 'STRING', description: `One or two short sentences in ${explainLang(c)}.` },
    }) };
  },
  read: (r) => ({ correct: !!r.correct, minor: !r.correct && !!r.minor, feedback: String(r.feedback || '') }),
};
