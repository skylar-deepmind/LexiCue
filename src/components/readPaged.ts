/** Read a requested prefix without exceeding the backend's per-call limit. */
export async function readPaged<T>(target: number, offset: number, batchLimit: number, fetch: (limit: number, offset: number) => Promise<{items: T[]; total: number}>, valid: () => boolean) {
  const items: T[] = [];
  let total = 0;
  do {
    const part = await fetch(Math.min(batchLimit, target - items.length), offset + items.length);
    if (!valid()) return null;
    total = part.total; items.push(...part.items);
    if (!part.items.length) break;
  } while (items.length < target && offset + items.length < total);
  return {items, total};
}
