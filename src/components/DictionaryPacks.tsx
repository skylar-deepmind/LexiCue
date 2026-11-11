import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { BusyRing } from './LoadingFeedback';
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
    if (pending || status?.busy || operation) return;
    const previousFocus = document.activeElement;
    setPending(pack.id); setError(null);
    try {
      if (kind === 'file') {
        // iOS copy mode leaves a second ZIP in tmp/*-Inbox. The native installer
        // already reads scoped URLs into bounded staging and releases access.
        const path = await open({ multiple: false, directory: false, fileAccessMode: 'scoped', filters: [{ name: 'LexiCue dictionary', extensions: ['zip'] }] });
        if (!path) return;
        await invoke('install_dictionary_pack', { id: pack.id, path });
      } else await invoke(kind === 'download' ? 'download_dictionary_pack' : 'remove_dictionary_pack', { id: pack.id });
      window.dispatchEvent(new Event('lexicue-dictionary-changed'));
    } catch (cause) { if (live.current) setError({ id: pack.id, key: errorKey(cause) }); }
    finally { if (live.current) {
      setPending(null); await refresh();
      requestAnimationFrame(() => {
        if (!live.current) return;
        const active = document.activeElement;
        if (active === document.body || active === document.documentElement || active === previousFocus) rows.current.get(pack.id)?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
      });
    } }
  };
  const busy = !!pending || !!operation || status?.busy;
  const size = (bytes: number) => `${(bytes / 1_000_000).toLocaleString(i18n.language, { maximumFractionDigits: 2 })} MB`;
  if (!status) return <section className="dictionary-packs"><p role="status">{!error && <BusyRing />}{t(error ? 'dictionaryPacks.statusFailed' : 'common.loading')}</p>{error && <button className="ui-button" onClick={() => { setError(null); void refresh(); }}>{t('common.retry')}</button>}</section>;
  return <div className="dictionary-packs">
    {status.packs.map(pack => <section className="dictionary-pack" ref={node => { if (node) rows.current.set(pack.id, node); else rows.current.delete(pack.id); }} key={pack.id} aria-labelledby={`pack-${pack.id}`} data-pack={pack.id} data-installed={pack.installed}>
      <div className="dictionary-pack-heading"><h2 id={`pack-${pack.id}`}>{t(`dictionaryPacks.names.${pack.id}`)}</h2><span>{t(pack.bundled_by_default ? 'dictionaryPacks.bundled' : pack.installed ? 'dictionaryPacks.installed' : 'dictionaryPacks.optional')}</span></div>
      <p>{t(`dictionaryPacks.descriptions.${pack.id}`)}</p>
      <p className="dictionary-pack-size">{t('dictionaryPacks.dataSize', { size: size(pack.database.bytes) })}{!pack.bundled_by_default && ` · ${t('dictionaryPacks.downloadSize', { size: size(pack.archive.bytes) })}`}</p>
      {pack.error && <p role="alert">{t(pack.bundled_by_default ? 'dictionaryPacks.baseUnavailable' : 'dictionaryPacks.packUnavailable')}</p>}
      {operation?.id === pack.id && <div className="dictionary-pack-progress"><span role="status">{t(`dictionaryPacks.phases.${operation.phase}`)}</span><progress aria-label={t(`dictionaryPacks.phases.${operation.phase}`)} max={operation.total || 1} value={operation.phase === 'downloading' ? operation.completed : undefined}/>{operation.phase === 'downloading' && <span>{size(operation.completed)} / {size(operation.total)}</span>}<button className="ui-button" onClick={() => { void invoke('cancel_dictionary_pack').catch(() => setError({ id: pack.id, key: 'failed' })); }}>{t('common.cancel')}</button></div>}
      {pending === pack.id && !operation && <p role="status"><BusyRing/>{t('common.loading')}</p>}
      {error?.id === pack.id && <p role="alert">{t(`dictionaryPacks.${error.key}`)}</p>}
      {!pack.bundled_by_default && <div className="dictionary-pack-actions">
        {pack.installed || pack.error ? <button className="ui-button" disabled={busy} onClick={() => { void action(pack, 'remove'); }}>{t('dictionaryPacks.remove')}</button> : <>
          {pack.download_url ? <button className="ui-button" disabled={busy} onClick={() => { void action(pack, 'download'); }}>{t('dictionaryPacks.download')}</button> : <span>{t('dictionaryPacks.unpublished')}</span>}
          <button className="ui-button" disabled={busy} onClick={() => { void action(pack, 'file'); }}>{t('dictionaryPacks.installFile')}</button>
        </>}
      </div>}
      {pack.bundled_by_default && !pack.installed && <button className="ui-button" disabled={busy} onClick={() => { void invoke('retry_dictionary_init').then(refresh).catch(() => setError({ id: pack.id, key: 'failed' })); }}>{t('common.retry')}</button>}
    </section>)}
    {error && !error.id && <p role="alert">{t(`dictionaryPacks.${error.key}`)}</p>}
  </div>;
}
