/** Omit progress when the native service cannot report a completion count. */
export default function InlineProgress({ label, progress }: { label: string; progress?: {done: number; total: number} }) {
  const percent = progress ? Math.max(0, Math.min(100, progress.done / Math.max(1, progress.total) * 100)) : undefined;
  return <span className="inline-progress" data-determinate={!!progress || undefined} role="progressbar" aria-label={label}
    aria-valuemin={progress ? 0 : undefined} aria-valuemax={progress?.total} aria-valuenow={progress?.done}>
    <span style={percent === undefined ? undefined : {width: `${percent}%`}} />
  </span>;
}
