import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useFileStore } from '../stores/fileStore';
import { tagErrorMessage } from '../lib/tags';
import Overlay from './Overlay';

/** Classification artwork opens the wall; its caption owns naming only. */
export default function TagNamesDialog({tagId,onClose}:{tagId?:number;onClose:()=>void}) {
  const {t}=useTranslation(),tags=useFileStore(state=>state.tags);
  const [selected,setSelected]=useState(tagId),[name,setName]=useState(tags.find(tag=>tag.id===tagId)?.name??'');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),pending=useRef(false);
  const close=()=>{if(pending.current)return false;onClose();return true;};
  const save=async()=>{
    if(pending.current||!name.trim())return;
    pending.current=true;setBusy(true);setError('');
    try{if(selected!==undefined)await useFileStore.getState().renameTag(selected,name);else await useFileStore.getState().createTag(name);onClose();}
    catch(reason){setError(t(tagErrorMessage(reason,'tags.saveFailed')));}
    finally{pending.current=false;setBusy(false);}
  };
  return <Overlay label={t('tags.manage')} onClose={close} className="tag-dialog approved-tag-names">
    <h2>{t('tags.manage')}</h2>
    <div className="approved-tag-name-list">{tags.map(tag=><button className="ui-button" key={tag.id} disabled={busy} aria-pressed={selected===tag.id} onClick={()=>{setSelected(tag.id);setName(tag.name);setError('');}}>{tag.name}</button>)}<button className="ui-button" aria-label={t('tags.create')} disabled={busy} onClick={()=>{setSelected(undefined);setName('');setError('');}}><Plus size={18} aria-hidden="true"/></button></div>
    <form onSubmit={event=>{event.preventDefault();void save();}}>
      <label htmlFor="approved-tag-name">{t(selected===undefined?'tags.create':'tags.rename')}</label>
      <input autoFocus id="approved-tag-name" className="tag-input" disabled={busy} value={name} maxLength={100} onChange={event=>setName(event.target.value)}/>
      {error&&<p className="tag-error" role="alert">{error}</p>}
      <footer><button type="button" className="ui-button" disabled={busy} onClick={close}>{t('common.cancel')}</button><button className="ui-button tag-primary" disabled={busy||!name.trim()} aria-busy={busy}>{t(busy?'tags.saving':'common.save')}</button></footer>
    </form>
  </Overlay>;
}
