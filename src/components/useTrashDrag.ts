import { useLayoutEffect, useRef, type RefObject } from 'react';
import i18n from '../i18n';
import { visualCopy } from '../lib/visualSnapshot';

type Removal = { id: string; label: string; remove: () => Promise<boolean>; disabled?: boolean };
type Session = { node: HTMLElement; commit: () => void; move: (x: number, y: number) => void; release: (x: number, y: number) => void; cancel: () => void; busy: boolean };
let current: Session | null = null;
export const isTrashDragging = () => !!current;


function lift(node: HTMLElement, spec: Removal, x: number, y: number, keyboard=false): Session {
  current?.cancel();
  const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const rect=node.getBoundingClientRect(),visibility=node.style.visibility,copy=visualCopy(node);
  const layer=document.createElement('div');layer.className='trash-drag-layer figma-shell';
  const ghost=document.createElement('div');ghost.className='trash-drag-ghost';ghost.setAttribute('aria-hidden','true');
  Object.assign(ghost.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,transformOrigin:'0 0'});
  Object.assign(copy.style,{position:'relative',inset:'auto',width:'100%',height:'100%',margin:'0',transform:'none',visibility:'visible'});ghost.append(copy);
  const basket=document.createElement('button');basket.type='button';basket.className='trash-drop-target';basket.setAttribute('aria-label',`${i18n.t('common.delete')} · ${spec.label}`);
  basket.innerHTML='<svg viewBox="0 0 64 72" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="trash-paper" d="m25 24-3-13 12-3 7 14"/><g class="trash-bin-body"><path class="trash-body" d="M13 27q19-7 38 0l-5 33q-1 7-14 7T18 60Z"/><path class="trash-rim" d="M13 27q19 8 38 0"/><path class="trash-ridge" d="m22 37 2 21m18-21-2 21"/><path d="M27 46h.1m9.8 0h.1m-7 6q2 3 4 0"/></g><g class="trash-lid"><path class="trash-cap" d="M10 25q0-9 22-9t22 9q-22 8-44 0Z"/><path d="M25 16v-3q7-5 14 0v3"/></g></svg><span></span>';
  const caption=basket.querySelector('span')!,status=document.createElement('p');status.className='sr-only';status.setAttribute('role','status');status.textContent=i18n.t('approved.dragToTrash');
  layer.append(ghost,basket,status);document.body.append(layer);node.style.visibility='hidden';node.dataset.trashLifted='true';
  const bin=basket.getBoundingClientRect(),cx=bin.left+bin.width/2,cy=bin.top+bin.height*.4;
  const startDistance=Math.max(180,Math.hypot(x-cx,y-cy)),grabX=x-rect.left,grabY=y-rect.top;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let disposed=false,over=false,sealing:ReturnType<typeof setTimeout>|undefined;
  const paint=(hot:boolean)=>{over=hot;basket.dataset.open=String(hot);caption.textContent=i18n.t(hot?'approved.releaseDelete':'approved.dragToTrash');};
  paint(false);
  const inside=(px:number,py:number)=>{const r=basket.getBoundingClientRect();return px>=r.left-12&&px<=r.right+12&&py>=r.top-12&&py<=r.bottom+12;};
  const close=()=>{if(disposed)return;disposed=true;clearTimeout(sealing);node.style.visibility=visibility;delete node.dataset.trashLifted;const restoreFocus=layer.contains(document.activeElement);layer.remove();if(restoreFocus&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true});window.removeEventListener('keydown',key,true);window.removeEventListener('resize',cancel);window.removeEventListener('pagehide',cancel);window.removeEventListener('blur',cancel);document.removeEventListener('pointerdown',outside,true);if(current===session)current=null;};
  const cancel=()=>{if(!session.busy)close();};
  const commit=()=>{
    if(disposed||session.busy)return;
    session.busy=true;basket.disabled=true;basket.setAttribute('aria-busy','true');paint(true);basket.dataset.dropping='true';caption.textContent=i18n.t('common.loading');
    const r=basket.getBoundingClientRect(),tx=r.left+r.width/2-rect.left,ty=r.top+27-rect.top;
    const at=(scale:number,dy:number,angle:number)=>`translate3d(${tx-rect.width*scale/2}px,${ty-rect.height*scale/2+dy}px,0) rotate(${angle}deg) scale(${scale})`;
    const frames=reduced?[{opacity:.92},{opacity:0}]:[
      {transform:ghost.style.transform||'none',opacity:.92,offset:0},
      {transform:at(.16,-18,-9),opacity:1,offset:.4},
      {transform:at(.065,15,7),opacity:.7,offset:.76},
      {transform:at(.012,32,11),opacity:0,offset:1},
    ];
    const motion=ghost.animate(frames,{duration:reduced?100:560,easing:'cubic-bezier(.32,.05,.6,1)',fill:'forwards'});
    sealing=setTimeout(()=>{basket.dataset.sealed='true';},reduced?80:430);
    // Deletion starts exactly at release. Its snapshot survives source unmount,
    // and a rejected write restores the real card after the visible toss.
    let removal:Promise<boolean>;try{removal=spec.remove();}catch{removal=Promise.resolve(false);}
    void Promise.allSettled([motion.finished,removal]).then(close);
  };
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!session.busy){e.preventDefault();e.stopPropagation();cancel();}};
  const outside=(e:PointerEvent)=>{if(!layer.contains(e.target as Node)&&e.target!==node&&!node.contains(e.target as Node)){e.preventDefault();e.stopPropagation();cancel();}};
  const session:Session={node,busy:false,cancel,commit,move:(px,py)=>{
    if(disposed||session.busy)return;
    const proximity=Math.max(0,Math.min(1,1-Math.hypot(px-cx,py-cy)/startDistance)),scale=.96-.69*proximity*proximity;
    ghost.style.transform=`translate3d(${px-x+(1-scale)*grabX}px,${py-y+(1-scale)*grabY-12}px,0) scale(${scale})`;
    ghost.dataset.proximity=String(proximity);paint(inside(px,py));
  },release:(px,py)=>{if(disposed)return;if(inside(px,py)&&over){commit();}else{cancel();}}};
  basket.onclick=commit;window.addEventListener('keydown',key,true);window.addEventListener('resize',cancel);window.addEventListener('pagehide',cancel);window.addEventListener('blur',cancel);document.addEventListener('pointerdown',outside,true);current=session;
  if(keyboard)basket.focus({preventScroll:true});return session;
}

