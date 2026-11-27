import { readerViews } from '../lib/readerViewMemory';
import { usePageReturn, viewKey } from '../lib/pageNavigation';
import VisitLink from '../components/VisitLink';
import PageBack from '../components/PageBack';
import { ChevronLeft } from 'lucide-react';
import { prepareReadingReturn } from '../lib/readingMotion';
import { readingReturnPath } from '../lib/readingEntry';
import ReaderHeading from '../components/ReaderHeading';
import { LoadingSkeleton } from '../components/LoadingFeedback';
import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { ReadingMaterial } from '../lib/materials';
import { useMaterialStore } from '../stores/materialStore';
import { readerNavigation, sourceMatches } from '../lib/readerNavigation';
import ReadingPage from './ReadingPage';
import { LIBRARY_SCOPE } from '../lib/readingScope';
import { consumeImportedReading, validateImportedReading } from '../lib/readingEntry';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import { useRestoreGuard } from '../stores/restoreGuard';
import { useSpeechStore } from '../stores/speechStore';

const pendingReads = new Map<string, Promise<ReadingMaterial>>();
function openMaterial(id: number) {
    const key = `${useRestoreGuard.getState().generation}:${id}`;
    const pending = pendingReads.get(key);
    if (pending) return pending;
    const request = invoke<ReadingMaterial>('open_reading_material', { fileId: id })
        .finally(() => { pendingReads.delete(key); });
    pendingReads.set(key, request);
    return request;
}

export default function FileDetailPage() {
    const { fileId: raw } = useParams();
    const id = Number(raw);
    const location=useLocation();
    return <MaterialReader key={`${id}:${location.key}`} id={id}/>;
}
function MaterialReader({ id }: { id: number }) {
    const material = useMaterialStore(store =>
        store.files.find(file => file.id === id) ?? (store.current?.id === id ? store.current : undefined));
    const location = useLocation();
    const {state} = location;
    const { back } = usePageReturn(readingReturnPath(state));
    const [cached] = useState(()=>readerViews.get(viewKey(location)));
    const importToken = state?.importReadingToken;
    const visit = readerNavigation.get(state?.sourceVisitToken);
    const { t } = useTranslation();
    const [data, setData] = useState<ReadingMaterial | null>(cached?.data.material.id===id ? cached.data : null);
    const [error, setError] = useState(false);
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        const refresh = () => setRevision(value => value + 1);
        window.addEventListener('lexicue-sync-applied', refresh);
        return () => window.removeEventListener('lexicue-sync-applied', refresh);
    }, []);
    useEffect(() => {
        let active = true;
        setError(false);
        if (!Number.isInteger(id) || id < 1) {
            setError(true);
            return;
        }
        void openMaterial(id).then(async next => {
            const imported = await validateImportedReading(importToken, next);
            if (active) {
            if (imported && consumeImportedReading(importToken)) useReadingDeskStore.getState().keepAndOpen(next.material);
            else consumeImportedReading(importToken);
            useReadingDeskStore.getState().use(next.material);
            setData(next);
            useMaterialStore.setState({ current: next.material });
            void useMaterialStore.getState().ensure();
        } }).catch(error => {
            if (!active) return;
            consumeImportedReading(importToken);
            if (String(error).includes('material_legacy_or_missing')) {
                const current = useMaterialStore.getState().current;
                if (current?.id === id) {
                    const mediaIdentity = current.source?.key ?? current.document?.identity ?? current.content_hash;
                    const speech = useSpeechStore.getState();
                    if (speech.reading?.key.startsWith(`reader:${mediaIdentity}:`)) speech.exitReading();
                    useMaterialStore.setState({ current: null });
                }
            }
            setData(null);
            setError(true);
        });
        return () => { active = false; useReadingDeskStore.getState().clearNotice(); };
    }, [id, revision, importToken]);
    if (error || data && visit && !sourceMatches(visit.target, data))
        return <div className="reader-load-error"><p>{t('reader.unavailable')}</p>{visit && <blockquote lang="en">{visit.target.sentence}</blockquote>}<div><PageBack fallback={visit?.origin.path ?? '/files'}/><button className="ui-button" onClick={() => setRevision(revision + 1)}>{t('common.retry')}</button><VisitLink className="ui-button" to={`/legacy?fileId=${id}`}>{t('materials.history')}</VisitLink></div></div>;
    if (!data)
        return <div className="material-reading"><div className={material ? 'reading-page reader-with-cover' : 'reading-page'}><nav className="reading-breadcrumb" aria-label={t('materials.path')}>
            <button className="page-back" type="button" aria-label={t('common.back')} onClick={() => {
                if (state?.readingMotion) prepareReadingReturn(id);
                back();
            }}><ChevronLeft size={22} aria-hidden="true"/></button>
        </nav><div className="reader-scroll"><div className="reading-layout"><section className="workspace-paper reading-paper" aria-busy="true">
            {material && <ReaderHeading material={material}/>}
            <LoadingSkeleton kind="text" label={t('common.loading')}/>
        </section></div></div></div></div>;
    return <div className="material-reading"><ReadingPage key={`${data.material.id}:${data.material.content_hash}:${state?.sourceVisitToken ?? ""}:${state?.restoreVisitToken ?? ""}`} data={data} scope={LIBRARY_SCOPE}/></div>;
}
