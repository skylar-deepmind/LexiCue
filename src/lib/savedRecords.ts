import { invoke } from '@tauri-apps/api/core';

/** Portable selected sense; does not depend on an installed dictionary package. */
export interface DictionarySnapshot {
  schema_version: 1;
  headword: string;
  source: {
    provider: 'longman' | 'cambridge' | 'wiktionary';
    dataset: string;
    edition: string | null;
    release: string | null;
    adapter_version: string;
    entry_key: string;
    locator: string | null;
    entry_url?: string | null;
    retrieved_at?: string | null;
    access_channel?: 'author_public_api' | 'freedictionaryapi';
    service_url?: string;
    received_at?: string;
    content_hash?: string;
    license?: { name: string; url: string };
    attribution?: string;
    modifications?: string;
  };
  entry_id: string;
  group_id: string;
  sense_id: string;
  part_of_speech: string | null;
  meaning: { en: string | null; zh: string | null };
  labels: { kind: string; text: string }[];
  examples: { id: string; english: string; chinese: string | null }[];
  patterns: string[];
  source_path?: string;
  content_kind?: 'definition' | 'relation';
  ancestors?: { source_path: string; meaning: { en: string | null; zh: string | null }; labels: { kind: string; text: string }[] }[];
}

/** Source-labelled excerpt; does not assert a meaning for the saved sentence. */
export interface DictionaryReference {
  schema_version: 1;
  kind: 'dictionary_excerpt';
  headword: string;
  senses: DictionarySnapshot[];
}
export interface SavedGroup {
  group_id: string;
  expression: string;
  context_count: number;
  latest_saved_at: number | null;
  preview: SavedRecord;
}
export interface SavedGroupPage { groups: SavedGroup[]; total_groups: number; total_records: number }
export interface SavedContextPage { records: SavedRecord[]; total: number }

export interface SavedRecord {
  record_id: string;
  expression: string;
  normalized_expression: string;
  source_key: string;
  sentence: string | null;
  sentence_translation: string | null;
  source: {
    content_hash: string;
    document?: {
      schema_version: 1 | 2; origin?: import('./documentTypes').ContentOrigin; identity: string; original_format: import('./documentTypes').DocumentFormat;
      source_sha256: string; extractor_version: string; selection: import('./documentTypes').DocumentSelection;
      locations: import('./documentTypes').DocumentLocation[]; section_title: string;
    } | null;
    media?: import('./sourceMedia').MediaRef | null;
    media_identity?: string | null;
    youtube?: Omit<import('./sourceMedia').YoutubeSource, 'cues'> | null;
    file_name: string;
    segment_index: number;
    start_offset: number | null;
    end_offset: number | null;
    start_time: string | null;
    end_time: string | null;
  } | null;
  explanation: string | null;
  explanation_source: 'dictionary' | 'ai' | 'personal' | 'unknown';
  dictionary_snapshot?: DictionarySnapshot | null;
  dictionary_reference?: DictionaryReference | null;
  origin: 'reader' | 'legacy';
  legacy: Record<string, unknown> | null;
  saved_at: number | null;
  updated_at: number;
  revision: string;
  generation: number;
  deleted_at: number | null;
}

export type SavedMutation = {
  kind: 'save';
  input: {
    segment_id: number;
    expression: string;
    start_offset: number;
    end_offset: number;
    explanation: string | null;
    explanation_source: SavedRecord['explanation_source'];
    dictionary_snapshot?: DictionarySnapshot | null;
  dictionary_reference?: DictionaryReference | null;
  };
} | {
  kind: 'edit'; record_id: string; expected_revision: string; explanation: string;
} | {
  kind: 'remove'; record_id: string; expected_revision: string;
};

export interface SavedMutationResult { record: SavedRecord; changed: boolean; operation_id: string }
export interface SavedConflict { id: number; record_id: string; local: SavedRecord; remote: SavedRecord }
export interface SavedMigrationReport {
  eligible_words: number; eligible_phrases: number; saved_contexts: number; missing_sources: number;
  history_only: { kind: string; legacy_id: number; reason: string }[];
}

export async function mutateSaved(mutation: SavedMutation, operationId: string): Promise<SavedMutationResult> {
  const result=await invoke<SavedMutationResult>('mutate_saved_record', { mutation, operationId });
  if(result.changed)window.dispatchEvent(new Event('lexicue-saved-changed'));
  return result;
}
export async function undoSaved(operationId: string): Promise<SavedRecord> {
  const result=await invoke<SavedRecord>('undo_saved_mutation', { operationId });
  window.dispatchEvent(new Event('lexicue-saved-changed'));
  return result;
}
export function savedErrorKey(error: unknown): string {
  return String(error).includes('conflict') ? 'savedRecords.conflictError' : 'savedRecords.writeError';
}

/** Present user-authored legacy content without exposing database columns. */
export function legacyContent(value: unknown): { label: string; text: string }[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const row = value as Record<string, unknown>;
  const result: { label: string; text: string }[] = [];
  const add = (label: string, text: unknown) => {
    if (typeof text === 'string' && text.trim()) result.push({ label: `savedRecords.${label}`, text });
  };
  add('legacyNote', row.definition);
  if (row.occurrence && typeof row.occurrence === 'object') {
    const occurrence = row.occurrence as Record<string, unknown>;
    add('contextMeaning', occurrence.meaning_zh); add('usage', occurrence.usage_zh);
    add('englishMeaning', occurrence.meaning_en); add('usage', occurrence.usage_en);
  }
  if (row.dictionary && typeof row.dictionary === 'object') {
    const dictionary = row.dictionary as Record<string, unknown>;
    for (const key of ['other_senses_json', 'other_senses_en_json']) {
      try {
        const senses: unknown = JSON.parse(String(dictionary[key] ?? '[]'));
        if (Array.isArray(senses)) for (const item of senses) {
          if (!item || typeof item !== 'object') continue;
          add('extraSense', item.meaning_zh ?? item.meaning_en); add('example', item.example_en);
        }
      } catch { /* The unmodified original remains in the portable backup. */ }
    }
  }
  if (Array.isArray(row.same_position_records)) {
    for (const item of row.same_position_records) result.push(...legacyContent(item));
  }
  return result;
}
