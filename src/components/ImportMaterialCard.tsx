import { useLibraryNames } from './useLibraryNames';
import { useLocation, useNavigate } from 'react-router-dom';
import { visitState } from '../lib/pageNavigation';
import { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ImportItem, ImportPhase } from '../stores/importStore';
import { useImportStore } from '../stores/importStore';
import type { TagInfo } from '../lib/types';
import { allocatedCover } from '../lib/materialCover';
import { bookmarkTitle } from '../lib/bookmarkDesk';
import MaterialCover from './MaterialCover';
import DocumentPreview from './DocumentPreview';
import Overlay from './Overlay';
import { BusyRing } from './LoadingFeedback';
import CardTagChoices from './CardTagChoices';
import './import-material-card.css';

export default function ImportMaterialCard({ item, items, tags, tagIds, phase, busy, canConfirm, retryable, onClose, onConfirm, onRetry }: {
  item: ImportItem; items: ImportItem[]; tags: TagInfo[]; tagIds: number[]; phase: ImportPhase;
  busy: boolean; canConfirm: boolean; retryable: boolean; onClose: () => void; onConfirm: () => void; onRetry: () => void;
}) {
  const navigate=useNavigate(), location=useLocation();
  const { t } = useTranslation();
  const libraryNames = useLibraryNames();
  const [full,setFull]=useState(false),[identity,setIdentity]=useState<string|null>(null);
  const draft=item.draft!;
  useEffect(()=>{let current=true;setIdentity(null);void crypto.subtle.digest('SHA-256',new TextEncoder().encode(draft.content)).then(bytes=>{if(current)setIdentity([...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,16));}).catch(()=>{if(current)setIdentity(draft.operation_id);});return()=>{current=false;};},[draft.content,draft.operation_id]);
  const cover=draft.source?.video_id?`https://i.ytimg.com/vi/${encodeURIComponent(draft.source.video_id)}/hqdefault.jpg`:allocatedCover(identity??draft.operation_id);
  const selected=tags.find(tag=>tagIds.includes(tag.id)), tagName=selected?.name??libraryNames.untagged;
  const index=items.findIndex(row=>row.id===item.id), selectable=items.filter(row=>!!row.draft);
  return <div className="import-card-stage" data-phase={phase}>
    <CardTagChoices tags={tags} selected={tagIds} disabled={busy} onSelect={ids=>useImportStore.getState().setImportTagIds(ids)}/>
    <article className="import-material-card approved-import-preview" data-import-item={item.id} data-ready={!!identity} aria-label={t('materials.importDialog.preview')}>
      <button type="button" className="approved-card-open import-card-cover" disabled={busy} aria-label={t('materials.importDialog.previewTitle')} onClick={()=>setFull(true)}>
        <MaterialCover src={cover} identity={identity??draft.operation_id} className="approved-card-cover"/>
      </button>
      <div className="approved-card-copy">
        <span className="import-card-category">{tagName}</span>
        {draft.document?.origin?<input className="approved-card-title import-card-title-input" aria-label={t('materials.importDialog.materialTitle')} value={draft.name} disabled={busy} maxLength={240} onChange={event=>useImportStore.getState().renameDraft(item.id,event.target.value)}/>:<strong className="approved-card-title" lang="en">{bookmarkTitle(draft.name)}</strong>}
        <span className="approved-card-quote" lang="en">{draft.segments[0]?.en_text}</span>
      </div>
    </article>
    {selectable.length>1&&<nav className="import-card-pager" aria-label={t('materials.importDialog.previewTitle')}><button className="approved-icon" disabled={busy||!items.slice(0,index).some(row=>row.draft)} aria-label={t('history.previous')} onClick={()=>useImportStore.getState().select(items.slice(0,index).findLast(row=>row.draft)!.id)}><ChevronLeft size={18}/></button><span>{selectable.findIndex(row=>row.id===item.id)+1} / {selectable.length}</span><button className="approved-icon" disabled={busy||!items.slice(index+1).some(row=>row.draft)} aria-label={t('history.next')} onClick={()=>useImportStore.getState().select(items.slice(index+1).find(row=>row.draft)!.id)}><ChevronRight size={18}/></button></nav>}
    {draft.document?.extraction_status==='partial'&&<p className="import-card-warning" role="status">{t('documents.partial')}</p>}
    <footer className="import-card-actions"><button type="button" className="approved-icon" aria-label={t(busy?'materials.importDialog.minimize':'common.close')} onClick={onClose}><X size={21}/></button>
      {phase==='preview'&&<button type="button" className="ui-button lc-import-primary" disabled={!canConfirm||!identity} onClick={onConfirm}><Check size={19} aria-hidden="true"/>{t(draft.document?.extraction_status==='partial'?'documents.importPartial':'approved.placeOnDesk')}</button>}
      {busy&&<span role="status"><BusyRing/><span className="sr-only">{t('fileStore.importing')}</span></span>}
      {busy&&items.length>1&&<button className="ui-button" onClick={()=>useImportStore.getState().cancel()}>{t('materials.cancelRemaining')}</button>}
    </footer>
    <div className="import-card-errors">{items.filter(row=>row.stage==='failed'||row.stage==='duplicate'||row.stage==='cancelled'||row.englishFallback!==undefined).map(row=><div key={row.id}>
      {items.length>1&&<strong>{row.name}</strong>}{row.error&&<p role="alert">{t(`materials.errors.${row.error}`)}</p>}
      {row.englishFallback!==undefined&&<button className="ui-button" onClick={()=>void useImportStore.getState().useEnglish(row.id)}>{t('materials.englishFallback')}</button>}
      {row.stage==='cancelled'&&<p role="status">{t('materials.stages.cancelled')}</p>}
      {row.stage==='duplicate'&&<><p role="status">{t('materials.stages.duplicate')}</p><button className="ui-button" onClick={()=>{useImportStore.getState().hide();navigate(row.result!.readable?`/files/${row.result!.file_id}`:`/legacy?fileId=${row.result!.file_id}`,{state:{...visitState(location),reopenImport:true}});}}>{t('materials.openExisting')}</button></>}
    </div>)}{retryable&&<button className="ui-button" disabled={busy} onClick={onRetry}>{t('materials.retryFailed')}</button>}</div>
    {full&&<Overlay label={t('materials.importDialog.previewTitle')} className="import-document-sheet" onClose={()=>setFull(false)}><header><h2>{bookmarkTitle(draft.name)}</h2><button className="approved-icon" aria-label={t('common.close')} onClick={()=>setFull(false)}><X size={20}/></button></header><DocumentPreview item={item}/></Overlay>}
  </div>;
}
