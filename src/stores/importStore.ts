import { create } from 'zustand';
import { prepareContent } from '../lib/contentImport';
import { clipboardTitle } from '../lib/clipboardContent';
import { snapshotSource, type YoutubeSource } from '../lib/sourceMedia';
import type { ReadingMaterial } from '../lib/materials';
import { useSourceMediaStore } from './sourceMediaStore';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { readDocumentFile } from '../lib/readDocumentFile';
import { extractDocument, selectDocumentRange } from '../lib/documentImport';
import type { DocumentSource, DocumentSelection, ExtractedDocument } from '../lib/documentTypes';
import { materialError, parseSrtInWorker, type MaterialImportResult } from '../lib/materials';
import type { SegmentInput } from '../lib/types';
import { useMaterialStore } from './materialStore';
import { useYoutubeStore, type TrackSelection } from './youtubeStore';
import { usePreferencesStore } from './preferencesStore';
import { EMPTY_BROWSER_SESSION } from '../lib/youtubeDownload';
import { trackLanguage } from '../lib/youtubeSelection';
import { materialPickerOptions, pickedMaterialSource } from '../lib/importPicker';
import { translateImportSegments, type ImportTranslationResult, type TranslationProgress } from '../lib/importTranslation';

export type ImportStage = 'queued' | 'downloading' | 'reading' | 'parsing' | 'translating' | 'ready' | 'writing' | 'created' | 'duplicate' | 'failed' | 'cancelled';
export type ImportPhase = 'source' | 'preparing' | 'preview' | 'committing' | 'result';
type YouTubeSelection = { primary: string; secondary: string | null };
interface ReadResult { content: string; translationFailed?: boolean; source?: YoutubeSource | null; sourceIssue?: string | null }
export interface ImportSource {
    name: string;
    kind?: 'file' | 'youtube' | 'clipboard' | 'webpage';
    capturedText?: string;
    title?: string;
    url?: string;
    youtubeSelection?: YouTubeSelection;
    preparedSegments?: SegmentInput[];
    skipTranslation?: boolean;
    read: (signal: AbortSignal) => Promise<string | Uint8Array | ReadResult>;
}
/** A preview and its write share this immutable snapshot, including its operation id. */
export interface ImportDraft {
    readonly operation_id: string;
    readonly name: string;
    readonly content: string;
    readonly segments: SegmentInput[];
    readonly wordCount: number;
    readonly source?: YoutubeSource | null;
    readonly sourceIssue?: string | null;
    readonly youtubeSelection?: YouTubeSelection;
    readonly document?: DocumentSource;
    readonly normalized_kind?: 'txt' | 'srt';
}
export interface ImportItem extends ImportSource {
    id: string;
    stage: ImportStage;
    error?: string;
    draft?: ImportDraft;
    extraction?: ExtractedDocument;
    englishFallback?: string;
    fallbackSegments?: SegmentInput[];
    fallbackSource?: YoutubeSource | null;
    fallbackSourceIssue?: string | null;
    translationProgress?: TranslationProgress;
    result?: MaterialImportResult;
}
export interface ImportIO {
    parse: (content: string, signal: AbortSignal, name?: string) => Promise<SegmentInput[]>;
    translate?: (segments: SegmentInput[], signal: AbortSignal, progress: (value: TranslationProgress) => void) => Promise<ImportTranslationResult>;
    write: (input: { operation_id: string; name: string; content: string; segments: SegmentInput[]; source?: YoutubeSource | null; document?: DocumentSource; normalized_kind?: 'txt' | 'srt' }) => Promise<MaterialImportResult>;
}
type Update = (id: string, patch: Partial<ImportItem>) => void;

function freezeDocument(value: DocumentSource): DocumentSource {
    const copy = structuredClone(value);
    const freeze = (item: unknown): void => {
        if (!item || typeof item !== 'object' || Object.isFrozen(item)) return;
        for (const child of Object.values(item)) freeze(child);
        Object.freeze(item);
    };
    freeze(copy);
    return copy;
}

