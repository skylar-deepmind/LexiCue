import { useEffect, useState } from 'react';
import { Cloud, Copy, Download, HardDriveDownload, LogIn, RefreshCw, UserPlus } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { ask } from '@tauri-apps/plugin-dialog';
import SettingsCollapsibleSection from './SettingsCollapsibleSection';

interface SyncStatus {
  configured: boolean; email: string | null; endpoint: string | null; last_synced_at: number | null;
  device_id: string | null;
  phase: string; pending_uploads: number; pending_downloads: number; conflicts: number; last_error: string | null;
  v3_initialized: boolean; last_uploaded: number; last_downloaded: number;
}
interface SyncDevice { id: string; name: string; last_seen_at: string }
interface SyncCheckpoint { id: string; device_id: string; device_name: string; cursor: number; encrypted_len: number; created_at: string; protocol_version: number }
interface SyncCheckpointPreview {
  checkpoint: SyncCheckpoint; files: number; folders: number; words: number; phrases: number; review_logs: number;
  local_files: number; local_has_data: boolean;
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export default function CloudSyncSettings() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'register' | 'login' | 'recovery'>('register');
  const [endpoint, setEndpoint] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [devices, setDevices] = useState<SyncDevice[]>([]);
  const [checkpoints, setCheckpoints] = useState<SyncCheckpoint[]>([]);
  const [preview, setPreview] = useState<SyncCheckpointPreview | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  const refresh = async () => {
    try { setStatus(await invoke<SyncStatus>('sync_status')); } catch (value) { setError(String(value)); }
  };
  const refreshRemote = async () => {
    if (!status?.configured) return;
    const [nextDevices, nextCheckpoints] = await Promise.all([
      invoke<SyncDevice[]>('sync_devices'),
      invoke<SyncCheckpoint[]>('sync_checkpoints'),
    ]);
    setDevices(nextDevices); setCheckpoints(nextCheckpoints);
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!status?.configured) { setDevices([]); setCheckpoints([]); return; }
    void refreshRemote().catch(() => { setDevices([]); setCheckpoints([]); });
  }, [status?.configured]);

  const authenticate = async () => {
    setBusy(true); setError('');
    try {
      if (mode === 'register') {
        const result = await invoke<{ recovery_code: string }>('sync_register', { endpoint, email, password, deviceName: '' });
        setRecoveryCode(result.recovery_code);
      } else if (mode === 'login') {
        await invoke('sync_login', { endpoint, email, password, deviceName: '' });
      } else {
        await invoke('sync_reset_password', { endpoint, email, password, recoveryCode: recoveryInput.trim(), deviceName: '' });
      }
      setPassword(''); setRecoveryInput(''); await refresh();
    } catch (value) { setError(String(value)); } finally { setBusy(false); }
  };
  const sync = async () => { setBusy(true); setError(''); setNotice(''); try { await invoke('sync_now'); await refresh(); await refreshRemote(); } catch (value) { setError(String(value)); } finally { setBusy(false); } };
  const initializeV3 = async () => {
    const confirmed = await ask('此设备会成为旧资料的唯一同步源，并创建一份新的加密 v3 基线。其他旧设备需要先恢复该版本，才能开始双向合并。', { title: '设为云同步源', kind: 'warning', okLabel: '创建 v3 基线', cancelLabel: '取消' });
    if (!confirmed) return;
    setBusy(true); setError(''); setNotice('');
    try { await invoke('sync_initialize_v3'); await refresh(); await refreshRemote(); setNotice('v3 同步基线已创建。请在其他旧设备上预览并恢复此版本后再同步。'); } catch (value) { setError(String(value)); } finally { setBusy(false); }
  };
  const disconnect = async () => { setBusy(true); try { await invoke('sync_disconnect'); setRecoveryCode(''); await refresh(); } catch (value) { setError(String(value)); } finally { setBusy(false); } };
  const revokeDevice = async (deviceId: string) => { setBusy(true); setError(''); try { await invoke('sync_revoke_device', { deviceId }); setDevices((items) => items.filter((item) => item.id !== deviceId)); } catch (value) { setError(String(value)); } finally { setBusy(false); } };
  const loadPreview = async (checkpointId: string) => { setBusy(true); setError(''); setConfirmRestore(false); try { setPreview(await invoke<SyncCheckpointPreview>('sync_preview_checkpoint', { checkpointId })); } catch (value) { setError(String(value)); } finally { setBusy(false); } };
  const restore = async () => {
    if (!preview || (preview.local_has_data && !confirmRestore)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const path = await invoke<string>('sync_restore_checkpoint', { checkpointId: preview.checkpoint.id });
      setPreview(null); setConfirmRestore(false); await refresh();
      setNotice(`已恢复云端版本。本机恢复前备份已保存到：${path}`);
    } catch (value) { setError(String(value)); } finally { setBusy(false); }
  };
  const deleteAccount = async () => {
    const confirmed = await ask('这会永久删除服务器上的全部加密检查点、同步事件和设备授权。本机资料不会被删除，且此操作无法撤销。', { title: '删除云同步账户', kind: 'warning', okLabel: '永久删除', cancelLabel: '取消' });
    if (!confirmed) return;
    setBusy(true); setError(''); setNotice('');
    try { await invoke('sync_delete_account'); setRecoveryCode(''); setPreview(null); await refresh(); setNotice('云端账户及其加密同步数据已删除；本机资料仍然保留。'); } catch (value) { setError(String(value)); } finally { setBusy(false); }
  };

  return <SettingsCollapsibleSection
    id="cloud-sync"
    icon={<span className="rounded-xl bg-blue-50 p-2 text-blue-600"><Cloud size={20} /></span>}
    title="云同步"
    description="端到端加密：服务器只保存密文，离线学习始终可用。"
    summary={status?.configured ? `已连接：${status.email}` : '未配置'}
    open={open} onOpenChange={setOpen} expandLabel="展开" collapseLabel="收起"
  >
    {status?.configured ? <div className="space-y-4">
      <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
        <p className="font-medium text-gray-900">已连接至 {status.endpoint}</p>
        <p className="mt-1">{status.last_synced_at ? `上次成功同步：${new Date(status.last_synced_at).toLocaleString()}` : '尚未同步。'}</p>
        <p className="mt-1">{status.v3_initialized ? (status.pending_uploads ? `待同步变更：${status.pending_uploads}` : '所有本地变更均已同步。') : '尚未加入 v3 双向同步。'}{status.pending_downloads ? ` · 待下载：${status.pending_downloads}` : ''}</p>
        {status.v3_initialized && (status.last_uploaded > 0 || status.last_downloaded > 0) && <p className="mt-1 text-xs">最近一次：上传 {status.last_uploaded} 项，下载 {status.last_downloaded} 项。</p>}
        {status.conflicts > 0 && <p className="mt-1 text-amber-700">有 {status.conflicts} 项内容需要处理冲突。</p>}
      </div>
      {!status.v3_initialized && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800"><p className="font-semibold">开始双向同步前需要建立统一基线</p><p className="mt-1">若这里是资料最完整的设备，请将它设为同步源；否则在下方选择另一台设备创建的 v3 云端版本，预览后恢复。</p><button type="button" onClick={() => void initializeV3()} disabled={busy} className="mt-3 rounded-lg bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50">将此设备设为同步源</button></div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void sync()} disabled={busy || !status.v3_initialized} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"><RefreshCw size={15} className={busy ? 'animate-spin' : ''} />立即同步</button>
        <button type="button" onClick={() => void disconnect()} disabled={busy} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">退出本机同步</button>
      </div>
      <p className="-mt-2 text-xs text-gray-500">退出只会移除本机登录状态；不会删除云端密文或撤销其他设备。</p>
      <div className="rounded-lg border border-gray-200 text-sm">
        <p className="flex items-center gap-2 px-3 py-2 font-medium text-gray-900"><HardDriveDownload size={16} />云端版本（保留最近 5 个）</p>
        {checkpoints.length === 0 ? <p className="border-t border-gray-100 px-3 py-3 text-gray-500">尚无可恢复的云端版本。完成一次同步后会出现在这里。</p> : checkpoints.map((checkpoint) => <div key={checkpoint.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-3 py-2 text-gray-600">
          <span><span className="font-medium text-gray-900">{checkpoint.device_name}</span><span className="ml-2 text-xs">{new Date(checkpoint.created_at).toLocaleString()} · {formatBytes(checkpoint.encrypted_len)} · v{checkpoint.protocol_version}</span></span>
          <button type="button" disabled={busy} onClick={() => void loadPreview(checkpoint.id)} className="inline-flex items-center gap-1 text-xs text-blue-700 hover:text-blue-800 disabled:opacity-50"><Download size={14} />预览并恢复</button>
        </div>)}
      </div>
      {preview && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-semibold">恢复前预览</p>
        <p className="mt-1">云端版本包含 {preview.files} 个文件、{preview.folders} 个文件夹、{preview.words} 个单词、{preview.phrases} 个词组和 {preview.review_logs} 条复习记录。</p>
        {preview.local_has_data ? <label className="mt-3 flex items-start gap-2 text-amber-900"><input checked={confirmRestore} onChange={(event) => setConfirmRestore(event.target.checked)} type="checkbox" className="mt-0.5 accent-blue-600" /><span>我理解这会替换本机现有的 {preview.local_files} 个文件；LexiCue 会先创建本地安全备份。</span></label> : <p className="mt-3 text-amber-900">本机没有已导入资料，可以安全恢复。</p>}
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void restore()} disabled={busy || (preview.local_has_data && !confirmRestore)} className="rounded-lg bg-blue-600 px-3 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50">恢复并替换本机资料</button><button type="button" onClick={() => { setPreview(null); setConfirmRestore(false); }} disabled={busy} className="rounded-lg border border-amber-300 px-3 py-2 text-amber-800 hover:bg-amber-100 disabled:opacity-50">取消</button></div>
      </div>}
      {devices.length > 0 && <div className="rounded-lg border border-gray-200 text-sm">
        <p className="px-3 py-2 font-medium text-gray-900">已连接设备</p>
        {devices.map((device) => <div key={device.id} className="flex items-center justify-between gap-3 border-t border-gray-100 px-3 py-2 text-gray-600">
          <span><span className="font-medium text-gray-900">{device.name}</span>{device.id === status.device_id && <span className="ml-2 text-xs text-blue-700">当前设备</span>}<span className="ml-2 text-xs">{new Date(device.last_seen_at).toLocaleString()}</span></span>
          {device.id !== status.device_id && <button type="button" disabled={busy} onClick={() => void revokeDevice(device.id)} className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50">撤销授权</button>}
        </div>)}
      </div>}
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        <p className="font-medium">危险操作</p><p className="mt-1">删除云端账户会清除服务器上的全部密文、版本和设备授权，但不会删除本机资料。</p>
        <button type="button" onClick={() => void deleteAccount()} disabled={busy} className="mt-3 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50">删除云端账户</button>
      </div>
    </div> : <div className="space-y-3">
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setMode('register')} className={`rounded-lg px-3 py-1.5 text-sm ${mode === 'register' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}><UserPlus size={14} className="mr-1 inline" />创建账户</button><button type="button" onClick={() => setMode('login')} className={`rounded-lg px-3 py-1.5 text-sm ${mode === 'login' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}><LogIn size={14} className="mr-1 inline" />登录</button><button type="button" onClick={() => setMode('recovery')} className={`rounded-lg px-3 py-1.5 text-sm ${mode === 'recovery' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}>恢复密码</button></div>
      <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://sync.example.com" aria-label="同步服务器地址" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
      <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="邮箱" type="email" autoComplete="email" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
      {mode === 'recovery' && <input value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value)} placeholder="恢复代码（XXXX-XXXX-XXXX-XXXX）" type="text" autoComplete="off" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-gray-900 placeholder:font-sans placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />}
      <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'recovery' ? '新密码（至少 10 位）' : '密码（至少 10 位）'} type="password" autoComplete={mode === 'register' || mode === 'recovery' ? 'new-password' : 'current-password'} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
      <button type="button" onClick={() => void authenticate()} disabled={busy || !endpoint || !email || !password || (mode === 'recovery' && !recoveryInput.trim())} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? '正在连接…' : mode === 'register' ? '创建加密账户' : mode === 'recovery' ? '用恢复代码重设密码' : '登录'}</button>
    </div>}
    {status?.last_error && <p role="alert" className="mt-3 break-words text-sm text-red-600">{status.last_error}</p>}
    {recoveryCode && <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800"><p className="font-semibold">保存恢复代码</p><p className="mt-1">仅显示这一次。忘记密码时，只有它能恢复你的加密数据。</p><div className="mt-3 flex items-center justify-between gap-2 rounded bg-white px-3 py-2 font-mono text-xs text-gray-900"><span>{recoveryCode}</span><button type="button" onClick={() => void navigator.clipboard.writeText(recoveryCode)} aria-label="复制恢复代码" className="rounded p-1 text-gray-600 hover:bg-gray-50"><Copy size={15} /></button></div></div>}
    {error && <p role="alert" className="mt-3 break-words text-sm text-red-600">{error}</p>}
    {notice && <p role="status" className="mt-3 break-words text-sm text-green-700">{notice}</p>}
  </SettingsCollapsibleSection>;
}
