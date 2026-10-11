import type { FileProgress, LearningStats } from '../stores/insightsStore';
import type { LearningProgress } from './types';
import { learningIndex } from './fileProgress';

export function vocabularyProgress(source: LearningStats | FileProgress): [LearningProgress, LearningProgress] {
  return [
    { total: source.total_words, known: source.known, learning: source.learning, unprocessed: source.unprocessed, ignored: source.ignored },
    { total: source.total_phrases, known: source.phrases_known, learning: source.phrases_learning, unprocessed: source.phrases_unprocessed, ignored: source.phrases_ignored },
  ];
}

export function fileLearningIndex(file: FileProgress) {
  const [words, phrases] = vocabularyProgress(file);
  return learningIndex(words, phrases, file.phrase_analyzed);
}
