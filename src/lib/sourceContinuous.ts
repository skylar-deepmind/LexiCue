/** Cue times describe text following; only the actual media ended event ends a full-track session. */
export interface ReadingAnchor { index: number; segment_id: number; start_ms: number; end_ms: number }
export interface ReadingPlayback {
  path: string; file_id: number; source_key: string; asset_id: string;
  start_ms: number; duration_ms: number; anchors: ReadingAnchor[];
}
export interface ReadingSourceRequest { fileId: number; segmentId: number; sourceKey: string; key: string; index: number }
export interface ReadingSourceJump { fileId: number; segmentId: number; sourceKey: string; index: number }
export interface ReadingGroup { index: number; start_ms: number; end_ms: number }
export function readingGroups(anchors: readonly ReadingAnchor[]): ReadingGroup[] {
  const groups: ReadingGroup[] = [];
  for (const anchor of [...anchors].sort((a, b) => a.start_ms - b.start_ms || a.index - b.index)) {
    const previous = groups.at(-1);
    if (previous?.start_ms === anchor.start_ms) previous.end_ms = Math.max(previous.end_ms, anchor.end_ms);
    else groups.push({ index: anchor.index, start_ms: anchor.start_ms, end_ms: anchor.end_ms });
  }
  return groups;
}
/** Latest actual start wins overlaps; shared cues have one stable representative. Gaps have no precise highlight. */
export function readingIndexAt(groups: readonly ReadingGroup[], mediaMs: number): number | null {
  let low = 0, high = groups.length;
  while (low < high) { const middle = (low + high) >>> 1; if (groups[middle].start_ms <= mediaMs) low = middle + 1; else high = middle; }
  const group = groups[low - 1];
  return group && mediaMs < group.end_ms ? group.index : null;
}
