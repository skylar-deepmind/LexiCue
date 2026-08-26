import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import EmptyState from '../components/EmptyState';
import ReadingPage from './ReadingPage';
import { useFileStore } from '../stores/fileStore';
import type { FileRecord } from '../lib/types';
import { LoadingSpinner } from '../components/Skeleton';

export default function FileDetailPage() {
  const { t } = useTranslation();
  const { fileId: rawFileId } = useParams();
  const fileId = Number(rawFileId);
  const navigate = useNavigate();
  const [file, setFile] = useState<FileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!Number.isInteger(fileId)) {
      setError(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    invoke<FileRecord>('get_file_info', { fileId })
      .then((nextFile) => {
        setFile(nextFile);
        setError(false);
      })
      .catch((reason) => {
        console.error('Failed to load file:', reason);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [fileId]);

  const backToFiles = () => {
    useFileStore.getState().setCurrentFolder(file?.folder_id ?? null);
    navigate('/files');
  };

  if (loading) return <div className="flex h-full items-center justify-center gap-2 text-gray-500" role="status" aria-label={t('common.loading')}><LoadingSpinner />{t('common.loading')}</div>;
  if (error || !file) return <EmptyState icon="📭" title={t('fileDetail.notFound')} description={t('fileDetail.notFoundHint')} />;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-3 sm:px-6">
        <button onClick={backToFiles} className="ui-icon-button" aria-label={t('fileDetail.back')}>
          <ArrowLeft size={18} />
        </button>
        <span className="file-card-icon grid size-10 shrink-0 place-items-center rounded-xl"><BookOpen size={19} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('sidebar.files')}</p><h1 className="truncate text-base font-semibold text-gray-900" title={file.name}>{file.name}</h1></div>
      </header>
      <div className="min-h-0 flex-1">
        <ReadingPage fileId={fileId} />
      </div>
    </div>
  );
}
