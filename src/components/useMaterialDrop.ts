import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { pickedMaterialSource } from '../lib/importPicker';
import { useImportStore } from '../stores/importStore';
export default function useMaterialDrop() {
    useEffect(() => {
        const sources = (files: FileList) => Array.from(files).map(file => ({ name: file.name, read: () => file.text() }));
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
                    void useImportStore.getState().start(payload.paths.map(path => pickedMaterialSource(path, readTextFile)));
            }).then(unlisten => { if (disposed)
                unlisten();
            else
                off = unlisten; }).catch(() => { });
        }
        catch { /* DOM file dropping remains available in browser tests. */ }
        return () => { disposed = true; off?.(); window.removeEventListener('dragover', drag); window.removeEventListener('drop', drop); };
    }, []);
}
