import { describe, expect, it } from 'vitest';
import { createLookupPlaybackInterruption } from '../lookupPlayback';
import type { ReadingSessionSnapshot } from '../readingSession';
const session = (changes: Partial<ReadingSessionSnapshot> = {}): ReadingSessionSnapshot => ({ key: 'reader:material:4', index: 4, mode: 'tts-queue', status: 'playing', rate: 1, pauseReason: null, resumeMode: 'continue', errorCode: null, ...changes });
describe('closing a lookup resumes only the playback it interrupted', () => {
  it.each(['tts-queue', 'source-continuous'] as const)('remembers %s before selection pauses it and consumes once', mode => {
    const interrupted = createLookupPlaybackInterruption(); expect(interrupted.remember(session({ mode }))).toBe(true);
    expect(interrupted.remember(session({ mode, status: 'paused', pauseReason: 'selection' }))).toBe(false);
    const paused = session({ mode, status: 'paused', pauseReason: 'lookup' });
    expect(interrupted.consume(paused)).toBe(true); expect(interrupted.consume(paused)).toBe(false);
  });
  it('can resume a queue that was still preparing audio when selection began', () => {
    const interrupted = createLookupPlaybackInterruption(); expect(interrupted.remember(session({ status: 'loading' }))).toBe(true);
    expect(interrupted.consume(session({ status: 'paused', pauseReason: 'selection' }))).toBe(true);
  });
  it('never turns an existing user pause into a play request', () => {
    const interrupted = createLookupPlaybackInterruption(); expect(interrupted.remember(session({ status: 'paused', pauseReason: 'user' }))).toBe(false);
    expect(interrupted.consume(session({ status: 'paused', pauseReason: 'lookup' }))).toBe(false);
  });
  it.each(['user', 'hidden', 'edit'] as const)('a later %s pause overrides a prior lookup interruption', pauseReason => {
    const interrupted = createLookupPlaybackInterruption(); interrupted.remember(session());
    expect(interrupted.consume(session({ status: 'paused', pauseReason }))).toBe(false);
  });
  it('does not restart stopped, failed, replaced, or explicitly controlled sessions', () => {
    for (const current of [null, session({ status: 'error' }), session({ status: 'ended' }), session({ key: 'reader:other:4', status: 'paused', pauseReason: 'lookup' }), session({ index: 5, status: 'paused', pauseReason: 'lookup' })]) {
      const interrupted = createLookupPlaybackInterruption(); interrupted.remember(session()); expect(interrupted.consume(current)).toBe(false);
    }
    const interrupted = createLookupPlaybackInterruption(); interrupted.remember(session()); interrupted.clear();
    expect(interrupted.consume(session({ status: 'paused', pauseReason: 'lookup' }))).toBe(false);
  });
});
