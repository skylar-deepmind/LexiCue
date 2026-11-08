import DesktopLaunch, { type LaunchContraction } from './DesktopLaunch';
import './mobile-launch.css';

export type MobileContraction = Exclude<LaunchContraction, 'scale'>;
export const MOBILE_LAUNCH_CONTRACTION: MobileContraction = 'inset';

export default function MobileLaunch({ contraction = MOBILE_LAUNCH_CONTRACTION }: { contraction?: MobileContraction }) {
  return <DesktopLaunch variant="mobile" contraction={contraction} />;
}
