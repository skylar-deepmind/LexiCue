import { useTranslation } from 'react-i18next';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isAuthorPublicSource, isCambridgeEntryUrl, isWiktionarySource } from '../lib/dictionaryResult';
import type { DictionarySnapshot } from '../lib/savedRecords';

/** Edition and retrieval time describe the source; neither is inferred from the adapter. */
export default function DictionarySource({ source, historical = false, compact = false }: { source: DictionarySnapshot['source'] & { delivery?: string }; historical?: boolean; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const cambridge = source.provider === 'cambridge';
  const publicApi = isAuthorPublicSource(source);
  const wiktionary = isWiktionarySource(source);
  const timestamp = publicApi || wiktionary ? source.received_at : source.retrieved_at;
  const date = timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toLocaleString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const name = t(`dictionary.${source.provider}`);
  const edition = source.edition ? t('dictionary.edition', { edition: source.edition }) : null;
  return <div className="lookup-provider dictionary-source" data-dictionary-provider={source.provider} data-access-channel={source.access_channel}>
    <p>{[name, wiktionary ? t('dictionaryFlow.englishOnly') : null, publicApi ? t('dictionary.authorPublicApi') : null, source.delivery ? t(`dictionary.delivery.${source.delivery}`, { defaultValue: source.delivery }) : null, edition].filter(Boolean).join(' · ')}</p>
    {wiktionary && <small>{t('dictionary.freeDictionaryAttribution')}</small>}
    {cambridge && !publicApi && <small>{source.dataset}</small>}
    {historical && source.release && <small>{source.release}</small>}
    {!compact && date && <small>{t(publicApi || wiktionary ? 'dictionary.received' : 'dictionary.retrieved')} <time dateTime={timestamp!}>{date}</time></small>}
    {publicApi && <small>{t('dictionary.originalMetadataUnknown')}</small>}
    {!publicApi && (wiktionary || isCambridgeEntryUrl(source.entry_url)) && <a href={source.entry_url!} target="_blank" rel="noreferrer" onClick={event => { event.preventDefault(); void openUrl(source.entry_url!).catch(() => {}); }}>{t('dictionary.originalEntry')}</a>}
    {wiktionary && !compact && <details className="dictionary-license"><summary>{t('dictionary.licenseDetails')}</summary><small>{source.attribution}</small><a href={source.license!.url} target="_blank" rel="noreferrer" onClick={event => { event.preventDefault(); void openUrl(source.license!.url).catch(() => {}); }}>{source.license!.name}</a><small>{t('dictionary.adaptationNotice')}</small></details>}
  </div>;
}
