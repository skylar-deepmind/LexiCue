export type WordStatus = 'unprocessed' | 'learning' | 'known' | 'ignored';
export type Rating = 1 | 2 | 3 | 4;
export type { Language } from './languages';
import type { Language } from './languages';

export interface FileRecord {
  id: number;
  name: string;
  type: 'txt' | 'srt';
  imported_at: number;
  segment_count: number;
  phrase_analyzed: boolean;
  phrase_analysis_at: number | null;
  language: Language;
  folder_id: number | null;
}

export interface FolderInfo {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: number;
  file_count: number;
}

export interface Segment {
  id: number;
  index_num: number;
  en_text: string;
  zh_text: string | null;
  start_time: string | null;
  end_time: string | null;
}

export interface WordInfo {
  id: number;
  lemma: string;
  status: WordStatus;
  definition: string | null;
  frequency: number;
  language: Language;
  reading: string | null;
  part_of_speech: string | null;
}

export interface OccurrenceDetail {
  id: number;
  original_form: string;
  position: number;
  en_text: string;
  zh_text: string | null;
  start_time: string | null;
  end_time: string | null;
  file_name: string;
}

export interface WordDetail {
  word: WordInfo;
  occurrences: OccurrenceDetail[];
}

export interface DictionaryDefinition {
  part_of_speech: string;
  definition: string;
  translation: string | null;
  example: string | null;
}

export interface DictionaryEntry {
  language: Language;
  lemma: string;
  provider: string;
  phonetic: string | null;
  audio_url: string | null;
  local_audio_path: string | null;
  definitions: DictionaryDefinition[];
  fetched_at: number;
}

export interface DictionarySource {
  language: Language;
  provider: string;
  version: string | null;
  source_url: string | null;
  license: string | null;
  imported_at: number;
  entry_count: number;
}

export interface DueCard {
  word_id: number;
  lemma: string;
  definition: string | null;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  occurrences: CardOccurrence[];
  language: Language;
  reading: string | null;
  part_of_speech: string | null;
}

export interface CardOccurrence {
  id: number;
  en_text: string;
  zh_text: string | null;
  start_time: string | null;
  end_time: string | null;
  file_name: string;
  original_form: string | null;
}

export interface DuplicateCheck {
  file_id: number;
  name: string;
}

export interface ImportPayload {
  name: string;
  file_type: string;
  content: string;
  content_hash: string;
  segments: SegmentInput[];
  lemmas: string[];
  occurrences: OccurrenceInput[];
  phrase_occurrences?: PhraseOccurrenceInput[];
  replace_file_id?: number;
  folder_id?: number | null;
  language: Language;
}

export interface PhraseOccurrenceInput {
  text: string;
  segment_index: number;
  position: number;
}

export interface SegmentInput {
  index: number;
  en_text: string;
  zh_text: string | null;
  start_time: string | null;
  end_time: string | null;
}

export interface OccurrenceInput {
  lemma: string;
  segment_index: number;
  original_form: string;
  position: number;
  reading?: string | null;
  part_of_speech?: string | null;
}

export interface PhraseInfo {
  id: number;
  text: string;
  status: WordStatus;
  definition: string | null;
  source: 'detected' | 'manual';
  frequency: number;
  language: Language;
}

export interface PhraseDetail {
  phrase: PhraseInfo;
  occurrences: OccurrenceDetail[];
}

export interface PhraseDictionaryEntry {
  text: string;
  translation: string;
  pinyin: string | null;
  usage_zh: string | null;
  category: string | null;
  provider: string;
}

export interface DuePhraseCard {
  phrase_id: number;
  text: string;
  definition: string | null;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  occurrences: CardOccurrence[];
  language: Language;
}

export interface PhraseRatingPayload {
  phrase_id: number;
  rating: number;
  card_state: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  new_state: number;
  new_stability: number;
  new_difficulty: number;
  new_elapsed_days: number;
  new_scheduled_days: number;
  new_due_at: number;
}

export interface BackupPayload {
  schema_version: number;
  exported_at: number;
  app_version: string;
  data: {
    files: Record<string, unknown>[];
    segments: Record<string, unknown>[];
    words: Record<string, unknown>[];
    occurrences: Record<string, unknown>[];
    reviews: Record<string, unknown>[];
    review_logs: Record<string, unknown>[];
    dictionary_entries?: Record<string, unknown>[];
    dictionary_sources?: Record<string, unknown>[];
    phrases?: Record<string, unknown>[];
    phrase_occurrences?: Record<string, unknown>[];
    phrase_reviews?: Record<string, unknown>[];
    phrase_review_logs?: Record<string, unknown>[];
    phrase_dictionary_entries?: Record<string, unknown>[];
    file_phrase_analysis?: Record<string, unknown>[];
  };
}

export interface RatingPayload {
  word_id: number;
  rating: number;
  card_state: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  new_state: number;
  new_stability: number;
  new_difficulty: number;
  new_elapsed_days: number;
  new_scheduled_days: number;
  new_due_at: number;
}
