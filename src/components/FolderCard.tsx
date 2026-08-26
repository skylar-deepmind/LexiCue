import { Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FolderInfo } from '../lib/types';
import type { DragPayload } from './FolderTree';
import FolderActionsMenu from './FolderActionsMenu';

interface FolderCardProps {
  folder: FolderInfo;
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

export default function FolderCard({
  folder,
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
}: FolderCardProps) {
  const { t } = useTranslation();
  const invalidDrop = drag?.kind === 'folder' && descendantIds.has(folder.id);
  const canDrop = drag !== null && !invalidDrop;

  return (
    <article
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
      className={`group folder-card flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 transition-all hover:border-blue-300 hover:shadow-sm ${
        invalidDrop ? 'opacity-40' : ''
      }`}
    >
      <button onClick={() => onSelect(folder.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left" aria-label={`${t('files.openFolder', 'Open folder')}: ${folder.name}`}>
        <Folder size={25} className="folder-card-icon shrink-0" strokeWidth={1.7} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900" title={folder.name}>
          {folder.name}
          </span>
          <span className="block text-xs text-gray-500">
          {t('files.folderCount', { count: folder.file_count })}
          </span>
        </span>
      </button>
      <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
        <FolderActionsMenu
          folder={folder}
          onNewSubfolder={onNewSubfolder}
          onRename={onRename}
          onMove={onMove}
          onDelete={onDelete}
        />
      </div>
    </article>
  );
}
