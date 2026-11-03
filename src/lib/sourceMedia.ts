/** Portable metadata only. Device paths and download state never enter backups. */
export interface YoutubeSource {
  version: 1; provider: 'youtube'; key: string; video_id: string; url: string; title: string;
  duration_ms: number; subtitle_track: string; subtitle_language: string;
  subtitle_kind: 'manual' | 'original' | 'translated' | 'unknown'; subtitle_sha256: string;
  cues: { id: number; start_ms: number; end_ms: number; text: string }[];
  audio: { format_id: string; language: 'en' | 'und'; language_basis: 'metadata' | 'single_unlabelled_original' } | null;
}
export interface MediaRef {
  source: YoutubeSource; cue_ids: number[]; start_ms: number; end_ms: number; precision: 'cue';
  padding_before_ms: 0; padding_after_ms: 0; expected_sha256?: string | null;
}
export type MediaTarget = ({ segment_id: number; record_id?: never } | { record_id: string; segment_id?: never }) & { source_key?: string; start_ms?: number; end_ms?: number };
export interface MediaStatus { status: 'missing' | 'preparing' | 'ready' | 'failed'; error?: string | null; asset_id?: string | null }

/** Own a frozen copy for the preview/commit receipt; no later cache result can retarget it. */
export function snapshotSource(source: YoutubeSource | null | undefined): YoutubeSource | null | undefined {
  if (!source) return source;
  const copy = structuredClone(source);
  copy.cues?.forEach(Object.freeze);
  if (copy.cues) Object.freeze(copy.cues);
  if (copy.audio) Object.freeze(copy.audio);
  return Object.freeze(copy);
}

export function bindMediaTarget(reference: MediaRef, target: MediaTarget): MediaTarget {
  return { ...target, source_key: reference.source.key, start_ms: reference.start_ms, end_ms: reference.end_ms };
}
