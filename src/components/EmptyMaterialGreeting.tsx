import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaQuery } from './useMediaQuery';
import { hasGreetedEmptyMaterial, markEmptyMaterialGreeted } from '../lib/emptyMaterialGreeting';

const duration = 6160;
const artwork = '/design/empty-material/';

export default function EmptyMaterialGreeting() {
  const { t } = useTranslation();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [playing, setPlaying] = useState(() => !hasGreetedEmptyMaterial() && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { markEmptyMaterialGreeted(); }, []);
  useEffect(() => { if (reducedMotion) setPlaying(false); }, [reducedMotion]);
  useEffect(() => {
    if (!playing || !loaded) return;
    const timer = setTimeout(() => setPlaying(false), duration);
    return () => clearTimeout(timer);
  }, [playing, loaded]);
  const animate = playing && !reducedMotion;
  return <div className="approved-empty-material" data-playback={animate ? 'playing' : 'waiting'}>
    <div className="approved-empty-material-figure" aria-hidden="true">
      <img src={`${artwork}${animate ? 'greeting-once.gif' : 'waiting.png'}`} alt="" width={220} height={280} decoding="async" onLoad={() => setLoaded(true)} onError={() => setPlaying(false)}/>
    </div>
    <p>{t('approved.emptyMaterials')}</p>
  </div>;
}
