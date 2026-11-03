import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../readingTranslation', () => ({ READING_TRANSLATION_BATCH: 8, translateReadingBatch: vi.fn() }));
import { translateReadingBatch } from '../readingTranslation';
import { createReadingTranslationSession } from '../readingTranslationSession';
import type { Segment } from '../types';

const rows: Segment[] = [0, 1, 2].map(index => ({ id: index + 10, index_num: index, en_text: `Sentence ${index}.`, zh_text: index === 0 ? '原有译文' : null, start_time: null, end_time: null }));
const createSession = (allowGenerate = true) => createReadingTranslationSession({ materialId: 7, contentHash: 'hash', segments: rows, allowGenerate });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => vi.resetAllMocks());

describe('reading translation session', () => {
  it('starts off without requests, shows cached media translations without invoking generation', () => {
    const session = createSession(false);
    expect(session.getSnapshot().enabled).toBe(false);
    expect(session.available).toBe(true);
    session.toggle(rows);
    expect(session.getSnapshot()).toMatchObject({ enabled: true, status: 'ready' });
    expect(translateReadingBatch).not.toHaveBeenCalled();
  });
  it('requests visible missing originals and retries only missing results after partial success', async () => {
    vi.mocked(translateReadingBatch).mockResolvedValueOnce({ translations: [{ id: 11, zh_text: '第一句' }], failed: true })
      .mockResolvedValueOnce({ translations: [{ id: 12, zh_text: '第二句' }], failed: false });
    const session = createSession();
    session.toggle(rows);
    await settle();
    expect(vi.mocked(translateReadingBatch).mock.calls[0][2].map(row => row.id)).toEqual([11, 12]);
    expect(session.getSnapshot().status).toBe('partial');
    await session.request(rows);
    expect(vi.mocked(translateReadingBatch).mock.calls[1][2].map(row => row.id)).toEqual([12]);
    expect(session.getSnapshot()).toMatchObject({ status: 'ready', generated: { 11: '第一句', 12: '第二句' } });
  });
  it('invalidates old responses on hide and permits a new request without stale finally clearing its owner', async () => {
    const resolvers: Array<(value: { translations: {id:number;zh_text:string}[]; failed:boolean }) => void> = [];
    vi.mocked(translateReadingBatch).mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));
    const session = createSession();
    session.toggle([rows[1]]);
    const firstSignal = vi.mocked(translateReadingBatch).mock.calls[0][3];
    session.close();
    session.toggle([rows[2]]);
    resolvers[0]({ translations: [{ id: 11, zh_text: '迟到' }], failed: false });
    await settle();
    expect(firstSignal.aborted).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ status: 'loading', generated: {} });
    await session.request(rows);
    expect(translateReadingBatch).toHaveBeenCalledTimes(2);
    resolvers[1]({ translations: [{ id: 12, zh_text: '当前' }], failed: false });
    await settle();
    expect(session.getSnapshot().generated).toEqual({ 12: '当前' });
  });
  it('rejects foreign or changed sentences and unrequested response ids', async () => {
    vi.mocked(translateReadingBatch).mockResolvedValue({ translations: [{ id: 888, zh_text: '错误材料' }], failed: false });
    const session = createSession();
    session.toggle([{...rows[1], en_text:'Changed.'}, {...rows[2], id: 900}]);
    expect(translateReadingBatch).not.toHaveBeenCalled();
    await session.request([rows[1]]);
    expect(session.getSnapshot()).toMatchObject({ generated: {}, status: 'error' });
  });
  it('turns transport failures into recoverable feedback and close keeps completed translations', async () => {
    vi.mocked(translateReadingBatch).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ translations: [{ id: 11, zh_text: '恢复' }], failed: false });
    const session = createSession();
    session.toggle([rows[1]]); await settle();
    expect(session.getSnapshot().status).toBe('error');
    await session.request([rows[1]]); session.close();
    expect(session.getSnapshot()).toEqual({ enabled: false, status: 'idle', generated: { 11: '恢复' } });
  });
  it('has no generation entry for empty or untranslated source-only material', () => {
    const session = createReadingTranslationSession({ materialId: 9, contentHash: 'media', segments: rows.slice(1), allowGenerate: false });
    session.toggle(rows);
    expect(session.available).toBe(false);
    expect(session.getSnapshot().enabled).toBe(false);
  });
});
