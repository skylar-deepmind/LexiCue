import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

type Phase = 'unpaired' | 'offering' | 'scanning' | 'confirming' | 'waiting' | 'syncing'
  | 'synced' | 'permission' | 'update' | 'pending' | 'error' | 'unsupported';
export interface DeviceStatus {
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

export function useDeviceSyncStatus() {
  const [status, setStatus] = useState<DeviceStatus>();
  const [readError, setReadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let timer: number;
    const poll = async () => {
      const version = generation.current;
      if (document.visibilityState === 'visible' && !busyRef.current) {
        try {
          const next = await invoke<DeviceStatus>('device_sync', {action: 'status'});
          if (alive && version === generation.current) { setStatus(next); setReadError(false); }
          if (next.state === 'unsupported') return;
        } catch { if (alive && version === generation.current) setReadError(true); }
      }
      if (alive) timer = window.setTimeout(poll, 1000);
    };
    void poll();
    return () => { alive = false; window.clearTimeout(timer); };
  }, []);

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
