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
      className={`group flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 transition-all hover:border-blue-300 hover:shadow-sm ${
        invalidDrop ? 'opacity-40' : 'cursor-pointer'
      }`}
    >
      <Folder size={28} className="shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium text-gray-900" title={folder.name}>
          {folder.name}
        </h3>
        <p className="text-xs text-gray-500">
          {t('files.folderCount', { count: folder.file_count })}
        </p>
      </div>
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
  );
}
