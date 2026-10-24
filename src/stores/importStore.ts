import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { materialError, parseSrtInWorker, type MaterialImportResult } from '../lib/materials';
import type { SegmentInput } from '../lib/types';
import { useMaterialStore } from './materialStore';
import { useYoutubeStore, type TrackSelection } from './youtubeStore';
import { usePreferencesStore } from './preferencesStore';
import { EMPTY_BROWSER_SESSION } from '../lib/youtubeDownload';
import { materialPickerOptions, pickedMaterialSource } from '../lib/importPicker';
export type ImportStage = 'queued' | 'downloading' | 'reading' | 'parsing' | 'writing' | 'created' | 'duplicate' | 'failed' | 'cancelled';
export interface ImportSource {
    name: string;
    kind?: 'file' | 'youtube';
    read: () => Promise<string>;
}
export interface ImportItem extends ImportSource {
    id: string;
    stage: ImportStage;
    error?: string;
    result?: MaterialImportResult;
}
export interface ImportIO {
    parse: (content: string, signal: AbortSignal) => Promise<SegmentInput[]>;
    write: (input: {
        operation_id: string;
        name: string;
        content: string;
        segments: SegmentInput[];
    }) => Promise<MaterialImportResult>;
}
export async function runImportQueue(items: ImportItem[], signal: AbortSignal, update: (id: string, patch: Partial<ImportItem>) => void, io: ImportIO) {
    for (const item of items) {
        let writing = false;
        let parsing = false;
        if (signal.aborted) {
            update(item.id, { stage: 'cancelled' });
            continue;
        }
        try {
            if (!item.name.toLowerCase().endsWith('.srt'))
                throw new Error('material_invalid_srt');
            update(item.id, { stage: item.kind === 'youtube' ? 'downloading' : 'reading', error: undefined });
            const content = await item.read();
            if (signal.aborted) {
                update(item.id, { stage: 'cancelled' });
                continue;
            }
            update(item.id, { stage: 'parsing' });
            parsing = true;
            const segments = await io.parse(content, signal);
            if (signal.aborted) {
                update(item.id, { stage: 'cancelled' });
                continue;
            }
            update(item.id, { stage: 'writing' });
            writing = true;
            // Never report a committed file as cancelled. Stop applies after this receipt.
            const result = await io.write({ operation_id: item.id, name: item.name, content, segments });
            update(item.id, { stage: result.outcome, result });
            useMaterialStore.getState().changed();
        }
        catch (error) {
            const known=materialError(error);const reason=known==='failed'&&!writing?(item.kind==='youtube'?'download_failed':parsing?'parse_failed':'read_failed'):known;
            update(item.id, { stage: signal.aborted && !writing ? 'cancelled' : 'failed', error: reason });
        }
    }
}
let controller: AbortController | null = null;
let downloadJob: number | null = null;
export const useImportStore = create<{
    open: boolean;
    items: ImportItem[];
    running: boolean;
    stopping: boolean;
    destination: number | 'materials' | null;
    pickerError: boolean;
    show: () => void;
    hide: () => void;
    clearDestination: () => void;
    start: (sources: ImportSource[], retry?: boolean) => Promise<void>;
    choose: () => Promise<void>;
    cancel: () => void;
    retry: () => Promise<void>;
    fromYouTube: (input: {
        url: string;
        title: string;
        primary: TrackSelection;
        secondary: TrackSelection | null;
    }) => Promise<void>;
}>((set, get) => ({
    open: false, items: [], running: false, stopping: false, destination: null, pickerError: false,
    show: () => set({ open: true }), clearDestination: () => set({ destination: null }), hide: () => set({ open: false, destination: null }),
    start: async (sources, retry = false) => {
        if (get().running)
            return;
        const items = retry ? get().items.filter(item => ['failed', 'cancelled'].includes(item.stage)).map(item => ({ ...item, stage: 'queued' as const, error: undefined })) : sources.map(source => ({ ...source, id: crypto.randomUUID(), stage: 'queued' as const }));
        if (!items.length)
            return;
        controller = new AbortController();
        const active = controller;
        const all = retry ? get().items.map(item => items.find(next => next.id === item.id) ?? item) : items;
        set({ open: true, running: true, stopping: false, items: all, destination: null, pickerError: false });
        const update = (id: string, patch: Partial<ImportItem>) => set(state => ({ items: state.items.map(item => item.id === id ? { ...item, ...patch } : item) }));
        await runImportQueue(items, active.signal, update, { parse: parseSrtInWorker, write: input => invoke('import_reading_material', { input }) });
        const current = get().items;
        set({ running: false, stopping: false, destination: active.signal.aborted ? null : current.length === 1 && current[0].stage === 'created' ? current[0].result!.file_id : current.length > 1 && current.some(item => item.stage === 'created') ? 'materials' : null });
        if (controller === active)
            controller = null;
    },
    choose: async () => {
        if (get().running)
            return;
        try {
            const paths = await open(materialPickerOptions());
            if (!paths)
                return;
            await get().start((Array.isArray(paths) ? paths : [paths]).map(path => pickedMaterialSource(path,readTextFile)));
        }
        catch {
            set({ pickerError: true });
        }
    },
    fromYouTube: async (input) => {
        if (get().running)
            return;
        const name = input.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) + '.srt';
        let englishFallback: string | null = null;
        await get().start([{ name, kind: 'youtube', read: async () => {
                    if (englishFallback !== null)
                        return englishFallback;
                    const job = Date.now();
                    downloadJob = job;
                    try {
                        const prepared = await useYoutubeStore.getState().prepareSubtitles(job, input.url, input.primary, input.secondary, usePreferencesStore.getState().youtube.browserSession ?? EMPTY_BROWSER_SESSION);
                        if (prepared.status === 'partial') {
                            englishFallback = prepared.primary.content;
                            throw new Error('material_translation_partial');
                        }
                        return prepared.subtitle.content;
                    }
                    catch (error) {
                        if (String(error).includes('material_translation_partial'))
                            throw error;
                        throw new Error('material_download_failed');
                    }
                    finally {
                        if (downloadJob === job)
                            downloadJob = null;
                    }
                } }]);
        if (get().items[0]?.stage === 'created')
            usePreferencesStore.getState().recordYouTubeImport({ primary: 'en', secondary: input.secondary ? 'zh' : null });
    },
    cancel: () => { if (controller) {
        set({ stopping: true });
        controller.abort();
        if (downloadJob !== null)
            void useYoutubeStore.getState().cancelJob(downloadJob).catch(() => { });
    } },
    retry: () => get().start([], true),
}));
