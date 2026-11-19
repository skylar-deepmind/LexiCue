import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { BusyRing } from './LoadingFeedback';
import { Check, Download, FolderOpen, X } from 'lucide-react';
import useTrashDrag, { isTrashDragging } from './useTrashDrag';
import './dictionary-packs.css';

type PackId = 'daily' | 'extended' | 'specialist';
interface Pack { id: PackId; installed: boolean; error: string | null; bundled_by_default: boolean; download_url: string | null; archive: { bytes: number }; database: { bytes: number } }
interface Progress { id: PackId; phase: 'downloading' | 'verifying' | 'installing'; completed: number; total: number }
interface Status { packs: Pack[]; operation: Progress | null; busy: boolean }
function errorKey(error: unknown): string {
  const text = String(error);
  if (/cancelled/.test(text)) return 'cancelled';
  if (/checksum|manifest|archive|version/.test(text)) return 'invalid';
  if (/unpublished/.test(text)) return 'unpublished';
  if (/busy/.test(text)) return 'busy';
  return 'failed';
}
export default function DictionaryPacks() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<Status | null>(null);
  const [operation, setOperation] = useState<Progress | null>(null);
  const [pending, setPending] = useState<PackId | null>(null);
  const [error, setError] = useState<{ id?: PackId; key: string } | null>(null);
  const live = useRef(true);
  const rows = useRef(new Map<PackId, HTMLElement>());
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++request.current;
    try {
      const next = await invoke<Status>('dictionary_pack_status');
      if (live.current && version === request.current) { setStatus(next); setOperation(next.operation); }
    } catch { if (live.current && version === request.current) setError({ key: 'statusFailed' }); }
  }, []);
  useEffect(() => {
    live.current = true;
    const subscriptions = [listen<Progress>('dictionary-pack-progress', event => { if (live.current) { request.current++; setOperation(event.payload); } }),
      listen('dictionary-packs-changed', () => { if (live.current) { window.dispatchEvent(new Event('lexicue-dictionary-changed')); void refresh(); } })];
    subscriptions.forEach(promise => { void promise.catch(() => {}); });
    void refresh();
    const foreground = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('lexicue-dictionary-changed', foreground);
    return () => { live.current = false; request.current++; document.removeEventListener('visibilitychange', foreground); window.removeEventListener('lexicue-dictionary-changed', foreground); subscriptions.forEach(promise => { void promise.then(unlisten => unlisten()).catch(() => {}); }); };
  }, [refresh]);
  useEffect(() => {
    if (!status?.busy && !operation && !pending) return;
    const timer = setInterval(() => { void refresh(); }, 2000);
    return () => clearInterval(timer);
  }, [status?.busy, operation, pending, refresh]);
  const action = async (pack: Pack, kind: 'file' | 'download' | 'remove') => {
    if (pending || status?.busy || operation) return false;
    const previousFocus = document.activeElement;
    setPending(pack.id); setError(null);
    try {
      if (kind === 'file') {
        // iOS copy mode leaves a second ZIP in tmp/*-Inbox. The native installer
        // already reads scoped URLs into bounded staging and releases access.
        const path = await open({ multiple: false, directory: false, fileAccessMode: 'scoped', filters: [{ name: 'LexiCue dictionary', extensions: ['zip'] }] });
        if (!path) return false;
        await invoke('install_dictionary_pack', { id: pack.id, path });
      } else await invoke(kind === 'download' ? 'download_dictionary_pack' : 'remove_dictionary_pack', { id: pack.id });
      window.dispatchEvent(new Event('lexicue-dictionary-changed'));
      return true;
    } catch (cause) { if (live.current) setError({ id: pack.id, key: errorKey(cause) }); return false; }
    finally { if (live.current) {
      setPending(null); await refresh();
      requestAnimationFrame(() => {
        if (!live.current || isTrashDragging()) return;
        const active = document.activeElement;
        if (active === document.body || active === document.documentElement || active === previousFocus) rows.current.get(pack.id)?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
      });
    } }
  };
  const busy = !!pending || !!operation || status?.busy;
  const size = (bytes: number) => `${(bytes / 1_000_000).toLocaleString(i18n.language, { maximumFractionDigits: 2 })} MB`;
  if (!status) return <section className="dictionary-packs"><p role="status">{!error && <BusyRing />}{t(error ? 'dictionaryPacks.statusFailed' : 'common.loading')}</p>{error && <button className="ui-button" onClick={() => { setError(null); void refresh(); }}>{t('common.retry')}</button>}</section>;
  return <div className="dictionary-packs">
    {status.packs.map(pack=><section className="dictionary-pack" ref={node=>{if(node)rows.current.set(pack.id,node);else rows.current.delete(pack.id);}} key={pack.id} data-pack={pack.id} data-installed={pack.installed}>
      <DictionaryBook pack={pack} busy={!!busy} operation={operation?.id===pack.id?operation:null} pending={pending===pack.id} size={size(pack.installed?pack.database.bytes:pack.archive.bytes)}
        onInstall={()=>{if(pack.bundled_by_default){void invoke('retry_dictionary_init').then(refresh).catch(()=>setError({id:pack.id,key:'failed'}));}else void action(pack,pack.download_url?'download':'file');}}
        onFile={()=>void action(pack,'file')} onCancel={()=>void invoke('cancel_dictionary_pack').catch(()=>setError({id:pack.id,key:'failed'}))} onRemove={()=>action(pack,'remove')}/>
      {pack.error&&<p role="alert">{t(pack.bundled_by_default?'dictionaryPacks.baseUnavailable':'dictionaryPacks.packUnavailable')}</p>}
      {error?.id===pack.id&&<p role="alert">{t(`dictionaryPacks.${error.key}`)}</p>}
    </section>)}
    {error&&!error.id&&<p role="alert">{t(`dictionaryPacks.${error.key}`)}</p>}
  </div>;
}

