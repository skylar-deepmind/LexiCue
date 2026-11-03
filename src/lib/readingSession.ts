/** Shared P3 contract: reading survives a temporary pronunciation channel. */
export const READING_RATES = [0.75, 1, 1.25, 1.5] as const;
export type ReadingRate = typeof READING_RATES[number];
export type ReadingPauseReason = 'user' | 'lookup' | 'edit' | 'selection' | 'hidden';
export type ReadingStatus = 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export interface ReadingSessionSnapshot {
  key: string;
  index: number;
  mode: 'tts-queue' | 'source-continuous';
  status: ReadingStatus;
  rate: ReadingRate;
  pauseReason: ReadingPauseReason | null;
  resumeMode: 'continue' | 'restart-sentence';
  errorCode: string | null;
}
