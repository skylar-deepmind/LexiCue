import { describe, expect, it } from 'vitest';
import { savedDateBins, savedDayString, savedInputDay, savedTimeline } from '../savedTimeline';

describe('saved timeline growth', () => {
  it('keeps zero records empty without inventing a date', () => {
    const model = savedTimeline([], 320);
    expect(model.phase).toBe('empty');
    expect(model.firstDay).toBeUndefined();
    expect(model.marks).toEqual([]);
    expect(model.selectedTotal).toBe(0);
  });
  it('keeps a single date a centered dot even with many records that day', () => {
    for (const count of [1, 7, 100, 10000]) {
      const model = savedTimeline([{ day: 20000, count }], 320);
      expect(model.phase).toBe('seed');
      expect(model.activeDays).toBe(1);
      expect(model.total).toBe(count);
      expect(model.marks[0]).toMatchObject({ x: 160, width: 8, height: 8, count });
    }
  });
  it('grows by distinct dates rather than total saves', () => {
    const bins = (n: number) => Array.from({ length: n }, (_, day) => ({ day, count: 1 }));
    expect([1, 3, 7, 28].map(n => savedTimeline(bins(n), 320).phase)).toEqual(['seed', 'dots', 'stems', 'band']);
  });
  it('preserves actual gaps between dates and draws no zero-count filler bars', () => {
    const { marks } = savedTimeline([{ day: 0, count: 1 }, { day: 10, count: 1 }, { day: 100, count: 1 }], 320);
    expect(marks).toHaveLength(3);
    expect((marks[1].x - marks[0].x) / (marks[2].x - marks[0].x)).toBeCloseTo(.1);
    expect(marks.every(mark => mark.count > 0)).toBe(true);
  });
  it('uses the fixed small-data scale instead of making the current peak full-height', () => {
    const bins = Array.from({ length: 14 }, (_, day) => ({ day, count: day === 13 ? 7 : 1 }));
    const model = savedTimeline(bins, 320);
    expect(model.capacity).toBe(8);
    expect(model.marks[0].height).toBe(8);
    expect(model.marks.at(-1)!.height).toBe(42);
    expect(model.marks.every(mark => mark.height <= 48)).toBe(true);
  });
  it('aggregates a dense long history within the available width without losing records or range counts', () => {
    const bins = Array.from({ length: 1000 }, (_, day) => ({ day: day * 2, count: 3 }));
    const model = savedTimeline(bins, 276, 100, 120);
    expect(model.activeDays).toBe(1000);
    expect(model.total).toBe(3000);
    expect(model.selectedTotal).toBe(33);
    expect(model.marks.length).toBeLessThanOrEqual(46);
    expect(model.marks.reduce((n, mark) => n + mark.count, 0)).toBe(3000);
    expect(model.marks.reduce((n, mark) => n + mark.selectedCount, 0)).toBe(33);
    expect(model.marks.every(mark => mark.x >= 22 && mark.x <= 254 && mark.height <= 48)).toBe(true);
  });
  it('sorts and merges native date bins, ignoring invalid counts and impossible dates', () => {
    expect(savedDateBins([{ day: 3, count: 2 }, { day: 1, count: 1 }, { day: 3, count: 4 }, { day: 2, count: 0 }, { day: 4, count: -2 }, { day: NaN, count: 1 }, { day: 1e9, count: 1 }])).toEqual([{ day: 1, count: 1 }, { day: 3, count: 6 }]);
  });
  it('round-trips date-only native day numbers without local-timezone shifts', () => {
    for (const day of [0, 20000, 20774]) expect(savedInputDay(savedDayString(day))).toBe(day);
    expect(savedInputDay('')).toBeUndefined();
  });
});
