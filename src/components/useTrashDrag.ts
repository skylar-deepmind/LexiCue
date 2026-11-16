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
  Object.assign(ghost.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
  Object.assign(copy.style,{position:'relative',inset:'auto',width:'100%',height:'100%',margin:'0',transform:'none',visibility:'visible'});ghost.append(copy);
  const basket=document.createElement('button');basket.type='button';basket.className='trash-drop-target';basket.setAttribute('aria-label',`${i18n.t('common.delete')} · ${spec.label}`);
  basket.innerHTML='<svg viewBox="0 0 48 56" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g class="trash-lid"><path d="M7 13h34M18 12V6h12v6"/></g><path d="m10 16 3 32q0 3 3 3h16q3 0 3-3l3-32M19 24v19M29 24v19"/></svg><span></span>';
  const caption=basket.querySelector('span')!,status=document.createElement('p');status.className='sr-only';status.setAttribute('role','status');status.textContent=i18n.t('approved.dragToTrash');
  layer.append(ghost,basket,status);document.body.append(layer);node.style.visibility='hidden';node.dataset.trashLifted='true';
  let disposed=false,over=false,moved=false;
  const paint=(hot:boolean)=>{over=hot;basket.dataset.open=String(hot);caption.textContent=i18n.t(hot?'approved.releaseDelete':'approved.dragToTrash');};
  paint(false);
  const inside=(px:number,py:number)=>{const r=basket.getBoundingClientRect();return px>=r.left-12&&px<=r.right+12&&py>=r.top-12&&py<=r.bottom+12;};
  const close=()=>{if(disposed)return;disposed=true;node.style.visibility=visibility;delete node.dataset.trashLifted;const restoreFocus=layer.contains(document.activeElement);layer.remove();if(restoreFocus&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true});window.removeEventListener('keydown',key,true);window.removeEventListener('resize',cancel);window.removeEventListener('pagehide',cancel);window.removeEventListener('blur',cancel);document.removeEventListener('pointerdown',outside,true);if(current===session)current=null;};
  const cancel=()=>{close();};
  const commit=()=>{if(disposed||session.busy)return;session.busy=true;basket.disabled=true;basket.setAttribute('aria-busy','true');paint(true);void spec.remove().then(close,close);};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel();}};
  const outside=(e:PointerEvent)=>{if(!layer.contains(e.target as Node)&&e.target!==node&&!node.contains(e.target as Node)){e.preventDefault();e.stopPropagation();cancel();}};
  const session:Session={node,busy:false,cancel,commit,move:(px,py)=>{if(disposed||session.busy)return;moved ||= Math.hypot(px-x,py-y)>8;ghost.style.transform=`translate3d(${px-x}px,${py-y-12}px,0) scale(.96)`;paint(inside(px,py));},release:(px,py)=>{if(disposed)return;if(inside(px,py)&&over){commit();}else if(moved){cancel();}else{basket.focus({preventScroll:true});}}};
  basket.onclick=commit;window.addEventListener('keydown',key,true);window.addEventListener('resize',cancel,{once:true});window.addEventListener('pagehide',cancel,{once:true});window.addEventListener('blur',cancel,{once:true});document.addEventListener('pointerdown',outside,true);current=session;
  if(keyboard)basket.focus({preventScroll:true});return session;
}

