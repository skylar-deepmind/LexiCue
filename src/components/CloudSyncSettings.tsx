import { useEffect, useState } from 'react';
import { Cloud, Copy, LogIn, RefreshCw, UserPlus } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import SettingsCollapsibleSection from './SettingsCollapsibleSection';

interface SyncStatus { configured: boolean; email: string | null; endpoint: string | null; last_synced_at: number | null }

export default function CloudSyncSettings() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [endpoint, setEndpoint] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');

  const refresh = async () => {
    try { setStatus(await invoke<SyncStatus>('sync_status')); } catch (value) { setError(String(value)); }
  };
  useEffect(() => { void refresh(); }, []);

  const authenticate = async () => {
    setBusy(true); setError('');
    try {
      if (mode === 'register') {
        const result = await invoke<{ recovery_code: string }>('sync_register', { endpoint, email, password, deviceName: 'LexiCue device' });
        setRecoveryCode(result.recovery_code);
      } else {
        await invoke('sync_login', { endpoint, email, password, deviceName: 'LexiCue device' });
      }
      setPassword(''); await refresh();
    } catch (value) { setError(String(value)); } finally { setBusy(false); }
  };
  const sync = async () => { setBusy(true); setError(''); try { await invoke('sync_now'); await refresh(); } catch (value) { setError(String(value)); } finally { setBusy(false); } };
  const disconnect = async () => { setBusy(true); try { await invoke('sync_disconnect'); setRecoveryCode(''); await refresh(); } catch (value) { setError(String(value)); } finally { setBusy(false); } };

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
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void sync()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"><RefreshCw size={15} className={busy ? 'animate-spin' : ''} />立即同步</button>
        <button type="button" onClick={() => void disconnect()} disabled={busy} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">断开此设备</button>
      </div>
    </div> : <div className="space-y-3">
      <div className="flex gap-2"><button type="button" onClick={() => setMode('register')} className={`rounded-lg px-3 py-1.5 text-sm ${mode === 'register' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}><UserPlus size={14} className="mr-1 inline" />创建账户</button><button type="button" onClick={() => setMode('login')} className={`rounded-lg px-3 py-1.5 text-sm ${mode === 'login' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}><LogIn size={14} className="mr-1 inline" />登录</button></div>
      <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://sync.example.com" aria-label="同步服务器地址" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
      <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="邮箱" type="email" autoComplete="email" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
      <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码（至少 10 位）" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" />
      <button type="button" onClick={() => void authenticate()} disabled={busy || !endpoint || !email || !password} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? '正在连接…' : mode === 'register' ? '创建加密账户' : '登录'}</button>
    </div>}
    {recoveryCode && <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800"><p className="font-semibold">保存恢复代码</p><p className="mt-1">仅显示这一次。忘记密码时，只有它能恢复你的加密数据。</p><div className="mt-3 flex items-center justify-between gap-2 rounded bg-white px-3 py-2 font-mono text-xs text-gray-900"><span>{recoveryCode}</span><button type="button" onClick={() => void navigator.clipboard.writeText(recoveryCode)} aria-label="复制恢复代码" className="rounded p-1 text-gray-600 hover:bg-gray-50"><Copy size={15} /></button></div></div>}
    {error && <p role="alert" className="mt-3 break-words text-sm text-red-600">{error}</p>}
  </SettingsCollapsibleSection>;
}
