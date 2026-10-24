import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, LayoutGrid, List, MoreHorizontal, Tags, Trash2 } from 'lucide-react';
import { useMaterialStore } from '../stores/materialStore';
import { useFileStore } from '../stores/fileStore';
import type { Material } from '../lib/materials';
import TagFilterBar from '../components/TagFilterBar';
import TagManager from '../components/TagManager';
import TagEditDialog from '../components/TagEditDialog';
export default function FilesPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const materials = useMaterialStore();
    const selected = useFileStore(s => s.selectedTagIds);
    const untagged = useFileStore(s => s.untaggedOnly);
    const loadTags = useFileStore(s => s.loadTags);
    const deleting = useFileStore(s => s.deletingFiles);
    const [tagsOpen, setTagsOpen] = useState(selected.length > 0 || untagged);
    const [manager, setManager] = useState(false);
    const [edit, setEdit] = useState<Material | null>(null);
    const [menu, setMenu] = useState<number | null>(null);
    const scroll = useRef<HTMLDivElement>(null);
    const anchor = useRef<{
        id: string;
        offset: number;
    } | null>(null);
    const filters = JSON.stringify([selected, untagged]);
    const scrollKey = `lexicue-material-scroll:${filters}:${materials.view}`;
    useEffect(() => { const [ids, onlyUntagged] = JSON.parse(filters) as [
        number[],
        boolean
    ]; void useMaterialStore.getState().load(ids, onlyUntagged); void loadTags(); }, [filters, materials.revision, loadTags]);
    useEffect(() => { const refresh = () => useMaterialStore.getState().changed(); window.addEventListener('lexicue-sync-applied', refresh); return () => window.removeEventListener('lexicue-sync-applied', refresh); }, []);
    useLayoutEffect(() => {
        const node = scroll.current;
        if (!node || materials.loading)
            return;
        if (anchor.current) {
            const target = node.querySelector<HTMLElement>(`[data-material="${anchor.current.id}"]`);
            if (target)
                node.scrollTop += target.getBoundingClientRect().top - node.getBoundingClientRect().top - anchor.current.offset;
            anchor.current = null;
        }
        else
            node.scrollTop = Number(sessionStorage.getItem(scrollKey) ?? 0);
        const remember = () => sessionStorage.setItem(scrollKey, String(node.scrollTop));
        node.addEventListener('scroll', remember, { passive: true });
        return () => node.removeEventListener('scroll', remember);
    }, [materials.loading, materials.view, scrollKey]);
    const setView = (view: 'gallery' | 'list') => {
        const node = scroll.current;
        if (!node || view === materials.view)
            return;
        const top = node.getBoundingClientRect().top;
        const first = Array.from(node.querySelectorAll<HTMLElement>('[data-material]')).find(el => el.getBoundingClientRect().bottom > top);
        if (first)
            anchor.current = { id: first.dataset.material!, offset: first.getBoundingClientRect().top - top };
        materials.setView(view);
    };
    const closeEdit = () => { setEdit(null); materials.changed(); };
    let last: number | null = null;
    try {
        const saved = JSON.parse(localStorage.getItem('lexicue-last-reading') ?? 'null');
        if (materials.files.some(file => file.id === saved?.id && file.content_hash === saved?.hash))
            last = saved.id;
    }
    catch { /* Old local reading metadata is optional. */ }
    return <div className="materials-page"><div className="materials-scroll" ref={scroll}><div className="workspace-paper materials-paper">
    <div className="materials-heading"><h1>{t('materials.title')}</h1><div className="materials-tools">
      <button className="ui-button ui-button--icon" aria-label={t('materials.filterTags')} aria-pressed={tagsOpen} onClick={() => setTagsOpen(!tagsOpen)}><Tags size={19} aria-hidden="true"/></button>
      <div className="material-view-switch" role="group" aria-label={t('materials.view')}><button className="ui-button ui-button--icon" aria-label={t('materials.gallery')} aria-pressed={materials.view === 'gallery'} onClick={() => setView('gallery')}><LayoutGrid size={18} aria-hidden="true"/></button><button className="ui-button ui-button--icon" aria-label={t('materials.list')} aria-pressed={materials.view === 'list'} onClick={() => setView('list')}><List size={20} aria-hidden="true"/></button></div>
    </div></div>
    {tagsOpen && <TagFilterBar onManage={() => setManager(true)}/>}
    {last !== null && <Link className="material-continue" to={`/files/${last}`}>{t('materials.continueReading')}<span>{materials.files.find(file => file.id === last)?.name}</span></Link>}
    {materials.loading && <p className="material-status" role="status">{t('common.loading')}</p>}
    {materials.error && <div className="saved-error" role="alert"><p>{t('materials.loadFailed')}</p><button className="ui-button" onClick={() => void materials.load(selected, untagged)}>{t('common.retry')}</button></div>}
    {!materials.loading && !materials.error && !materials.files.length && <div className="material-empty"><FileText size={32} aria-hidden="true"/><p>{t(selected.length || untagged ? 'materials.noMatches' : 'materials.empty')}</p></div>}
    <div className={`material-collection material-collection--${materials.view}`}>{materials.files.map(file => <article className="material-card" key={file.id} data-material={file.id}>
      <button className="material-open" onClick={() => navigate(`/files/${file.id}`)} disabled={!!deleting[file.id]} aria-label={file.name}>
        <div className="material-preview"><span>ENGLISH · SRT</span><p lang="en">{file.preview}</p></div><h2>{file.name}</h2><small>{t('materials.sentences', { count: file.segment_count })}</small>
      </button>
      {file.tags.length > 0 && <div className="material-tags">{file.tags.map(tag => <span className="file-tag" key={tag.id}>{tag.name}</span>)}</div>}
      <div className="material-row-menu"><button className="ui-button ui-button--icon" aria-label={t('materials.more', { name: file.name })} aria-expanded={menu === file.id} onClick={() => setMenu(menu === file.id ? null : file.id)}><MoreHorizontal size={20} aria-hidden="true"/></button>
        {menu === file.id && <div className="material-actions"><button className="ui-button" onClick={() => { setMenu(null); setEdit(file); }}><Tags size={16} aria-hidden="true"/>{t('tags.edit')}</button><button className="ui-button ui-button--danger" disabled={!!deleting[file.id]} onClick={() => { setMenu(null); void useFileStore.getState().deleteFile(file.id).then(() => materials.changed()); }}><Trash2 size={16} aria-hidden="true"/>{t('materials.delete')}</button></div>}
      </div>
      {deleting[file.id] && <p role="status">{t('fileStore.deleting')}</p>}
    </article>)}</div>
  </div></div>
    {manager && <TagManager onClose={() => { setManager(false); materials.changed(); }}/>}{edit && <TagEditDialog file={edit} onClose={closeEdit}/>}
  </div>;
}
