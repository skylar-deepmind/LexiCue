import { useEffect, useId, useState, type FormEvent } from 'react';
import { ask, save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown, Cloud, Copy, Download, Eye, EyeOff, Laptop, LogIn,
  RefreshCw, ShieldCheck, Trash2, UserPlus,
} from 'lucide-react';
import { syncCoordinator } from '../lib/syncCoordinator';
import { errorCode, type SyncErrorCode } from '../lib/syncErrors';
import SettingsCollapsibleSection from './SettingsCollapsibleSection';

interface SyncStatus {
  configured: boolean;
  email: string | null;
  device_id: string | null;
  last_synced_at: number | null;
  phase: string;
  pending_uploads: number;
  pending_downloads: number;
  conflicts: number;
  last_error: string | null;
  last_uploaded: number;
  last_downloaded: number;
  auto_sync_enabled: boolean;
  next_retry_at: number | null;
  progress: {
    phase: string;
    completed_items: number;
    total_items: number;
    completed_bytes: number;
    total_bytes: number;
    bytes_per_second: number;
    eta_seconds: number | null;
    retry_at: number | null;
  } | null;
}

interface SyncDevice { id: string; name: string; last_seen_at: string }
interface AuthResult { recovery_code: string | null }
type Mode = 'register' | 'login' | 'recover';

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 1024) return `${Math.max(0, Math.round(value))} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let amount = value;
  let unit = 'B';
  for (const next of units) {
    amount /= 1024;
    unit = next;
    if (amount < 1024) break;
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${unit}`;
}

