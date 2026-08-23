import type { LearningProgress } from './types';

export type LearningStage = 'notStarted' | 'starting' | 'progressing' | 'flowing' | 'nearlyDone' | 'complete';

export function learningIndex(
  wordProgress: LearningProgress,
  phraseProgress: LearningProgress,
  phraseAnalyzed: boolean,
): number | null {
  const included = phraseAnalyzed ? [wordProgress, phraseProgress] : [wordProgress];
  const total = included.reduce((sum, progress) => sum + progress.total, 0);
  if (total <= 0) return null;

  const weighted = included.reduce(
    (sum, progress) => sum + progress.learning * 0.5 + progress.known + progress.ignored,
    0,
  );
  return Math.round((weighted / total) * 100);
}

export function learningStage(index: number | null): LearningStage | null {
  if (index === null) return null;
  if (index === 0) return 'notStarted';
  if (index < 25) return 'starting';
  if (index < 50) return 'progressing';
  if (index < 75) return 'flowing';
  if (index < 100) return 'nearlyDone';
  return 'complete';
}

export function occurrenceRoute(
  occurrence: { file_id: number; segment_index: number },
  focusType: 'word' | 'phrase',
  focusId: number,
): string {
  const params = new URLSearchParams({
    segment: String(occurrence.segment_index),
    focusType,
    focusId: String(focusId),
  });
  return `/files/${occurrence.file_id}?${params.toString()}`;
}

export function legacyReadingRoute(search: string): string {
  const fileId = new URLSearchParams(search).get('fileId');
  return fileId && /^\d+$/.test(fileId) ? `/files/${fileId}` : '/files';
}
