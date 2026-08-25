import { appDataDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { Stronghold } from '@tauri-apps/plugin-stronghold';

export interface SyncSecrets {
  access_token: string;
  refresh_token: string;
  data_key: string;
}

const CLIENT = 'lexicue-cloud-sync';
const RECORD = 'credentials-v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function vault() {
  // The password is a random value returned by Rust from the platform security
  // service (Keychain on macOS / Android Keystore-backed storage on Android).
  // It never enters SQLite, and Stronghold encrypts the actual credential set.
  const [directory, key] = await Promise.all([
    appDataDir(),
    invoke<string>('sync_vault_key'),
  ]);
  const hold = await Stronghold.load(await join(directory, 'cloud-sync.hold'), key);
  let client;
  try { client = await hold.loadClient(CLIENT); }
  catch { client = await hold.createClient(CLIENT); }
  return { hold, store: client.getStore() };
}

export async function loadSyncSecrets(): Promise<SyncSecrets> {
  const { store } = await vault();
  const value = await store.get(RECORD);
  if (!value) throw new Error('本机安全保险库中没有同步凭据，请重新登录或使用恢复代码。');
  const parsed = JSON.parse(decoder.decode(value)) as SyncSecrets;
  if (!parsed.access_token || !parsed.data_key) throw new Error('本机同步凭据不完整，请重新登录。');
  return parsed;
}

export async function saveSyncSecrets(secrets: SyncSecrets): Promise<void> {
  const { hold, store } = await vault();
  await store.insert(RECORD, Array.from(encoder.encode(JSON.stringify(secrets))));
  await hold.save();
}

export async function clearSyncSecrets(): Promise<void> {
  const { hold, store } = await vault();
  await store.remove(RECORD);
  await hold.save();
}

/** Moves credentials produced by the pre-vault build without a data-loss gap. */
export async function migrateLegacySyncSecrets(): Promise<void> {
  const legacy = await invoke<SyncSecrets | null>('sync_legacy_credentials');
  if (!legacy) return;
  await saveSyncSecrets(legacy);
  await invoke('sync_finalize_legacy_credentials');
}
