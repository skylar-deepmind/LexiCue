import type { Material } from './materials';

export const LEGACY_DESK_KEY = 'lexicue-reading-desk:v1';
export const DESK_KEY = 'lexicue-reading-desk:v2';
export const DESK_V1_BACKUP_KEY = 'lexicue-reading-desk:v1:backup';
export const DESK_INITIALIZED_KEY = 'lexicue-reading-desk:v2:initialized';
export const DESK_LIMIT = 5;
export interface MaterialRef { id: number; identity: string; hash: string }
/** items is display order; opened is actual-open MRU, without invented timestamps. */
export interface ReadingDesk { version: 2; initialized: boolean; items: MaterialRef[]; selected: MaterialRef | null; opened: MaterialRef[] }
export const emptyDesk = (initialized = false): ReadingDesk => ({ version: 2, initialized, items: [], selected: null, opened: [] });
export const materialIdentity = (m: Material) => m.source?.key ? `source:${m.source.key}` : m.document?.identity ? `document:${m.document.identity}` : `content:${m.content_hash}`;
export const materialRef = (m: Material): MaterialRef => ({ id: m.id, identity: materialIdentity(m), hash: m.content_hash });
export const sameRef = (a: MaterialRef | null, b: MaterialRef | null) => !!a && !!b && a.id === b.id && a.identity === b.identity && a.hash === b.hash;
export const matchesMaterial = (ref: MaterialRef, m: Material) => sameRef(ref, materialRef(m));
const validRef = (x: unknown): x is MaterialRef => !!x && typeof x === 'object' && Number.isSafeInteger((x as MaterialRef).id) && (x as MaterialRef).id > 0 && typeof (x as MaterialRef).identity === 'string' && !!(x as MaterialRef).identity && typeof (x as MaterialRef).hash === 'string' && !!(x as MaterialRef).hash;

/** Invalid/unknown saved states fail closed: never refill an explicitly organized desk. */
export function parseDesk(raw: string | null): { desk: ReadingDesk; recovered: boolean } {
    if (raw === null) return { desk: emptyDesk(), recovered: false };
    try {
        const x = JSON.parse(raw);
        if (![1, 2].includes(x?.version) || typeof x.initialized !== 'boolean' || !Array.isArray(x.items) || (x.version === 2 && !Array.isArray(x.opened))) throw Error('invalid');
        const items: MaterialRef[] = [];
        for (const ref of x.items) if (validRef(ref) && !items.some(item => item.id === ref.id) && items.length < (x.version === 1 ? 3 : DESK_LIMIT)) items.push({ id: ref.id, identity: ref.identity, hash: ref.hash });
        const selected = items.find(ref => validRef(x.selected) && sameRef(ref, x.selected)) ?? items[0] ?? null;
        const opened: MaterialRef[] = [];
        for (const ref of x.version === 1 ? items : x.opened) {
            const member = validRef(ref) ? items.find(item => sameRef(item, ref)) : undefined;
            if (member && !opened.some(item => sameRef(item, member))) opened.push(member);
        }
        const desk: ReadingDesk = { version: 2, initialized: x.initialized || items.length > 0, items, selected, opened };
        const comparable = x.version === 1 ? { ...desk, version: 1, opened: undefined } : desk;
        return { desk, recovered: JSON.stringify(comparable) !== JSON.stringify(x) };
    } catch { return { desk: emptyDesk(true), recovered: true }; }
}

/** Call only with a complete, successfully loaded, unfiltered list. */
export function reconcileDesk(desk: ReadingDesk, files: Material[], last: unknown): ReadingDesk {
    if (!desk.initialized) {
        const saved = last as { id?: unknown; hash?: unknown } | null;
        const initial = files.find(m => m.id === saved?.id && m.content_hash === saved?.hash && m.segment_count > 0);
        const ref = initial ? materialRef(initial) : null;
        return { ...emptyDesk(true), items: ref ? [ref] : [], selected: ref, opened: ref ? [ref] : [] };
    }
    const items = desk.items.filter(ref => files.some(m => m.segment_count > 0 && matchesMaterial(ref, m)));
    return { ...desk, items, selected: items.find(ref => sameRef(ref, desk.selected)) ?? items[0] ?? null, opened: desk.opened.filter(ref => items.some(item => sameRef(item, ref))) };
}
export function keepOnDesk(desk: ReadingDesk, material: Material): ReadingDesk {
    const ref = materialRef(material);
    if (desk.items.some(item => sameRef(item, ref))) return desk;
    let previous = desk.items.filter(item => item.id !== ref.id);
    if (previous.length >= DESK_LIMIT) {
        // Never-opened members are oldest. Equal recency follows stable display order.
        const oldest = [...previous].reverse().find(item => !desk.opened.some(opened => sameRef(item, opened)))
            ?? [...desk.opened].reverse().find(opened => previous.some(item => sameRef(item, opened)))
            ?? previous[0];
        previous = previous.filter(item => !sameRef(item, oldest));
    }
    const items = [ref, ...previous];
    return { ...desk, initialized: true, items, selected: ref, opened: desk.opened.filter(opened => previous.some(item => sameRef(item, opened))) };
}
export function selectOnDesk(desk: ReadingDesk, material: Material): ReadingDesk {
    const ref = desk.items.find(item => matchesMaterial(item, material));
    return !ref || sameRef(ref, desk.selected) ? desk : { ...desk, selected: ref };
}
export function openOnDesk(desk: ReadingDesk, material: Material): ReadingDesk {
    const selected = selectOnDesk(desk, material);
    const ref = selected.items.find(item => matchesMaterial(item, material));
    if (!ref || sameRef(ref, selected.opened[0] ?? null)) return selected;
    return { ...selected, opened: [ref, ...selected.opened.filter(item => !sameRef(item, ref))] };
}
export function archiveFromDesk(desk: ReadingDesk, ref: MaterialRef): ReadingDesk {
    const items = desk.items.filter(item => !sameRef(item, ref));
    return { ...desk, initialized: true, items, selected: items.find(item => sameRef(item, desk.selected)) ?? items[0] ?? null, opened: desk.opened.filter(item => !sameRef(item, ref)) };
}

/** Unversioned source/document positions cannot prove which content produced them. */
export function positionMatchesMaterial(saved: { hash?: unknown } | null, material: Material, key: string): boolean {
    if (!saved) return false;
    if (typeof saved.hash === 'string') return saved.hash === material.content_hash;
    return key === material.content_hash;
}

/** Local segment metadata, never an inferred completion percentage or an N+1 document fetch. */
export function readingPosition(material: Material): number | null {
    try {
        const key = material.source?.key ?? material.document?.identity ?? material.content_hash;
        const saved = JSON.parse(localStorage.getItem(`lexicue-reader-state:${key}`) ?? 'null');
        return positionMatchesMaterial(saved, material, key) && Number.isSafeInteger(saved?.segment) && saved.segment >= 0 && saved.segment < material.segment_count ? saved.segment : null;
    } catch { return null; }
}
