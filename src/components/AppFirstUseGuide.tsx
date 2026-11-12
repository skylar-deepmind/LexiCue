import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useOnboardingStore } from '../stores/onboardingStore';
import { useImportStore } from '../stores/importStore';
import { backNavigation } from '../lib/backNavigation';
import { useAppStarting } from './StartupContext';
import FirstUseGuide from './FirstUseGuide';

/** Routes and successful real actions own the tour. There is no parallel demo UI. */
export default function AppFirstUseGuide() {
  const starting=useAppStarting();
  const {t}=useTranslation();
  const saveLabel=t('reader.saveSentence');
  const guide=useOnboardingStore(), importing=useImportStore(state=>state.open);
  const location=useLocation(), navigate=useNavigate();
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    if(location.pathname==='/files'&&new URLSearchParams(location.search).get('guide')==='1'){
      useOnboardingStore.getState().begin('import');navigate('/files',{replace:true});
    } else if(!['/files','/example','/'].includes(location.pathname)&&useOnboardingStore.getState().tour&&useOnboardingStore.getState().active){
      useOnboardingStore.getState().finish('skipped');
    }
  },[location.pathname,location.search,navigate]);
  useEffect(()=>{
    if(!guide.active||!guide.tour)return;
    let frame=0;
    const observer=new MutationObserver(records=>{
      if(records.every(record=>record.target instanceof Element&&record.target.closest('[data-app-guide]')))return;
      cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>setRevision(value=>value+1));
    });
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-tab','data-closing']});
    return()=>{cancelAnimationFrame(frame);observer.disconnect();};
  },[guide.active,guide.tour]);
  useEffect(()=>{
    const keys=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!event.defaultPrevented&&!backNavigation.hasLayers()&&useOnboardingStore.getState().active){
        useOnboardingStore.getState().finish('skipped');if(location.pathname==='/example')navigate('/files',{replace:true});
      }
    };
    document.addEventListener('keydown',keys);return()=>document.removeEventListener('keydown',keys);
  },[location.pathname,navigate]);
  void revision;
  if(starting||!guide.active||!guide.tour||document.querySelector('.sentence-note-dialog')||location.pathname==='/example'&&!document.querySelector('.reading-page'))return null;
  const skip=()=>{guide.finish('skipped');if(location.pathname==='/example')navigate('/files',{replace:true});};
  const finish=()=>{guide.finish('completed');navigate('/files',{replace:true});};
  const startExample=()=>{useImportStore.getState().hide();navigate('/example');};
  const tools=()=>{if(document.querySelector('.context-panel'))backNavigation.dismiss();guide.setTour('tools');};
  const mobile=matchMedia('(max-width:767px)').matches;
  let target='',title='',body='',action:string|undefined,progress=1,onNext=()=>{};
  switch(guide.tour){
    case 'import':
      target=importing?'[data-guide="import-sources"]':'[data-guide="import"]';
      title=importing?'从喜欢的内容开始':'把想读的内容带进来';
      body=importing?'粘贴英文正文、网页或 YouTube 链接，也能选择英语文件。导入前可以先检查。':'点这里打开导入。先不用准备材料，我们也备好了一篇英语体验文章。';
      action='先用体验材料';onNext=startExample;break;
    case 'lookup':
      progress=2;target='.reading-sentence .reading-word';title='不懂的词，点一下！';
      body=mobile?'轻点正文里的词看释义；长按也能选择词组。试试 Curiosity。':'点击正文里的词看释义；拖选或用 Shift + 方向键选词组。试试 Curiosity。';break;
    case 'save':
      progress=3;target=guide.records.length?'[data-testid=lookup-records-tab]':'.lookup-footer';title=guide.records.length?'原句也一起留下了':`想留下，就点「${saveLabel}」`;
      body=guide.records.length?'刚才的表达和原句已经记下。从「我的记录」可以回看原句和补充笔记。':`点查词卡底部的「${saveLabel}」，表达、释义和上下文一起保存。体验记录不会进入你的材料库。`;
      action=guide.records.length?'继续听读':'稍后再试';onNext=tools;
      if(!document.querySelector('.context-panel')){target='.reading-sentence .reading-word';title='再点开一个词试试';body=`在查词卡底部点「${saveLabel}」，就能保留原句。也可以稍后再试。`;}
      break;
    case 'tools':
      progress=4;target='[data-guide="tools"]';title='听一听，也能看译文';body=mobile?'底部的耳机开启听读，翻译按钮切换中文。按自己的节奏试试看。':'左侧的耳机开启听读，翻译按钮切换中文。试着点一下，正文会同步变化。';
      action=guide.records.length?'看看记忆提示':'开始自己的阅读';onNext=()=>guide.records.length?guide.setTour('recall'):finish();break;
    case 'recall':{
      progress=5;
      const history=document.querySelector('.recall-history .saved-sentence-original'), panel=document.querySelector('.context-panel');
      if(history){target='.recall-history .saved-sentence-original';title='记忆，带着它的来处';body='这里就是刚才保存的原句。以后再遇到这个表达，也能从「我的记录」回看原句和笔记。';action='开始自己的阅读';onNext=finish;}
      else if(panel){target='[data-testid="lookup-records-tab"]';title='打开「我的记录」看看';body='点这里，找回你刚才记下的表达和原句。';}
      else{target='.reading-word[data-recall]';title='记下的词，有了轻标记';body='点一下带标记的词，再打开「我的记录」。这是你刚才真实记下的内容。';}
      break;
    }
  }
  const host=importing?document.querySelector<HTMLElement>('.lc-import-layer')??document.body:document.body;
  return <FirstUseGuide host={host} key={guide.tour} target={target} stage={guide.tour} title={title} body={body} progress={progress} action={action} onNext={onNext} onSkip={skip}/>;
}