// Drop references to unabortable native reads as soon as cancelled. A late native
// result is consumed but cannot update a newer task or reopen its dialog.
function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        const abort = () => reject(new Error('material_cancelled'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
        task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

/** Preparation deliberately has no write capability. */
export async function prepareImportQueue(items: ImportItem[], signal: AbortSignal, update: Update, parse: ImportIO['parse'], translate?: ImportIO['translate']) {
    for (const item of items) {
        if (signal.aborted) break;
        let parsing = false;
        try {
            const contentKind = item.kind === 'clipboard' || item.kind === 'webpage' ? item.kind : undefined;
            if (!contentKind && !/\.(pdf|docx|epub|md|markdown|vtt|srt|txt)$/i.test(item.name)) throw new Error('material_invalid_srt');
            update(item.id, { stage: item.kind === 'youtube' ? 'downloading' : 'reading', error: undefined });
            const preparedContent = contentKind ? await abortable(prepareContent(contentKind, contentKind === 'webpage' ? item.url! : item.capturedText!, signal), signal) : undefined;
            const read = preparedContent ? preparedContent.content : await abortable(item.read(signal), signal);
            if (signal.aborted) break;
            if (!contentKind && !(read instanceof Uint8Array) && !/\.(txt|srt)$/i.test(item.name)) throw new Error('material_invalid_format');
            update(item.id, { stage: 'parsing' });
            parsing = true;
            const extraction = preparedContent ?? (read instanceof Uint8Array ? await extractDocument(read, item.name, signal) : undefined);
            const content = extraction ? extraction.content : typeof read === 'string' ? read : (read as ReadResult).content;
            const readMeta = typeof read === 'object' && !(read instanceof Uint8Array) ? read : undefined;
            if (readMeta?.translationFailed) {
                update(item.id, { stage: 'failed', error: 'translation_partial', englishFallback: content, fallbackSource: readMeta!.source, fallbackSourceIssue: readMeta!.sourceIssue });
                continue;
            }
            update(item.id, { stage: 'parsing' });
            parsing = true;
            let segments = extraction?.segments ?? item.preparedSegments ?? await parse(content, signal, item.name);
            if (signal.aborted) break;
            if (item.kind === 'youtube' && translate && !item.skipTranslation && segments.some(segment => !segment.zh_text?.trim())) {
                update(item.id, { stage: 'translating' });
                const translated = await abortable(translate(segments, signal, translationProgress => update(item.id, { translationProgress })), signal);
                if (signal.aborted) break;
                segments = translated.segments;
                if (translated.failed) {
                    update(item.id, { stage: 'failed', error: 'translation_partial', englishFallback: content, fallbackSegments: segments, fallbackSource: readMeta ? readMeta.source : item.fallbackSource, fallbackSourceIssue: readMeta ? readMeta.sourceIssue : item.fallbackSourceIssue, translationProgress: undefined });
                    continue;
                }
            }
            // Freeze copies, never objects owned by a parser or another source.
            const frozenSegments = segments.map(segment => Object.freeze({ ...segment }));
            Object.freeze(frozenSegments);
            const draft = Object.freeze({ operation_id: item.id, name: preparedContent?.document.display_name ?? item.name, content, segments: frozenSegments, source: snapshotSource(readMeta ? readMeta.source : item.fallbackSource), sourceIssue: readMeta ? readMeta.sourceIssue : item.fallbackSourceIssue,
                wordCount: segments.reduce((count, segment) => count + (segment.en_text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)?.length ?? 0), 0),
                youtubeSelection: item.youtubeSelection ? Object.freeze({ ...item.youtubeSelection }) : undefined,
                ...(extraction ? {document: freezeDocument(extraction.document), normalized_kind: extraction.normalized_kind} : {}) });
            update(item.id, { ...(preparedContent ? { name: draft.name, title: draft.name } : {}), stage: 'ready', draft, extraction, englishFallback: undefined, fallbackSegments: undefined, translationProgress: undefined });
        } catch (error) {
            if (signal.aborted) break;
            const known = materialError(error);
            const reason = known === 'failed' ? parsing ? 'parse_failed' : item.kind === 'youtube' ? 'download_failed' : 'read_failed' : known;
            update(item.id, { stage: 'failed', error: reason });
        }
    }
}

/** Commit has no reader/parser. Stop waits for the current transaction receipt. */
export async function commitImportQueue(items: ImportItem[], signal: AbortSignal, update: Update, write: ImportIO['write']) {
    for (const item of items) {
        const draft = item.draft;
        if (!draft) continue;
        if (signal.aborted) { update(item.id, { stage: 'cancelled' }); continue; }
        update(item.id, { stage: 'writing', error: undefined });
        try {
            const result = await write({ operation_id: draft.operation_id, name: draft.name, content: draft.content, segments: draft.segments, ...(draft.source ? { source: draft.source } : {}), ...(draft.document ? { document: draft.document, normalized_kind: draft.normalized_kind } : {}) });
            update(item.id, { stage: result.outcome, result });
            useMaterialStore.getState().changed();
            if (draft.source?.audio && result.readable) {
                // Independent of the subtitle queue/timeout; no automatic playback.
                void invoke<ReadingMaterial>('open_reading_material', { fileId: result.file_id }).then(data => {
                    const first = Object.entries(data.media_refs ?? {})[0];
                    if (first) void useSourceMediaStore.getState().prepare(first[1], { segment_id: Number(first[0]) });
                }).catch(() => {});
            }
            if (result.outcome === 'created' && draft.youtubeSelection)
                usePreferencesStore.getState().recordYouTubeImport(draft.youtubeSelection);
        } catch (error) {
            // A missing receipt may mean committed. Never turn it into cancelled.
            update(item.id, { stage: 'failed', error: materialError(error) });
        }
    }
}

let controller: AbortController | null = null;
let generation = 0;
let pickerGeneration = 0;
let rangeGeneration = 0;
let jobSequence = Date.now();
const empty = { items: [] as ImportItem[], phase: 'source' as ImportPhase, source: 'choose' as 'choose' | 'file' | 'youtube', selectedId: null as string | null,
    running: false, stopping: false, destination: null as number | 'materials' | null, pickerError: false, picking: false, selectionBusy: null as string | null };
function abandonPreparation() {
    generation++;
    rangeGeneration++;
    pickerGeneration++;
    controller?.abort();
    controller = null;
}
export const useImportStore = create<{
    open: boolean;
    items: ImportItem[];
    phase: ImportPhase;
    source: 'choose' | 'file' | 'youtube';
    selectedId: string | null;
    running: boolean;
    stopping: boolean;
    picking: boolean;
    destination: number | 'materials' | null;
    pickerError: boolean;
    selectionBusy: string | null;
    selectRange: (id: string, selection: DocumentSelection) => Promise<void>;
    show: () => void;
    hide: () => void;
    changeSource: (source?: 'choose' | 'file' | 'youtube') => void;
    select: (id: string) => void;
    clearDestination: () => void;
    start: (sources: ImportSource[]) => Promise<void>;
    choose: () => Promise<void>;
    fromContent: (kind: 'clipboard' | 'webpage', value: string) => Promise<void>;
    renameDraft: (id: string, title: string) => void;
    cancel: () => void;
    retry: () => Promise<void>;
    confirm: () => Promise<void>;
    useEnglish: (id: string) => Promise<void>;
    fromYouTube: (input: { url: string; title: string; primary: TrackSelection; secondary: TrackSelection | null }) => Promise<void>;
}>((set, get) => {
    const update: Update = (id, patch) => set(state => ({ items: state.items.map(item => item.id === id ? { ...item, ...patch } : item) }));
    const prepare = async (items: ImportItem[], all = items) => {
        abandonPreparation();
        const token = generation;
        const active = new AbortController();
        controller = active;
        set({ open: true, phase: 'preparing', running: true, stopping: false, items: all, selectedId: null, destination: null, pickerError: false, picking: false, selectionBusy: null });
        await prepareImportQueue(items, active.signal, (id, patch) => { if (token === generation) update(id, patch); }, parseSrtInWorker, translateImportSegments);
        if (token !== generation) return;
        controller = null;
        set({ running: false, phase: 'preview', selectedId: get().items.find(item => item.draft)?.id ?? null });
    };
    const commit = async (items: ImportItem[]) => {
        if (get().running || get().selectionBusy || !items.length) return;
        // Lock synchronously, before the first await: double clicks cannot submit twice.
        pickerGeneration++;
        const active = new AbortController();
        controller = active;
        set({ phase: 'committing', running: true, stopping: false, picking: false, destination: null });
        await commitImportQueue(items, active.signal, update, input => invoke('import_reading_material', { input }));
        const current = get().items;
        set({ running: false, stopping: false, phase: 'result', destination: active.signal.aborted ? null :
            current.length === 1 && current[0].stage === 'created' ? current[0].result!.file_id :
            current.length > 1 && current.some(item => item.stage === 'created') ? 'materials' : null });
        if (controller === active) controller = null;
    };
    return {
        open: false, ...empty,
        show: () => set({ open: true }),
        clearDestination: () => set({ destination: null }),
        hide: () => {
            if (get().phase === 'committing' || get().phase === 'result' && get().items.some(item => item.draft && ['failed', 'cancelled'].includes(item.stage))) set({ open: false, destination: null });
            else { abandonPreparation(); set({ ...empty, open: false }); }
        },
        changeSource: (source = 'choose') => {
            if (get().phase === 'committing') return;
            abandonPreparation(); set({ ...empty, open: true, source });
        },
        select: selectedId => set({ selectedId }),
        selectRange: async (id, selection) => {
            if (get().running || get().selectionBusy || get().phase !== 'preview') return;
            const item = get().items.find(row => row.id === id);
            if (!item?.extraction || !item.draft) return;
            const token = ++rangeGeneration;
            set({ selectionBusy: id });
            try {
                const selected = await selectDocumentRange(item.extraction, selection);
                if (token !== rangeGeneration || !get().open || get().phase !== 'preview') return;
                const segments = selected.segments.map(segment => Object.freeze({...segment}));
                Object.freeze(segments);
                const draft = Object.freeze({...item.draft, operation_id: crypto.randomUUID(), content: selected.content,
                    segments, document: freezeDocument(selected.document), normalized_kind: selected.normalized_kind,
                    wordCount: segments.reduce((count, segment) => count + (segment.en_text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)?.length ?? 0), 0)});
                update(id, {draft, error: undefined});
            } catch (error) {
                if (token === rangeGeneration) update(id, {error: materialError(error)});
            } finally { if (token === rangeGeneration) set({selectionBusy: null}); }
        },
        start: async sources => {
            if (get().phase === 'committing' || !sources.length) return;
            await prepare(sources.map(source => ({ ...source, id: crypto.randomUUID(), stage: 'queued' })));
        },
        fromContent: async (kind, value) => {
            await get().start([{kind, name: kind === 'clipboard' ? clipboardTitle(value) : value, capturedText: kind === 'clipboard' ? value : undefined, url: kind === 'webpage' ? value : undefined, read: async () => value}]);
        },
        renameDraft: (id, title) => {
            if (get().phase !== 'preview' || get().running) return;
            const item = get().items.find(item => item.id === id);
            const doc = item?.draft?.document;
            if (!item?.draft || !doc?.origin || !title.trim() || [...title].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127) || new TextEncoder().encode(title).length > 1024) return;
            const document = freezeDocument({...doc, display_name: title, origin: {...doc.origin, title}});
            update(id, {name: title, title, draft: Object.freeze({...item.draft, name: title, document})});
        },
        choose: async () => {
            if (get().running || get().picking) return;
            const token = ++pickerGeneration;
            set({ picking: true, pickerError: false });
            try {
                const paths = await open(materialPickerOptions());
                if (token !== pickerGeneration || !paths) return;
                await get().start((Array.isArray(paths) ? paths : [paths]).map(path => pickedMaterialSource(path, readDocumentFile)));
            } catch { if (token === pickerGeneration) set({ pickerError: true }); }
            finally { if (token === pickerGeneration) set({ picking: false }); }
        },
        fromYouTube: async input => {
            if (get().running) return;
            const name = input.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) + '.srt';
            await get().start([{ name, title: input.title, url: input.url, kind: 'youtube',
                youtubeSelection: { primary: trackLanguage(input.primary), secondary: input.secondary ? trackLanguage(input.secondary) : null },
                read: async signal => {
                    const job = ++jobSequence;
                    const abort = () => { void useYoutubeStore.getState().cancelJob(job).catch(() => {}); };
                    signal.addEventListener('abort', abort, { once: true });
                    try {
                        const prepared = await useYoutubeStore.getState().prepareSubtitles(job, input.url, input.primary, input.secondary,
                            usePreferencesStore.getState().youtube.browserSession ?? EMPTY_BROWSER_SESSION);
                        return prepared.status === 'partial' ? { content: prepared.primary.content, translationFailed: true, source: prepared.primary.source, sourceIssue: prepared.primary.source_issue } : { content: prepared.subtitle.content, source: prepared.subtitle.source, sourceIssue: prepared.subtitle.source_issue };
                    } finally { signal.removeEventListener('abort', abort); }
                } }]);
        },
        useEnglish: async id => {
            if (get().running || get().phase !== 'preview') return;
            const item = get().items.find(row => row.id === id);
            if (item?.englishFallback === undefined) return;
            const content = item.englishFallback;
            const next: ImportItem = { ...item, stage: 'queued', error: undefined, englishFallback: undefined,
                preparedSegments: item.fallbackSegments, skipTranslation: true,
                youtubeSelection: item.youtubeSelection ? { primary: item.youtubeSelection.primary, secondary: null } : undefined, read: async () => content };
            await prepare([next], get().items.map(row => row.id === id ? next : row));
        },
        confirm: async () => {
            if (get().phase !== 'preview') return;
            await commit(get().items.filter(item => item.stage === 'ready' && item.draft));
        },
        cancel: () => {
            if (get().phase === 'committing') { set({ stopping: true }); controller?.abort(); }
            else { abandonPreparation(); set({ ...empty, open: true }); }
        },
        retry: async () => {
            if (get().running) return;
            if (get().phase === 'result') {
                await commit(get().items.filter(item => item.draft && ['failed', 'cancelled'].includes(item.stage)));
            } else if (get().phase === 'preview') {
                const items = get().items.filter(item => item.stage === 'failed' && (item.englishFallback === undefined || item.fallbackSegments)).map(item => ({ ...item, stage: 'queued' as const, error: undefined,
                    ...(item.fallbackSegments ? { preparedSegments: item.fallbackSegments, read: async () => item.englishFallback! } : {}) }));
                if (items.length) await prepare(items, get().items.map(item => items.find(next => next.id === item.id) ?? item));
            }
        },
    };
});
