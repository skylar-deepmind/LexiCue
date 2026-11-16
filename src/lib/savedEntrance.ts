/** A real saved-record miniature becomes the same record's full folio. */
let active: { id: string; node: HTMLElement; box: DOMRect; layer: HTMLElement; jobs: Animation[]; reverse: boolean; running: boolean; dispose: () => void } | null = null;
let lastId: string | null = null;
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function begin(id: string, element: HTMLElement, reverse: boolean) {
  active?.dispose();
  if(reduced())return false;
  const rect=element.getBoundingClientRect(),node=element.cloneNode(true) as HTMLElement;
  node.removeAttribute('id');node.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));
  const layer=document.createElement('div');layer.className='approved-saved-flight figma-shell';layer.setAttribute('aria-hidden','true');layer.inert=true;
  Object.assign(node.style,{position:'absolute',left:`${rect.x}px`,top:`${rect.y}px`,width:`${rect.width}px`,height:`${rect.height}px`,margin:'0',transform:'none',transformOrigin:'0 0',pointerEvents:'none',overflow:'hidden'});
  if(reverse)node.style.background='var(--approved-desk)';
  layer.append(node);document.body.append(layer);
  const jobs: Animation[]=[],hidden: {node:HTMLElement;visibility:string}[]=[];let disposed=false;
  const cancel=()=>{if(disposed)return;disposed=true;(active?.layer===layer?active.jobs:jobs).forEach(a=>a.cancel());hidden.forEach(({node,visibility})=>node.style.visibility=visibility);layer.remove();clearTimeout(timer);window.removeEventListener('resize',cancel);window.removeEventListener('pagehide',cancel);if(active?.layer===layer)active=null;};
  const timer=setTimeout(cancel,2500);window.addEventListener('resize',cancel,{once:true});window.addEventListener('pagehide',cancel,{once:true});
  active={id,node,box:rect,layer,jobs,reverse,running:false,dispose:cancel};
  if(!reverse){
    const pop=node.animate([{transform:'rotate(-7deg)'},{transform:'translate(-18px,-70px) rotate(-12deg)'}],{duration:180,fill:'forwards',easing:'cubic-bezier(.22,.68,.22,1)'});jobs.push(pop);
  }
  return true;
}
export function captureSavedEntrance(id: string | undefined, element: HTMLElement | null) {
  if(!id||!element)return false;
  lastId=id;return begin(id,element,false);
}
export function prepareSavedReturn(id: string | undefined) {
  if(!id||id!==lastId)return false;
  const folio=document.querySelector<HTMLElement>(`.approved-saved-folio[data-record="${CSS.escape(id)}"]`);
  return !!folio&&begin(id,folio,true);
}
export function finishSavedEntrance(id: string) {
  const state=active;if(!state||state.reverse||state.id!==id||state.running)return;state.running=true;
  const run=()=>{
    if(active!==state)return;
    const target=document.querySelector<HTMLElement>(`.approved-saved-folio[data-record="${CSS.escape(id)}"]`);if(!target)return;
    const to=target.getBoundingClientRect(),from=state.node.getBoundingClientRect();
    state.jobs.forEach(a=>a.cancel());
    Object.assign(state.node.style,{left:`${from.x}px`,top:`${from.y}px`,width:`${from.width}px`,height:`${from.height}px`,transform:'none'});
    const options:KeyframeAnimationOptions={duration:480,easing:'cubic-bezier(.22,.68,.22,1)',fill:'both'};
    state.jobs=[state.node.animate([{left:`${from.x}px`,top:`${from.y}px`,width:`${from.width}px`,height:`${from.height}px`,borderRadius:'5px',opacity:1,transform:'rotate(-12deg)'},{left:`${to.x}px`,top:`${to.y}px`,width:`${to.width}px`,height:`${Math.min(to.height,innerHeight-to.y)}px`,borderRadius:'0px',opacity:0,transform:'rotate(0deg)'}],options),target.animate([{opacity:0},{opacity:0,offset:.56},{opacity:1}],options)];
    const preview=state.node.querySelector<HTMLElement>('.approved-pocket-preview');
    if(preview)state.jobs.push(preview.animate([{transform:`scale(${from.width/360})`},{transform:`scale(${to.width/360})`}],options));
    void Promise.allSettled(state.jobs.map(a=>a.finished)).then(state.dispose);
  };
  void document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(run)));
}
export function finishSavedReturn(id: string | undefined) {
  const state=active;if(!state?.reverse||state.running)return;
  if(id&&id!==state.id){state.dispose();return;}
  const target=document.querySelector<HTMLElement>(`[data-pocket-record="${CSS.escape(state.id)}"]`);if(!target)return;
  state.running=true;
  const to=target.getBoundingClientRect(),from=state.box;
  const job=state.node.animate([{transform:'none',opacity:1},{transform:`translate(${to.x-from.x}px,${to.y-from.y}px) rotate(-7deg) scale(${to.width/from.width})`,opacity:0}],{duration:430,easing:'cubic-bezier(.22,.68,.22,1)',fill:'both'});state.jobs.push(job);
  void job.finished.then(state.dispose,state.dispose);
}
