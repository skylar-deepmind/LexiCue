import {useEffect,useRef,type RefObject} from 'react';
/** Focus ownership for overlays scoped to the sample window, without a body portal. */
export function useSampleFocus(panel:RefObject<HTMLElement>,root:RefObject<HTMLDivElement>,onClose:()=>void,initial='input:not(:disabled),select:not(:disabled)',enabled=true){
 const close=useRef(onClose);
 useEffect(()=>{close.current=onClose;},[onClose]);
 useEffect(()=>{
  const element=panel.current,box=root.current;if(!enabled||!element||!box)return;
  const opener=document.activeElement as HTMLElement,shell=box.querySelector<HTMLElement>('.sample-shell');const wasInert=shell?.inert;if(shell)shell.inert=true;
  const focusable=()=>[...element.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(el=>el.getClientRects().length);
  (element.querySelector<HTMLElement>(initial)||focusable()[0]||element).focus({preventScroll:true});
  const keys=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close.current();}else if(event.key==='Tab'){const items=focusable();if(!items.length){event.preventDefault();element.focus({preventScroll:true});return;}const active=document.activeElement;if(!element.contains(active)||!items.includes(active as HTMLElement)||event.shiftKey&&active===items[0]||!event.shiftKey&&active===items.at(-1)){event.preventDefault();(event.shiftKey?items.at(-1):items[0]).focus({preventScroll:true});}}};
  document.addEventListener('keydown',keys);
  return()=>{document.removeEventListener('keydown',keys);if(shell)shell.inert=wasInert||false;if(opener?.isConnected)opener.focus({preventScroll:true});};
 },[panel,root,initial,enabled]);
}
