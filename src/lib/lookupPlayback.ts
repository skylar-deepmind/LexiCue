import type { ReadingSessionSnapshot } from './readingSession';

/** Remember playback intent before pointer selection pauses it. A lookup must
 * never turn a prior user/hidden/error pause into an automatic play request. */
export function createLookupPlaybackInterruption() {
  let interrupted: Pick<ReadingSessionSnapshot, 'key' | 'index' | 'mode'> | null = null;
  return {
    remember(reading: ReadingSessionSnapshot | null) {
      if (!reading || !['playing', 'loading'].includes(reading.status)) return false;
      interrupted = { key: reading.key, index: reading.index, mode: reading.mode };
      return true;
    },
    consume(reading: ReadingSessionSnapshot | null) {
      const previous = interrupted; interrupted = null;
      return !!previous && !!reading && reading.status === 'paused'
        && ['lookup', 'selection'].includes(reading.pauseReason ?? '')
        && reading.key === previous.key && reading.index === previous.index && reading.mode === previous.mode;
    },
    clear() { interrupted = null; },
  };
}
