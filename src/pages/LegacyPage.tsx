import PageBack from '../components/PageBack';
import { usePageReturn,createViewCache,viewKey } from '../lib/pageNavigation';
import { backNavigation } from '../lib/backNavigation';
import { LoadingSkeleton, BusyRing } from '../components/LoadingFeedback';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFileStore } from '../stores/fileStore';
import { useImportStore } from '../stores/importStore';
import ContextPanel from '../components/ContextPanel';
type Row = Record<string, unknown>;
type LegacyPageData = { rows: Row[]; more: boolean };
const kinds = ['files', 'words', 'phrases', 'reviews', 'phrase_reviews', 'review_logs', 'phrase_review_logs', 'frequency_baseline_profiles', 'frequency_baseline_marks', 'frequency_baseline_daily_checks', 'file_phrase_analysis'];
interface LegacyView {kind:string;query:string;offset:number;selected:number|null;scroll:number;result:{kind:string;query:string;data:LegacyPageData}|null}
const views=createViewCache<LegacyView>();
export default function LegacyPage() {
    const { t } = useTranslation();
    const [params] = useSearchParams();
    const location=useLocation(),key=viewKey(location);
    const [memory]=useState(()=>views.get(key));
    const viewport=useRef<HTMLDivElement>(null);
    const {back} = usePageReturn('/settings?section=backup');
    useEffect(()=>backNavigation.setPage(()=>{back();return true;},1),[back]);
    const [kind, setKind] = useState(memory?.kind ?? (kinds.includes(params.get('kind') ?? '') ? params.get('kind')! : 'files'));
    const [query, setQuery] = useState(memory?.query ?? '');
    const [offset, setOffset] = useState(memory?.offset ?? 0);
    const [result, setResult] = useState<{ kind: string; query: string; data: LegacyPageData } | null>(memory?.result ?? null);
    const page = result?.kind === kind && result.query === query ? result.data : null;
    const [selected, setSelected] = useState<number | null>(memory?.selected ?? (params.has('fileId') ? Number(params.get('fileId')) : null));
    const importOpen = useImportStore(state => state.open);
    useEffect(() => { if (importOpen)
        setSelected(null); }, [importOpen]);
    const [selectedDetail, setDetail] = useState<{ kind: string; id: number; value: Row } | null>(null);
    const detail = selectedDetail?.kind === kind && selectedDetail.id === selected ? selectedDetail.value : null;
    const [failed, setFailed] = useState(false);
    const [retry, setRetry] = useState(0);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let live = true;
        setLoading(true);
        setFailed(false);
        void invoke<LegacyPageData>('list_legacy_records', { kind, query, offset }).then(value => { if (live)
            setResult({ kind, query, data: value }); })
            .catch(() => { if (live)
            setFailed(true); }).finally(() => { if (live)
            setLoading(false); });
        return () => { live = false; };
    }, [kind, query, offset, retry]);
    useEffect(() => {
        if (selected === null)
            return;
        let live = true;
        setDetail(null);
        void invoke<Row>('legacy_record_detail', { kind, id: selected }).then(value => { if (live)
            setDetail({ kind, id: selected, value }); })
            .catch(() => { if (live)
            setDetail({ kind, id: selected, value: { error: t('history.missing') } }); });
        return () => { live = false; };
    }, [selected, kind, t]);
    const snapshot=useRef({kind,query,offset,selected,result});snapshot.current={kind,query,offset,selected,result};
    useLayoutEffect(()=>{const node=viewport.current;if(node)node.scrollTop=memory?.scroll ?? 0;return()=>{views.set(key,{...snapshot.current,scroll:node?.scrollTop ?? 0});};},[key,memory]);
    const fields = (value: Row) => <dl className="legacy-fields">{Object.entries(value).filter(([, v]) => v !== null).map(([name, v]) => <div key={name}><dt>{t(`history.fields.${name}`, { defaultValue: name })}</dt><dd>{typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}</dd></div>)}</dl>;
    return <div className="materials-scroll" ref={viewport}><section className="workspace-paper legacy-paper">
    <div className="materials-heading"><PageBack className="desktop-page-back" fallback="/settings?section=backup"/><h1>{t('materials.history')}</h1><button className="ui-button" onClick={() => void useFileStore.getState().exportAll()}>{t('history.export')}</button></div>
    <p className="legacy-hint">{t('history.readOnly')}</p>
    <label className="legacy-kind">{t('history.kind')}<select value={kind} onChange={event => { setKind(event.target.value); setOffset(0); setSelected(null); }}>{kinds.map(value => <option key={value} value={value}>{t(`history.kinds.${value}`)}</option>)}</select></label>
    <input type="search" className="legacy-search" value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} aria-label={t('history.search')} placeholder={t('history.search')}/>
    {loading && !page && <LoadingSkeleton kind="list" label={t('common.loading')}/>}
    {failed && <div role="alert"><p>{t('materials.errors.failed')}</p><button className="ui-button" onClick={() => setRetry(retry + 1)}>{t('common.retry')}</button></div>}
    {page && <ul className="legacy-list" aria-busy={loading}>{page.rows.map(row => {
                const id = Number(row.legacy_rowid ?? row.id ?? row.word_id ?? row.phrase_id);
                return <li key={id}><button onClick={() => setSelected(id)}><strong>{String(row.name ?? row.lemma ?? row.text ?? row.model ?? row.language ?? `#${id}`)}</strong><small>{[row.language, row.status, row.type].filter(Boolean).join(' · ')}</small></button></li>;
            })}</ul>}
    <div className="legacy-paging"><button className="ui-button" disabled={loading || !offset} onClick={() => setOffset(Math.max(0, offset - 80))}>{t('history.previous')}</button><button className="ui-button" disabled={loading || !page?.more} onClick={() => setOffset(offset + 80)}>{t('history.next')}</button>
        {loading && page && <span role="status"><BusyRing/><span className="sr-only">{t('common.loading')}</span></span>}</div>
  </section>{selected !== null && <ContextPanel label={t('materials.history')} onClose={() => setSelected(null)}><div className="lookup-body">{detail ? <>{detail.record && fields(detail.record as Row)}{detail.error && <p role="alert">{String(detail.error)}</p>}{['contexts', 'explanations'].map(key => Array.isArray(detail[key]) && <section key={key}><h3>{t(`history.${key}`)}</h3>{(detail[key] as Row[]).map((row, index) => <div className="legacy-context" key={index}>{fields(row)}</div>)}</section>)}</> : <LoadingSkeleton kind="text" label={t('common.loading')}/>}</div></ContextPanel>}</div>;
}
