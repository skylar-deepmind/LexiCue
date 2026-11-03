import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFileStore } from '../stores/fileStore';
import { useImportStore } from '../stores/importStore';
import ContextPanel from '../components/ContextPanel';
type Row = Record<string, unknown>;
const kinds = ['files', 'words', 'phrases', 'reviews', 'phrase_reviews', 'review_logs', 'phrase_review_logs', 'frequency_baseline_profiles', 'frequency_baseline_marks', 'frequency_baseline_daily_checks', 'file_phrase_analysis'];
export default function LegacyPage() {
    const { t } = useTranslation();
    const [params] = useSearchParams();
    const [kind, setKind] = useState(kinds.includes(params.get('kind') ?? '') ? params.get('kind')! : 'files');
    const [query, setQuery] = useState('');
    const [offset, setOffset] = useState(0);
    const [page, setPage] = useState<{
        rows: Row[];
        more: boolean;
    }>({ rows: [], more: false });
    const [selected, setSelected] = useState<number | null>(params.has('fileId') ? Number(params.get('fileId')) : null);
    const importOpen = useImportStore(state => state.open);
    useEffect(() => { if (importOpen)
        setSelected(null); }, [importOpen]);
    const [detail, setDetail] = useState<Row | null>(null);
    const [failed, setFailed] = useState(false);
    const [retry, setRetry] = useState(0);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let live = true;
        setLoading(true);
        setFailed(false);
        void invoke<typeof page>('list_legacy_records', { kind, query, offset }).then(value => { if (live)
            setPage(value); })
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
            setDetail(value); })
            .catch(() => { if (live)
            setDetail({ error: t('history.missing') }); });
        return () => { live = false; };
    }, [selected, kind, t]);
    const fields = (value: Row) => <dl className="legacy-fields">{Object.entries(value).filter(([, v]) => v !== null).map(([name, v]) => <div key={name}><dt>{t(`history.fields.${name}`, { defaultValue: name })}</dt><dd>{typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}</dd></div>)}</dl>;
    return <div className="materials-scroll"><section className="workspace-paper legacy-paper">
    <div className="materials-heading"><h1>{t('materials.history')}</h1><button className="ui-button" onClick={() => void useFileStore.getState().exportAll()}>{t('history.export')}</button></div>
    <p className="legacy-hint">{t('history.readOnly')}</p>
    <label className="legacy-kind">{t('history.kind')}<select value={kind} onChange={event => { setKind(event.target.value); setOffset(0); setSelected(null); }}>{kinds.map(value => <option key={value} value={value}>{t(`history.kinds.${value}`)}</option>)}</select></label>
    <input type="search" className="legacy-search" value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} aria-label={t('history.search')} placeholder={t('history.search')}/>
    {loading ? <p role="status">{t('common.loading')}</p> : failed ? <div role="alert"><p>{t('materials.errors.failed')}</p><button className="ui-button" onClick={() => setRetry(retry + 1)}>{t('common.retry')}</button></div> : <ul className="legacy-list">{page.rows.map(row => {
                const id = Number(row.legacy_rowid ?? row.id ?? row.word_id ?? row.phrase_id);
                return <li key={id}><button onClick={() => setSelected(id)}><strong>{String(row.name ?? row.lemma ?? row.text ?? row.model ?? row.language ?? `#${id}`)}</strong><small>{[row.language, row.status, row.type].filter(Boolean).join(' · ')}</small></button></li>;
            })}</ul>}
    <div className="legacy-paging"><button className="ui-button" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 80))}>{t('history.previous')}</button><button className="ui-button" disabled={!page.more} onClick={() => setOffset(offset + 80)}>{t('history.next')}</button></div>
  </section>{selected !== null && <ContextPanel label={t('materials.history')} onClose={() => setSelected(null)}><div className="lookup-body">{detail ? <>{detail.record && fields(detail.record as Row)}{detail.error && <p role="alert">{String(detail.error)}</p>}{['contexts', 'explanations'].map(key => Array.isArray(detail[key]) && <section key={key}><h3>{t(`history.${key}`)}</h3>{(detail[key] as Row[]).map((row, index) => <div className="legacy-context" key={index}>{fields(row)}</div>)}</section>)}</> : <p role="status">{t('common.loading')}</p>}</div></ContextPanel>}</div>;
}
