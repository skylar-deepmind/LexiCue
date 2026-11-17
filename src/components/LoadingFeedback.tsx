import { useTranslation } from 'react-i18next';
import './loading-feedback.css';

/** Pair the decorative indicator with the action or status that owns it. */
export function BusyRing() {
  return <span className="busy-ring" aria-hidden="true" />;
}

export function ActivityTrack() {
  return <span className="activity-track inline-progress" aria-hidden="true"><span /></span>;
}

export function LoadingSkeleton({ kind, label }: { kind: 'list' | 'text' | 'tags'; label: string }) {
  return <div className={`loading-skeleton loading-skeleton--${kind}`} role="status">
    <span className="sr-only">{label}</span>
    <div className="loading-skeleton__shape" aria-hidden="true">
      <i /><i /><i />{kind === 'list' && <i />}
    </div>
  </div>;
}


export function RouteLoading() {
  const { t } = useTranslation();
  return <div className="approved-route-loading" role="status" aria-label={t('common.loading')}><BusyRing/></div>;
}
