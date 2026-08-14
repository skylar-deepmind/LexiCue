import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

const MENU_PADDING = 8;
const MENU_GAP = 4;

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
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const buttonRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let left = buttonRect.right - menuRect.width;
    left = Math.min(left, window.innerWidth - menuRect.width - MENU_PADDING);
    left = Math.max(left, MENU_PADDING);
    let top = buttonRect.bottom + MENU_GAP;
    if (top + menuRect.height > window.innerHeight - MENU_PADDING) {
      top = Math.max(MENU_PADDING, buttonRect.top - menuRect.height - MENU_GAP);
    }
    setPosition({ left, top });
  }, [open]);

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
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', left: position.left, top: position.top, zIndex: 100 }}
          className="min-w-[160px] rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
        >
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
        </div>
      )}
    </div>
  );
}
