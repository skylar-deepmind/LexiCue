import type { ImportItem } from '../stores/importStore';
import type { ReadingMaterial } from './materials';

export type ReadingOrigin = 'desk' | 'library';
export function readingReturnPath(state: unknown): string {
    const origin = (state as { readingOrigin?: unknown } | null)?.readingOrigin;
    return origin === 'library' ? '/files?view=library' : '/files';
}
// In-memory, one-use handoff. A route or reader mount alone cannot authorize placement.
let pending: { token: string; fileId: number; draft: NonNullable<ImportItem['draft']> } | null = null;
export function clearImportedReading() { pending = null; }
export function authorizeImportedReading(item: ImportItem): string | null {
    pending = null;
    if (item.stage !== 'created' || item.result?.outcome !== 'created' || !item.result.readable || !item.draft) return null;
    const token = crypto.randomUUID();
    pending = {token, fileId:item.result.file_id, draft:item.draft};
    return token;
}
export async function validateImportedReading(token: unknown, data: ReadingMaterial): Promise<boolean> {
    const ticket = pending;
    if (!ticket || ticket.token !== token || ticket.fileId !== data.material.id || !data.segments.length) return false;
    let digest: ArrayBuffer;
    try { digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticket.draft.content)); }
    catch { return false; } // Optional desk placement must never make a successful reader open fail.
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('').slice(0,16);
    return pending === ticket && hash === data.material.content_hash &&
        (ticket.draft.document?.identity ?? null) === (data.material.document?.identity ?? null) &&
        (ticket.draft.source?.key ?? null) === (data.material.source?.key ?? null);
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
