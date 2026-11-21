import type { Material } from './materials';
import type { SavedRecord } from './savedRecords';

// Content identity already travels with backups and sync. Allocation is stable
// across renames, devices and restores, without migrating historical records.
const prints = ['16339', '16355', '16367', '16388', '16398', '16428', '16462', '16609', '16907', '16851'];
export function allocatedCover(identity: string): string {
  let hash = 0;
  for (const char of identity) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return `/design/prints/${prints[hash % prints.length]}.jpg`;
}
export function materialCover(material: Material): string {
  return material.document?.cover ?? allocatedCover(material.content_hash);
}
export function savedCover(record: SavedRecord): string {
  return allocatedCover(record.source?.content_hash ?? record.source_key);
}
