import { boundedDocumentZip } from './documentZip';
import { DOCUMENT_LIMITS } from './documentTypes';

const documents = ['srt', 'vtt', 'txt', 'md', 'markdown', 'docx', 'epub', 'pdf'];
const covers = ['jpg', 'jpeg', 'png', 'webp'];
const audio = ['m4a', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'opus', 'mka'];
const video = ['mp4', 'mov', 'm4v', 'mkv', 'webm'];
const extension = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? '';
const media = [...audio, ...video];
const allowed = [...documents, ...covers, ...media];

export interface PackageMember {
  name: string;
  document: Uint8Array;
  cover?: Uint8Array;
  audio?: Uint8Array;
}

export function unpackMaterialPackage(bytes: Uint8Array): PackageMember[] {
  const files = boundedDocumentZip(bytes, {
    needed: name => !name.split('/').some(part => part.startsWith('.') || part === '__MACOSX') && allowed.includes(extension(name)),
    entryBytes: name => covers.includes(extension(name)) ? 8 * 1024 * 1024 : DOCUMENT_LIMITS.binaryBytes,
    totalBytes: DOCUMENT_LIMITS.zipTotalBytes,
  });
  type Group = { path: string; entries: Map<string, [string, Uint8Array]> };
  const groups = new Map<string, Group>();
  for (const [name, data] of files) {
    const path = name.slice(0, name.lastIndexOf('.')).normalize('NFC');
    const key = path.toLowerCase();
    const group = groups.get(key) ?? { path, entries: new Map() };
    const ext = extension(name);
    if (group.entries.has(ext)) throw new Error('material_ambiguous_package');
    group.entries.set(ext, [name, data]);
    groups.set(key, group);
  }
  const preferred = (group: Group | undefined, types: string[]) => types.map(type => group?.entries.get(type)).find(Boolean);
  const results: PackageMember[] = [];
  const used = new Set<string>();
  // yt-dlp's exported English captions commonly have a language suffix.
  for (const [key, group] of groups) {
    if (!/\.en(?:-[a-z]{2})?$/.test(key) || !preferred(group, ['srt', 'vtt'])) continue;
    const base = key.replace(/\.en(?:-[a-z]{2})?$/, '');
    const companions = groups.get(base);
    if (!companions || !preferred(companions, [...covers, ...media]) || preferred(companions, ['srt', 'vtt'])) continue;
    // Multiple English tracks need a single unambiguous pairing.
    if (used.has(base)) throw new Error('material_ambiguous_package');
    used.add(base);
    const [name, document] = preferred(group, ['srt', 'vtt'])!;
    results.push({ name: companions.path.split('/').at(-1)! + '.' + extension(name), document,
      cover: preferred(group, covers)?.[1] ?? preferred(companions, covers)?.[1],
      audio: preferred(group, media)?.[1] ?? preferred(companions, media)?.[1] });
    used.add(key);
  }
  for (const [key, group] of groups) {
    if (used.has(key)) continue;
    const primary = preferred(group, documents);
    if (!primary) continue;
    const [name, document] = primary;
    results.push({ name: name.split('/').at(-1)!, document, cover: preferred(group, covers)?.[1],
      audio: ['srt', 'vtt'].includes(extension(name)) ? preferred(group, media)?.[1] : undefined });
  }
  if (!results.length) throw new Error('material_empty_package');
  if (results.length > 100) throw new Error('material_archive_limit');
  return results;
}
