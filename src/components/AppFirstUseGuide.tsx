import { usePageReturn } from '../lib/pageNavigation';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useOnboardingStore } from '../stores/onboardingStore';
import { useImportStore } from '../stores/importStore';
import { backNavigation } from '../lib/backNavigation';
import { useAppStarting } from './StartupContext';
import FirstUseGuide from './FirstUseGuide';

/** Routes and successful real actions own the tour. There is no parallel demo UI. */
export default function AppFirstUseGuide() {
  const starting=useAppStarting();
  const guide=useOnboardingStore(), importing=useImportStore(state=>state.open);
  const location=useLocation(), navigate=useNavigate();
  const {back,origin}=usePageReturn();
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    if(location.pathname==='/files'&&new URLSearchParams(location.search).get('guide')==='1'){
      useOnboardingStore.getState().begin('import');navigate('/files',{replace:true,state:location.state});
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
        useOnboardingStore.getState().finish('skipped');if(origin)back();else if(location.pathname==='/example')navigate('/files',{replace:true});
      }
    };
    document.addEventListener('keydown',keys);return()=>document.removeEventListener('keydown',keys);
  },[location.pathname,navigate]);
  void revision;
  if(starting||!guide.active||!guide.tour||location.pathname==='/example'&&!document.querySelector('.reading-page'))return null;
  const skip=()=>{guide.finish('skipped');if(origin)back();else if(location.pathname==='/example')navigate('/files',{replace:true});};
  const finish=()=>{guide.finish('completed');if(origin)back();else navigate('/files',{replace:true});};
  const startExample=()=>{useImportStore.getState().hide();navigate('/example',{state:location.state});};
  const tools=()=>{if(document.querySelector('.context-panel'))backNavigation.dismiss();guide.setTour('tools');};
  const mobile=matchMedia('(max-width:767px)').matches;
  let target='',title='',body='',action:string|undefined,progress=1,onNext=()=>{};
  switch(guide.tour){
    case 'import':
      target=importing?'[data-guide="import-sources"]':document.querySelector('.approved-card[data-desk-active="true"]')?'.approved-card[data-desk-active="true"]':'[data-guide="import"]';
      title=importing?'从喜欢的内容开始':document.querySelector('.approved-card[data-desk-active="true"]')?'从这里继续阅读':'把想读的内容带进来';
      body=importing?'粘贴英文正文或网页链接，也能导入文档、字幕或素材 ZIP。':document.querySelector('.approved-card[data-desk-active="true"]')?'点中央卡回到上次读到的句子。右上的托盘可以导入新的内容。':'点这里打开导入。先不用准备材料，我们也备好了一篇英语体验文章。';
      action='先用体验材料';onNext=startExample;break;
    case 'lookup':
      progress=2;target='.reading-sentence .reading-word';title='不懂的词，点一下！';
      body=mobile?'轻点正文里的词看释义；长按也能选择词组。试试 Curiosity。':'点击正文里的词看释义；拖选或用 Shift + 方向键选词组。试试 Curiosity。';break;
    case 'save':
      progress=3;target=guide.records.length?'.quiet-pocket':'[data-sheet-active] .sentence-sheet';title=guide.records.length?'原句也一起留下了':'想留下，就拿起这一句';
      body=guide.records.length?'刚才的表达和原句已经记下。从侧袋可以回看原句和补充笔记。':'把原句拖进查词卡的侧袋，就能留下表达和上下文。';
      action=guide.records.length?'继续听读':'稍后再试';onNext=tools;
      if(!document.querySelector('.context-panel')){target='.reading-sentence .reading-word';title='再点开一个词试试';body='拿起整句，拖到查词卡侧袋里。';}
      break;
    case 'tools':
      progress=4;target='[data-guide="tools"]';title='听一听，也能看译文';body=mobile?'底部的耳机开启听读，翻译按钮切换中文。按自己的节奏试试看。':'右上的耳机开启听读，翻译按钮切换中文。试着点一下，正文会同步变化。';
      action=guide.records.length?'看看记忆提示':'开始自己的阅读';onNext=()=>guide.records.length?guide.setTour('recall'):finish();break;
    case 'recall':{
      progress=5;
      const history=document.querySelector('.recall-history .saved-sentence-original'), panel=document.querySelector('.context-panel');
      if(history){target='.recall-history .saved-sentence';title='记忆，带着它的来处';body='这里就是刚才保存的原句。以后再遇到这个表达，也能从侧袋回看原句和笔记。';action='开始自己的阅读';onNext=finish;}
      else if(panel){target='.quiet-pocket';title='打开侧袋看看';body='点这里，找回你刚才记下的表达和原句。';}
      else{target='.reading-word[data-recall]';title='记下的词，有了轻标记';body='点一下带标记的词，再打开侧袋。这是你刚才真实记下的内容。';}
      break;
    }
  }
  const host=importing?document.querySelector<HTMLElement>('.lc-import-layer')??document.body:document.body;
  return <FirstUseGuide host={host} key={guide.tour} target={target} stage={guide.tour} title={title} body={body} progress={progress} action={action} onNext={onNext} onSkip={skip}/>;
}
