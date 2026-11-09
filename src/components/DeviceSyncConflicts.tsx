import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';

interface Candidate { revision: string; text: string; deleted: boolean }
interface Conflict { entity: string; field: string; label: string; versions: Candidate[] }

export default function DeviceSyncConflicts({ onPending }: { onPending: (value: boolean) => void }) {
  const { t } = useTranslation();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const refresh = useCallback(async () => {
    const rows = await invoke<Conflict[]>('list_device_conflicts');
    setConflicts(rows);
    onPending(rows.length > 0);
  }, [onPending]);
  useEffect(() => {
    const update = () => { void refresh().catch(() => setError(true)); };
    update();
    window.addEventListener('lexicue-sync-applied', update);
    return () => window.removeEventListener('lexicue-sync-applied', update);
  }, [refresh]);
  const item = conflicts[0];
  if (!item) return error ? <p role="alert">{t('settings.deviceSync.conflictRead')}</p> : null;
  const resolve = async () => {
    if (busy || !item.versions.some(v => v.revision === selected)) return;
    setError(false);
    setBusy(true);
    try {
      await invoke('resolve_device_conflict', {
        entity: item.entity, field: item.field, revisions: item.versions.map(v => v.revision), selected,
      });
      setSelected('');
      window.dispatchEvent(new Event('lexicue-sync-applied'));
    } catch { setError(true); }
    finally { try { await refresh(); } catch { setError(true); } setBusy(false); }
  };
  return <details><summary>{t('settings.deviceSync.review', { count: conflicts.length })}</summary>
    <fieldset key={item.entity + item.field} disabled={busy}>
      <legend>{item.label}</legend>
      {item.versions.map(v => <label className="device-sync-candidate" key={v.revision}>
        <input type="radio" name="device-sync-version" checked={selected === v.revision} onChange={() => setSelected(v.revision)} />
        <span>{item.field.startsWith('restored-') ? t(v.revision === 'include' ? 'settings.deviceSync.includeRestored' : 'settings.deviceSync.keepLocal')
          : item.field.startsWith('deleted-material:') && v.revision !== 'deleted' ? <>{t('settings.deviceSync.recoverCopy')}<br />{v.text}</>
          : v.deleted || v.revision === 'deleted' ? t('settings.deviceSync.deleted') : v.text}</span>
      </label>)}
    </fieldset>
    <button className="ui-button" disabled={busy || !item.versions.some(v => v.revision === selected)} onClick={() => void resolve()}>{t('settings.deviceSync.useVersion')}</button>
    {error && <p role="alert">{t('settings.deviceSync.conflictRead')}</p>}
  </details>;
}
