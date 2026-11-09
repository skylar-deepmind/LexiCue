import { useId, useLayoutEffect, useRef, type CSSProperties } from 'react';
import appLogo from '../media/app-logo.png';
import './desktop-launch.css';

export const DESKTOP_LAUNCH_DURATION = 4200;
export const DESKTOP_LAUNCH_SPEED = 1.7;
export const DESKTOP_LAUNCH_SLOGAN = '让每一次遇见，都留下记忆。';
export type LaunchContraction = 'scale' | 'vertical' | 'inset' | 'circle';

const ENCOUNTERS = [
  { x: 42, y: 16, scale: .42, angle: 5, arrive: 380 },
  { x: -57, y: 69, scale: .62, angle: -7, arrive: 530 },
  { x: 111, y: 106, scale: .76, angle: 7, arrive: 680 },
  { x: -140, y: 146, scale: .95, angle: -6, arrive: 830 },
  { x: 79, y: 192, scale: 1.14, angle: 5, arrive: 980 },
];
const MOBILE_ENCOUNTERS = [
  { x: 30, y: 4, scale: .42, angle: 5, arrive: 380 },
  { x: -49, y: 64, scale: .62, angle: -7, arrive: 530 },
  { x: 83, y: 122, scale: .76, angle: 7, arrive: 680 },
  { x: -105, y: 180, scale: .95, angle: -6, arrive: 830 },
  { x: 61, y: 235, scale: 1.14, angle: 5, arrive: 980 },
];

