import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import ReadingPage from './ReadingPage';
import type { ReadingMaterial } from '../lib/materials';
import { useOnboardingStore } from '../stores/onboardingStore';
import { useImportStore } from '../stores/importStore';
import { backNavigation } from '../lib/backNavigation';
interface Example {session_id:string;data:ReadingMaterial}
export default function ExamplePage(){
  const {t}=useTranslation();const navigate=useNavigate();
  const [id]=useState(()=>crypto.randomUUID());const [example,setExample]=useState<Example|null>(null);const [error,setError]=useState(false);const [retry,setRetry]=useState(0);const generation=useRef(0);
  const importOpen=useImportStore(state=>state.open);
  useEffect(()=>{
    const current=++generation.current;let live=true;setError(false);useOnboardingStore.getState().begin();
    void invoke<Example>('begin_example_session',{sessionId:id}).then(value=>{if(live)setExample(value);}).catch(()=>{if(live)setError(true);});
    const leave=()=>{if(useOnboardingStore.getState().active)useOnboardingStore.getState().finish('skipped');void invoke('end_example_session',{sessionId:id}).catch(()=>{});};
    window.addEventListener('pagehide',leave);
    // StrictMode re-runs setup before this microtask; only the latest lifecycle may dispose.
    const disposeCurrent=()=>{if(generation.current===current)leave();};
    return()=>{live=false;window.removeEventListener('pagehide',leave);queueMicrotask(disposeCurrent);};
  },[id,retry]);
  useEffect(()=>{if(importOpen){if(useOnboardingStore.getState().active)useOnboardingStore.getState().finish('skipped');navigate('/files',{replace:true});}},[importOpen,navigate]);
  useEffect(()=>backNavigation.setPage(()=>{if(useOnboardingStore.getState().active)useOnboardingStore.getState().finish('skipped');navigate('/files',{replace:true});return true;},1),[navigate]);
  const skip=()=>{useOnboardingStore.getState().finish('skipped');navigate('/files',{replace:true});};
  if(error)return <section className="workspace-paper example-load"><h1>{t('onboarding.sample')}</h1><p role="alert">{t('onboarding.loadFailed')}</p><button className="ui-button" onClick={()=>setRetry(retry+1)}>{t('common.retry')}</button><button className="ui-button" onClick={skip}>{t('onboarding.skip')}</button></section>;
  if(!example)return <section className="workspace-paper example-load"><h1>{t('onboarding.sample')}</h1><p role="status">{t('common.loading')}</p><button className="ui-button" onClick={skip}>{t('onboarding.skip')}</button></section>;
  return <ReadingPage data={example.data} scope={{kind:'example',sessionId:id}}/>;
}
