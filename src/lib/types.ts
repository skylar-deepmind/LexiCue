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
  phrase_skipped_items: number;
  language: Language;
  tags: TagInfo[];
  word_progress: LearningProgress;
  phrase_progress: LearningProgress;
}

export interface LearningProgress {
  total: number;
  unprocessed: number;
  learning: number;
  known: number;
  ignored: number;
}

export interface TagInfo {
  id: number;
  name: string;
  created_at: number;
}

export interface TagSelection {
  tagIds: number[];
  newTagNames: string[];
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
  baseline_pending?: boolean;
  word_kind: 'common' | 'proper_noun' | 'noise' | 'ambiguous';
  search_aliases: string[];
}

export interface OccurrenceDetail {
  id: number;
  file_id: number;
  segment_id: number;
  segment_index: number;
  original_form: string;
  position: number;
  en_text: string;
  zh_text: string | null;
  start_time: string | null;
  end_time: string | null;
  file_name: string;
  hidden: boolean;
  expression_metadata?: ExpressionMetadata | null;
  surface_text?: string | null;
  token_positions?: number[] | null;
  meaning_zh?: string | null;
  usage_zh?: string | null;
  meaning_edited?: boolean;
  meaning_en?: string | null;
  usage_en?: string | null;
  meaning_en_edited?: boolean;
  collins_sense_id?: number | null;
  analysis_model?: string | null;
  analyzed_at?: number | null;
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
  requested_form: string;
  matched_headword: string;
  match_kind: 'exact' | 'inflection' | 'spelling_variant' | 'online_fallback';
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
  baseline_pending: boolean;
}

export interface CardOccurrence {
  id: number;
  en_text: string;
  zh_text: string | null;
  start_time: string | null;
  end_time: string | null;
  file_name: string;
  original_form: string | null;
  meaning_zh?: string | null;
  meaning_en?: string | null;
  token_positions?: number[] | null;
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
  tag_ids: number[];
  new_tag_names: string[];
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
  word_kind?: 'common' | 'proper_noun' | 'noise' | 'ambiguous';
}

export interface PhraseInfo {
  id: number;
  text: string;
  status: WordStatus;
  definition: string | null;
  source: 'detected' | 'manual';
  frequency: number;
  language: Language;
  unverified: boolean;
}

export interface PhraseDetail {
  phrase: PhraseInfo;
  occurrences: OccurrenceDetail[];
}

export interface ExpressionMetadata {
  context_meaning_en?: string | null;
  register_tags: string[];
  regions: string[];
  cautions: string[];
  domains: string[];
  evidence_kind: string;
  source: string;
}

export interface PhraseDictionaryEntry {
  expression_metadata?: ExpressionMetadata | null;
  text: string;
  translation: string;
  pinyin: string | null;
  usage_zh: string | null;
  category: string | null;
  provider: string;
  other_senses: { meaning_zh: string; example_en: string }[];
  other_senses_edited: boolean;
  meaning_en: string | null;
  usage_en: string | null;
  other_senses_en: { meaning_en: string; example_en: string }[];
  other_senses_en_edited: boolean;
  collins_senses: {
    id: number;
    phrase: string;
    headword: string;
    grammar: string;
    definition: string;
    example: string | null;
  }[];
  collins_available: boolean;
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
    tags?: Record<string, unknown>[];
    file_tags?: Record<string, unknown>[];
    legacy_tag_folders?: Record<string, unknown>[];
    file_tag_state?: Record<string, unknown>[];
    folders?: Record<string, unknown>[];
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
