import AdaptiveMenu from './AdaptiveMenu';
import { useRef, useState } from 'react';
import { MoreHorizontal, FolderPlus, Pencil, FolderInput, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FolderInfo } from '../lib/types';

interface FolderActionsMenuProps {
  folder: FolderInfo;
  onNewSubfolder: (parentId: number) => void;
  onRename: (folder: FolderInfo) => void;
  onMove: (folder: FolderInfo) => void;
  onDelete: (folder: FolderInfo) => void;
}

export default function FolderActionsMenu({
  folder,
  onNewSubfolder,
  onRename,
  onMove,
  onDelete,
}: FolderActionsMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        ref={buttonRef}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('folders.actionsAria', { name: folder.name })}
        className="p-1 text-gray-400 transition-colors hover:text-gray-700"
      >
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <AdaptiveMenu anchorRef={buttonRef} label={folder.name} onClose={() => setOpen(false)}>
          <button
            role="menuitem"
            onClick={() => run(() => onNewSubfolder(folder.id))}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            <FolderPlus size={15} className="text-gray-400" />
            {t('folders.newSubfolder')}
          </button>
          <button
            role="menuitem"
            onClick={() => run(() => onRename(folder))}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Pencil size={15} className="text-gray-400" />
            {t('folders.rename')}
          </button>
          <button
            role="menuitem"
            onClick={() => run(() => onMove(folder))}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            <FolderInput size={15} className="text-gray-400" />
            {t('folders.move')}
          </button>
          <div className="my-1 border-t border-gray-100" />
          <button
            role="menuitem"
            onClick={() => run(() => onDelete(folder))}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
          >
            <Trash2 size={15} className="text-red-400" />
            {t('folders.delete')}
          </button>
        </AdaptiveMenu>
      )}
    </div>
  );
}
