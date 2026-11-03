import {beforeEach, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({invoke: vi.fn(), translate: vi.fn()}));
vi.mock('@tauri-apps/api/core', () => ({invoke: mocks.invoke}));
vi.mock('../importTranslation', () => ({translateImportSegments: mocks.translate}));
import {translateReadingBatch} from '../readingTranslation';
import type {Segment} from '../types';
const sentences = (count: number): Segment[] => Array.from({length: count}, (_, index) => ({id: index + 10, index_num: index, en_text: `Sentence ${index}.`, zh_text: index === 0 ? '已有人工译文' : null, start_time: null, end_time: null}));
beforeEach(() => {vi.clearAllMocks(); mocks.invoke.mockResolvedValue([{id: 11, zh_text: '补译'}]);});
it('caps explicit requests at eight missing sentences, retains existing translations and binds writes to original English and file version', async () => {
    mocks.translate.mockImplementation(async rows => ({segments: rows.map((row: {index: number}) => ({...row, zh_text: row.index === 1 ? '补译' : null})), failed: true}));
    const result = await translateReadingBatch(7, 'original-hash', sentences(30), new AbortController().signal);
    expect(mocks.translate.mock.calls[0][0]).toHaveLength(8);
    expect(mocks.translate.mock.calls[0][0].every((row: {index: number}) => row.index !== 0)).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith('fill_reading_translations', {fileId: 7, contentHash: 'original-hash', segments: [{id: 11, en_text: 'Sentence 1.', zh_text: '补译'}]});
    expect(result.failed).toBe(true);
});
it('never writes a late result after cancellation or navigation', async () => {
    let resolve!: (value: unknown) => void;
    mocks.translate.mockReturnValue(new Promise(done => {resolve = done;}));
    const controller = new AbortController();
    const pending = translateReadingBatch(7, 'hash', sentences(3), controller.signal);
    controller.abort();
    resolve({segments: [{index: 1, zh_text: '迟到结果'}], failed: false});
    await expect(pending).rejects.toThrow('material_cancelled');
    expect(mocks.invoke).not.toHaveBeenCalled();
});
it('a service error produces no write, and showing existing translations makes no request', async () => {
    mocks.translate.mockImplementation(async rows => ({segments: rows, failed: true}));
    expect(await translateReadingBatch(7, 'hash', sentences(2), new AbortController().signal)).toEqual({translations: [], failed: true});
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.translate.mockClear();
    expect(await translateReadingBatch(7, 'hash', sentences(1), new AbortController().signal)).toEqual({translations: [], failed: false});
    expect(mocks.translate).not.toHaveBeenCalled();
});
