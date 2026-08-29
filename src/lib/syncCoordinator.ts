import { invoke } from '@tauri-apps/api/core';

type Status = { configured: boolean; auto_sync_enabled: boolean; pending_uploads: number };
const now = () => Date.now();

/**
 * A foreground-only, single-flight scheduler. Keeping it outside React means
 * the Settings button, startup, online events and polling always join the
 * same operation rather than racing two uploads against one SQLite outbox.
 */
class SyncCoordinator {
  private active: Promise<void> | null = null;
  private retryTimer: number | null = null;
  private dirtyTimer: number | null = null;
  private retrySeconds = 10;
  private started = false;
  private hadPending = false;

  async runNow(force = false): Promise<void> {
    if (this.active) return this.active;
    this.clearTimers();
    this.active = this.run(force).finally(() => { this.active = null; });
    return this.active;
  }

  private async run(force: boolean): Promise<void> {
    const status = await invoke<Status>('sync_status');
    if (!status.configured || (!force && !status.auto_sync_enabled) || document.visibilityState !== 'visible') return;
    try {
      await invoke('sync_set_diagnostic', { phase: 'syncing', lastError: null, nextRetryAt: null });
      await invoke('sync_run');
      await invoke('sync_set_diagnostic', { phase: 'idle', lastError: null, nextRetryAt: null });
      this.retrySeconds = 10;
      this.hadPending = false;
    } catch (error) {
      const message = String(error);
      if (!/credential_|auth_required|session_expired/i.test(message)) this.scheduleRetry(message);
      else await invoke('sync_set_diagnostic', { phase: 'paused', lastError: message, nextRetryAt: null });
      throw error;
    }
  }

  private scheduleRetry(error: string): void {
    if (this.retryTimer !== null || document.visibilityState !== 'visible') return;
    const delay = Math.min(this.retrySeconds, 300) * 1000;
    void invoke('sync_set_diagnostic', { phase: 'retrying', lastError: error, nextRetryAt: now() + delay });
    this.retrySeconds = Math.min(this.retrySeconds * 2, 300);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void this.runNow().catch(() => undefined);
    }, delay);
  }

  markChanged(): void {
    if (this.dirtyTimer !== null) window.clearTimeout(this.dirtyTimer);
    this.dirtyTimer = window.setTimeout(() => {
      this.dirtyTimer = null;
      void this.runNow().catch(() => undefined);
    }, 10_000);
  }

  start(): () => void {
    if (this.started) return () => this.stop();
    this.started = true;
    const resume = () => { if (document.visibilityState === 'visible') void this.runNow().catch(() => undefined); };
    const online = () => void this.runNow().catch(() => undefined);
    const changed = () => this.markChanged();
    const pendingPoll = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void invoke<Status>('sync_status').then((status) => {
        if (status.pending_uploads > 0 && !this.hadPending) this.markChanged();
        this.hadPending = status.pending_uploads > 0;
      }).catch(() => undefined);
    }, 2000);
    const foregroundPoll = window.setInterval(() => void this.runNow().catch(() => undefined), 5 * 60_000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', online);
    window.addEventListener('lexicue-sync-changed', changed);
    void this.runNow().catch(() => undefined);
    return () => {
      window.clearInterval(pendingPoll); window.clearInterval(foregroundPoll);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', online);
      window.removeEventListener('lexicue-sync-changed', changed);
      this.stop();
    };
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    if (this.dirtyTimer !== null) window.clearTimeout(this.dirtyTimer);
    this.retryTimer = this.dirtyTimer = null;
  }
  private stop(): void { this.started = false; this.clearTimers(); }
}

export const syncCoordinator = new SyncCoordinator();
export const notifySyncChanged = () => window.dispatchEvent(new Event('lexicue-sync-changed'));
