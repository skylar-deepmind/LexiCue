import { Folder, HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FolderInfo } from '../lib/types';
import { getFolderDescendantIds } from '../lib/folderTree';

interface MoveToFolderDialogProps {
  title: string;
  folders: FolderInfo[];
  excludeFolderId?: number | null;
  onSelect: (folderId: number | null) => void;
  onCancel: () => void;
}

export default function MoveToFolderDialog({
  title,
  folders,
  excludeFolderId,
  onSelect,
  onCancel,
}: MoveToFolderDialogProps) {
  const { t } = useTranslation();
  const invalidIds = excludeFolderId
    ? getFolderDescendantIds(folders, excludeFolderId)
    : new Set<number>();

  const childrenOf = (parentId: number | null) =>
    folders.filter((folder) => folder.parent_id === parentId);

  const renderItem = (folder: FolderInfo, depth: number) => {
    const invalid = invalidIds.has(folder.id);
    return (
      <div key={folder.id}>
        <button
          onClick={() => onSelect(folder.id)}
          disabled={invalid}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
            invalid
              ? 'cursor-not-allowed text-gray-300'
              : 'text-gray-700 hover:bg-gray-50'
          }`}
          style={{ paddingLeft: `${depth * 20 + 12}px` }}
        >
          <Folder size={15} className={invalid ? 'text-gray-300' : 'text-amber-500'} />
          <span className="min-w-0 truncate">{folder.name}</span>
        </button>
        {childrenOf(folder.id).map((child) => renderItem(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[70vh] w-full max-w-sm flex-col rounded-2xl bg-white shadow-xl">
        <div className="border-b border-gray-100 p-5">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          <button
            onClick={() => onSelect(null)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            <HardDrive size={15} className="text-blue-500" />
            {t('files.root')}
          </button>
          <div className="my-1 border-t border-gray-100" />
          {folders.filter((folder) => folder.parent_id === null).map((folder) => renderItem(folder, 0))}
          {folders.length === 0 && (
            <p className="px-3 py-2 text-sm text-gray-400">{t('files.moveEmptyFolders')}</p>
          )}
        </div>
        <div className="flex justify-end border-t border-gray-100 p-4">
          <button
            onClick={onCancel}
            className="rounded-lg bg-gray-100 px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
