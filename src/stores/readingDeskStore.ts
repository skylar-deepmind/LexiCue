import { create } from 'zustand';
import type { Material } from '../lib/materials';
import { archiveFromDesk, DESK_INITIALIZED_KEY, DESK_KEY, DESK_V1_BACKUP_KEY, LEGACY_DESK_KEY, emptyDesk, keepOnDesk, matchesMaterial, materialRef, openOnDesk, parseDesk, reconcileDesk, sameRef, selectOnDesk, type ReadingDesk } from '../lib/readingDesk';

type Notice = { kind: 'archived' | 'kept' | 'replaced' | 'undone' | 'undoUnavailable' | 'unavailable' | 'recovered'; name?: string };
interface DeskStore {
    desk: ReadingDesk;
    catalog: Material[] | null;
    undo: { before: ReadingDesk; revision: number } | null;
    revision: number;
    notice: Notice | null;
    persistenceFailed: boolean;
    reconcile: (files: Material[]) => void;
    keep: (material: Material) => void;
    keepAndOpen: (material: Material) => void;
    archive: (material: Material) => void;
    select: (material: Material) => void;
    use: (material: Material) => void;
    undoChange: () => void;
    clearNotice: () => void;
    resetAfterRestore: () => void;
    acceptExternal: (raw: string | null) => void;
}
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const optionalStorage = (): Storage => localStorage;
export function createReadingDeskStore(storage: () => Storage = optionalStorage) {
    let initial = { desk: emptyDesk(true), recovered: false }, failed = false, last: unknown = null;
    let migrationBackup: string | null = null;
    let knownRaw: string | null | undefined;
    const save = (desk: ReadingDesk) => {
        try {
            const target = storage();
            if (migrationBackup !== null) {
                if (target.getItem(DESK_V1_BACKUP_KEY) === null) target.setItem(DESK_V1_BACKUP_KEY, migrationBackup);
                migrationBackup = null;
            }
            const raw = JSON.stringify(desk);
            target.setItem(DESK_KEY, raw);
            knownRaw = raw;
            // Retaining v1 must not make removing v2 resurrect an old desk.
            target.setItem(DESK_INITIALIZED_KEY, '1');
            return false;
        } catch { return true; }
    };
    try {
        const raw = storage().getItem(DESK_KEY);
        knownRaw = raw;
        const wasInitialized = raw === null && storage().getItem(DESK_INITIALIZED_KEY) === '1';
        const legacy = raw === null && !wasInitialized ? storage().getItem(LEGACY_DESK_KEY) : null;
        initial = wasInitialized ? { desk: emptyDesk(true), recovered: false } : parseDesk(raw ?? legacy);
        if (legacy !== null) {
            // Keep the old key untouched as well as a frozen copy. A failed
            // backup blocks the v2 write and is retried on the next action.
            migrationBackup = legacy;
            failed = save(initial.desk);
        }
    } catch { failed = true; }
    // Capture before a reader updates last-reading; initialization never follows the current route.
    try { last = JSON.parse(storage().getItem('lexicue-last-reading') ?? 'null'); } catch { /* optional */ }
    return create<DeskStore>((set, get) => {
        const commit = (desk: ReadingDesk, notice: Notice | null, undoable: boolean) => {
            const before = get();
            const revision = before.revision + 1;
            set({ desk, revision, notice, undo: undoable ? { before: before.desk, revision } : null, persistenceFailed: save(desk) });
        };
        const available = (m: Material) => m.segment_count > 0 && !!get().catalog?.some(file => matchesMaterial(materialRef(m), file));
        const receivePendingExternal = () => {
            try {
                const raw = storage().getItem(DESK_KEY);
                if (raw !== knownRaw && (knownRaw !== undefined || raw !== null)) get().acceptExternal(raw);
                else knownRaw = raw;
            } catch { set({ persistenceFailed: true }); }
        };
        const keepMaterial = (material: Material, markOpened: boolean) => {
            receivePendingExternal();
            if (!available(material)) { set({notice:{kind:'unavailable'}}); return; }
            const before = get().desk;
            const member = before.items.some(ref => matchesMaterial(ref, material));
            if (member && !markOpened) return;
            const kept = keepOnDesk(before, material);
            const desk = markOpened ? openOnDesk(kept, material) : kept;
            if (desk === before) return;
            const removed = before.items.find(ref => !desk.items.some(item => sameRef(ref, item)));
            const notice: Notice | null = member ? get().undo ? { kind:'undoUnavailable' } : null
                : removed ? { kind:'replaced', name:get().catalog?.find(m => matchesMaterial(removed, m))?.name } : { kind:'kept' };
            commit(desk, notice, !member);
        };
        return {
            desk: initial.desk, catalog: null, undo: null, revision: 0,
            notice: initial.recovered ? { kind: 'recovered' } : null, persistenceFailed: failed,
            reconcile: files => {
                set({ catalog: files });
                receivePendingExternal();
                const before = get();
                const desk = reconcileDesk(before.desk, files, last);
                const undoValid = !before.undo || before.undo.before.items.every(ref => files.some(file => matchesMaterial(ref, file) && file.segment_count > 0));
                if (JSON.stringify(desk) !== JSON.stringify(before.desk)) commit(desk, before.undo ? {kind:'undoUnavailable'} : before.notice, false);
                else if (!undoValid) set({ undo: null, notice: { kind: 'undoUnavailable' } });
            },
            keep: material => keepMaterial(material, false),
            // Successful imported reading is one placement/open intent: its undo
            // must survive the reader's following idempotent use() notification.
            keepAndOpen: material => keepMaterial(material, true),
            archive: material => {
                receivePendingExternal();
                const before = get().desk;
                if (!before.items.some(ref => matchesMaterial(ref, material))) return;
                commit(archiveFromDesk(before, materialRef(material)), { kind: 'archived', name: material.name }, true);
            },
            select: material => {
                receivePendingExternal();
                if (!available(material)) return;
                const before = get();
                const desk = selectOnDesk(before.desk, material);
                if (desk !== before.desk) commit(desk, before.undo ? { kind: 'undoUnavailable' } : null, false);
            },
            use: material => {
                receivePendingExternal();
                if (!available(material)) return;
                const before = get();
                const desk = openOnDesk(before.desk, material);
                if (desk !== before.desk) commit(desk, before.undo ? { kind: 'undoUnavailable' } : null, false);
            },
            undoChange: () => {
                receivePendingExternal();
                const { undo, revision, catalog } = get();
                if (!undo || undo.revision !== revision || !catalog || !undo.before.items.every(ref => catalog.some(m => matchesMaterial(ref, m) && m.segment_count > 0))) {
                    set({undo:null,notice:{kind:'undoUnavailable'}}); return;
                }
                commit(undo.before, {kind:'undone'}, false);
            },
            clearNotice: () => set({ undo: null, notice: null }),
            resetAfterRestore: () => { last = null; set(state => ({ catalog: null, undo: null, notice: null, revision: state.revision + 1 })); },
            acceptExternal: raw => {
                knownRaw = raw;
                const parsed = parseDesk(raw);
                const catalog = get().catalog;
                // A removed key is an empty workspace, never a request to run migration again.
                const desk = { ...parsed.desk, initialized: true };
                // The event already represents persisted state. Writing it back
                // creates cross-window storage-event ping-pong and can overwrite
                // a newer value with this window's older catalog reconciliation.
                set(state => ({ desk: catalog ? reconcileDesk(desk, catalog, null) : desk, revision: state.revision + 1,
                    undo: null, notice: { kind: parsed.recovered ? 'recovered' : 'undoUnavailable' } }));
            },
        };
    });
}
export const useReadingDeskStore = createReadingDeskStore();
