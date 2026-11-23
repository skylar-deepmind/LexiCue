import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readDocumentFile } from '../lib/readDocumentFile';
import { DOCUMENT_LIMITS } from '../lib/documentTypes';
import { pickedMaterialSource } from '../lib/importPicker';
import { isMobilePlatform } from '../lib/platform';
import { useImportStore, type ImportSource } from '../stores/importStore';

export type MaterialDropPoint = { x: number; y: number };

export default function useMaterialDrop() {
    const [dragging, setDragging] = useState(false);
    const dropOrigin = useRef<MaterialDropPoint | null>(null);
    useEffect(() => {
        if (isMobilePlatform()) return;
        const start = useImportStore.getState().start;
        const canDrop = () => {
            const state = useImportStore.getState();
            return !state.running && !state.picking && !state.selectionBusy;
        };
        const resetDrag = () => setDragging(false);
        const importDrop = (sources: ImportSource[], origin: MaterialDropPoint) => {
            resetDrag();
            if (!sources.length || !canDrop()) return;
            dropOrigin.current = origin;
            void start(sources).finally(() => {
                if (dropOrigin.current === origin) dropOrigin.current = null;
            });
        };
        const browserDrag = (event: DragEvent) => {
            if (!event.dataTransfer?.types.includes('Files')) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = canDrop() ? 'copy' : 'none';
            setDragging(canDrop());
        };
        const leave = (event: DragEvent) => {
            if (!event.relatedTarget) resetDrag();
        };
        const browserDrop = (event: DragEvent) => {
            if (!event.dataTransfer?.types.includes('Files')) return;
            event.preventDefault();
            importDrop(Array.from(event.dataTransfer.files, file => ({
                name: file.name,
                async read(signal: AbortSignal) {
                    if (file.size > DOCUMENT_LIMITS.binaryBytes) throw new Error('material_too_large');
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    if (signal.aborted) throw new Error('material_cancelled');
                    return bytes;
                },
            })), { x: event.clientX, y: event.clientY });
        };
        // Native drops grant read access to the dropped paths. DOM file events
        // are the fallback for web previews and builds with native drag disabled.
        window.addEventListener('dragenter', browserDrag);
        window.addEventListener('dragover', browserDrag);
        window.addEventListener('dragleave', leave);
        window.addEventListener('drop', browserDrop);
        window.addEventListener('blur', resetDrag);
        window.addEventListener('pagehide', resetDrag);
        let disposed = false;
        let nativeFiles = false;
        let off: (() => void) | undefined;
        if (isTauri()) {
            void Promise.resolve().then(() => getCurrentWindow().onDragDropEvent(({ payload }) => {
                if (disposed) return;
                if (payload.type === 'enter') nativeFiles = payload.paths.length > 0;
                if (payload.type === 'enter' || payload.type === 'over') {
                    setDragging(nativeFiles && canDrop());
                } else if (payload.type === 'leave') {
                    nativeFiles = false;
                    resetDrag();
                } else {
                    nativeFiles = false;
                    const { x, y } = payload.position;
                    // Wry's macOS drag coordinates come from AppKit in points.
                    const scale = /Mac/i.test(navigator.platform) ? 1 : window.devicePixelRatio || 1;
                    importDrop(payload.paths.map(path => pickedMaterialSource(path, readDocumentFile)), { x: x / scale, y: y / scale });
                }
            })).then(unlisten => { if (disposed) unlisten(); else off = unlisten; }).catch(() => {});
        }
        return () => {
            disposed = true;
            off?.();
            window.removeEventListener('dragenter', browserDrag);
            window.removeEventListener('dragover', browserDrag);
            window.removeEventListener('dragleave', leave);
            window.removeEventListener('drop', browserDrop);
            window.removeEventListener('blur', resetDrag);
            window.removeEventListener('pagehide', resetDrag);
        };
    }, []);
    return { dragging, dropOrigin };
}
