import { useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import DeviceSyncConflicts from './DeviceSyncConflicts';
import { useFileStore } from '../stores/fileStore';
import { useDeviceSyncStatus, type DeviceStatus } from './useDeviceSyncStatus';
import './device-sync.css';

type Backup = { id: string; created: number };
type IconName = 'smartphone' | 'devices' | 'laptop' | 'check-phone' | 'check-mac' | 'clock' | 'qr' | 'archive' | 'chevron' | 'window';
function Icon({name}: {name: IconName}) {
  return <i className={`sync-icon sync-icon--${name}`} aria-hidden="true" />;
}

export function DeviceSyncSummary() {
  const { t } = useTranslation();
  const {status, readError} = useDeviceSyncStatus();
  if (readError) return <>{t('settings.deviceSync.state.error')}</>;
  if (!status || status.state === 'unsupported') return null;
  return <>{t(`settings.deviceSync.state.${status.state}`)}</>;
}

export default function DeviceSyncSettings() {
  const { t, i18n } = useTranslation();
  const { status, readError, busy, perform } = useDeviceSyncStatus();
  const [error, setError] = useState(false);
  const [hasConflicts, setHasConflicts] = useState(false);
  const [remove, setRemove] = useState(false);
  const [backups, setBackups] = useState<Backup[]>();
  const [selectedBackup, setSelectedBackup] = useState<Backup>();
  const heading = useRef<HTMLHeadingElement>(null);
  const key = (name: string) => t(`settings.deviceSync.${name}`);
  const act = async (action: string) => {
    setError(false);
    try {
      await perform(() => invoke<DeviceStatus>('device_sync', {action, confirmationId:status?.confirmationId}));
      setRemove(false);
      if (['confirm', 'cancel', 'revoke'].includes(action)) heading.current?.focus({preventScroll:true});
    } catch { setError(true); }
  };
  const restore = async (backup: Backup) => {
    setError(false);
    try {
      await perform(async () => {
        await useFileStore.getState().restoreAll(backup.id);
        return invoke<DeviceStatus>('device_sync', {action:'status'});
      });
      setSelectedBackup(undefined);
    } catch { setError(true); }
  };
  if (!isTauri() || status?.state === 'unsupported') return <p>{key('unsupported')}</p>;
  if (!status) return readError ? <p role="alert">{key('issue.unavailable')}</p> : <p role="status">{t('common.loading')}</p>;
  const phase = status.state;
  const mac = status.role === 'mac';
  const attempting = phase === 'offering' || phase === 'scanning' || phase === 'confirming';
  const canPair = !status.paired && !attempting;
  const label = key(`state.${readError ? 'error' : hasConflicts && phase === 'synced' ? 'pending' : phase}`);
  const peerName = status.peerName || (mac ? 'iPhone' : 'Mac');
  const statusLine = <span className="sync-state" role="status">
    {phase === 'synced' && !hasConflicts && !readError && <Icon name={mac ? 'check-mac' : 'check-phone'}/>}
    {phase === 'waiting' && !readError && <Icon name="clock"/>}{label}
  </span>;
  const pairButton = canPair && <button className="sync-primary" disabled={busy} onClick={()=>void act(mac?'offer':'scan')}><Icon name="qr"/>{key(mac?'show':'scan')}</button>;
  return <div className="device-sync" data-role={status.role}>
    <section className="sync-peers">
      <div className="sync-peers-heading">
        <h2 ref={heading} tabIndex={-1}>{key('pairedDevices')}</h2>
        {mac && pairButton}
      </div>
      {status.paired ? mac ? <div className="sync-panel sync-peer-row">
        <span className="sync-peer-icon"><Icon name="smartphone"/></span>
        <strong dir="auto">{peerName}</strong>{statusLine}
      </div> : <div className="sync-panel sync-peer-card">
        <span className="sync-hero-icon"><Icon name="devices"/></span><strong dir="auto">{peerName}</strong>{statusLine}
      </div> : <div className="sync-panel sync-pairing">
        {!mac && <span className="sync-hero-icon"><Icon name="devices"/></span>}
        {statusLine}
        {canPair && <p>{key(mac ? 'macIntro' : 'iphoneIntro')}</p>}
        {!mac && pairButton}
        {phase==='offering' && status.qr && <img className="device-sync-qr" alt={key('qr')} src={status.qr}/>}
        {phase==='confirming' && <>
          <strong dir="auto">{peerName}</strong><p>{key('compare')}</p>
          <strong className="device-sync-code" dir="ltr">{status.code}</strong><p>{key('merge')}</p>
          <button className="sync-primary" disabled={busy || status.confirmed || !status.confirmationId} onClick={()=>void act('confirm')}>{key(status.confirmed?'otherConfirm':'confirm')}</button>
        </>}
        {attempting && <button className="sync-action" disabled={busy} onClick={()=>void act('cancel')}>{t('common.cancel')}</button>}
      </div>}
      {status.issue && <p className="sync-notice">{key(`issue.${status.issue}`)}</p>}
      {status.paired && phase==='waiting' && <p className="sync-notice">{key('reachability')}</p>}
      {status.paired && status.issue!=='reconcile' && ['error','pending','permission'].includes(phase) && <button className="sync-action" disabled={busy} onClick={()=>void act('wake')}>{t('common.retry')}</button>}
    </section>
    {mac && status.paired && <section className="sync-receive">
      <h2>{key('receiveSettings')}</h2>
      <label className="sync-panel sync-switch-row">
        <Icon name="window"/>
        <span>{key('receiveTitle')}<small>{key('receiveHint')}</small></span>
        <input type="checkbox" role="switch" checked={!!status.receiveClosed} disabled={busy} onChange={e=>void act(e.target.checked?'receiveClosedOn':'receiveClosedOff')}/>
      </label>
    </section>}
    <DeviceSyncConflicts onPending={setHasConflicts}/>
    <section className="sync-management">
      <h2>{key('deviceManagement')}</h2>
      <div className="sync-panel sync-rows">
        {status.paired && <details onToggle={e=>{if(!e.currentTarget.open)setRemove(false);}}>
          <summary><Icon name="laptop"/><span>{key('manage')}</span><Icon name="chevron"/></summary>
          <div className="sync-disclosed">
            {remove && <p>{key('removeEffect')}</p>}
            <button className="sync-action" disabled={busy} onClick={()=>remove?void act('revoke'):setRemove(true)}>{key(remove?'confirmRemove':'remove')}</button>
            {remove && <button className="sync-action" disabled={busy} onClick={()=>setRemove(false)}>{t('common.cancel')}</button>}
          </div>
        </details>}
        <details onToggle={e=>{
          if(!e.currentTarget.open){setSelectedBackup(undefined);return;}
          void invoke<Backup[]>('device_sync',{action:'backups'}).then(setBackups).catch(()=>setError(true));
        }}>
          <summary><Icon name="archive"/><span>{key('backups')}</span><Icon name="chevron"/></summary>
          <div className="sync-disclosed">
            {backups?.length===0 && <p>{key('noBackup')}</p>}
            {!selectedBackup && backups?.map(b=><button className="sync-action" key={b.id} onClick={()=>setSelectedBackup(b)}>{new Date(b.created*1000).toLocaleString(i18n.language)}</button>)}
            {selectedBackup && <><p>{new Date(selectedBackup.created*1000).toLocaleString(i18n.language)} · {key('restoreEffect')}</p>
              <button className="sync-action" disabled={busy} onClick={()=>void restore(selectedBackup)}>{key('restore')}</button>
              <button className="sync-action" disabled={busy} onClick={()=>setSelectedBackup(undefined)}>{t('common.cancel')}</button></>}
          </div>
        </details>
      </div>
    </section>
    {(error || readError) && <p role="alert">{key('issue.unavailable')}</p>}
  </div>;
}