export default function CloudSyncSettings() {
  const { t } = useTranslation();
  const emailId = useId();
  const passwordId = useId();
  const recoveryId = useId();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SyncErrorCode | ''>('');
  const [notice, setNotice] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [devices, setDevices] = useState<SyncDevice[]>([]);

  const refresh = async () => {
    try { setStatus(await invoke<SyncStatus>('sync_status')); }
    catch (value) { setError(errorCode(value)); }
  };

  const refreshDevices = async () => {
    try { setDevices(await invoke<SyncDevice[]>('sync_devices')); }
    catch (value) { setError(errorCode(value)); }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!sectionOpen || !status?.configured) return;
    const timer = window.setInterval(() => { void refresh(); }, 1000);
    return () => window.clearInterval(timer);
  }, [sectionOpen, status?.configured]);
  useEffect(() => {
    if (advancedOpen && status?.configured) void refreshDevices();
  }, [advancedOpen, status?.configured]);

  const authenticate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      let result: AuthResult;
      if (mode === 'register') {
        result = await invoke<AuthResult>('sync_register', { email: email.trim(), password });
      } else if (mode === 'login') {
        result = await invoke<AuthResult>('sync_login', { email: email.trim(), password });
      } else {
        result = await invoke<AuthResult>('sync_recover', {
          email: email.trim(), password, recoveryCode: recoveryInput.trim(),
        });
      }
      setRecoveryCode(result.recovery_code ?? '');
      setPassword(''); setRecoveryInput('');
      await refresh();
      setNotice(mode === 'register' ? 'accountCreated' : 'connected');
    } catch (value) {
      setError(errorCode(value));
    } finally { setBusy(false); }
  };

  const runSync = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await syncCoordinator.runNow(true);
      await refresh();
      setNotice('synced');
    } catch (value) { setError(errorCode(value)); }
    finally { setBusy(false); }
  };

  const toggleAutoSync = async () => {
    if (!status) return;
    setBusy(true); setError('');
    try {
      await invoke('sync_set_auto_sync', { enabled: !status.auto_sync_enabled });
      await refresh();
      if (!status.auto_sync_enabled) void syncCoordinator.runNow();
    } catch (value) { setError(errorCode(value)); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true); setError('');
    try {
      try { await invoke('sync_logout'); } catch { /* local sign-out must work offline */ }
      await invoke('sync_disconnect');
      setRecoveryCode(''); setDevices([]); setAdvancedOpen(false);
      await refresh();
    } catch (value) { setError(errorCode(value)); }
    finally { setBusy(false); }
  };

  const revokeDevice = async (deviceId: string) => {
    setBusy(true); setError('');
    try {
      await invoke('sync_revoke_device', { deviceId });
      setDevices((items) => items.filter((item) => item.id !== deviceId));
    } catch (value) { setError(errorCode(value)); }
    finally { setBusy(false); }
  };

  const deleteAccount = async () => {
    const confirmed = await ask(t('settings.cloudSync.deleteConfirm'), {
      title: t('settings.cloudSync.deleteAccount'),
      kind: 'warning',
    });
    if (!confirmed) return;
    setBusy(true); setError('');
    try {
      await invoke('sync_delete_account');
      setRecoveryCode(''); setDevices([]); setAdvancedOpen(false);
      await refresh();
      setNotice('accountDeleted');
    } catch (value) { setError(errorCode(value)); }
    finally { setBusy(false); }
  };

  const saveRecoveryKey = async () => {
    const path = await save({ defaultPath: 'lexicue-recovery-key.txt', filters: [{ name: 'Text', extensions: ['txt'] }] });
    if (!path) return;
    await writeTextFile(path, `${t('settings.cloudSync.recoveryFileTitle')}\n${recoveryCode}\n`);
    setNotice('recoverySaved');
  };

  const stateKey = status?.phase === 'syncing' || status?.phase === 'preparing' || status?.phase === 'applying' || status?.phase === 'uploading' || status?.phase === 'downloading'
    ? 'syncing'
    : status?.phase === 'offline' || status?.phase === 'retrying'
      ? 'offline'
      : status?.phase === 'paused' || status?.last_error?.includes('auth_') || status?.last_error?.includes('session_')
        ? 'authRequired'
        : status?.last_error ? 'error' : 'synced';
  const emailError = error === 'invalid_email' || error === 'email_exists';
  const passwordError = error === 'invalid_credentials' || error === 'invalid_password';
  const recoveryError = error === 'invalid_recovery_code';
  const fieldError = emailError || passwordError || recoveryError;

  return <SettingsCollapsibleSection
    id="cloud-sync"
    icon={<span className="rounded-xl bg-blue-50 p-2 text-blue-600"><Cloud size={20} aria-hidden="true" /></span>}
    title={t('settings.cloudSync.title')}
    description={t('settings.cloudSync.description')}
    summary={status?.configured ? t(`settings.cloudSync.state.${stateKey}`) : t('settings.cloudSync.notConnected')}
    open={sectionOpen} onOpenChange={setSectionOpen}
    expandLabel={t('settings.expand')} collapseLabel={t('settings.collapse')}
  >
    {status?.configured ? <div className="space-y-4">
      <div className={`sync-status sync-status--${stateKey}`} role="status" aria-live="polite">
        <div className="flex min-w-0 items-start gap-3">
          <ShieldCheck className="mt-0.5 shrink-0" size={20} aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold">{t(`settings.cloudSync.state.${stateKey}`)}</p>
            <p className="mt-1 break-words text-sm">{status.email}</p>
            <p className="mt-1 text-sm">
              {status.last_synced_at
                ? t('settings.cloudSync.lastSynced', { time: new Date(status.last_synced_at).toLocaleString() })
                : t('settings.cloudSync.preparing')}
            </p>
            {status.pending_uploads > 0 && <p className="mt-1 text-sm">{t('settings.cloudSync.pending', { count: status.pending_uploads })}</p>}
            {status.conflicts > 0 && <p className="mt-1 text-sm">{t('settings.cloudSync.conflicts', { count: status.conflicts })}</p>}
            {status.progress && status.progress.phase !== 'idle' && (
              <div className="sync-progress mt-3" aria-label={t('settings.cloudSync.progressLabel')}>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{t(`settings.cloudSync.progress.${status.progress.phase}`, { defaultValue: status.progress.phase })}</span>
                  <span>{status.progress.completed_items}/{status.progress.total_items || '—'}</span>
                </div>
                <div className="sync-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={status.progress.total_bytes || 1} aria-valuenow={Math.min(status.progress.completed_bytes, status.progress.total_bytes || 1)}>
                  <div className="sync-progress__bar" style={{ width: `${status.progress.total_bytes > 0 ? Math.min(100, (status.progress.completed_bytes / status.progress.total_bytes) * 100) : 5}%` }} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span>{formatBytes(status.progress.completed_bytes)} / {formatBytes(status.progress.total_bytes)}</span>
                  {status.progress.bytes_per_second > 0 && <span>{formatBytes(status.progress.bytes_per_second)}/s</span>}
                  {status.progress.eta_seconds !== null && <span>{t('settings.cloudSync.eta', { seconds: status.progress.eta_seconds })}</span>}
                </div>
              </div>
            )}
            {status.last_error && (stateKey === 'error' || stateKey === 'authRequired') && (
              <p className="sync-error-message mt-3" role="alert">
                {t(`settings.cloudSync.errors.${errorCode(status.last_error)}`)}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void runSync()} disabled={busy} className="sync-primary-button">
          <RefreshCw size={17} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
          {t('settings.cloudSync.syncNow')}
        </button>
        <button type="button" onClick={() => void toggleAutoSync()} disabled={busy} aria-pressed={status.auto_sync_enabled} className="sync-secondary-button">
          {status.auto_sync_enabled ? t('settings.cloudSync.pauseAuto') : t('settings.cloudSync.enableAuto')}
        </button>
      </div>

      <div className="sync-advanced">
        <button type="button" className="sync-advanced__trigger" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen}>
          <span>{t('settings.cloudSync.advanced')}</span>
          <ChevronDown size={18} className={advancedOpen ? 'rotate-180' : ''} aria-hidden="true" />
        </button>
        {advancedOpen && <div className="sync-advanced__content space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="flex items-center gap-2 font-medium text-gray-900"><Laptop size={17} aria-hidden="true" />{t('settings.cloudSync.devices')}</h4>
              <button type="button" onClick={() => void refreshDevices()} disabled={busy} className="sync-text-button">{t('settings.cloudSync.refresh')}</button>
            </div>
            {devices.map((device) => <div key={device.id} className="sync-device-row">
              <span className="min-w-0 break-words"><span className="font-medium text-gray-900">{device.name}</span>{device.id === status.device_id && <span className="ml-2 text-xs text-blue-700">{t('settings.cloudSync.currentDevice')}</span>}<span className="mt-0.5 block text-xs text-gray-500">{new Date(device.last_seen_at).toLocaleString()}</span></span>
              {device.id !== status.device_id && <button type="button" disabled={busy} onClick={() => void revokeDevice(device.id)} className="sync-danger-text">{t('settings.cloudSync.revoke')}</button>}
            </div>)}
          </div>
          <div className="border-t border-gray-100 pt-4">
            <button type="button" onClick={() => void disconnect()} disabled={busy} className="sync-secondary-button">{t('settings.cloudSync.disconnect')}</button>
          </div>
          <div className="sync-danger-zone">
            <p className="font-medium">{t('settings.cloudSync.dangerTitle')}</p>
            <p className="mt-1 text-sm">{t('settings.cloudSync.deleteHint')}</p>
            <button type="button" onClick={() => void deleteAccount()} disabled={busy} className="sync-danger-button"><Trash2 size={16} aria-hidden="true" />{t('settings.cloudSync.deleteAccount')}</button>
          </div>
        </div>}
      </div>
    </div> : <form className="space-y-4" onSubmit={(event) => void authenticate(event)} noValidate>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('settings.cloudSync.accountMode')}>
        <button type="button" aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError(''); }} className="sync-mode-button"><UserPlus size={17} aria-hidden="true" />{t('settings.cloudSync.createAccount')}</button>
        <button type="button" aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(''); }} className="sync-mode-button"><LogIn size={17} aria-hidden="true" />{t('settings.cloudSync.login')}</button>
      </div>
      <div>
        <label htmlFor={emailId} className="sync-label">{t('settings.cloudSync.email')}</label>
        <input id={emailId} value={email} onChange={(event) => setEmail(event.target.value)} type="email" inputMode="email" autoComplete="email" required aria-invalid={emailError} aria-describedby={emailError ? `${emailId}-error` : undefined} className="sync-input" />
        {emailError && <p id={`${emailId}-error`} role="alert" className="sync-field-error">{t(`settings.cloudSync.errors.${error}`)}</p>}
      </div>
      {mode === 'recover' && <div>
        <label htmlFor={recoveryId} className="sync-label">{t('settings.cloudSync.recoveryKey')}</label>
        <input id={recoveryId} value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value)} autoComplete="off" required aria-invalid={recoveryError} aria-describedby={recoveryError ? `${recoveryId}-error` : undefined} className="sync-input font-mono" />
        {recoveryError && <p id={`${recoveryId}-error`} role="alert" className="sync-field-error">{t(`settings.cloudSync.errors.${error}`)}</p>}
      </div>}
      <div>
        <label htmlFor={passwordId} className="sync-label">{mode === 'recover' ? t('settings.cloudSync.newPassword') : t('settings.cloudSync.password')}</label>
        <div className="relative">
          <input id={passwordId} value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={10} required aria-invalid={passwordError} aria-describedby={passwordError ? `${passwordId}-error` : undefined} className="sync-input pr-12" />
          <button type="button" className="sync-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? t('settings.cloudSync.hidePassword') : t('settings.cloudSync.showPassword')}>
            {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
          </button>
        </div>
        {passwordError && <p id={`${passwordId}-error`} role="alert" className="sync-field-error">{t(`settings.cloudSync.errors.${error}`)}</p>}
        <p className="mt-1 text-xs text-gray-500">{t('settings.cloudSync.passwordHint')}</p>
      </div>
      <button type="submit" disabled={busy || !email.trim() || password.length < 10 || (mode === 'recover' && !recoveryInput.trim())} className="sync-primary-button w-full justify-center">
        {busy && <RefreshCw size={17} className="animate-spin" aria-hidden="true" />}
        {busy ? t('settings.cloudSync.preparing') : mode === 'register' ? t('settings.cloudSync.createAndSync') : mode === 'recover' ? t('settings.cloudSync.recoverAction') : t('settings.cloudSync.loginAndSync')}
      </button>
      {mode === 'login' && <button type="button" className="sync-text-button mx-auto block" onClick={() => { setMode('recover'); setError(''); }}>{t('settings.cloudSync.forgotPassword')}</button>}
      {mode === 'recover' && <button type="button" className="sync-text-button mx-auto block" onClick={() => { setMode('login'); setError(''); }}>{t('settings.cloudSync.backToLogin')}</button>}
    </form>}

    {recoveryCode && <div className="sync-recovery" role="status">
      <p className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} aria-hidden="true" />{t('settings.cloudSync.saveRecoveryTitle')}</p>
      <p className="mt-1 text-sm">{t('settings.cloudSync.saveRecoveryDescription')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-3 text-sm text-gray-900">{recoveryCode}</code>
        <button type="button" onClick={() => void navigator.clipboard.writeText(recoveryCode)} className="sync-icon-button" aria-label={t('settings.cloudSync.copyRecovery')}><Copy size={18} aria-hidden="true" /></button>
        <button type="button" onClick={() => void saveRecoveryKey()} className="sync-icon-button" aria-label={t('settings.cloudSync.downloadRecovery')}><Download size={18} aria-hidden="true" /></button>
      </div>
    </div>}
    {error && !fieldError && <p role="alert" className="sync-error-message">{t(`settings.cloudSync.errors.${error}`)}</p>}
    {notice && <p role="status" className="sync-success-message">{t(`settings.cloudSync.notices.${notice}`)}</p>}
  </SettingsCollapsibleSection>;
}
