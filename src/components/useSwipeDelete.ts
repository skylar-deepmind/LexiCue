import { useLayoutEffect, useRef, type RefObject } from 'react';

/** One gesture owner separates a quiet word press from scrolling and delete reveal. */
export default function useSwipeDelete(ref: RefObject<HTMLElement | null>, open: boolean, onOpen: (open: boolean) => void, enabled: boolean) {
  const latest = useRef({open,onOpen});latest.current={open,onOpen};
  useLayoutEffect(() => {
    const node=ref.current;if(!node)return;
    let drag:{id:number;x:number;y:number;dx:number;active:boolean;tap:boolean;vertical:boolean;base:number;button:HTMLButtonElement}|null=null;
    let suppress=false,timer:ReturnType<typeof setTimeout>,pressTimer:ReturnType<typeof setTimeout>;
    const clearPress=()=>{clearTimeout(pressTimer);node.querySelector('[data-press]')?.removeAttribute('data-press');};
    const suppressClick=()=>{suppress=true;clearTimeout(timer);timer=setTimeout(()=>{suppress=false;},350);};
    const down=(event:PointerEvent)=>{
      const button=(event.target as Element).closest<HTMLButtonElement>('.saved-record-open');
      if(event.button!==0||!button||button.disabled)return;
      clearPress();clearTimeout(timer);suppress=false;
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,active:false,tap:true,vertical:false,base:latest.current.open?-72:0,button};
      pressTimer=setTimeout(()=>{if(drag?.tap)button.dataset.press='true';},75);
    };
    const move=(event:PointerEvent)=>{
      if(!drag||drag.id!==event.pointerId)return;
      const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if(Math.hypot(dx,dy)>7){drag.tap=false;clearPress();}
      if(!enabled||drag.vertical)return;
      if(!drag.active){if(Math.abs(dy)>Math.abs(dx)+6){drag.vertical=true;return;}if(Math.abs(dx)<8)return;drag.active=true;node.setPointerCapture(event.pointerId);node.dataset.swiping='true';}
      event.preventDefault();drag.dx=dx;
      node.style.setProperty('--swipe-shift',`${Math.max(-88,Math.min(0,drag.base+dx))}px`);
    };
    const end=(event:PointerEvent)=>{
      if(!drag||drag.id!==event.pointerId)return;
      const gesture=drag;drag=null;clearPress();delete node.dataset.swiping;node.style.removeProperty('--swipe-shift');
      if(node.hasPointerCapture(event.pointerId))node.releasePointerCapture(event.pointerId);
      if(!gesture.active){
        if(!gesture.tap||event.type==='pointercancel')suppressClick();
        else if(event.type==='pointerup'){gesture.button.dataset.press='true';pressTimer=setTimeout(clearPress,110);}
        return;
      }
      suppressClick();
      latest.current.onOpen(event.type==='pointercancel'?latest.current.open:gesture.base+gesture.dx < -32);
    };
    const click=(event:MouseEvent)=>{if(suppress){event.preventDefault();event.stopImmediatePropagation();suppress=false;}};
    const key=(event:KeyboardEvent)=>{if(['Enter',' '].includes(event.key)&&(event.target as Element).matches('.saved-record-open')){suppress=false;clearPress();if(event.type==='keydown')(event.target as HTMLElement).dataset.press='true';}};
    const blur=()=>{clearPress();};
    node.addEventListener('pointerdown',down);node.addEventListener('pointermove',move);node.addEventListener('pointerup',end);node.addEventListener('pointercancel',end);node.addEventListener('click',click,true);
    node.addEventListener('keydown',key);node.addEventListener('keyup',key);node.addEventListener('focusout',blur);
    return()=>{clearTimeout(timer);clearPress();node.style.removeProperty('--swipe-shift');delete node.dataset.swiping;node.removeEventListener('pointerdown',down);node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',end);node.removeEventListener('pointercancel',end);node.removeEventListener('click',click,true);node.removeEventListener('keydown',key);node.removeEventListener('keyup',key);node.removeEventListener('focusout',blur);};
  },[ref,enabled]);
}
