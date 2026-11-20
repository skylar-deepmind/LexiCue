export type SavedDateBin = { day: number; count: number };
export type TimelinePhase = 'empty' | 'seed' | 'dots' | 'stems' | 'band';
export type TimelineMark = { key: number; firstDay: number; lastDay: number; count: number; selectedCount: number; x: number; width: number; height: number };
const smooth = (from: number, to: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};
export function savedDateBins(input: readonly SavedDateBin[]): SavedDateBin[] {
  const days = new Map<number, number>();
  for (const bin of input) {
    if (!Number.isSafeInteger(bin.day) || !Number.isSafeInteger(bin.count) || bin.count <= 0 || Math.abs(bin.day) > 100_000_000) continue;
    days.set(bin.day, (days.get(bin.day) ?? 0) + bin.count);
  }
  return [...days].sort(([a], [b]) => a - b).map(([day, count]) => ({ day, count }));
}
const axisInset = 22;
export const savedTimelineMinGap = 12;
const preferredGap = 32;

function interpolate(value: number, source: number[], destination: number[]) {
  if (value <= source[0] || source.length === 1) return destination[0];
  if (value >= source[source.length - 1]) return destination[destination.length - 1];
  let low = 0, high = source.length - 1;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (source[mid] > value) high = mid;
    else low = mid;
  }
  const fraction = (value - source[low]) / (source[high] - source[low]);
  return destination[low] + fraction * (destination[high] - destination[low]);
}

export function savedTimeline(input: readonly SavedDateBin[], availableWidth: number, from = -Infinity, to = Infinity) {
  const bins = savedDateBins(input), firstDay = bins[0]?.day, lastDay = bins.at(-1)?.day;
  const activeDays = bins.length, total = bins.reduce((n, b) => n + b.count, 0);
  const selectedTotal = bins.reduce((n, b) => n + (b.day >= from && b.day <= to ? b.count : 0), 0);
  const phase: TimelinePhase = activeDays === 0 ? 'empty' : activeDays === 1 ? 'seed' : activeDays < 5 ? 'dots' : activeDays < 14 ? 'stems' : 'band';
  const days = bins.map(bin => bin.day);
  const gaps = days.slice(1).map((day, index) => day - days[index]);
  const plotWidth = Math.max(gaps.length * savedTimelineMinGap, Math.min(gaps.length * preferredGap, availableWidth - 2 * axisInset));

  // Keep each mark readable. Once small calendar gaps reach the floor, the
  // remaining width is shared by larger gaps in proportion to their duration.
  let remainingDays = (lastDay ?? 0) - (firstDay ?? 0), remainingWidth = plotWidth;
  let scale = remainingWidth / Math.max(1, remainingDays);
  for (const gap of [...gaps].sort((a, b) => a - b)) {
    if (gap * scale >= savedTimelineMinGap) break;
    remainingDays -= gap;
    remainingWidth -= savedTimelineMinGap;
    scale = remainingWidth / Math.max(1, remainingDays);
  }
  const positions = [axisInset];
  for (const gap of gaps) positions.push(positions[positions.length - 1] + Math.max(savedTimelineMinGap, gap * scale));
  const width = Math.round(plotWidth) + 2 * axisInset;
  const capacity = bins.reduce((peak, bin) => Math.max(peak, bin.count), 1);
  const markWidth = 8 + smooth(12, 25, activeDays) * 1.5;
  const marks: TimelineMark[] = bins.map(({ day, count }, index) => ({
    key: day, firstDay: day, lastDay: day, count,
    selectedCount: day >= from && day <= to ? count : 0,
    x: positions[index], width: markWidth, height: 36 * count / capacity,
  }));
  return {
    bins, marks, activeDays, total, selectedTotal, phase, firstDay, lastDay, capacity, width,
    axisStart: positions[0], axisEnd: positions[positions.length - 1],
    xFor: (day: number) => days.length ? interpolate(day, days, positions) : axisInset,
    dayAt: (x: number) => days.length ? interpolate(x, positions, days) : 0,
  };
}
export const savedDayString = (day: number) => new Date(day * 86400000).toISOString().slice(0, 10);
export const savedInputDay = (date: string) => date ? Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000) : undefined;
