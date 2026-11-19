import { paintedCopy } from './visualSnapshot';
/** Only the lifted sheet is visible until the real folio is ready to take over. */
type Flight={id:string;node:HTMLElement;box:DOMRect;jobs:Animation[];reverse:boolean;running:boolean;hide:(node:HTMLElement)=>void;dispose:()=>void};
let active:Flight|null=null,lastId:string|null=null;
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function begin(id:string,element:HTMLElement,reverse:boolean){
 active?.dispose();if(reduced())return false;
 const rect=element.getBoundingClientRect(),node=paintedCopy(element),layer=document.createElement('div'),hidden:{node:HTMLElement;visibility:string}[]=[];
 layer.className='approved-saved-flight figma-shell';layer.setAttribute('aria-hidden','true');layer.inert=true;
 Object.assign(node.style,{left:`${rect.x}px`,top:`${rect.y}px`,background:'transparent'});
 layer.append(node);document.body.append(layer);
 const hide=(node:HTMLElement)=>{hidden.push({node,visibility:node.style.visibility});node.style.visibility='hidden';};hide(element);
 let disposed=false;const dispose=()=>{if(disposed)return;disposed=true;state.jobs.forEach(a=>a.cancel());hidden.forEach(h=>h.node.style.visibility=h.visibility);layer.remove();clearTimeout(timeout);window.removeEventListener('resize',dispose);window.removeEventListener('pagehide',dispose);if(active===state)active=null;};
 const state:Flight={id,node,box:rect,jobs:[],reverse,running:false,hide,dispose};active=state;
 const timeout=setTimeout(dispose,3000);window.addEventListener('resize',dispose,{once:true});window.addEventListener('pagehide',dispose,{once:true});
 if(!reverse)state.jobs.push(node.animate([{transform:'none'},{transform:'translate(-18px,-70px) rotate(-5deg)'}],{duration:180,fill:'both',easing:'cubic-bezier(.22,.68,.22,1)'}));return true;
}
export function cancelSavedFlight(){active?.dispose();}
export function captureSavedEntrance(id:string|undefined,element:HTMLElement|null){if(!id||!element)return false;lastId=id;return begin(id,element,false);}
export function prepareSavedReturn(id:string|undefined){if(!id||id!==lastId)return false;const node=document.querySelector<HTMLElement>(`.approved-saved-folio[data-record="${CSS.escape(id)}"]`);return !!node&&begin(id,node,true);}
export function finishSavedEntrance(id:string){
 const state=active;if(!state||state.reverse||state.id!==id||state.running)return;
 const target=document.querySelector<HTMLElement>(`.approved-saved-folio[data-record="${CSS.escape(id)}"]`);if(!target)return;
 state.running=true;state.hide(target);
 void document.fonts.ready.then(()=>requestAnimationFrame(()=>{
  if(active!==state)return;
  const to=target.getBoundingClientRect(),from=state.box,transform=getComputedStyle(state.node).transform;
  state.node.style.transform=transform;state.jobs.forEach(a=>a.cancel());
  const options:KeyframeAnimationOptions={duration:480,easing:'cubic-bezier(.22,.68,.22,1)',fill:'both'};
  const incoming=target.animate([{opacity:0},{opacity:0,offset:.56},{opacity:1}],options);
  target.style.visibility='visible';
  state.jobs=[state.node.animate([{transform,opacity:1},{transform:`translate(${to.x-from.x}px,${to.y-from.y}px) rotate(7deg) scale(${to.width/from.width})`,opacity:0}],options),incoming];
  void Promise.allSettled(state.jobs.map(a=>a.finished)).then(state.dispose);
 }));
}
export function finishSavedReturn(id:string|undefined){
 const state=active;if(!state?.reverse||state.running)return;if(id&&id!==state.id){state.dispose();return;}
 const target=document.querySelector<HTMLElement>(`[data-pocket-record="${CSS.escape(state.id)}"]`);if(!target)return;
 state.running=true;state.hide(target);const to=target.getBoundingClientRect(),from=state.box;
 const job=state.node.animate([{transform:'none',opacity:1},{transform:`translate(${to.x-from.x}px,${to.y-from.y}px) rotate(-7deg) scale(${to.width/from.width})`,opacity:0}],{duration:430,easing:'cubic-bezier(.22,.68,.22,1)',fill:'both'});state.jobs=[job];void job.finished.then(state.dispose,state.dispose);
}
