// Shared write paths used by several screens.
import { addMistakes, addWord } from './store.js';

// Saves Gemini mistake records; word-choice fixes also add the right word to the word list.
export function logMistakes(list, source, code = 'de') {
  const added = addMistakes(list || [], source, code);
  const newWords = [];
  for (const m of list || []) {
    const w = m.wordToLearn;
    if (m.category !== 'word_choice' || !w || !w.lemma) continue;
    const { word, created } = addWord({
      lang: code, lemma: w.lemma, article: w.article || '', reading: w.reading || '', pos: w.pos || 'other',
      meaning: w.meaning || '', plural: w.plural || '', verbForms: w.verbForms || '', forms: w.forms || '',
      recallAnswer: w.recallAnswer || '',
      contextSentence: m.correctedSentence || '', source: 'correction',
    });
    if (created) newWords.push(word);
  }
  return { mistakes: added, words: newWords };
}
