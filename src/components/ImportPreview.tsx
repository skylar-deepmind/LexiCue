import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import type { Language } from '../lib/languages';
import { languageLabel } from '../lib/languages';

interface ImportPreviewProps {
  preview: Array<{ en: string; zh: string | null }>;
  fileName: string;
  segmentCount: number;
  wordCount: number;
  language: Language;
  replaceFileName?: string | null;
  targetFolder?: string | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ImportPreview({
  preview,
  fileName,
  segmentCount,
  wordCount,
  language,
  replaceFileName,
  targetFolder,
  busy = false,
  onConfirm,
  onCancel,
}: ImportPreviewProps) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div className="p-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">{t('importPreview.title')}</h3>
          <p className="text-sm text-gray-500 mt-1 truncate" title={fileName}>{fileName}</p>
          <div className="flex gap-3 mt-3 text-xs text-gray-500">
            <span>{t('importPreview.segments', { count: segmentCount })}</span>
            <span>{t('importPreview.words', { count: wordCount })}</span>
            <span>{languageLabel(language)}</span>
          </div>
          {replaceFileName && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('importPreview.replaceHint', { name: replaceFileName })}
            </p>
          )}
          {targetFolder && (
            <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
              {t('importPreview.targetFolder', { name: targetFolder })}
            </p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {preview.map((p, i) => (
            <div key={i} className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm text-gray-800 font-medium">{p.en}</p>
              {p.zh && <p className="text-xs text-gray-500 mt-1">{p.zh}</p>}
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-gray-100 flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-40"
          >
            {t('importPreview.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {busy && <RefreshCw size={14} className="animate-spin" />}
            {busy ? t('fileStore.importing') : t('importPreview.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
