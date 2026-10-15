// Gemini features that judge the learner's answers in exercises. ask/read pairs as in words.js.
import { lemmaOf, wordTitle } from '../languages.js';
import { categoryLabel, categoriesFor } from '../categories.js';
import { rulePrompt } from '../rules.js';
import { S, GAP_ACCEPTABLE, explainLang, levelText, toneGuide, naturalProps, cleanNatural,
  correctionProps, correctionRules, cleanMistakes, recheckNote, recheckTemp, spellingNote } from './shared.js';

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
  read(reply, c) {
    const r = cleanMistakes(reply, c);
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
  read(reply, c) {
    const r = cleanMistakes(reply, c);
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
correct is true when the learner's answer is a form of this word that makes the sentence grammatical and natural, even if it differs from the expected one (another politeness level or tense${L.reading ? `, or written in ${L.reading} instead of its usual script` : ''}). It is false for another word, a form that doesn't fit the sentence, or a misspelling.${spellingNote(L)}${recheckNote(recheck)}`;
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
First correct the learner's answer with as few changes as possible (correctedText; the answer unchanged if it is already right) and list the learner's mistakes, if any. Then decide whether the answer fulfils the task and is grammatically correct ${L.english}. Other correct solutions than the model answer count as correct: a part the learner left as it was is not a mistake when it is correct, even if the model answer changed it.

${correctionRules(c)}${recheckNote(recheck)}`;
    // The verdict comes last, after the correction it rests on (#37).
    return { prompt, temperature: recheckTemp(recheck), schema: S({
      ...correctionProps(c),
      feedback: { type: 'STRING', description: `One or two sentences in ${explainLang(c)}, about the mistakes in correctedText, or why the answer is right.` },
      correct: { type: 'BOOLEAN' },
    }) };
  },
  read: (r, c) => cleanMistakes(r, c),
};

// An exercise the app checks itself (a word, a gap, word order, a choice), when the app's
// check found the answer wrong or on "Check again": Gemini judges the answer against the
// expected one. Other correct answers count; a small slip in an otherwise right answer (a
// typo, a missing accent) is minor. correctedText is the answer with the fewest changes that
// make it right, shown as the correction. meaning: the task asks for one particular word or
// phrase (recall), so another word with the same meaning is sameMeaning, not correct (#40).
// Returns { correct, minor, sameMeaning, feedback, correctedText }.
export const judgeAnswer = {
  ask(c, { instruction, shown = '', expected, answer, recheck = null, meaning = false }) {
    const { L } = c;
    const verdict = meaning
      ? `correct is true when the learner's answer is the expected word or phrase, in any correct form or spelling of it. sameMeaning is true when it is a different ${L.english} word or phrase that is correct and means the same here; then correct is false. minor is true when the answer is the expected one except for a small slip such as a typo or a missing accent; then correct is false.`
      : `correct is true when the learner's answer fulfils the task and is correct ${L.english}, even if it differs from the expected answer (another correct word, form or word order). minor is true when the answer is right except for a small slip such as a typo or a missing accent; then correct is false.`;
    const prompt = `A ${L.english} learner at ${levelText(L)} is doing an exercise.
Task: ${instruction}
${shown ? `Shown to the learner: """${shown}"""\n` : ''}Expected answer: """${expected}"""
Learner's answer: """${answer}"""
First write correctedText: the learner's answer (only what they typed, not the rest of the exercise) with as few changes as possible that make it right; unchanged if it is right. Then the verdict.
${verdict}${spellingNote(L)}${recheckNote(recheck)}`;
    return { prompt, temperature: 0, schema: S({
      correctedText: { type: 'STRING' },
      feedback: { type: 'STRING', description: `One or two short sentences in ${explainLang(c)}.` },
      correct: { type: 'BOOLEAN' },
      minor: { type: 'BOOLEAN' },
      ...(meaning ? { sameMeaning: { type: 'BOOLEAN' } } : {}),
    }) };
  },
  read: (r) => ({
    correct: !!r.correct, minor: !r.correct && !!r.minor, sameMeaning: !r.correct && !!r.sameMeaning,
    feedback: String(r.feedback || ''), correctedText: String(r.correctedText || ''),
  }),
};
