/** A bounded window, including after a filter, deletion or sync shrinks the collection. */
export function collectionPage(total: number, requested: number, size: number) {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pages, Math.max(1, Math.trunc(requested) || 1));
  const offset = (page - 1) * size;
  return { page, pages, offset, start: total ? offset + 1 : 0, end: Math.min(offset + size, total) };
}
