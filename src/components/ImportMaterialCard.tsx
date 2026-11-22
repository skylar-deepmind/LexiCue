import { useLibraryNames } from './useLibraryNames';
import { useLocation, useNavigate } from 'react-router-dom';
import { visitState } from '../lib/pageNavigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ImportItem, ImportPhase } from '../stores/importStore';
import { useImportStore } from '../stores/importStore';
import type { TagInfo, TagSelection } from '../lib/types';
import { allocatedCover, youtubeCover } from '../lib/materialCover';
import { bookmarkTitle } from '../lib/bookmarkDesk';
import MaterialCover from './MaterialCover';
import DocumentPreview from './DocumentPreview';
import Overlay from './Overlay';
import { BusyRing } from './LoadingFeedback';
import {useFileStore} from '../stores/fileStore';
import useTrashDrag from './useTrashDrag';
import EdgePicker from './EdgePicker';
import './import-material-card.css';

export default function ImportMaterialCard({ item, items, tags, tagSelection, phase, busy, canConfirm, retryable, onClose, onConfirm, onRetry }: {
  item: ImportItem; items: ImportItem[]; tags: TagInfo[]; tagSelection: TagSelection; phase: ImportPhase;
  busy: boolean; canConfirm: boolean; retryable: boolean; onClose: () => void; onConfirm: () => void; onRetry: () => void;
}) {
  const navigate=useNavigate(), location=useLocation();
  const { t } = useTranslation();
  const libraryNames = useLibraryNames();
  const [full,setFull]=useState(false),[identity,setIdentity]=useState<string|null>(null);
  const setTags = useImportStore(state => state.setImportTags);
  const loadingTags = useFileStore(s=>s.loadingTags);
  const tagsError = useFileStore(s=>s.tagsError);
  const draft=item.draft!;
  useEffect(()=>{let current=true;setIdentity(null);void crypto.subtle.digest('SHA-256',new TextEncoder().encode(draft.content)).then(bytes=>{if(current)setIdentity([...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,16));}).catch(()=>{if(current)setIdentity(draft.operation_id);});return()=>{current=false;};},[draft.content,draft.operation_id]);
  const cover=draft.document?.cover??item.youtubeCoverData??youtubeCover(draft.source)??allocatedCover(identity??draft.operation_id);
  const newTag = tagSelection.newTagNames[0];
  const selected = tags.find(tag => tagSelection.tagIds.includes(tag.id));
  const tagName = newTag ?? selected?.name ?? libraryNames.untagged;
  const index=items.findIndex(row=>row.id===item.id), selectable=items.filter(row=>!!row.draft);
  const cardRef = useRef<HTMLElement>(null);
  const ready = phase === 'preview' && !busy && canConfirm && !!identity;
  useTrashDrag(cardRef, {
    id: item.id, label: draft.name, discardPreview: true, disabled: !ready || full,
    remove: async () => {
      const store = useImportStore.getState();
      if (!store.open || store.running || store.phase !== 'preview') return false;
      const remaining = store.items.filter(row => row.id !== item.id);
      if (remaining.length) useImportStore.setState({items: remaining, selectedId: remaining[0].id});
      else onClose();
      return true;
    },
  });
  async function placeWithTag(value: TagSelection) {
    const node = cardRef.current;
    if (!ready || !node || useImportStore.getState().phase !== 'preview') return false;
    setTags(value);
    if (items.length > 1) return true;
    // Retain the exact pose the user released, even as the picker unmounts.
    const style = getComputedStyle(node);
    const pose = { translate: style.translate, scale: style.scale, transition: 'none' };
    Object.assign(node.style, pose);
    onConfirm();
    if (useImportStore.getState().phase === 'preview') {
      for (const prop of Object.keys(pose)) node.style.removeProperty(prop);
      return false;
    }
    return true;
  }
  useEffect(() => {
    if (phase === 'result' && !useImportStore.getState().destination && cardRef.current) {
      for (const prop of ['translate','scale','transition']) cardRef.current.style.removeProperty(prop);
    }
  }, [phase]);
  return <div className="import-card-stage" data-phase={phase}>
    <article ref={cardRef} className="import-material-card approved-import-preview" data-import-item={item.id} data-ready={!!identity} aria-label={t('materials.importDialog.preview')}>
      <button type="button" className="approved-card-open import-card-cover" disabled={busy} aria-label={t('materials.importDialog.previewTitle')} onClick={()=>setFull(true)}>
        <MaterialCover src={cover} identity={identity??draft.operation_id} className="approved-card-cover"/>
      </button>
      <button type="button" data-no-trash="" className="approved-card-category approved-tag-edit material-floating-tag import-edge-label" disabled={busy||phase!=='preview'} aria-label={t('tags.edit')+' · '+tagName} onClick={e=>e.currentTarget.dispatchEvent(new Event('import-tag-picker'))}>{tagName}</button>
      <div className="approved-card-copy">
        {draft.document?.origin?<input className="approved-card-title import-card-title-input" aria-label={t('materials.importDialog.materialTitle')} value={draft.name} disabled={busy} maxLength={240} onChange={event=>useImportStore.getState().renameDraft(item.id,event.target.value)}/>:<strong data-no-trash="" className="approved-card-title" lang="en">{bookmarkTitle(draft.name)}</strong>}
        <span data-no-trash="" className="approved-card-quote" lang="en">{draft.segments[0]?.en_text}</span>
      </div>
      {phase==='preview'&&<span aria-hidden="true" data-no-trash="" className="gesture-bottom-edge"/>}
    </article>
    {phase==='preview'&&!full&&<EdgePicker key={item.id} tags={tags} current={newTag??selected?.name??''} loading={loadingTags} error={tagsError?t('tags.loadFailed'):undefined} retry={tagsError?()=>void useFileStore.getState().loadTags(true):undefined} disabled={!ready} choose={placeWithTag}/>}
    {selectable.length>1&&<nav className="import-card-pager" aria-label={t('materials.importDialog.previewTitle')}><button className="approved-icon" disabled={busy||!items.slice(0,index).some(row=>row.draft)} aria-label={t('history.previous')} onClick={()=>useImportStore.getState().select(items.slice(0,index).findLast(row=>row.draft)!.id)}><ChevronLeft size={18}/></button><span>{selectable.findIndex(row=>row.id===item.id)+1} / {selectable.length}</span><button className="approved-icon" disabled={busy||!items.slice(index+1).some(row=>row.draft)} aria-label={t('history.next')} onClick={()=>useImportStore.getState().select(items.slice(index+1).find(row=>row.draft)!.id)}><ChevronRight size={18}/></button></nav>}
    {phase==='preview' && item.packageAudio && <p className="import-card-warning">{t('materials.importDialog.packageAudio')}</p>}
    {phase==='preview' && item.youtubeAudioUnavailable && <p className="import-card-warning" role="status">{t('sourceAudio.failed')}</p>}
    {draft.document?.extraction_status==='partial'&&<p className="import-card-warning" role="status">{t('documents.partial')}</p>}
    {phase==='preview' && items.length>1 && <button className="ui-button import-card-batch-confirm" disabled={!ready} onClick={onConfirm}>{t('materials.importDialog.confirm',{count:items.filter(row=>row.stage==='ready').length})}</button>}
    {phase!=='preview'&&<footer className="import-card-actions"><button type="button" className="approved-icon" aria-label={t(busy?'materials.importDialog.minimize':'common.close')} onClick={onClose}><X size={21}/></button>
      {busy&&<span role="status"><BusyRing/><span className="sr-only">{t('fileStore.importing')}</span></span>}
      {busy&&items.length>1&&<button className="ui-button" onClick={()=>useImportStore.getState().cancel()}>{t('materials.cancelRemaining')}</button>}
    </footer>}
    <div className="import-card-errors">{items.filter(row=>row.stage==='failed'||row.stage==='duplicate'||row.stage==='cancelled'||row.englishFallback!==undefined).map(row=><div key={row.id}>
      {items.length>1&&<strong>{row.name}</strong>}{row.error&&<p role="alert">{t(`materials.errors.${row.error}`)}</p>}
      {row.error==='package_audio'&&phase==='result'&&<button className="ui-button" onClick={()=>void useImportStore.getState().usePackageText(row.id)}>{t('materials.importDialog.usePackageText')}</button>}
      {row.englishFallback!==undefined&&<button className="ui-button" onClick={()=>void useImportStore.getState().useEnglish(row.id)}>{t('materials.englishFallback')}</button>}
      {row.stage==='cancelled'&&<p role="status">{t('materials.stages.cancelled')}</p>}
      {row.stage==='duplicate'&&<><p role="status">{t('materials.stages.duplicate')}</p><button className="ui-button" onClick={()=>{useImportStore.getState().hide();navigate(row.result!.readable?`/files/${row.result!.file_id}`:`/legacy?fileId=${row.result!.file_id}`,{state:{...visitState(location),reopenImport:true}});}}>{t('materials.openExisting')}</button></>}
    </div>)}{retryable&&<button className="ui-button" disabled={busy} onClick={onRetry}>{t('materials.retryFailed')}</button>}</div>
    {full&&<Overlay label={t('materials.importDialog.previewTitle')} className="import-document-sheet" onClose={()=>setFull(false)}><header><h2>{bookmarkTitle(draft.name)}</h2><button className="approved-icon" aria-label={t('common.close')} onClick={()=>setFull(false)}><X size={20}/></button></header><DocumentPreview item={item}/></Overlay>}
  </div>;
}
