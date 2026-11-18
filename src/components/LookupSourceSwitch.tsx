import { useTranslation } from 'react-i18next';
import { BusyRing } from './LoadingFeedback';
export type LookupSourceState = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
/** Supplemental lookup lives in the current card; the original meaning stays. */
export default function LookupSourceSwitch({ online, onOnline }: { online: LookupSourceState; onOnline: () => void }) {
  const { t } = useTranslation();
  const label = online === 'missing' ? t('approved.noNew') : online === 'error' ? t('dictionary.issues.unavailable') : t('approved.supplement');
  return <div className="lookup-source-switch approved-lookup-map" role="group" aria-label={t('dictionary.sources')}><button type="button" data-state={online} aria-label={label} title={label} aria-busy={online === 'loading'} onClick={onOnline}>
    <img src={`/design/lookup-${online === 'missing' || online === 'error' ? 'empty' : online === 'ready' ? 'open' : 'idle'}.svg`} width="38" height="38" alt=""/>{online === 'loading' && <span aria-hidden="true"><BusyRing/></span>}
  </button></div>;
}
