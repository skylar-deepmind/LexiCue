import { useLayoutEffect, type RefObject } from 'react';

/** Reveal a thumb only when user input produces an actual scroll. */
export function useQuietScrollbars(ref: RefObject<HTMLElement | null>, mounted: boolean) {
  useLayoutEffect(() => {
    const card=ref.current;
    if (!mounted || !card) return;
    let armedUntil=0, timer: ReturnType<typeof setTimeout> | undefined;
    const locked=()=>!!document.querySelector('.context-panel[data-refresh-transition]') || card.dataset.closing==='true' || card.hasAttribute('data-refresh-sizing') || !!card.querySelector('.soft-refresh[data-refresh-state="revealing"]') || !!card.closest('[data-lookup-moving],[data-page-moving]') || !!card.querySelector('[data-lookup-moving],[data-page-moving],[data-motion-moving]');
    const hide=()=>{ clearTimeout(timer); card.removeAttribute('data-user-scrolling'); card.querySelectorAll('[data-user-scrolling]').forEach(node=>node.removeAttribute('data-user-scrolling')); };
    const intent=()=>{ if (!locked()) armedUntil=performance.now()+300; };
    const key=(event: KeyboardEvent)=>{ if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) intent(); };
    const scroll=(event: Event)=>{ if (locked()) { hide(); return; } const node=event.target; if (performance.now()>armedUntil || !(node instanceof HTMLElement) || node.scrollHeight<=node.clientHeight) return; hide(); node.dataset.userScrolling='true'; timer=setTimeout(hide,800); };
    const observer=new MutationObserver(()=>{ if (locked()) { armedUntil=0; hide(); } });
    observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-refresh-state','data-refresh-sizing','data-refresh-transition','data-closing','data-motion-moving','data-lookup-moving','data-page-moving','data-open']});
    card.addEventListener('wheel',intent,{passive:true}); card.addEventListener('touchmove',intent,{passive:true}); card.addEventListener('keydown',key); card.addEventListener('scroll',scroll,true);
    return ()=>{ hide(); observer.disconnect(); card.removeEventListener('wheel',intent); card.removeEventListener('touchmove',intent); card.removeEventListener('keydown',key); card.removeEventListener('scroll',scroll,true); };
  },[ref,mounted]);
}
