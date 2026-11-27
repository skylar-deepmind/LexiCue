import type { ImportItem } from '../stores/importStore';
import { computeHash } from './hash';
import type { ReadingMaterial } from './materials';

export type ReadingOrigin = 'desk' | 'library';
export function readingReturnPath(state: unknown): string {
    const origin = (state as { readingOrigin?: unknown } | null)?.readingOrigin;
    return origin === 'library' ? '/files?view=library' : '/files';
}
// In-memory, one-use handoff. A route or reader mount alone cannot authorize placement.
let pending: { token: string; fileId: number; hasLocalAudio: boolean; draft: NonNullable<ImportItem['draft']> } | null = null;
export function clearImportedReading() { pending = null; }
export function authorizeImportedReading(item: ImportItem): string | null {
    pending = null;
    if (item.stage !== 'created' || item.result?.outcome !== 'created' || !item.result.readable || !item.draft) return null;
    const token = crypto.randomUUID();
    pending = {token, fileId:item.result.file_id, hasLocalAudio: !!item.packageAudio, draft:item.draft};
    return token;
}
export async function validateImportedReading(token: unknown, data: ReadingMaterial): Promise<boolean> {
    const ticket = pending;
    const { material } = data;
    if (!ticket || ticket.token !== token || ticket.fileId !== material.id || !data.segments.length) return false;
    const source = ticket.draft.source;
    const savedSource = material.source;
    const sourceMatches = ticket.hasLocalAudio ? savedSource?.provider === 'local'
        : source ? savedSource?.provider === source.provider && savedSource.key === source.key
        : !savedSource;
    if (!sourceMatches || (ticket.draft.document?.identity ?? null) !== (material.document?.identity ?? null)) return false;
    let hash: string;
    try { hash = await computeHash(ticket.draft.content); }
    catch { return false; } // Optional desk placement must never make a successful reader open fail.
    return pending === ticket && hash === material.content_hash;
}
export function consumeImportedReading(token: unknown) {
    if (!pending || pending.token !== token) return false;
    pending = null;
    return true;
}
/** Once the user leaves the authorized handoff, browser history cannot replay it as a new import. */
export function retainImportedReading(token: unknown) {
    if (pending && pending.token !== token) pending=null;
}
