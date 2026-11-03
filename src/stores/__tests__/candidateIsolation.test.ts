import { afterEach, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ invoke: vi.fn(), check: vi.fn(), github: vi.fn(), install: vi.fn(), relaunch: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: calls.invoke }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));
vi.mock('../../lib/updater', () => ({ checkForUpdates: calls.check, checkGithubRelease: calls.github, downloadAndInstall: calls.install, relaunchApp: calls.relaunch, isNewerVersion: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.clearAllMocks(); });

it('an isolated candidate cannot update or schedule sync even through indirect store calls', async () => {
  vi.stubEnv('VITE_SLICE_PREVIEW', '1');
  const { useUpdateStore } = await import('../updateStore');
  const { syncCoordinator } = await import('../../lib/syncCoordinator');
  await useUpdateStore.getState().check();
  useUpdateStore.setState({ status: 'available', update: { version: '99.0.0' } as never });
  await useUpdateStore.getState().install();
  const stop = syncCoordinator.start();
  syncCoordinator.markChanged(); await syncCoordinator.runNow(true); stop();
  for (const callback of Object.values(calls)) expect(callback).not.toHaveBeenCalled();
  expect(useUpdateStore.getState().status).toBe('available');
});
