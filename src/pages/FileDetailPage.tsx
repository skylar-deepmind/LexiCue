import { LoadingSkeleton } from '../components/LoadingFeedback';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ReadingMaterial } from '../lib/materials';
import { useMaterialStore } from '../stores/materialStore';
import { readerNavigation, sourceMatches } from '../lib/readerNavigation';
import ReadingPage from './ReadingPage';
import { LIBRARY_SCOPE } from '../lib/readingScope';
import { consumeImportedReading, validateImportedReading } from '../lib/readingEntry';
import { useReadingDeskStore } from '../stores/readingDeskStore';
export default function FileDetailPage() {
    const { fileId: raw } = useParams();
    const id = Number(raw);
    return <MaterialReader key={id} id={id}/>;
}
function MaterialReader({ id }: { id: number }) {
    const title = useMaterialStore(store =>
        store.files.find(file => file.id === id)?.name ?? (store.current?.id === id ? store.current.name : undefined));
    const { state } = useLocation();
    const importToken = state?.importReadingToken;
    const visit = readerNavigation.get(state?.sourceVisitToken);
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
        void Promise.all([invoke<ReadingMaterial>('open_reading_material', { fileId: id }), useMaterialStore.getState().load()]).then(async ([next]) => {
            const imported = await validateImportedReading(importToken, next);
            if (active) {
            if (imported && consumeImportedReading(importToken)) useReadingDeskStore.getState().keepAndOpen(next.material);
            else consumeImportedReading(importToken);
            useReadingDeskStore.getState().use(next.material);
            setData(next);
            useMaterialStore.setState({ current: next.material });
        } }).catch(() => { if (active) {
            consumeImportedReading(importToken); setError(true);
        } });
        return () => { active = false; useReadingDeskStore.getState().clearNotice(); };
    }, [id, revision, importToken]);
    if (error || data && visit && !sourceMatches(visit.target, data))
        return <div className="reader-load-error"><p>{t('reader.unavailable')}</p>{visit && <blockquote lang="en">{visit.target.sentence}</blockquote>}<div>{visit && <Link className="ui-button" to={visit.origin.path} state={{restoreVisitToken:state?.sourceVisitToken, sourceVisitToken:visit.origin.kind==='reader'?visit.origin.parentVisitToken:undefined}}>{t('common.back')}</Link>}<button className="ui-button" onClick={() => setRevision(revision + 1)}>{t('common.retry')}</button><Link className="ui-button" to={`/legacy?fileId=${id}`}>{t('materials.history')}</Link></div></div>;
    if (!data)
        return <div className="material-reading"><div className="reading-page"><div className="reader-scroll"><div className="reading-layout"><section className="workspace-paper reading-paper" aria-busy="true">
            {title && <h1 className="reading-title" lang="en">{title}</h1>}
            <LoadingSkeleton kind="text" label={t('common.loading')}/>
        </section></div></div></div></div>;
    return <div className="material-reading"><ReadingPage key={`${data.material.id}:${data.material.content_hash}:${state?.sourceVisitToken ?? ""}:${state?.restoreVisitToken ?? ""}`} data={data} scope={LIBRARY_SCOPE}/></div>;
}
