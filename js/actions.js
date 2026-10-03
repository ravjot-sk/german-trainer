// Shared write paths used by several screens.
import { addMistakes, addWord } from './store.js';

// Saves Gemini mistake records; word-choice fixes also add the right word to the word list.
export function logMistakes(list, source) {
  const added = addMistakes(list || [], source);
  const newWords = [];
  for (const m of list || []) {
    const w = m.wordToLearn;
    if (m.category !== 'word_choice' || !w || !w.german) continue;
    const { word, created } = addWord({
      german: w.german, article: w.article || '', pos: w.pos || 'other', meaning: w.meaning || '',
      plural: w.plural || '', verbForms: w.verbForms || '',
      contextSentence: m.correctedSentence || '', source: 'correction',
    });
    if (created) newWords.push(word);
  }
  return { mistakes: added, words: newWords };
}
