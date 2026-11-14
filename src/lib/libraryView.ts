export interface LibraryView { query: string; page?: number; sort?: 'newest' | 'oldest' | 'title'; range: 'all' | 'stored'; tagsOpen: boolean; tagIds: number[]; untagged: boolean; scroll: number; focusId: number | null; expandedId?:number|null }
const KEY = 'lexicue-library-view:v1';
export function readLibraryView(): LibraryView {
    const fallback: LibraryView = {query:'',range:'all',tagsOpen:false,tagIds:[],untagged:false,scroll:0,focusId:null};
    try {
        const x = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
        if (!x || typeof x !== 'object') return fallback;
        return {query:typeof x.query === 'string' ? x.query.slice(0,500) : '',range:x.range === 'stored' ? 'stored' : 'all',tagsOpen:x.tagsOpen === true,
            tagIds:Array.isArray(x.tagIds) ? x.tagIds.filter((id: unknown) => Number.isSafeInteger(id) && Number(id)>0) : [],untagged:x.untagged === true,
            scroll:Number.isFinite(x.scroll) && x.scroll>=0 ? x.scroll : 0,focusId:Number.isSafeInteger(x.focusId) && x.focusId>0 ? x.focusId : null,
            ...(Number.isSafeInteger(x.page) && x.page > 0 ? {page:x.page} : {}),
            ...(['newest','oldest','title'].includes(x.sort) ? {sort:x.sort} : {}),
            expandedId:Number.isSafeInteger(x.expandedId)&&x.expandedId>0?x.expandedId:null};
    } catch { return fallback; }
}
export function saveLibraryView(view: LibraryView) { try { sessionStorage.setItem(KEY, JSON.stringify(view)); } catch { /* Optional session metadata never blocks reading. */ } }
