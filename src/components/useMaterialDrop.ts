import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readDocumentFile } from '../lib/readDocumentFile';
import { DOCUMENT_LIMITS } from '../lib/documentTypes';
import { pickedMaterialSource } from '../lib/importPicker';
import { useImportStore } from '../stores/importStore';
export default function useMaterialDrop() {
    useEffect(() => {
        const sources = (files: FileList) => Array.from(files).map(file => ({ name: file.name, read: async (signal: AbortSignal) => {if (file.size > DOCUMENT_LIMITS.binaryBytes) throw new Error('material_too_large'); const bytes = new Uint8Array(await file.arrayBuffer()); if (signal.aborted) throw new Error('material_cancelled'); return bytes;} }));
        const drag = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) {
            event.preventDefault();
            useImportStore.getState().show();
        } };
        const drop = (event: DragEvent) => { if (!event.dataTransfer?.files.length)
            return; event.preventDefault(); void useImportStore.getState().start(sources(event.dataTransfer.files)); };
        window.addEventListener('dragover', drag);
        window.addEventListener('drop', drop);
        let disposed = false;
        let off: (() => void) | undefined;
        try {
            void getCurrentWindow().onDragDropEvent(({ payload }) => {
                if (payload.type === 'enter')
                    useImportStore.getState().show();
                if (payload.type === 'drop')
                    void useImportStore.getState().start(payload.paths.map(path => pickedMaterialSource(path, readDocumentFile)));
            }).then(unlisten => { if (disposed)
                unlisten();
            else
                off = unlisten; }).catch(() => { });
        }
        catch { /* DOM file dropping remains available in browser tests. */ }
        return () => { disposed = true; off?.(); window.removeEventListener('dragover', drag); window.removeEventListener('drop', drop); };
    }, []);
}
