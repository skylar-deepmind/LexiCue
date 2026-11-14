import { Check, Download, Minus, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BusyRing } from './LoadingFeedback';

export type LookupSourceState = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
export default function LookupSourceSwitch({ selected, local, online, onLocal, onOnline }: {
  selected: 'local' | 'online'; local: LookupSourceState; online: LookupSourceState;
  onLocal: () => void; onOnline: () => void;
}) {
  const { t } = useTranslation();
  return <div className="lookup-source-switch" role="group" aria-label={t('dictionary.sources')}>
    {(['local', 'online'] as const).map(source => {
      const state = source === 'local' ? local : online;
      const unavailable = source === 'local' && state === 'missing';
      return <button type="button" key={source} data-state={state} aria-pressed={selected === source}
        aria-busy={state === 'loading'} disabled={unavailable}
        title={t(`dictionarySwitch.${source}.${state}`)} onClick={source === 'local' ? onLocal : onOnline}>
        <span>{t(source === 'local' ? 'dictionaryFlow.localTag' : 'dictionaryFlow.onlineTag')}</span>
        {state === 'loading' ? <BusyRing/> : state === 'missing' ? <Minus size={13} aria-hidden="true"/> : state === 'error' ? <RefreshCw size={13} aria-hidden="true"/> : state === 'idle' ? <Download size={13} aria-hidden="true"/> : selected === source ? <Check size={13} aria-hidden="true"/> : null}
      </button>;
    })}
  </div>;
}
