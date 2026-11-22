import { create } from 'zustand';
import { useRestoreGuard } from './restoreGuard';
import { useFeedbackStore } from './feedbackStore';
import i18n from '../i18n';
import { prepareContent, prepareYouTube } from '../lib/contentImport';
import type { YoutubeSource } from '../lib/sourceMedia';
import { clipboardTitle } from '../lib/clipboardContent';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { materialPackageCover, readMaterialPackage } from '../lib/materialPackage';
import { readDocumentFile } from '../lib/readDocumentFile';
import { extractDocument, selectDocumentRange } from '../lib/documentImport';
import type { DocumentSource, DocumentSelection, ExtractedDocument } from '../lib/documentTypes';
import { materialError, parseSrtInWorker, type MaterialImportResult } from '../lib/materials';
import type { SegmentInput, TagSelection } from '../lib/types';
import { useMaterialStore } from './materialStore';
import { materialPickerOptions, pickedMaterialSource } from '../lib/importPicker';
import { translateImportSegments, type ImportTranslationResult, type TranslationProgress } from '../lib/importTranslation';

export type ImportStage = 'queued' | 'reading' | 'parsing' | 'translating' | 'ready' | 'writing' | 'created' | 'duplicate' | 'failed' | 'cancelled';
export type ImportPhase = 'source' | 'preparing' | 'preview' | 'committing' | 'result';
export interface ImportSource {
    name: string;
    kind?: 'file' | 'clipboard' | 'webpage' | 'youtube';
    capturedText?: string;
    title?: string;
    url?: string;
    preparedSegments?: SegmentInput[];
    youtube?: YoutubeSource;
    youtubeCoverData?: string | null;
    youtubeAudioUnavailable?: boolean;
    packageCover?: Uint8Array;
    packageAudio?: Uint8Array;
    skipTranslation?: boolean;
    read: (signal: AbortSignal) => Promise<string | Uint8Array>;
}
/** A preview and its write share this immutable snapshot, including its operation id. */
export interface ImportDraft {
    readonly operation_id: string;
    readonly name: string;
    readonly content: string;
    readonly segments: SegmentInput[];
    readonly wordCount: number;
    readonly document?: DocumentSource;
    readonly normalized_kind?: 'txt' | 'srt';
    readonly source?: YoutubeSource;
}
export interface ImportItem extends ImportSource {
    id: string;
    stage: ImportStage;
    error?: string;
    draft?: ImportDraft;
    extraction?: ExtractedDocument;
    englishFallback?: string;
    fallbackSegments?: SegmentInput[];
    translationProgress?: TranslationProgress;
    result?: MaterialImportResult;
}
type ImportWrite = Pick<ImportDraft, 'operation_id' | 'name' | 'content' | 'segments' | 'document' | 'normalized_kind' | 'source'>;
export interface ImportIO {
    parse: (content: string, signal: AbortSignal, name?: string) => Promise<SegmentInput[]>;
    translate?: (segments: SegmentInput[], signal: AbortSignal, progress: (value: TranslationProgress) => void) => Promise<ImportTranslationResult>;
    write: (input: ImportWrite, audio?: Uint8Array) => Promise<MaterialImportResult>;
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
            update(item.id, { stage: 'reading', error: undefined });
            const reusing = !!item.preparedSegments;
            const captions = item.kind === 'youtube' && !reusing ? await abortable(prepareYouTube(item.url!, item.id, signal), signal) : undefined;
            const youtube = captions?.source ?? item.youtube;
            const presentation = youtube ? {
                youtube, youtubeCoverData: captions ? captions.cover : item.youtubeCoverData,
                youtubeAudioUnavailable: captions ? captions.audio_unavailable : item.youtubeAudioUnavailable,
            } : {};
            const title = youtube?.title || youtube?.video_id;
            const name = title ? `${title.replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').slice(0, 200)}.srt` : item.name;
            const preparedContent = contentKind && !reusing ? await abortable(prepareContent(contentKind, contentKind === 'webpage' ? item.url! : item.capturedText!, signal), signal) : undefined;
            const read = captions?.content ?? preparedContent?.content ?? await abortable(item.read(signal), signal);
            if (signal.aborted) break;
            if (!reusing && !contentKind && !(read instanceof Uint8Array) && !/\.(txt|srt)$/i.test(item.name)) throw new Error('material_invalid_format');
            update(item.id, { stage: 'parsing' });
            parsing = true;
            let extraction = preparedContent ?? (reusing ? item.extraction : read instanceof Uint8Array ? await extractDocument(read, item.name, signal) : undefined);
            if (item.packageCover && extraction && !extraction.document.cover) {
                try {
                    const cover = await abortable(materialPackageCover(item.packageCover), signal);
                    extraction = { ...extraction, document: { ...extraction.document, cover } };
                } catch {
                    if (signal.aborted) break;
                    extraction = { ...extraction, document: { ...extraction.document, extraction_status: 'partial',
                        warnings: [...extraction.document.warnings, '封面无法读取。 / The cover could not be read.'] } };
                }
            }
            const content = extraction?.content ?? (typeof read === 'string' ? read : '');
            let segments = item.preparedSegments ?? extraction?.segments ?? await parse(content, signal, name);
            if (signal.aborted) break;
            if (translate && !item.skipTranslation && segments.some(segment => !segment.zh_text?.trim())) {
                update(item.id, { stage: 'translating' });
                const translated = await abortable(translate(segments, signal, translationProgress => update(item.id, { translationProgress })), signal);
                if (signal.aborted) break;
                segments = translated.segments;
                if (translated.failed) {
                    update(item.id, { ...presentation, stage: 'failed', error: 'translation_partial', englishFallback: content, fallbackSegments: segments, extraction, translationProgress: undefined });
                    continue;
                }
            }
            // Freeze copies, never objects owned by a parser or another source.
            const frozenSegments = segments.map(segment => Object.freeze({ ...segment }));
            Object.freeze(frozenSegments);
            const draft = Object.freeze({ operation_id: item.id, name: extraction?.document.display_name ?? name, content, segments: frozenSegments,
                wordCount: segments.reduce((count, segment) => count + (segment.en_text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)?.length ?? 0), 0),
                ...(youtube ? { source: youtube } : {}),
                ...(extraction ? {document: freezeDocument(extraction.document), normalized_kind: extraction.normalized_kind} : {}) });
            update(item.id, { ...presentation, ...(preparedContent || youtube ? { name: draft.name, title: title ?? draft.name } : {}), stage: 'ready', draft, extraction: extraction ? {...extraction, segments} : undefined, englishFallback: undefined, fallbackSegments: undefined, translationProgress: undefined });
        } catch (error) {
            if (signal.aborted) break;
            const known = materialError(error);
            const reason = known === 'failed' ? parsing ? 'parse_failed' : 'read_failed' : known;
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
            const result = await write({ operation_id: draft.operation_id, name: draft.name, content: draft.content, segments: draft.segments, ...(draft.document ? { document: draft.document, normalized_kind: draft.normalized_kind } : {}), ...(draft.source ? { source: draft.source } : {}) }, item.packageAudio);
            update(item.id, { stage: result.outcome, result });
            useMaterialStore.getState().changed();
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
const noImportTags: TagSelection = { tagIds: [], newTagNames: [] };
const empty = { importTags: noImportTags, items: [] as ImportItem[], phase: 'source' as ImportPhase, selectedId: null as string | null,
    running: false, stopping: false, destination: null as number | 'materials' | null, pickerError: false, picking: false, selectionBusy: null as string | null };
function abandonPreparation() {
    generation++;
    rangeGeneration++;
    pickerGeneration++;
    controller?.abort();
    controller = null;
}

function discardYouTubeAudio(items: ImportItem[]) {
    for (const item of items) {
        if (item.kind === 'youtube') {
            void invoke('discard_youtube_import_audio', { operationId: item.id }).catch(() => {});
        }
    }
}
export const useImportStore = create<{
    open: boolean;
    items: ImportItem[];
    phase: ImportPhase;
    selectedId: string | null;
    running: boolean;
    stopping: boolean;
    picking: boolean;
    destination: number | 'materials' | null;
    pickerError: boolean;
    selectionBusy: string | null;
    importTags: TagSelection;
    setImportTags: (selection: TagSelection) => void;
    selectRange: (id: string, selection: DocumentSelection) => Promise<void>;
    show: () => void;
    showLink: () => void;
    hide: () => void;
    select: (id: string) => void;
    clearDestination: () => void;
    start: (sources: ImportSource[]) => Promise<void>;
    choose: () => Promise<void>;
    fromContent: (kind: 'clipboard' | 'webpage' | 'youtube', value: string) => Promise<void>;
    renameDraft: (id: string, title: string) => void;
    cancel: () => void;
    retry: () => Promise<void>;
    confirm: () => Promise<void>;
    usePackageText: (id: string) => Promise<void>;
    useEnglish: (id: string) => Promise<void>;
}>((set, get) => {
    const update: Update = (id, patch) => set(state => ({ items: state.items.map(item => item.id === id ? { ...item, ...patch } : item) }));
    const prepare = async (items: ImportItem[], all = items) => {
        abandonPreparation();
        const token = generation;
        const active = new AbortController();
        controller = active;
        set({ open: true, phase: 'preparing', running: true, stopping: false, items: all, selectedId: null, destination: null, pickerError: false, picking: false, selectionBusy: null });
        const expanded: ImportItem[] = [];
        let nextItems = all;
        for (const item of items) {
            if (active.signal.aborted) return;
            if (!/\.zip$/i.test(item.name) || item.kind && item.kind !== 'file') {
                expanded.push(item);
                continue;
            }
            update(item.id, { stage: 'reading' });
            try {
                const bytes = await abortable(item.read(active.signal), active.signal);
                if (!(bytes instanceof Uint8Array)) throw new Error('material_invalid_document');
                update(item.id, { stage: 'parsing' });
                const members = await readMaterialPackage(bytes, active.signal);
                if (token !== generation) return;
                const sources: ImportItem[] = members.map(member => ({
                    id: crypto.randomUUID(), stage: 'queued', kind: 'file', name: member.name,
                    read: async () => member.document, packageCover: member.cover, packageAudio: member.audio,
                }));
                expanded.push(...sources);
                nextItems = nextItems.flatMap(row => row.id === item.id ? sources : [row]);
                set({ items: nextItems });
            } catch (error) {
                if (token !== generation) return;
                const failed: ImportItem = { ...item, stage: 'failed', error: materialError(error) };
                nextItems = nextItems.map(row => row.id === item.id ? failed : row);
                update(item.id, failed);
            }
        }
        await prepareImportQueue(expanded, active.signal, (id, patch) => { if (token === generation) update(id, patch); }, parseSrtInWorker, translateImportSegments);
        if (token !== generation) return;
        controller = null;
        set({ running: false, phase: 'preview', selectedId: get().items.find(item => item.draft)?.id ?? null });
    };
    const commit = async (items: ImportItem[]) => {
        if (useRestoreGuard.getState().active) { useFeedbackStore.getState().show(i18n.t('fileStore.restoreInProgress'), 'error'); return; }
        if (get().running || get().selectionBusy || !items.length) return;
        // Lock synchronously, before the first await: double clicks cannot submit twice.
        pickerGeneration++;
        const active = new AbortController();
        controller = active;
        set({ phase: 'committing', running: true, stopping: false, picking: false, destination: null });
        const { tagIds, newTagNames } = get().importTags;
        await commitImportQueue(items, active.signal, update, async (input, audio) => {
            const request = { ...input, ...(tagIds.length ? { tag_ids: tagIds } : {}), ...(newTagNames.length ? { new_tag_names: newTagNames } : {}) };
            if (!audio) return invoke('import_reading_material', { input: request });
            const operationId = input.operation_id;
            try {
                const size = 1024 * 1024;
                for (let offset = 0; offset < audio.length; offset += size) {
                    const bytes = audio.subarray(offset, offset + size);
                    let binary = '';
                    for (let i = 0; i < bytes.length; i += 8192)
                        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
                    await invoke('upload_local_material_audio', { operationId, offset, chunk: btoa(binary) });
                }
                return await invoke('import_material_with_local_audio', { input: request });
            } finally {
                await invoke('discard_local_material_audio', { operationId }).catch(() => {});
            }
        });
        const current = get().items;
        // A hidden write still owns its receipt and refreshes the catalog, but
        // must not leave a deferred navigation that fires on the next opening.
        set({ running: false, stopping: false, phase: 'result', destination: active.signal.aborted || !get().open ? null :
            current.length === 1 && current[0].stage === 'created' ? current[0].result!.file_id :
            current.length > 1 && current.some(item => item.stage === 'created') ? 'materials' : null });
        if (controller === active) controller = null;
    };
    return {
        open: false, ...empty,
        setImportTags: importTags => { if (!get().running && get().phase === 'preview') set({ importTags }); },
        show: () => { if (get().phase !== 'source') set({ open: true }); },
        showLink: () => {
            if (!get().running && !get().picking) {
                discardYouTubeAudio(get().items);
                set({ ...empty, open: true });
            }
        },
        clearDestination: () => set({ destination: null }),
        hide: () => {
            if (get().phase === 'committing' || get().phase === 'result' && get().items.some(item => item.draft && ['failed', 'cancelled'].includes(item.stage))) set({ open: false, destination: null });
            else { abandonPreparation(); discardYouTubeAudio(get().items); set({ ...empty, open: false }); }
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
            discardYouTubeAudio(get().items);
            set({importTags:noImportTags});
            await prepare(sources.map(source => ({ ...source, id: crypto.randomUUID(), stage: 'queued' })));
        },
        fromContent: async (kind, value) => {
            if(get().running)return;
            set({importTags:noImportTags});
            await prepare([{id:crypto.randomUUID(),stage:'queued',kind, name: kind === 'youtube' ? 'YouTube.srt' : kind === 'clipboard' ? clipboardTitle(value) : value, capturedText: kind === 'clipboard' ? value : undefined, url: kind === 'clipboard' ? undefined : value, read: async () => value}]);
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
            } catch { if (token === pickerGeneration) { set({ pickerError: true }); useFeedbackStore.getState().show(i18n.t('materials.importDialog.pickerFailed'),'error'); } }
            finally { if (token === pickerGeneration) set({ picking: false }); }
        },
        useEnglish: async id => {
            if (get().running || get().phase !== 'preview') return;
            const item = get().items.find(row => row.id === id);
            if (item?.englishFallback === undefined) return;
            const content = item.englishFallback;
            const next: ImportItem = { ...item, stage: 'queued', error: undefined, englishFallback: undefined,
                preparedSegments: item.fallbackSegments, skipTranslation: true,
                read: async () => content };
            await prepare([next], get().items.map(row => row.id === id ? next : row));
        },
        usePackageText: async id => {
            if (get().running || get().phase !== 'result') return;
            const item = get().items.find(row => row.id === id);
            if (!item?.draft || item.error !== 'package_audio') return;
            const next = { ...item, packageAudio: undefined, draft: Object.freeze({ ...item.draft, operation_id: crypto.randomUUID() }) };
            update(id, { packageAudio: undefined, draft: next.draft });
            await commit([next]);
        },
        confirm: async () => {
            if (get().phase !== 'preview') return;
            await commit(get().items.filter(item => item.stage === 'ready' && item.draft));
        },
        cancel: () => {
            if (get().phase === 'committing') { set({ stopping: true }); controller?.abort(); }
            else { abandonPreparation(); discardYouTubeAudio(get().items); set({ ...empty, open: false }); }
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
