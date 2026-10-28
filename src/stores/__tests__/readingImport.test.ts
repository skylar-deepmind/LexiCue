import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), parse: vi.fn(), open: vi.fn(), read: vi.fn(), prepare: vi.fn(), cancel: vi.fn(), record: vi.fn(), translate: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: mocks.read }));
vi.mock('../../lib/materials', async original => ({ ...await original<object>(), parseSrtInWorker: mocks.parse }));
vi.mock('../../lib/importTranslation', () => ({ translateImportSegments: mocks.translate }));
vi.mock('../youtubeStore', () => ({ useYoutubeStore: { getState: () => ({ prepareSubtitles: mocks.prepare, cancelJob: mocks.cancel }) } }));
vi.mock('../preferencesStore', () => ({ usePreferencesStore: { getState: () => ({ youtube: {}, recordYouTubeImport: mocks.record }) } }));
vi.mock('../materialStore', () => ({ useMaterialStore: { getState: () => ({ changed: vi.fn() }) } }));
import { prepareImportQueue, commitImportQueue, useImportStore, type ImportItem } from '../importStore';
import { parseEnglishSrt } from '../../lib/englishSrt';
import { parseEnglishText } from '../../lib/englishText';
const srt = (text = 'We fly.') => `1\n00:00:01,000 --> 00:00:02,000\n${text}\n`;
const item = (id: string): ImportItem => ({ id, name: id + '.srt', stage: 'queued', read: async () => srt() });
const store = () => useImportStore.getState();
const receipt = { file_id: 1, outcome: 'created' as const, readable: true };
const update = (items: ImportItem[]) => (id: string, patch: Partial<ImportItem>) => Object.assign(items.find(item => item.id === id)!, patch);
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const youtube = { url: 'https://www.youtube.com/watch?v=test', title: 'Real title', primary: { lang: 'en-orig', language: 'en', is_auto: true }, secondary: { lang: 'zh-Hans', is_auto: false } };
beforeEach(() => {
    store().changeSource(); store().hide(); vi.clearAllMocks();
    vi.stubGlobal('navigator', { userAgent: 'test' });
    mocks.parse.mockImplementation(async (text, _, name) => name?.endsWith('.txt') ? parseEnglishText(text) : parseEnglishSrt(text));
    mocks.translate.mockImplementation(async segments => ({ segments, failed: false }));
    mocks.invoke.mockResolvedValue(receipt); mocks.cancel.mockResolvedValue(undefined);
});

