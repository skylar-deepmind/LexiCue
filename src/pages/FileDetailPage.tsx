import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import EmptyState from '../components/EmptyState';
import ReadingPage from './ReadingPage';
import { useFileStore } from '../stores/fileStore';
import type { FileRecord } from '../lib/types';

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

  if (loading) return <div className="flex h-full items-center justify-center text-gray-400">{t('common.loading')}</div>;
  if (error || !file) return <EmptyState icon="📭" title={t('fileDetail.notFound')} description={t('fileDetail.notFoundHint')} />;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-gray-100 bg-white px-4 py-3 sm:px-6">
        <button onClick={backToFiles} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label={t('fileDetail.back')}>
          <ArrowLeft size={18} />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-base font-medium text-gray-900" title={file.name}>{file.name}</h1>
      </header>
      <div className="min-h-0 flex-1">
        <ReadingPage fileId={fileId} />
      </div>
    </div>
  );
}
