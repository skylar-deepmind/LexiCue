import { describe, expect, it } from 'vitest';
import { learningIndex, learningStage, legacyReadingRoute, occurrenceRoute } from '../fileProgress';

const progress = { total: 10, unprocessed: 2, learning: 3, known: 4, ignored: 1 };
const phrases = { total: 2, unprocessed: 0, learning: 0, known: 2, ignored: 0 };

describe('file progress', () => {
  it('combines words and analyzed phrases using processing weights', () => {
    expect(learningIndex(progress, phrases, true)).toBe(71);
  });

  it('uses words only before phrase analysis and handles empty files', () => {
    expect(learningIndex(progress, phrases, false)).toBe(65);
    const empty = { total: 0, unprocessed: 0, learning: 0, known: 0, ignored: 0 };
    expect(learningIndex(empty, phrases, false)).toBeNull();
  });

  it('maps every index boundary to the expected stage', () => {
    expect(learningStage(null)).toBeNull();
    expect(learningStage(0)).toBe('notStarted');
    expect(learningStage(1)).toBe('starting');
    expect(learningStage(24)).toBe('starting');
    expect(learningStage(25)).toBe('progressing');
    expect(learningStage(49)).toBe('progressing');
    expect(learningStage(50)).toBe('flowing');
    expect(learningStage(74)).toBe('flowing');
    expect(learningStage(75)).toBe('nearlyDone');
    expect(learningStage(99)).toBe('nearlyDone');
    expect(learningStage(100)).toBe('complete');
  });

  it('builds occurrence and legacy routes', () => {
    expect(occurrenceRoute({ file_id: 7, segment_index: 12 }, 'word', 3)).toBe('/files/7?segment=12&focusType=word&focusId=3');
    expect(legacyReadingRoute('?fileId=7')).toBe('/files/7');
    expect(legacyReadingRoute('')).toBe('/files');
  });
});