/** Touch scrolling wins before the hold; only an already lifted object owns touchmove. */
export default function useTrashDrag(ref: RefObject<HTMLElement|null>, spec: Removal) {
  const latest=useRef(spec);latest.current=spec;
  useLayoutEffect(()=>{
    const node=ref.current?.querySelector<HTMLElement>('[data-motion-file]')??ref.current;if(!node)return;node.dataset.trashSource='true';
    let pending:{x:number;y:number;id:number;touch:boolean}|null=null,timer:ReturnType<typeof setTimeout>|undefined,suppressUntil=0,session:Session|null=null;
    const clear=()=>{clearTimeout(timer);timer=undefined;pending=null;};
    const begin=(x:number,y:number,id:number,touch:boolean,target:EventTarget|null)=>{if(current?.busy||latest.current.disabled||target instanceof Element&&target.closest('input,textarea,a,summary,[data-no-trash]'))return;clear();pending={x,y,id,touch};timer=setTimeout(()=>{if(!pending)return;const data=latest.current;session=lift(node,data,x,y);suppressUntil=performance.now()+700;if(!touch)try{node.setPointerCapture(id);}catch{/* A released pointer cannot lift a different object. */}},420);};
    const move=(x:number,y:number,e:Event)=>{if(!pending)return;if(session){if(e.cancelable)e.preventDefault();session.move(x,y);}else if(Math.hypot(x-pending.x,y-pending.y)>7)clear();};
    const end=(x:number,y:number,cancel=false)=>{if(!pending)return;if(session){suppressUntil=performance.now()+700;if(cancel)session.cancel();else session.release(x,y);session=null;}clear();};
    const down=(e:PointerEvent)=>{if(e.pointerType!=='touch'&&e.button===0)begin(e.clientX,e.clientY,e.pointerId,false,e.target);};
    const pointerMove=(e:PointerEvent)=>{if(pending&&!pending.touch&&pending.id===e.pointerId)move(e.clientX,e.clientY,e);};
    const up=(e:PointerEvent)=>{if(pending&&!pending.touch&&pending.id===e.pointerId)end(e.clientX,e.clientY,e.type==='pointercancel');};
    const touchStart=(e:TouchEvent)=>{if(e.touches.length===1){const t=e.touches[0];begin(t.clientX,t.clientY,t.identifier,true,e.target);}else{session?.cancel();session=null;clear();}};
    const touchMove=(e:TouchEvent)=>{if(!pending?.touch)return;const t=[...e.touches].find(t=>t.identifier===pending?.id);if(t)move(t.clientX,t.clientY,e);};
    const touchEnd=(e:TouchEvent)=>{if(!pending?.touch)return;const t=[...e.changedTouches].find(t=>t.identifier===pending?.id);if(t)end(t.clientX,t.clientY,e.type==='touchcancel');};
    const click=(e:MouseEvent)=>{if(performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}};
    const context=(e:Event)=>{e.preventDefault();};
    const key=(e:KeyboardEvent)=>{if(!current?.busy&&!latest.current.disabled&&['Delete','Backspace'].includes(e.key)&&!(e.target as Element).closest('input,textarea')){e.preventDefault();e.stopPropagation();const r=node.getBoundingClientRect();session=lift(node,latest.current,r.left+r.width/2,r.top+r.height/2,true);}};
    node.addEventListener('pointerdown',down);node.addEventListener('pointermove',pointerMove);node.addEventListener('pointerup',up);node.addEventListener('pointercancel',up);node.addEventListener('touchstart',touchStart,{passive:true});node.addEventListener('touchmove',touchMove,{passive:false});node.addEventListener('touchend',touchEnd);node.addEventListener('touchcancel',touchEnd);node.addEventListener('click',click,true);node.addEventListener('contextmenu',context);node.addEventListener('dragstart',context);node.addEventListener('keydown',key);
    return()=>{clear();delete node.dataset.trashSource;if(current?.node===node)current.cancel();node.removeEventListener('pointerdown',down);node.removeEventListener('pointermove',pointerMove);node.removeEventListener('pointerup',up);node.removeEventListener('pointercancel',up);node.removeEventListener('touchstart',touchStart);node.removeEventListener('touchmove',touchMove);node.removeEventListener('touchend',touchEnd);node.removeEventListener('touchcancel',touchEnd);node.removeEventListener('click',click,true);node.removeEventListener('contextmenu',context);node.removeEventListener('dragstart',context);node.removeEventListener('keydown',key);};
  },[ref,spec.id]);
}
