import { useLayoutEffect, useRef } from 'react';

export function deskCardTransform(position: number) {
  const depth=Math.min(Math.abs(position),1), tilt=Math.max(-1,Math.min(1,position));
  return `translateX(calc(${position} * var(--desk-step, 78%))) scale(calc(1 - ${depth} * var(--desk-scale-loss, .14))) rotateY(calc(${-tilt} * var(--desk-y-rotation, 12deg))) rotateZ(calc(${tilt} * var(--desk-z-rotation, 3deg)))`;
}
type Position = {position:number;transform:string;opacity:number};
type Turn = {positions:Map<HTMLElement,Position>};

export function useSoftCardTurn(id:number|null|undefined,index:number,count:number,onStep:(step:number)=>void) {
  const stackRef=useRef<HTMLDivElement>(null), latest=useRef({index,count,onStep});
  const flight=useRef<Turn|null>(null), interrupt=useRef<(()=>void)|null>(null), request=useRef<(direction:number)=>void>(()=>{});
  latest.current={index,count,onStep};
  const available=!!id;
  const snapshot=(stack:HTMLElement) => new Map([...stack.querySelectorAll<HTMLElement>(':scope > .desk-card-viewport > .desk-paper')].map(paper=>[paper,{position:Number(paper.dataset.deskPosition),transform:getComputedStyle(paper).transform,opacity:Number(getComputedStyle(paper).opacity)}]));
  const freeze=(stack:HTMLElement)=>{const poses=snapshot(stack);interrupt.current?.();interrupt.current=null;flight.current=null;poses.forEach((pose,paper)=>{paper.style.transform=pose.transform;paper.style.opacity=String(pose.opacity);});};
  function turn(direction:number) {
    if(interrupt.current&&stackRef.current)freeze(stackRef.current);
    const state=latest.current;
    if(state.index+direction<0||state.index+direction>=state.count)return;
    const stack=stackRef.current;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches||!stack){state.onStep(direction);return;}
    flight.current={positions:snapshot(stack)};state.onStep(direction);
  }
  request.current=turn;
  useLayoutEffect(()=>{
    const turn=flight.current,stack=stackRef.current;
    if(!turn||!stack||!id){flight.current=null;return;}
    let cancelled=false;const animations:Animation[]=[],moving:HTMLElement[]=[];
    stack.dataset.turning='true';
    for(const [paper,before] of turn.positions){
      if(!paper.isConnected)continue;
      const after=Number(paper.dataset.deskPosition);
      if(Math.abs(before.position)>1&&Math.abs(after)>1)continue;
      paper.style.opacity=Math.abs(after)<=1?'1':'0';
      paper.style.visibility='visible';paper.style.zIndex=after===0?'5':before.position===0?'4':'2';moving.push(paper);
      animations.push(paper.animate([{transform:before.transform,opacity:before.opacity},{transform:getComputedStyle(paper).transform,opacity:Math.abs(after)<=1?1:0}],{duration:460,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'}));
    }
    const start=document.timeline.currentTime;if(typeof start==='number')animations.forEach(a=>{a.startTime=start;});
    const clear=()=>{animations.forEach(a=>a.cancel());moving.forEach(p=>{p.style.removeProperty('visibility');p.style.removeProperty('z-index');});delete stack.dataset.turning;if(flight.current===turn)flight.current=null;if(interrupt.current===clear)interrupt.current=null;};
    interrupt.current=clear;
    void Promise.all(animations.map(a=>a.finished)).then(()=>{if(!cancelled)clear();},()=>{});
    const resize=()=>animations.forEach(a=>a.finish());
    window.addEventListener('resize',resize);
    return()=>{cancelled=true;window.removeEventListener('resize',resize);clear();};
  },[id,index,count]);
  useLayoutEffect(()=>{
    const stack=stackRef.current;if(!stack)return;
    let drag:{id:number;x:number;y:number;dx:number;base:number;width:number;active:boolean;interrupted:boolean;start:number}|null=null,suppress=false,frame=0,timer:ReturnType<typeof setTimeout>;
    const cards=()=>[...stack.querySelectorAll<HTMLElement>(':scope > .desk-card-viewport > .desk-paper')];
    const settle=()=>{
      const animations:Animation[]=[];
      cards().forEach(p=>{const from=getComputedStyle(p).transform;p.style.transform=deskCardTransform(Number(p.dataset.deskPosition));p.style.opacity=Math.abs(Number(p.dataset.deskPosition))<=1?'1':'0';if(!matchMedia('(prefers-reduced-motion: reduce)').matches)animations.push(p.animate([{transform:from},{transform:getComputedStyle(p).transform}],{duration:280,easing:'cubic-bezier(.22,1,.36,1)'}));});
      const cancel=()=>{animations.forEach(a=>a.cancel());if(interrupt.current===cancel)interrupt.current=null;};interrupt.current=cancel;
      void Promise.all(animations.map(a=>a.finished)).then(()=>{if(interrupt.current===cancel)interrupt.current=null;},()=>{});
    };
    const paint=()=>{frame=0;if(!drag)return;const fraction=drag.base+drag.dx/(drag.width+5);cards().forEach(p=>{const position=Number(p.dataset.deskPosition)+fraction;p.style.transform=deskCardTransform(position);p.style.opacity=String(Math.max(0,Math.min(1,2-Math.abs(position))));});};
    const down=(event:PointerEvent)=>{
      if(innerWidth>=768||event.button!==0||(event.target as Element).closest('.desk-paper-top,.desk-card-tags,.desk-swipe-cue'))return;
      const interrupted=!!interrupt.current;if(interrupted)freeze(stack);
      const active=stack.querySelector<HTMLElement>('[data-desk-active="true"]'),width=active?.offsetWidth??300;
      const base=active?new DOMMatrixReadOnly(getComputedStyle(active).transform).m41/(width+5):0;
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,base,width,active:false,interrupted,start:performance.now()};
    };
    const move=(event:PointerEvent)=>{
      if(!drag||drag.id!==event.pointerId)return;
      let dx=event.clientX-drag.x;const dy=event.clientY-drag.y;
      if(!drag.active){if(Math.abs(dy)>Math.abs(dx)+6){if(drag.interrupted)settle();drag=null;return;}if(Math.abs(dx)<8)return;drag.active=true;stack.setPointerCapture(event.pointerId);stack.dataset.dragging='true';}
      event.preventDefault();
      const state=latest.current;if(state.index===0&&dx>0||state.index===state.count-1&&dx<0)dx*=.22;
      drag.dx=dx;if(!frame)frame=requestAnimationFrame(paint);
    };
    const end=(event:PointerEvent)=>{
      if(!drag||drag.id!==event.pointerId)return;
      cancelAnimationFrame(frame);paint();const gesture=drag;drag=null;delete stack.dataset.dragging;
      if(!gesture.active){if(gesture.interrupted)settle();return;}
      suppress=true;clearTimeout(timer);timer=setTimeout(()=>{suppress=false;},350);
      if(stack.hasPointerCapture(event.pointerId))stack.releasePointerCapture(event.pointerId);
      const state=latest.current,direction=gesture.dx<0?1:-1;
      const commit=event.type!=='pointercancel'&&(Math.abs(gesture.dx)>55||Math.abs(gesture.dx)>22&&performance.now()-gesture.start<260)&&state.index+direction>=0&&state.index+direction<state.count;
      if(commit){request.current(direction);return;}
      settle();
    };
    const click=(event:MouseEvent)=>{if(suppress){event.preventDefault();event.stopImmediatePropagation();suppress=false;}};
    const key=(event:KeyboardEvent)=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();request.current(event.key==='ArrowRight'?1:-1);}};
    stack.addEventListener('pointerdown',down);stack.addEventListener('pointermove',move);stack.addEventListener('pointerup',end);stack.addEventListener('pointercancel',end);stack.addEventListener('click',click,true);stack.addEventListener('keydown',key);
    return()=>{cancelAnimationFrame(frame);interrupt.current?.();clearTimeout(timer);stack.removeEventListener('pointerdown',down);stack.removeEventListener('pointermove',move);stack.removeEventListener('pointerup',end);stack.removeEventListener('pointercancel',end);stack.removeEventListener('click',click,true);stack.removeEventListener('keydown',key);};
  },[available]);
  return {stackRef,turn};
}
