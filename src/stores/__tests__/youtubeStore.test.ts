import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listeners: new Map<string, (event: { payload: unknown }) => void>() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name, callback) => { mocks.listeners.set(name, callback); return () => {}; }) }));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }));
import { useYoutubeStore } from '../youtubeStore';
import { EMPTY_BROWSER_SESSION } from '../../lib/youtubeDownload';

describe('YouTube progress ownership', () => {
  it('only accepts progress for active jobs and ignores late results after completion', async () => {
    await useYoutubeStore.getState().initialize();
    let resolve!: (value: unknown) => void;
    mocks.invoke.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = useYoutubeStore.getState().prepareSubtitles(7, 'video', { lang: 'en', is_auto: true }, null, EMPTY_BROWSER_SESSION);
    const emit = (jobId: number) => mocks.listeners.get('youtube-progress')!({ payload: { jobId, status: 'processing', stage: 'waiting', percent: 10, remainingSeconds: 60, message: '' } });
    emit(99);
    expect(useYoutubeStore.getState().downloadProgress[99]).toBeUndefined();
    emit(7);
    expect(useYoutubeStore.getState().downloadProgress[7].remainingSeconds).toBe(60);
    resolve({ status: 'complete', subtitle: { name: 'test', content: 'test' } }); await pending;
    emit(7);
    expect(useYoutubeStore.getState().downloadProgress[7]).toBeUndefined();
  });
});
