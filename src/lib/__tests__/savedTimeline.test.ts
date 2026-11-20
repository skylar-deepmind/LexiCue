import { describe, expect, it } from 'vitest';
import { savedDateBins, savedDayString, savedInputDay, savedTimeline, savedTimelineMinGap } from '../savedTimeline';

describe('saved timeline growth', () => {
  it('keeps zero records empty without inventing a date', () => {
    const model = savedTimeline([], 320);
    expect(model.phase).toBe('empty');
    expect(model.firstDay).toBeUndefined();
    expect(model.marks).toEqual([]);
    expect(model.selectedTotal).toBe(0);
  });
  it('normalizes a single active date within the same compact plot', () => {
    for (const count of [1, 7, 100, 10000]) {
      const model = savedTimeline([{ day: 20000, count }], 320);
      expect(model.phase).toBe('seed');
      expect(model.activeDays).toBe(1);
      expect(model.total).toBe(count);
      expect(model.marks[0]).toMatchObject({ x: 22, width: 8, height: 36, count });
    }
  });
  it('grows by distinct dates rather than total saves', () => {
    const bins = (n: number) => Array.from({ length: n }, (_, day) => ({ day, count: 1 }));
    expect([1, 3, 7, 28].map(n => savedTimeline(bins(n), 320).phase)).toEqual(['seed', 'dots', 'stems', 'band']);
  });
  it('preserves actual gaps between dates and draws no zero-count filler bars', () => {
    const { marks } = savedTimeline([{ day: 0, count: 1 }, { day: 10, count: 1 }, { day: 100, count: 1 }], 320);
    expect(marks).toHaveLength(3);
    expect(marks[1].x - marks[0].x).toBe(savedTimelineMinGap);
    expect(marks[2].x - marks[1].x).toBeGreaterThan(savedTimelineMinGap);
    expect(marks.every(mark => mark.count > 0)).toBe(true);
  });
  it('normalizes bar heights to the peak while preserving relative values', () => {
    const bins = Array.from({ length: 14 }, (_, day) => ({ day, count: day === 13 ? 7 : 1 }));
    const model = savedTimeline(bins, 320);
    expect(model.capacity).toBe(7);
    expect(model.marks[0].height).toBeCloseTo(36/7);
    expect(model.marks.at(-1)!.height).toBe(36);
    expect(model.marks.every(mark => mark.height <= 36)).toBe(true);
  });
  it('preserves ratios even when one day greatly exceeds another', () => {
    const { marks } = savedTimeline([{day:1,count:1},{day:2,count:1000}],320);
    expect(marks[0].height / marks[1].height).toBeCloseTo(.001, 8);
  });
  it('keeps sparse dates compact and lets dense dates extend beyond the viewport', () => {
    const bins = Array.from({ length: 1000 }, (_, day) => ({ day: day * 2, count: 3 }));
    expect(savedTimeline(bins.slice(0, 3), 1200).width).toBe(108);
    const model = savedTimeline(bins, 276, 100, 120);
    expect(model.width).toBeGreaterThan(276);
    expect(model.marks).toHaveLength(1000);
    expect(model.total).toBe(3000);
    expect(model.selectedTotal).toBe(33);
    expect(model.marks.slice(1).every((mark, i) => mark.x - model.marks[i].x >= savedTimelineMinGap)).toBe(true);
    for (const day of [0, 50, 121, 1234, 1998]) {
      expect(model.dayAt(model.xFor(day))).toBeCloseTo(day);
    }
  });
  it('sorts and merges native date bins, ignoring invalid counts and impossible dates', () => {
    expect(savedDateBins([{ day: 3, count: 2 }, { day: 1, count: 1 }, { day: 3, count: 4 }, { day: 2, count: 0 }, { day: 4, count: -2 }, { day: NaN, count: 1 }, { day: 1e9, count: 1 }])).toEqual([{ day: 1, count: 1 }, { day: 3, count: 6 }]);
  });
  it('round-trips date-only native day numbers without local-timezone shifts', () => {
    for (const day of [0, 20000, 20774]) expect(savedInputDay(savedDayString(day))).toBe(day);
    expect(savedInputDay('')).toBeUndefined();
  });
});
