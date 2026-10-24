import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ReadingMaterial } from '../lib/materials';
import { useMaterialStore } from '../stores/materialStore';
import ReadingPage from './ReadingPage';
import { LIBRARY_SCOPE } from '../lib/readingScope';
export default function FileDetailPage() {
    const { fileId: raw } = useParams();
    const id = Number(raw);
    const { t } = useTranslation();
    const [data, setData] = useState<ReadingMaterial | null>(null);
    const [error, setError] = useState(false);
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        let active = true;
        setData(null);
        setError(false);
        if (!Number.isInteger(id) || id < 1) {
            setError(true);
            return;
        }
        void invoke<ReadingMaterial>('open_reading_material', { fileId: id }).then(next => { if (active) {
            setData(next);
            useMaterialStore.setState({ current: next.material });
        } }).catch(() => { if (active)
            setError(true); });
        return () => { active = false; };
    }, [id, revision]);
    if (error)
        return <div className="reader-load-error"><p>{t('reader.unavailable')}</p><div><button className="ui-button" onClick={() => setRevision(revision + 1)}>{t('common.retry')}</button><Link className="ui-button" to={`/legacy?fileId=${id}`}>{t('materials.history')}</Link></div></div>;
    if (!data)
        return <p className="material-status" role="status">{t('common.loading')}</p>;
    return <ReadingPage key={data.material.content_hash} data={data} scope={LIBRARY_SCOPE}/>;
}
