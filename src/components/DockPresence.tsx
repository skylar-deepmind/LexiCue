import { useEffect, useState, type ReactNode } from 'react';

/** Keep one inert exit layer until its space has finished folding away. */
export default function DockPresence({ visible, children, className = '' }: { visible: boolean; children: ReactNode; className?: string }) {
  const [present, setPresent] = useState(visible);
  useEffect(() => {
    if (visible) { setPresent(true); return; }
    const timer = setTimeout(() => setPresent(false), 350);
    return () => clearTimeout(timer);
  }, [visible]);
  return <div className={`dock-presence ${className}`} data-visible={visible} inert={!visible} aria-hidden={!visible}>
    <div className="dock-presence-clip">{(visible || present) && children}</div>
  </div>;
}
