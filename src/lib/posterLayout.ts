export interface PosterMeasure { id: number; characters: number }
export interface PosterPlacement { id: number; column: 0 | 1; units: number }
/** Two equal columns, staggered seams, a shared bottom edge. Order is stable. */
export function phonePosterLayout(items: PosterMeasure[]): PosterPlacement[][] {
  const lengths = items.map(item => item.characters).sort((a, b) => a - b);
  const middle = Math.floor(lengths.length / 2);
  const median = lengths.length % 2 ? lengths[middle] : ((lengths[middle - 1] ?? 0) + (lengths[middle] ?? 0)) / 2;
  const columns: PosterPlacement[][] = [[], []], totals = [0, 0];
  for (const [index, item] of items.entries()) {
    const column: 0 | 1 = index === 0 ? 0 : index === 1 ? 1 : totals[0] <= totals[1] ? 0 : 1;
    const units = index === 1 ? 6 : item.characters > median ? 8 : 4;
    columns[column].push({ id: item.id, column, units }); totals[column] += units;
  }
  // Extend only the final poster, including the inter-poster spacing as units
  // at render time. The images remain separate from their natural title bars.
  const max = Math.max(...totals);
  columns.forEach((column, i) => { if (column.length) column[column.length - 1].units += max - totals[i]; });
  return columns;
}