/** Shared launch choreography. The mobile variant only changes composition. */
export default function DesktopLaunch({ variant = 'desktop', contraction = 'scale' }: { variant?: 'desktop' | 'mobile'; contraction?: LaunchContraction }) {
  const id = useId().replaceAll(':', '');
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = stage.current;
    if (!root) return;
    const lockup = root.querySelector<HTMLElement>('.desktop-launch__lockup')!;
    const logo = root.querySelector<HTMLImageElement>('.desktop-launch__logo')!;
    const fitBackdrop = () => {
      // Overscan covers the rounded corners at the opening. Size is measured
      // only on mount/resize; the contraction itself uses compositor transforms.
      const { width, height, top } = root.getBoundingClientRect();
      const tileTop = logo.getBoundingClientRect().top - top + 3;
      root.style.setProperty('--launch-backdrop-scale-x', String(width * 1.2 / 98));
      root.style.setProperty('--launch-backdrop-scale-y', String(height * 1.2 / 98));
      root.style.setProperty('--launch-backdrop-aspect', String(height / width));
      root.style.setProperty('--launch-backdrop-circle-scale', String(Math.hypot(width / 2, Math.max(tileTop + 49, height - tileTop - 49)) * 2 / 98));
      root.style.setProperty('--launch-backdrop-top', `${tileTop}px`);
      root.style.setProperty('--launch-backdrop-shift-y', `${height * .5 - tileTop - 49}px`);
    };
    fitBackdrop();
    const observer = new ResizeObserver(fitBackdrop);
    observer.observe(root);
    observer.observe(lockup);
    return () => observer.disconnect();
  }, []);
  const road = 'M74 256C52 238 34 220 41 202C47 183 95 184 121 171C135 163 127 153 126 144C143 160 146 173 125 183C109 192 81 194 81 203C81 214 138 236 173 256Z';
  return (
    <div ref={stage} className={`desktop-launch${variant === 'mobile' ? ' desktop-launch--mobile' : ''}`} data-contraction={variant === 'mobile' ? contraction : undefined} role="img" aria-label={`LexiCue，${DESKTOP_LAUNCH_SLOGAN}`}>
      <div className="desktop-launch__backdrop" aria-hidden="true">
        {variant === 'mobile' && contraction === 'vertical' && <div className="mobile-launch__backdrop-aspect"><div className="mobile-launch__backdrop-fill" /></div>}
      </div>
      <div className="desktop-launch__lockup" aria-hidden="true">
        <svg className="desktop-launch__road" viewBox="0 0 256 256" fill="none">
          <defs>
            <linearGradient id={`${id}-surface`} x1="61" y1="192" x2="163" y2="240" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--launch-road-edge)" />
              <stop offset=".38" stopColor="var(--launch-road-mid)" />
              <stop offset=".75" stopColor="var(--launch-road-shade)" />
              <stop offset="1" stopColor="var(--launch-road-deep)" />
            </linearGradient>
            <linearGradient id={`${id}-shine`} x1="59" y1="211" x2="139" y2="181" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--launch-road-line)" stopOpacity=".12" />
              <stop offset=".55" stopColor="var(--launch-road-line)" stopOpacity=".45" />
              <stop offset="1" stopColor="var(--launch-road-edge)" />
            </linearGradient>
            <linearGradient id={`${id}-end`} x1="0" y1="140" x2="0" y2="256" gradientUnits="userSpaceOnUse">
              <stop offset=".77" stopColor="white" />
              <stop offset="1" stopColor="black" />
            </linearGradient>
            <mask id={`${id}-fade`}><rect width="256" height="256" fill={`url(#${id}-end)`} /></mask>
            <clipPath id={`${id}-clip`}><path d={road} /></clipPath>
            <filter id={`${id}-bloom`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
          </defs>
          <g className="desktop-launch__road-reveal" mask={`url(#${id}-fade)`}>
            <path d={road} fill="var(--launch-cue)" opacity=".35" filter={`url(#${id}-bloom)`} />
            <path d="M74 256C52 238 34 220 41 202L42 212C46 230 66 246 82 256ZM81 203C81 214 138 236 173 256H182C145 231 89 213 81 203Z" fill="var(--launch-road-deep)" opacity=".65" />
            <path d={road} fill={`url(#${id}-surface)`} />
            <path d="M75 256C38 224 25 205 57 194C77 187 105 184 121 175C138 166 129 153 126 144C135 163 124 174 103 181C81 188 61 193 61 203C61 219 109 239 130 256Z" fill={`url(#${id}-shine)`} />
            <path d="M74 256C52 238 34 220 41 202C47 183 95 184 121 171C135 163 127 153 126 144" stroke="var(--launch-road-edge)" strokeWidth=".8" opacity=".85" />
            <path d="M126 144C143 160 146 173 125 183C109 192 81 194 81 203C81 214 138 236 173 256" stroke="var(--launch-cue-tip)" strokeWidth=".65" opacity=".65" />
            <g clipPath={`url(#${id}-clip)`}>
              <path className="desktop-launch__lane-flow" pathLength="100" d="M128 154C140 181 68 185 65 201C61 217 119 242 138 256" stroke="var(--launch-road-line)" strokeWidth="1.2" strokeDasharray="1 9" opacity=".7" />
              <g className="desktop-launch__lanes" fill="var(--launch-road-line)">
                <path d="M126 164L127 166L129 165L128 163Z" />
                <path d="M116 178L111 180L113 182L118 179Z" />
                <path d="M84 189L77 192L80 195L87 192Z" />
                <path d="M69 207L76 213L81 210L73 205Z" />
                <path d="M91 225L103 234L110 231L98 222Z" />
                <path d="M122 245L139 256H149L131 241Z" />
              </g>
            </g>
            <path className="desktop-launch__horizon" d="M135 165C166 166 197 182 220 198" stroke="var(--launch-cue)" strokeWidth="1" />
          </g>
        </svg>
        <svg className="desktop-launch__symbols" width="0" height="0">
          <defs>
            <clipPath id={`${id}-card-silhouette`}>
              <rect x="180" y="54" width="35" height="90" rx="14" />
              <rect x="156" y="35" width="46" height="109" rx="24" />
              <rect x="57" y="35" width="137" height="109" rx="30" />
            </clipPath>
            <symbol id={`${id}-conversation`} viewBox="0 0 256 256">
              <image href={appLogo} width="256" height="256" clipPath={`url(#${id}-card-silhouette)`} />
            </symbol>
          </defs>
        </svg>
        <div className="desktop-launch__halo" />
        <img className="desktop-launch__logo" src={appLogo} width="104" height="104" alt="" draggable="false" />
        <div className="desktop-launch__encounters">
          {(variant === 'mobile' ? MOBILE_ENCOUNTERS : ENCOUNTERS).map((card, index) => (
            <div key={index} className="desktop-launch__encounter" style={{
              '--encounter-x': `${card.x}px`, '--encounter-y': `${card.y}px`,
              '--encounter-scale': card.scale, '--encounter-angle': `${card.angle}deg`,
              '--encounter-arrive': `${card.arrive}ms`,
            } as CSSProperties}>
              <svg viewBox="0 0 256 256" fill="none"><use href={`#${id}-conversation`} /></svg>
            </div>
          ))}
        </div>
        <svg className="desktop-launch__spark" viewBox="0 0 32 32" fill="none">
          <path d="M16 0C18 12 20 14 32 16C20 18 18 20 16 32C14 20 12 18 0 16C12 14 14 12 16 0Z" fill="var(--launch-cue-tip)" />
        </svg>
        <p className="desktop-launch__name">LexiCue</p>
        <p className="desktop-launch__slogan" lang="zh-CN">{DESKTOP_LAUNCH_SLOGAN}</p>
      </div>
    </div>
  );
}
