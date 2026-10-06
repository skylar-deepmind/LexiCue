import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
import { useReaderStore } from '../readerStore';
describe('reader request ownership', () => {
  it('keeps the newest file and lookup spans when an old load completes late', async () => {
    let release!: (value: unknown) => void;
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === 'get_file_segments') return args.fileId === 1 ? new Promise(done => { release = done; }) : [{ id: 2, index_num: 0, en_text: 'novelty' }];
      if (command === 'get_file_info') return { language: 'en' };
      if (command === 'get_file_reader_tokens') return [{ segment_index: 0, language: 'en', surface: 'novelty', lemma: 'novelty', start: 0, end: 7, word_id: null, status: null }];
      return [];
    });
    const old = useReaderStore.getState().setFile(1);
    await useReaderStore.getState().setFile(2);
    release([{ id: 1, index_num: 0, en_text: 'old' }]); await old;
    expect(useReaderStore.getState().currentFileId).toBe(2);
    expect(useReaderStore.getState().segments[0].en_text).toBe('novelty');
    expect(useReaderStore.getState().readerTokens.get(0)?.[0].word_id).toBeNull();
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'list_words')).toBe(false);
  });
  it('exposes a failure and recovers on retry without old content', async () => {
    mocks.invoke.mockImplementation(async command => { if (command === 'get_file_segments') throw Error('database busy'); return []; });
    await useReaderStore.getState().setFile(3);
    expect(useReaderStore.getState().error).toContain('database busy');
    expect(useReaderStore.getState().segments).toHaveLength(0);
    expect(useReaderStore.getState().loading).toBe(false);
    mocks.invoke.mockImplementation(async command => command === 'get_file_info' ? { language: 'de' } : []);
    await useReaderStore.getState().setFile(3);
    expect(useReaderStore.getState().error).toBe('');
  });
});