describe('preview and transaction boundaries', () => {
    it('prepares real bilingual content without writes and commits the exact frozen preview once', async () => {
        const read = vi.fn().mockResolvedValue(srt('We fly.\n我们飞翔。'));
        await store().start([{ name: 'flight.srt', read }]);
        expect(mocks.invoke).not.toHaveBeenCalled(); expect(store().phase).toBe('preview');
        const draft = store().items[0].draft!;
        expect(draft.segments[0]).toMatchObject({ en_text: 'We fly.', zh_text: '我们飞翔。' });
        expect(draft.wordCount).toBe(2); expect(Object.isFrozen(draft.segments[0])).toBe(true);
        read.mockResolvedValue(srt('Changed after preview.'));
        await Promise.all([store().confirm(), store().confirm()]);
        expect(read).toHaveBeenCalledTimes(1); expect(mocks.parse).toHaveBeenCalledTimes(1); expect(mocks.invoke).toHaveBeenCalledTimes(1);
        expect(mocks.invoke).toHaveBeenCalledWith('import_reading_material', { input: { operation_id: draft.operation_id, name: draft.name, content: draft.content, segments: draft.segments } });
    });
    it('isolates invalid files from valid drafts and duplicate receipts', async () => {
        const items = [item('good'), { ...item('bad'), read: async () => '' }, item('duplicate')];
        await prepareImportQueue(items, new AbortController().signal, update(items), mocks.parse);
        expect(items.map(item => item.stage)).toEqual(['ready', 'failed', 'ready']);
        const write = vi.fn(async input => ({ ...receipt, outcome: input.operation_id === 'duplicate' ? 'duplicate' as const : 'created' as const }));
        await commitImportQueue(items, new AbortController().signal, update(items), write);
        expect(items.map(item => item.stage)).toEqual(['created', 'failed', 'duplicate']); expect(write).toHaveBeenCalledTimes(2);
    });
    it('retains the file-type and 32 MiB guards before creating any draft', async () => {
        await store().start([{ name: 'notes.pdf', read: async () => srt() },
            { name: 'oversized.srt', read: async () => 'a'.repeat(32 * 1024 * 1024 + 1) }]);
        expect(store().items.map(item => item.error)).toEqual(['invalid_srt', 'too_large']);
        expect(store().items.every(item => !item.draft)).toBe(true);
        await store().confirm(); expect(mocks.invoke).not.toHaveBeenCalled();
    });
    it('translates split TXT sentences before freezing the preview and preserves the original file', async () => {
        const text = 'She bought a book. She read it yesterday.';
        mocks.translate.mockImplementationOnce(async segments => ({ segments: segments.map((s: {index: number}) => ({...s, zh_text: `译文${s.index}`})), failed: false }));
        await store().start([{name: 'book.txt', read: async () => text}]);
        expect(store().items[0].draft?.segments.map(s => [s.en_text,s.zh_text])).toEqual([['She bought a book.','译文0'],['She read it yesterday.','译文1']]);
        expect(store().items[0].draft?.content).toBe(text);
        expect(mocks.invoke).not.toHaveBeenCalled();
    });
    it('retries only missing translation using retained sentences without reading or downloading again', async () => {
        const read = vi.fn(async () => srt('One sentence. Another sentence.'));
        mocks.translate.mockImplementationOnce(async segments => ({segments: segments.map((s: {index:number}) => ({...s,zh_text:s.index===0?'第一句。':null})),failed:true}));
        await store().start([{name:'retry.srt',read}]);
        expect(store().items[0].fallbackSegments?.[0].zh_text).toBe('第一句。');
        expect(store().items[0].error).toBe('translation_partial');
        mocks.translate.mockImplementationOnce(async segments => ({segments: segments.map((s: {zh_text:string|null}) => ({...s,zh_text:s.zh_text??'另一句。'})),failed:false}));
        await store().retry();
        expect(read).toHaveBeenCalledTimes(1);expect(mocks.parse).toHaveBeenCalledTimes(1);
        expect(store().items[0].draft?.segments.map(s=>s.zh_text)).toEqual(['第一句。','另一句。']);
        expect(mocks.invoke).not.toHaveBeenCalled();
    });
    it('continues with completed translations after failure and cancels a late translation on close', async () => {
        mocks.translate.mockImplementationOnce(async segments => ({segments,failed:true}));
        await store().start([item('fallback')]);
        await store().useEnglish(store().items[0].id);
        expect(store().items[0].draft).toBeDefined();expect(mocks.translate).toHaveBeenCalledTimes(1);
        expect(store().items[0].draft?.youtubeSelection).toBeUndefined();
        const late = deferred<{segments: ReturnType<typeof parseEnglishSrt>; failed: boolean}>();
        mocks.translate.mockReturnValueOnce(late.promise);
        const pending = store().start([item('late')]);
        await vi.waitFor(()=>expect(store().items[0].stage).toBe('translating'));
        store().hide();await pending;late.resolve({segments:parseEnglishSrt(srt()),failed:false});await Promise.resolve();
        expect(store()).toMatchObject({open:false,items:[]});
    });
    it('closes a pending read immediately and ignores its late result after another source opens', async () => {
        const late = deferred<string>();
        const pending = store().start([{ name: 'old.srt', read: () => late.promise }]);
        store().hide(); await pending;
        expect(store()).toMatchObject({ open: false, running: false, items: [] });
        await store().start([{ name: 'new.srt', read: async () => srt('A new source.') }]);
        late.resolve(srt('Late source.')); await Promise.resolve();
        expect(store().items[0].name).toBe('new.srt'); expect(mocks.invoke).not.toHaveBeenCalled();
        store().hide(); expect(store().items).toEqual([]);
    });
    it('aborts a parser on close and ignores a stale parser that does not honor abort', async () => {
        const late = deferred<ReturnType<typeof parseEnglishSrt>>(); let signal!: AbortSignal;
        mocks.parse.mockImplementationOnce((_, next) => { signal = next; return late.promise; });
        const pending = store().start([item('parsing')]);
        await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalled()); store().hide(); expect(signal.aborted).toBe(true);
        late.resolve(parseEnglishSrt(srt())); await pending;
        expect(store()).toMatchObject({ open: false, running: false, items: [] }); expect(mocks.invoke).not.toHaveBeenCalled();
    });
    it('keeps valid drafts when the picker is cancelled and ignores a closed picker result', async () => {
        await store().start([item('keep')]); const draft = store().items[0].draft;
        mocks.open.mockResolvedValueOnce(null); await store().choose(); expect(store().items[0].draft).toBe(draft);
        const late = deferred<string[]>(); mocks.open.mockReturnValueOnce(late.promise);
        const choosing = store().choose(); store().hide(); late.resolve(['/old.srt']); await choosing;
        expect(mocks.read).not.toHaveBeenCalled(); expect(store().open).toBe(false);
    });
    it('waits for a transaction on stop, survives background closing, and retries only remaining drafts', async () => {
        await store().start([item('one'), item('two')]);
        const pending = deferred<typeof receipt>(); mocks.invoke.mockReturnValueOnce(pending.promise);
        const committing = store().confirm(); store().hide();
        expect(store()).toMatchObject({ open: false, running: true, phase: 'committing' });
        store().cancel(); expect(store().items[0].stage).toBe('writing');
        pending.resolve(receipt); await committing;
        expect(store().items.map(item => item.stage)).toEqual(['created', 'cancelled']); expect(store().destination).toBeNull();
        store().show(); await store().retry();
        expect(store().items.map(item => item.stage)).toEqual(['created', 'created']); expect(mocks.parse).toHaveBeenCalledTimes(2);
    });
    it('reuses content and operation id after a lost receipt, including stop during the write', async () => {
        const read = vi.fn(async () => srt()); await store().start([{ name: 'stable.srt', read }]);
        mocks.invoke.mockImplementationOnce(async () => { store().cancel(); throw Error('lost receipt'); });
        await store().confirm(); expect(store().items[0].stage).toBe('failed');
        store().hide(); store().show(); await store().retry();
        expect(mocks.invoke.mock.calls[1]).toEqual(mocks.invoke.mock.calls[0]); expect(read).toHaveBeenCalledTimes(1);
        expect(store().items[0].stage).toBe('created');
    });
    it('does not let drops or source changes replace a committing batch', async () => {
        await store().start([item('locked')]); const pending = deferred<typeof receipt>(); mocks.invoke.mockReturnValueOnce(pending.promise);
        const committing = store().confirm(); await store().start([item('drop')]); store().changeSource('youtube');
        expect(store().items[0].name).toBe('locked.srt'); pending.resolve(receipt); await committing;
    });
    it('keeps English after a translation failure, previews it without redownloading, and records only committed preferences', async () => {
        mocks.prepare.mockResolvedValueOnce({ status: 'partial', primary: { content: srt(), name: 'English.srt' } });
        await store().fromYouTube(youtube);
        expect(store().items[0]).toMatchObject({ stage: 'failed', error: 'translation_partial', englishFallback: srt() });
        expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
        await store().useEnglish(store().items[0].id);
        expect(mocks.prepare).toHaveBeenCalledTimes(1); expect(store().items[0].draft?.youtubeSelection).toEqual({ primary: 'en', secondary: null });
        expect(mocks.record).not.toHaveBeenCalled(); await store().confirm();
        expect(mocks.record).toHaveBeenCalledWith({ primary: 'en', secondary: null });
    });
    it('cancels downloading on close and does not revive a late YouTube result', async () => {
        const late = deferred<unknown>(); mocks.prepare.mockReturnValueOnce(late.promise);
        const pending = store().fromYouTube(youtube); store().hide(); await pending;
        expect(mocks.cancel).toHaveBeenCalledWith(expect.any(Number));
        late.resolve({ status: 'complete', subtitle: { content: srt() } }); await Promise.resolve();
        expect(store()).toMatchObject({ open: false, items: [] }); expect(mocks.record).not.toHaveBeenCalled();
    });
    it('retries a failed download into preview, still requiring an explicit confirmation', async () => {
        mocks.prepare.mockRejectedValueOnce(Error('network unavailable'));
        await store().fromYouTube(youtube);
        expect(store().items[0]).toMatchObject({ stage: 'failed', error: 'download_failed' });
        expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
        mocks.prepare.mockResolvedValueOnce({ status: 'complete', subtitle: { content: srt() } });
        await store().retry(); expect(store().items[0].stage).toBe('ready');
        expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
        await store().confirm(); expect(mocks.invoke).toHaveBeenCalledTimes(1);
    });
    it('records bilingual preferences only after a successful retry, not a failed submit or a duplicate', async () => {
        mocks.prepare.mockResolvedValue({ status: 'complete', subtitle: { content: srt('We fly.\n我们飞翔。') } });
        await store().fromYouTube(youtube); expect(mocks.record).not.toHaveBeenCalled();
        mocks.invoke.mockRejectedValueOnce(Error('failed')); await store().confirm(); expect(mocks.record).not.toHaveBeenCalled();
        await store().retry(); expect(mocks.record).toHaveBeenCalledWith({ primary: 'en', secondary: 'zh-Hans' });
        mocks.record.mockClear(); await store().fromYouTube(youtube); mocks.invoke.mockResolvedValueOnce({ ...receipt, outcome: 'duplicate' }); await store().confirm();
        expect(mocks.record).not.toHaveBeenCalled();
    });
});
