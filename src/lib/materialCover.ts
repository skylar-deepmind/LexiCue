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
  return material.source?.video_id ? `https://i.ytimg.com/vi/${encodeURIComponent(material.source.video_id)}/hqdefault.jpg` : allocatedCover(material.content_hash);
}
export function savedCover(record: SavedRecord): string {
  const video = record.source?.youtube?.video_id ?? record.source?.media?.source.video_id;
  return video ? `https://i.ytimg.com/vi/${encodeURIComponent(video)}/hqdefault.jpg` : allocatedCover(record.source?.content_hash ?? record.source_key);
}
