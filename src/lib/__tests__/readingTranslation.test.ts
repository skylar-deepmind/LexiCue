import {beforeEach, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({invoke: vi.fn(), translate: vi.fn()}));
vi.mock('@tauri-apps/api/core', () => ({invoke: mocks.invoke}));
vi.mock('../importTranslation', () => ({translateImportSegments: mocks.translate}));
import {translateReadingBatch} from '../readingTranslation';
import type {Segment, SegmentInput} from '../types';
const sentences = (count: number): Segment[] => Array.from({length: count}, (_, index) => ({id: index + 10, index_num: index, en_text: `Sentence ${index}.`, zh_text: index === 0 ? '已有人工译文' : null, start_time: null, end_time: null}));
beforeEach(() => {
    vi.resetAllMocks();
    mocks.invoke.mockImplementation(async (_command, args) => args.segments.map((row: {id: number; zh_text: string}) => ({id: row.id, zh_text: row.zh_text})));
    mocks.translate.mockImplementation(async (rows: SegmentInput[]) => ({segments: rows.map(row => ({...row, zh_text: `译文 ${row.index}`})), failed: false}));
});
it('translates the entire missing material in bounded writes, with progress and existing Chinese preserved', async () => {
    const progress = vi.fn();
    const result = await translateReadingBatch(7, 'original-hash', sentences(20), new AbortController().signal, progress);
    expect(mocks.translate.mock.calls.map(call => call[0].length)).toEqual([8, 8, 3]);
    expect(result.translations).toHaveLength(19); expect(result.failed).toBe(false);
    expect(mocks.translate.mock.calls.flatMap(call => call[0]).some(row => row.index === 0)).toBe(false);
    expect(progress.mock.calls.map(call => call[1])).toEqual([{done:8,total:19},{done:16,total:19},{done:19,total:19}]);
    for (const [, args] of mocks.invoke.mock.calls) {
        expect(args).toMatchObject({fileId:7,contentHash:'original-hash'});
        expect(args.segments.length).toBeLessThanOrEqual(8);
        expect(args.segments.every((row: {id:number;en_text:string}) => row.en_text === `Sentence ${row.id-10}.`)).toBe(true);
    }
});
it('retains the completed batch and stops without a retry storm after a later service failure', async () => {
    mocks.translate.mockImplementationOnce(async (rows: SegmentInput[]) => ({segments: rows.map(row => ({...row, zh_text:'已完成'})), failed:false}))
      .mockImplementationOnce(async rows => ({segments:rows, failed:true}));
    const progress=vi.fn();const result=await translateReadingBatch(7,'hash',sentences(30),new AbortController().signal,progress);
    expect(result.failed).toBe(true);expect(result.translations).toHaveLength(8);
    expect(mocks.translate).toHaveBeenCalledTimes(2);expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
it('never writes a late result after cancellation or navigation', async () => {
    let resolve!: (value: unknown) => void;
    mocks.translate.mockReturnValue(new Promise(done => {resolve = done;}));
    const controller = new AbortController();
    const pending = translateReadingBatch(7, 'hash', sentences(3), controller.signal);
    controller.abort();resolve({segments: [{index: 1, zh_text: '迟到结果'}], failed: false});
    await expect(pending).rejects.toThrow('material_cancelled');expect(mocks.invoke).not.toHaveBeenCalled();
});
it('does not contact the service for fully translated material or an aborted request', async () => {
    expect(await translateReadingBatch(7,'hash',sentences(1),new AbortController().signal)).toEqual({translations:[],failed:false});
    const controller=new AbortController();controller.abort();
    await expect(translateReadingBatch(7,'hash',sentences(3),controller.signal)).rejects.toThrow('material_cancelled');
    expect(mocks.translate).not.toHaveBeenCalled();
});
