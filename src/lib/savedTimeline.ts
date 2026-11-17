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
export function savedTimeline(input: readonly SavedDateBin[], width: number, from = -Infinity, to = Infinity) {
  const bins = savedDateBins(input), firstDay = bins[0]?.day, lastDay = bins.at(-1)?.day;
  const activeDays = bins.length, total = bins.reduce((n, b) => n + b.count, 0);
  const selectedTotal = bins.reduce((n, b) => n + (b.day >= from && b.day <= to ? b.count : 0), 0);
  const phase: TimelinePhase = activeDays === 0 ? 'empty' : activeDays === 1 ? 'seed' : activeDays < 5 ? 'dots' : activeDays < 14 ? 'stems' : 'band';
  const plotWidth = Math.max(1, width - 44), maxMarks = Math.max(1, Math.min(96, Math.floor(plotWidth / 5)));
  const span = (lastDay ?? 0) - (firstDay ?? 0);
  const bucketSize = activeDays > maxMarks ? Math.ceil((span + 1) / maxMarks) : 1;
  const buckets = new Map<number, { firstDay: number; lastDay: number; count: number; selectedCount: number }>();
  for (const bin of bins) {
    const key = Math.floor((bin.day - firstDay!) / bucketSize);
    const bucket = buckets.get(key);
    const selected = bin.day >= from && bin.day <= to ? bin.count : 0;
    if (bucket) { bucket.lastDay = bin.day; bucket.count += bin.count; bucket.selectedCount += selected; }
    else buckets.set(key, { firstDay: bin.day, lastDay: bin.day, count: bin.count, selectedCount: selected });
  }
  // Keep a compact, fixed plotting height; only the relative data scale changes.
  const peak = Math.max(1, ...[...buckets.values()].map(b => b.count));
  const capacity = peak, density = smooth(12, 25, activeDays);
  const pitch = plotWidth * bucketSize / Math.max(1, span);
  const markWidth = 8 + (Math.max(3, Math.min(11, pitch * .67)) - 8) * density;
  const marks: TimelineMark[] = [...buckets].map(([key, bin]) => {
    const day = (bin.firstDay + bin.lastDay) / 2;
    const x = activeDays === 1 ? width / 2 : 22 + (day - firstDay!) / Math.max(1, span) * plotWidth;
    const height = Math.max(4, 36 * bin.count / capacity);
    return { ...bin, key: firstDay! + key * bucketSize, x, width: markWidth, height };
  });
  return { bins, marks, activeDays, total, selectedTotal, phase, firstDay, lastDay, capacity,
    axisStart: activeDays === 1 ? width / 2 - 16 : 22,
    axisEnd: activeDays === 1 ? width / 2 + 16 : width - 22 };
}
export const savedDayString = (day: number) => new Date(day * 86400000).toISOString().slice(0, 10);
export const savedInputDay = (date: string) => date ? Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000) : undefined;
