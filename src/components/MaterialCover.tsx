import { allocatedCover } from '../lib/materialCover';

export default function MaterialCover({ src, identity, className = '' }: {
  src: string; identity: string; className?: string;
}) {
  const fallback = allocatedCover(identity);
  return <img className={className} src={src.startsWith('https:') ? fallback : src} alt="" draggable={false} onError={event => {
    if (!event.currentTarget.src.endsWith(fallback)) event.currentTarget.src = fallback;
  }}/>;
}
