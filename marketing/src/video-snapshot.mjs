import {initialSession,IMPORT_SAMPLE} from './demo-model.mjs';
import {themeAt} from './video-revision.mjs';
export function videoSnapshot(id,frame,seconds){
 const t=frame/30,p=t/seconds,session=initialSession();
 session.files.push({...structuredClone(IMPORT_SAMPLE),tags:[1,4]});
 session.selectedTerm=null;session.statuses[3]='learning';
 const result={session,modal:null,drawerOpen:false,query:'',filter:'all',notice:'',target:null,clickAt:null,drawerAt:null};
 const action=(selector,at)=>{result.target=selector;result.clickAt=at*seconds;};
 if(id==='import'){
  session.files=session.files.filter(f=>f.id!==7);
  if(p<.15)action('.sample-toolbar>.sample-primary',.14);
  else if(p<.73){
   result.modal={type:'import',stage:p<.35?0:1,language:'en',tags:p>.55?[1,4]:p>.43?[1]:[]};
   if(p<.35)action('.sample-dialog .sample-toolbar button:last-child',.35);
   else if(p<.43)action('.sample-dialog .sample-tag-bar button:first-child',.43);
   else if(p<.55)action('.sample-dialog .sample-tag-bar button:last-child',.55);
   else action('.sample-dialog .sample-toolbar button:last-child',.73);
  }
  else{session.files.push({...structuredClone(IMPORT_SAMPLE),tags:[1,4]});result.notice='SRT 字幕已加入文件库';}
 }else if(id==='tags'){
  session.selectedTags=p>.28?[2]:[];action(p<.3?'[data-tag-id="2"]':'[data-edit-file="2"]',p<.3?.28:.54);
  if(p>.54&&p<.86){result.modal={type:'edit',id:2,tags:p>.68?[1,2,4]:[1,2]};action(p<.68?'.sample-dialog .sample-tag-bar button:last-child':'.sample-dialog .sample-toolbar button:last-child',p<.68?.68:.86);}
  if(p>=.86){session.files.find(f=>f.id===2).tags=[1,2,4];result.notice='标签已保存';}
 }else if(id==='lookup'||id==='phrases'){
  session.module='reading';session.fileId=1;
  if(id==='lookup'){
   session.statuses[3]=p>.61?'learning':'unprocessed';
   if(p>.28&&p<.87){result.drawerOpen=true;session.selectedTerm=3;result.drawerAt=.28*seconds;}
   if(p<.28)action('text:meaningful',.28);
   else if(p<.62)action('[data-status="learning"]',.61);
   else if(p<.87)action('.sample-detail-heading button',.87);
   if(p>.62&&p<.8)result.notice='meaningful 已标记为学习中';
  }else{
   session.aiEnabled=p>.1;session.analyzed=p>.3?[1]:[];
   action('[data-action="analyze"]',p<.1?.1:.3);
   if(p>.5){result.drawerOpen=true;session.selectedTerm=26;result.drawerAt=.5*seconds;}
   if(p>.32&&p<.5)action('text:comes up',.5);
  }
 }else if(id==='collect'){
  session.module='vocabulary';session.kind=p>.57?'phrase':'word';
  result.query=p>.2&&p<.57?'meaning':'';
  if(p<.3)action('[data-task="search"]',.2);
  else if(p<.57)action('[data-kind="phrase"]',.57);
  else action('[data-term-id="26"]',.73);
  if(p>.73){result.drawerOpen=true;session.selectedTerm=26;result.drawerAt=.73*seconds;}
 }else if(id==='review'){
  session.module='review';session.reviewQueue=[3,26,27];session.revealed=p>.25&&p<.7;
  action(p<.26?'[data-task="answer"]':'.sample-review>.grid button:nth-child(3)',p<.26?.25:.7);
  if(p>=.7){session.reviewIndex=1;session.reviews=[{id:3,rating:3}];result.notice='meaningful · 已保存评分';}
 }else if(id==='progress'){
  session.module='insights';session.reviews=[{id:3,rating:3}];
 }else if(id==='languages'){
  const index=Math.min(3,Math.floor(p*4));
  session.module='reading';session.language=['en','ja','de','zh'][index];session.fileId=[1,4,5,6][index];
  session.theme=themeAt(frame,seconds);session.uiLocale='zh';session.selectedTerm=[3,17,20,25][index];result.drawerOpen=true;
 }else session.module='settings';
 return result;
}
