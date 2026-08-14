import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderOpen, HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FolderInfo } from '../lib/types';
import { buildFolderTree, getFolderPath, type FolderNode } from '../lib/folderTree';
import FolderActionsMenu from './FolderActionsMenu';

export interface DragPayload {
  kind: 'file' | 'folder';
  id: number;
}

interface FolderTreeProps {
  folders: FolderInfo[];
  currentFolderId: number | null;
  drag: DragPayload | null;
  descendantIds: Set<number>;
  onSelect: (folderId: number | null) => void;
  onDragStart: (event: React.DragEvent, payload: DragPayload) => void;
  onDragEnd: () => void;
  onDrop: (targetFolderId: number | null) => void;
  onNewSubfolder: (parentId: number) => void;
  onRename: (folder: FolderInfo) => void;
  onMove: (folder: FolderInfo) => void;
  onDelete: (folder: FolderInfo) => void;
}

interface TreeNodeProps {
  node: FolderNode;
  depth: number;
  expanded: Set<number>;
  toggle: (id: number) => void;
  currentFolderId: number | null;
  drag: DragPayload | null;
  descendantIds: Set<number>;
  onSelect: (folderId: number) => void;
  onDragStart: (event: React.DragEvent, payload: DragPayload) => void;
  onDragEnd: () => void;
  onDrop: (targetFolderId: number | null) => void;
  onNewSubfolder: (parentId: number) => void;
  onRename: (folder: FolderInfo) => void;
  onMove: (folder: FolderInfo) => void;
  onDelete: (folder: FolderInfo) => void;
}

function TreeNode({
  node,
  depth,
  expanded,
  toggle,
  currentFolderId,
  drag,
  descendantIds,
  onSelect,
  onDragStart,
  onDragEnd,
  onDrop,
  onNewSubfolder,
  onRename,
  onMove,
  onDelete,
}: TreeNodeProps) {
  const { folder, children } = node;
  const isExpanded = expanded.has(folder.id);
  const isActive = currentFolderId === folder.id;
  const invalidDrop =
    drag?.kind === 'folder' && descendantIds.has(folder.id) && drag.id !== folder.id;
  const canDrop = drag !== null && !invalidDrop;

  return (
    <div>
      <div
        draggable
        onDragStart={(event) => onDragStart(event, { kind: 'folder', id: folder.id })}
        onDragEnd={onDragEnd}
        onDragOver={(event) => {
          if (canDrop) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (canDrop) onDrop(folder.id);
        }}
        onClick={() => onSelect(folder.id)}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        className={`group flex w-full cursor-pointer items-center gap-1 rounded-lg px-1.5 py-1 text-sm transition-colors ${
          isActive ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'
        } ${invalidDrop ? 'opacity-40' : ''}`}
      >
        <button
          onClick={(event) => {
            event.stopPropagation();
            toggle(folder.id);
          }}
          className="shrink-0 p-0.5 text-gray-400 hover:text-gray-600"
        >
          {children.length > 0 ? (
            isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <span className="inline-block w-[14px]" />
          )}
        </button>
        {isExpanded ? (
          <FolderOpen size={15} className="shrink-0 text-amber-500" />
        ) : (
          <Folder size={15} className="shrink-0 text-amber-500" />
        )}
        <span className="min-w-0 flex-1 truncate" title={folder.name}>{folder.name}</span>
        {folder.file_count > 0 && (
          <span className="shrink-0 text-xs text-gray-400">{folder.file_count}</span>
        )}
        <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
          <FolderActionsMenu
            folder={folder}
            onNewSubfolder={onNewSubfolder}
            onRename={onRename}
            onMove={onMove}
            onDelete={onDelete}
          />
        </div>
      </div>
      {isExpanded &&
        children.map((child) => (
          <TreeNode
            key={child.folder.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            currentFolderId={currentFolderId}
            drag={drag}
            descendantIds={descendantIds}
            onSelect={onSelect}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDrop={onDrop}
            onNewSubfolder={onNewSubfolder}
            onRename={onRename}
            onMove={onMove}
            onDelete={onDelete}
          />
        ))}
    </div>
  );
}

export default function FolderTree(props: FolderTreeProps) {
  const { t } = useTranslation();
  const { folders, currentFolderId, onSelect, onDrop, drag, descendantIds } = props;
  const roots = buildFolderTree(folders);

  const pathIds = getFolderPath(folders, currentFolderId).map((folder) => folder.id);
  const pathKey = pathIds.slice(0, -1).join(',');
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(pathIds.slice(0, -1)),
  );

  useEffect(() => {
    if (!pathKey) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of pathKey.split(',').map(Number)) next.add(id);
      return next;
    });
  }, [pathKey]);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canDropRoot = drag !== null;

  return (
    <div className="flex h-full flex-col p-2">
      <div
        onClick={() => onSelect(null)}
        onDragOver={(event) => {
          if (canDropRoot) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (canDropRoot) onDrop(null);
        }}
        className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
          currentFolderId === null
            ? 'bg-blue-50 text-blue-600'
            : 'text-gray-600 hover:bg-gray-50'
        }`}
      >
        <HardDrive size={15} className="shrink-0 text-blue-500" />
        <span className="min-w-0 flex-1 truncate">{t('files.root')}</span>
      </div>
      <div className="my-1 border-t border-gray-100" />
      <div className="flex-1 overflow-y-auto">
        {roots.map((node) => (
          <TreeNode
            key={node.folder.id}
            node={node}
            depth={0}
            expanded={expanded}
            toggle={toggle}
            currentFolderId={currentFolderId}
            drag={drag}
            descendantIds={descendantIds}
            onSelect={(folderId) => onSelect(folderId)}
            onDragStart={props.onDragStart}
            onDragEnd={props.onDragEnd}
            onDrop={onDrop}
            onNewSubfolder={props.onNewSubfolder}
            onRename={props.onRename}
            onMove={props.onMove}
            onDelete={props.onDelete}
          />
        ))}
        {roots.length === 0 && (
          <p className="px-2 py-2 text-xs text-gray-400">{t('files.treeEmpty')}</p>
        )}
      </div>
    </div>
  );
}
