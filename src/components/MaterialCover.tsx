import { allocatedCover } from '../lib/materialCover';

export default function MaterialCover({ src, identity, className = '' }: { src: string; identity: string; className?: string }) {
  return <img className={className} src={src} alt="" draggable={false} onError={event => {
    const fallback = allocatedCover(identity);
    if (!event.currentTarget.src.endsWith(fallback)) event.currentTarget.src = fallback;
  }}/>;
}
