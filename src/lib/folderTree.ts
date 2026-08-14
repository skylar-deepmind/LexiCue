import type { FolderInfo } from './types';

export interface FolderNode {
  folder: FolderInfo;
  children: FolderNode[];
}

export function buildFolderTree(folders: FolderInfo[], parentId: number | null = null): FolderNode[] {
  const byParent = new Map<number, FolderInfo[]>();
  for (const folder of folders) {
    if (folder.parent_id === null) continue;
    const list = byParent.get(folder.parent_id) ?? [];
    list.push(folder);
    byParent.set(folder.parent_id, list);
  }
  const build = (pid: number | null): FolderNode[] => {
    const siblings = pid === null
      ? folders.filter((folder) => folder.parent_id === null)
      : (byParent.get(pid) ?? []);
    return siblings.map((folder) => ({
      folder,
      children: build(folder.id),
    }));
  };
  return build(parentId);
}

export function getFolderPath(folders: FolderInfo[], folderId: number | null): FolderInfo[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: FolderInfo[] = [];
  let current = folderId === null ? null : byId.get(folderId) ?? null;
  while (current) {
    path.unshift(current);
    current = current.parent_id === null ? null : byId.get(current.parent_id) ?? null;
  }
  return path;
}

export function getFolderDescendantIds(folders: FolderInfo[], folderId: number): Set<number> {
  const byParent = new Map<number, FolderInfo[]>();
  for (const folder of folders) {
    if (folder.parent_id === null) continue;
    const list = byParent.get(folder.parent_id) ?? [];
    list.push(folder);
    byParent.set(folder.parent_id, list);
  }
  const result = new Set<number>();
  const visit = (id: number) => {
    result.add(id);
    for (const child of byParent.get(id) ?? []) visit(child.id);
  };
  visit(folderId);
  return result;
}