function DictionaryBook({pack,busy,operation,pending,size,onInstall,onFile,onCancel,onRemove}:{
  pack:Pack;busy:boolean;operation:Progress|null;pending:boolean;size:string;
  onInstall:()=>void;onFile:()=>void;onCancel:()=>void;onRemove:()=>Promise<boolean>;
}) {
  const {t}=useTranslation(),book=useRef<HTMLButtonElement>(null);
  const active=!!operation||pending,removable=pack.installed&&!pack.bundled_by_default;
  useTrashDrag(book,{id:`dictionary:${pack.id}`,label:t(`dictionaryPacks.names.${pack.id}`),disabled:!removable||busy,remove:onRemove});
  const progress=operation?.phase==='downloading'&&operation.total>0?Math.max(0,Math.min(1,operation.completed/operation.total)):null;
  return <div className="dictionary-book-wrap">
    <button ref={book} type="button" className="approved-dictionary-book" aria-label={t(`dictionaryPacks.names.${pack.id}`)} aria-busy={active||undefined}
      disabled={busy&&!active||pack.bundled_by_default&&pack.installed} onClick={()=>{if(!pack.installed&&!active)onInstall();}}>
      <span className="approved-book-rule"/><h2>{t(`dictionaryPacks.names.${pack.id}`)}</h2><img className="approved-book-device" src={`/design/book-${pack.id}.svg`} alt=""/>
      <span className="approved-book-size">{size}</span>
      <span className="approved-book-state" data-file-option={!pack.installed&&!!pack.download_url&&!active||undefined} aria-hidden="true">{pack.installed?<Check size={17}/>:pack.download_url?<Download size={17}/>:<FolderOpen size={17}/>}</span>
      {active&&<span className="dictionary-cover-progress" data-indeterminate={progress===null||undefined} role="progressbar" aria-label={t(`dictionaryPacks.phases.${operation?.phase??'downloading'}`)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress===null?undefined:Math.round(progress*100)}><i style={progress===null?undefined:{transform:`scaleX(${progress})`}}/></span>}
      {active&&<span className="approved-book-progress-value" role="status">{progress===null?t(operation?`dictionaryPacks.phases.${operation.phase}`:'common.loading'):`${Math.round(progress*100)}%`}</span>}
    </button>
    {active?<button type="button" className="dictionary-book-control" aria-label={t('common.cancel')} onClick={onCancel}><X size={18}/></button>:!pack.installed&&!pack.bundled_by_default&&!!pack.download_url&&<button type="button" className="dictionary-book-control" aria-label={t('dictionaryPacks.installFile')} onClick={onFile} disabled={busy}><FolderOpen size={17}/></button>}
  </div>;
}
