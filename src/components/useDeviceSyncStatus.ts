import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

type Phase = 'unpaired' | 'offering' | 'scanning' | 'confirming' | 'waiting' | 'syncing'
  | 'synced' | 'permission' | 'update' | 'pending' | 'error' | 'unsupported';
export interface DeviceStatus {
  state: Phase;
  role: 'mac' | 'iphone';
  paired: boolean;
  phase?: 'preparing' | 'exchanging' | 'awaitingAck';
  peerName?: string;
  code?: string;
  confirmationId?: string;
  confirmed?: boolean;
  qr?: string;
  issue?: string;
  receiveClosed?: boolean;
}

export function useDeviceSyncStatus(view: 'detail' | 'summary' = 'detail') {
  const [status, setStatus] = useState<DeviceStatus>();
  const [readError, setReadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let timer: number | undefined;
    let request = 0;
    const read = async () => {
      window.clearTimeout(timer);
      const current = ++request;
      if (document.visibilityState !== 'visible') return;
      const version = generation.current;
      const valid = () => alive && current === request && version === generation.current;
      let delay = 1000;
      if (!busyRef.current) {
        try {
          const next = await invoke<DeviceStatus>('device_sync', {action: 'status'});
          if (valid()) { setStatus(next); setReadError(false); }
          if (next.state === 'unsupported') return;
          if (view === 'summary') {
            if (next.state === 'unpaired') return;
            // Keep an in-progress summary current. A paired device can reconnect
            // without an app write, so also recheck quiet states less often.
            if (next.state !== 'syncing') delay = 5000;
          }
        } catch { if (valid()) setReadError(true); }
      }
      if (alive && current === request) timer = window.setTimeout(read, delay);
    };
    void read();
    document.addEventListener('visibilitychange', read);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', read);
    };
  }, [view]);

  const perform = useCallback(async (job: () => Promise<DeviceStatus>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    generation.current++;
    setBusy(true);
    try {
      const next = await job();
      setStatus(next);
      setReadError(false);
    } finally { busyRef.current = false; setBusy(false); }
  }, []);
  return {status, readError, busy, perform};
}
