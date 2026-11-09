import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Follow asynchronous content growth without restarting a grid/layout transition. */
export default function SmoothDisclosure({open, id, children}: {open: boolean; id: string; children: ReactNode}) {
  const root = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const motion = useRef<Animation | null>(null);
  const currentOpen = useRef(open); currentOpen.current = open;
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const node=root.current!, inner=content.current!;
    const update=() => {
      const height=currentOpen.current ? inner.getBoundingClientRect().height : 0;
      const from=node.getBoundingClientRect().height;
      motion.current?.cancel(); motion.current=null;
      delete node.dataset.moving;
      node.style.height=`${height}px`;
      if (!mounted.current || matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(from-height)<1 || inner.contains(document.activeElement)) return;
      node.dataset.moving='true';
      const animation=node.animate([{height:`${from}px`},{height:`${height}px`}],{duration:260,easing:'cubic-bezier(.22,1,.36,1)'});
      motion.current=animation;
      void animation.finished.then(()=>{if(motion.current===animation){motion.current=null;delete node.dataset.moving;}},()=>{});
    };
    update(); mounted.current=true;
    const observer=new ResizeObserver(update); observer.observe(inner);
    return ()=>{observer.disconnect();motion.current?.cancel();delete node.dataset.moving;};
  },[open]);
  return <div ref={root} id={id} className="saved-disclosure" data-open={open} inert={!open} aria-hidden={!open}><div ref={content} className="saved-disclosure-content">{children}</div></div>;
}
