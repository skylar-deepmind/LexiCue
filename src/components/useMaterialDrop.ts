import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readDocumentFile } from '../lib/readDocumentFile';
import { DOCUMENT_LIMITS } from '../lib/documentTypes';
import { pickedMaterialSource } from '../lib/importPicker';
import { isMobilePlatform } from '../lib/platform';
import { useImportStore } from '../stores/importStore';

export default function useMaterialDrop() {
    const [dragging, setDragging] = useState(false);
    useEffect(() => {
        if (isMobilePlatform()) return;
        const start = useImportStore.getState().start;
        const canDrop = () => {
            const state = useImportStore.getState();
            return !state.running && !state.picking;
        };
        const browserDrag = (event: DragEvent) => {
            if (!event.dataTransfer?.types.includes('Files')) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = canDrop() ? 'copy' : 'none';
            setDragging(canDrop());
        };
        const leave = (event: DragEvent) => {
            if (!event.relatedTarget) setDragging(false);
        };
        const browserDrop = (event: DragEvent) => {
            if (!event.dataTransfer?.files.length) return;
            event.preventDefault();
            setDragging(false);
            if (!canDrop()) return;
            void start(Array.from(event.dataTransfer.files, file => ({
                name: file.name,
                async read(signal: AbortSignal) {
                    if (file.size > DOCUMENT_LIMITS.binaryBytes) throw new Error('material_too_large');
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    if (signal.aborted) throw new Error('material_cancelled');
                    return bytes;
                },
            })));
        };
        // Native drops grant read access to the dropped paths. DOM file events
        // are the fallback for web previews and builds with native drag disabled.
        window.addEventListener('dragover', browserDrag);
        window.addEventListener('dragleave', leave);
        window.addEventListener('drop', browserDrop);
        let disposed = false;
        let off: (() => void) | undefined;
        if (isTauri()) {
            void Promise.resolve().then(() => getCurrentWindow().onDragDropEvent(({ payload }) => {
                if (disposed) return;
                if (payload.type === 'enter' || payload.type === 'over') setDragging(canDrop());
                else setDragging(false);
                if (payload.type === 'drop' && canDrop()) {
                    void start(payload.paths.map(path => pickedMaterialSource(path, readDocumentFile)));
                }
            })).then(unlisten => { if (disposed) unlisten(); else off = unlisten; }).catch(() => {});
        }
        return () => {
            disposed = true;
            off?.();
            window.removeEventListener('dragover', browserDrag);
            window.removeEventListener('dragleave', leave);
            window.removeEventListener('drop', browserDrop);
        };
    }, []);
    return dragging;
}