/** Touch scrolling wins before the hold; only an already lifted object owns touchmove. */
export default function useTrashDrag(ref: RefObject<HTMLElement|null>, spec: Removal) {
  const latest=useRef(spec);latest.current=spec;
  useLayoutEffect(()=>{
    const node=ref.current?.querySelector<HTMLElement>('[data-motion-file]')??ref.current;if(!node)return;node.dataset.trashSource='true';
    let pending:{x:number;y:number;id:number;touch:boolean}|null=null,timer:ReturnType<typeof setTimeout>|undefined,suppressUntil=0,session:Session|null=null;
    const clear=()=>{clearTimeout(timer);timer=undefined;pending=null;};
    const begin=(x:number,y:number,id:number,touch:boolean,target:EventTarget|null)=>{if(current?.busy||latest.current.disabled||target instanceof Element&&target.closest('input,textarea,a,summary,[data-no-trash]'))return;if(current?.node===node)current.cancel();session=null;suppressUntil=0;clear();pending={x,y,id,touch};timer=setTimeout(()=>{if(!pending)return;const data=latest.current;session=lift(node,data,x,y);suppressUntil=performance.now()+700;if(!touch)try{node.setPointerCapture(id);}catch{/* A released pointer cannot lift a different object. */}},420);};
    const move=(x:number,y:number,e:Event)=>{if(!pending)return;if(session){if(e.cancelable)e.preventDefault();session.move(x,y);}else if(Math.hypot(x-pending.x,y-pending.y)>7)clear();};
    const end=(x:number,y:number,cancel=false)=>{if(!pending)return;if(session&&session===current){suppressUntil=performance.now()+700;if(cancel)session.cancel();else session.release(x,y);}session=null;clear();};
    const down=(e:PointerEvent)=>{if(e.pointerType!=='touch'&&e.button===0)begin(e.clientX,e.clientY,e.pointerId,false,e.target);};
    const pointerMove=(e:PointerEvent)=>{if(pending&&!pending.touch&&pending.id===e.pointerId)move(e.clientX,e.clientY,e);};
    const up=(e:PointerEvent)=>{if(pending&&!pending.touch&&pending.id===e.pointerId)end(e.clientX,e.clientY,e.type==='pointercancel');};
    const touchStart=(e:TouchEvent)=>{if(e.touches.length===1){const t=e.touches[0];begin(t.clientX,t.clientY,t.identifier,true,e.target);}else{session?.cancel();session=null;clear();}};
    const touchMove=(e:TouchEvent)=>{if(!pending?.touch)return;const t=[...e.touches].find(t=>t.identifier===pending?.id);if(t)move(t.clientX,t.clientY,e);};
    const touchEnd=(e:TouchEvent)=>{if(!pending?.touch)return;const t=[...e.changedTouches].find(t=>t.identifier===pending?.id);if(t)end(t.clientX,t.clientY,e.type==='touchcancel');};
    const click=(e:MouseEvent)=>{if(performance.now()<suppressUntil&&!(e.target instanceof Element&&e.target.closest('[data-no-trash]'))){e.preventDefault();e.stopImmediatePropagation();}};
    const context=(e:Event)=>{e.preventDefault();};
    const key=(e:KeyboardEvent)=>{if(!current?.busy&&!latest.current.disabled&&['Delete','Backspace'].includes(e.key)&&!(e.target as Element).closest('input,textarea')){e.preventDefault();e.stopPropagation();const r=node.getBoundingClientRect();session=lift(node,latest.current,r.left+r.width/2,r.top+r.height/2,true);}};
    node.addEventListener('pointerdown',down);node.addEventListener('pointermove',pointerMove);node.addEventListener('pointerup',up);node.addEventListener('pointercancel',up);node.addEventListener('touchstart',touchStart,{passive:true});node.addEventListener('touchmove',touchMove,{passive:false});node.addEventListener('touchend',touchEnd);node.addEventListener('touchcancel',touchEnd);node.addEventListener('click',click,true);node.addEventListener('contextmenu',context);node.addEventListener('dragstart',context);node.addEventListener('keydown',key);
    return()=>{clear();delete node.dataset.trashSource;if(current?.node===node&&!current.busy)current.cancel();node.removeEventListener('pointerdown',down);node.removeEventListener('pointermove',pointerMove);node.removeEventListener('pointerup',up);node.removeEventListener('pointercancel',up);node.removeEventListener('touchstart',touchStart);node.removeEventListener('touchmove',touchMove);node.removeEventListener('touchend',touchEnd);node.removeEventListener('touchcancel',touchEnd);node.removeEventListener('click',click,true);node.removeEventListener('contextmenu',context);node.removeEventListener('dragstart',context);node.removeEventListener('keydown',key);};
  },[ref,spec.id]);
}
