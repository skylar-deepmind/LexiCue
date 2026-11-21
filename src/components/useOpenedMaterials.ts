import { useEffect } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { pickedMaterialSource } from '../lib/importPicker';
import { isIOSPlatform, isMobilePlatform } from '../lib/platform';
import { readDocumentFile } from '../lib/readDocumentFile';
import { useImportStore } from '../stores/importStore';

export default function useOpenedMaterials() {
    useEffect(() => {
        if (!isMobilePlatform() || !isTauri()) return;
        const ios = isIOSPlatform();
        const bridge = (window as Window & {
            LexiCueSystemUi?: { takeOpenedDocuments?: () => string };
        }).LexiCueSystemUi;
        let disposed = false;
        let reading = false;
        let requested = false;
        let off: (() => void) | undefined;
        const drain = async () => {
            requested = true;
            const state = useImportStore.getState();
            if (disposed || reading || state.running || state.picking || (state.open && state.phase !== 'source')) return;
            requested = false;
            reading = true;
            try {
                const paths = ios
                    ? await invoke<string[]>('take_opened_documents')
                    : JSON.parse(bridge?.takeOpenedDocuments?.() ?? '[]') as string[];
                if (!disposed && paths.length) {
                    const current = useImportStore.getState();
                    // The OS can deliver another file while a draft is open.
                    // Do not replace that draft or interrupt a database write.
                    pending.push(...paths);
                    if (!current.running && !current.picking && (!current.open || current.phase === 'source')) {
                        void current.start(pending.splice(0).map(path => pickedMaterialSource(path, readDocumentFile)));
                    }
                }
            } catch (error) {
                console.warn('Could not receive opened documents', error);
            } finally {
                reading = false;
                if (requested) void drain();
            }
        };
        const pending: string[] = [];
        const stop = useImportStore.subscribe(state => {
            if (state.running || state.picking || (state.open && state.phase !== 'source')) return;
            if (pending.length) void state.start(pending.splice(0).map(path => pickedMaterialSource(path, readDocumentFile)));
            else if (requested) void drain();
        });
        const request = () => { void drain(); };
        if (ios) {
            void listen('lexicue-open-documents', request).then(unlisten => {
                if (disposed) unlisten();
                else { off = unlisten; request(); }
            }).catch(() => request());
        } else {
            window.addEventListener('lexicue-open-documents', request);
            request();
        }
        return () => {
            disposed = true;
            stop();
            off?.();
            window.removeEventListener('lexicue-open-documents', request);
        };
    }, []);
}
