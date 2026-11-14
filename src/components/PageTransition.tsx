import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useNavigationType } from 'react-router-dom';

/** Keep the shell opaque and stationary; never clone a composited WebView page. */
export default function PageTransition({ pageKey, children }: { pageKey: string; children: ReactNode }) {
  const live = useRef<HTMLDivElement>(null), previous = useRef(pageKey);
  const navigation = useNavigationType();
  useLayoutEffect(() => {
    if (previous.current === pageKey) return;
    previous.current = pageKey;
    const root = live.current;
    if (!root || matchMedia('(prefers-reduced-motion: reduce)').matches || root.querySelector('[data-library-restored="true"]')) return;
    const content = root.querySelector<HTMLElement>('.reader-scroll,.saved-workspace,.system-settings,.legacy-paper,.reading-desk') ?? root;
    const motion = content.animate([{ translate: `${navigation === 'POP' ? -6 : 6}px 0` }, { translate: '0px 0' }],
      { duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)' });
    return () => motion.cancel();
  }, [pageKey, navigation]);
  return <div className="page-transition"><div className="page-live" ref={live}>{children}</div></div>;
}
