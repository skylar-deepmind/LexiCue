import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import DeviceSyncConflicts from './DeviceSyncConflicts';
import { useFileStore } from '../stores/fileStore';

type Phase = 'unpaired' | 'offering' | 'scanning' | 'confirming' | 'waiting' | 'syncing'
  | 'synced' | 'permission' | 'update' | 'pending' | 'error' | 'unsupported';
interface SyncStatus {
  state: Phase;
  role: 'mac' | 'iphone';
  paired: boolean;
  peerName?: string;
  code?: string;
  confirmationId?: string;
  confirmed?: boolean;
  qr?: string;
  issue?: string;
  receiveClosed?: boolean;
}
type Backup = { id: string; created: number };

export default function DeviceSyncSettings() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<SyncStatus>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasConflicts, setHasConflicts] = useState(false);
  const [remove, setRemove] = useState(false);
  const [backups, setBackups] = useState<Backup[]>();
  const [selectedBackup, setSelectedBackup] = useState<Backup>();
  const active = useRef(false);
  const generation = useRef(0);
  const summary = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let timer: number;
    const poll = async () => {
      const version = generation.current;
      if (document.visibilityState === 'visible' && !active.current) {
        try {
          const next = await invoke<SyncStatus>('device_sync', {action: 'status'});
          if (alive && version === generation.current) { setStatus(next); setError(false); }
          if (next.state === 'unsupported') return;
        } catch { if (alive && version === generation.current) setError(true); }
      }
      if (alive) timer = window.setTimeout(poll, 1000);
    };
    void poll();
    return () => { alive = false; window.clearTimeout(timer); };
  }, []);

  const perform = async (job: () => Promise<void>) => {
    if (active.current) return;
    active.current = true;
    generation.current++;
    setBusy(true);
    setError(false);
    try { await job(); } catch { setError(true); }
    finally { active.current = false; setBusy(false); }
  };
  const act = (action: string) => perform(async () => {
    const next = await invoke<SyncStatus>('device_sync', { action, confirmationId: status?.confirmationId });
    setStatus(next);
    setRemove(false);
    if (['confirm', 'cancel', 'revoke'].includes(action)) summary.current?.focus({preventScroll: true});
  });
  if ((!status && !error) || status?.state === 'unsupported') return null;
  const key = (name: string) => t(`settings.deviceSync.${name}`);
  const phase = status?.state;
  const attempting = phase === 'offering' || phase === 'scanning' || phase === 'confirming';
  const mac = status?.role === 'mac';
  const pair = () => act(mac ? 'offer' : 'scan');
  return <details className="device-sync">
    <summary ref={summary}>{key('title')}</summary>
    {status && <>
      {phase !== 'unpaired' && <p role="status">{status.peerName && <><strong dir="auto">{status.peerName}</strong> · </>}{key(`state.${hasConflicts && phase === 'synced' ? 'pending' : phase}`)}</p>}
      {!status.paired && !attempting && <p>{key(mac ? 'macIntro' : 'iphoneIntro')}</p>}
      {status.issue && <p>{key(`issue.${status.issue}`)}</p>}
      {phase === 'offering' && status.qr && <img className="device-sync-qr" alt={key('qr')} src={status.qr} />}
      {phase === 'confirming' && <>
        <p>{key('compare')}</p><strong className="device-sync-code" dir="ltr">{status.code}</strong>
        <p>{key('merge')}</p>
      </>}
      <div className="settings-options">
        {!status.paired && !attempting && <button className="ui-button" disabled={busy} onClick={() => void pair()}>{key(mac ? 'show' : 'scan')}</button>}
        {phase === 'confirming' && <button className="ui-button" disabled={busy || status.confirmed || !status.confirmationId} onClick={() => void act('confirm')}>{key(status.confirmed ? 'otherConfirm' : 'confirm')}</button>}
        {attempting && <button className="ui-button settings-quiet-action" disabled={busy} onClick={() => void act('cancel')}>{t('common.cancel')}</button>}
        {status.paired && status.issue !== 'reconcile' && (phase === 'error' || phase === 'pending' || phase === 'permission') && <button className="ui-button" disabled={busy} onClick={() => void act('wake')}>{t('common.retry')}</button>}
      </div>
      {status.paired && <>
        {phase === 'waiting' && <p>{key('reachability')}</p>}
        {mac && <label className="device-sync-option"><input type="checkbox" checked={!!status.receiveClosed} disabled={busy} onChange={e => void act(e.target.checked ? 'receiveClosedOn' : 'receiveClosedOff')} />{key('receiveClosed')}</label>}
        <details onToggle={e => { if (!e.currentTarget.open) setRemove(false); }}><summary>{key('manage')}</summary>
          {remove && <p>{key('removeEffect')}</p>}
          <button className="ui-button settings-quiet-action" disabled={busy} onClick={() => remove ? void act('revoke') : setRemove(true)}>{key(remove ? 'confirmRemove' : 'remove')}</button>
          {remove && <button className="ui-button" disabled={busy} onClick={() => setRemove(false)}>{t('common.cancel')}</button>}
        </details>
      </>}
      <DeviceSyncConflicts onPending={setHasConflicts} />
      <details onToggle={e => {
        if (!e.currentTarget.open) { setSelectedBackup(undefined); return; }
        void invoke<Backup[]>('device_sync', {action: 'backups'}).then(setBackups).catch(() => setError(true));
      }}><summary>{key('backups')}</summary>
        {backups?.length === 0 && <p>{key('noBackup')}</p>}
        {backups && !selectedBackup && backups.map(b => <button key={b.id} className="ui-button settings-quiet-action" onClick={() => setSelectedBackup(b)}>{new Date(b.created * 1000).toLocaleString(i18n.language)}</button>)}
        {selectedBackup && <><p>{new Date(selectedBackup.created * 1000).toLocaleString(i18n.language)} · {key('restoreEffect')}</p>
          <button className="ui-button" disabled={busy} onClick={() => void perform(async () => {
            await useFileStore.getState().restoreAll(selectedBackup.id); setSelectedBackup(undefined);
            setStatus(await invoke<SyncStatus>('device_sync', {action: 'status'}));
          })}>{key('restore')}</button>
          <button className="ui-button settings-quiet-action" disabled={busy} onClick={() => setSelectedBackup(undefined)}>{t('common.cancel')}</button></>}
      </details>
    </>}
    {error && <p role="alert">{key('issue.unavailable')}</p>}
  </details>;
}
