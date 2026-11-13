import { useEffect, useState, type RefObject } from 'react';
import CollectionPager from './CollectionPager';

/** The page control stays available after the first deliberate scroll. Keyboard
 * users can reveal the same control by tabbing to it, without a second entry. */
export default function FloatingCollectionPager({ scroll, resetKey, ...props }: Parameters<typeof CollectionPager>[0] & {
  scroll: RefObject<HTMLElement | null>; resetKey: string;
}) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    setRevealed(false);
    const node = scroll.current;
    const update = () => { if (node && node.scrollTop > 20) setRevealed(true); };
    update(); node?.addEventListener('scroll', update, { passive: true });
    return () => node?.removeEventListener('scroll', update);
  }, [scroll, resetKey]);
  if (props.total <= props.size) return null;
  return <div className="saved-floating-pager" data-visible={revealed || undefined} onFocusCapture={() => setRevealed(true)}>
    <CollectionPager {...props}/>
  </div>;
}
