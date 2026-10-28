import { useTranslation } from 'react-i18next';
import type { DictionarySnapshot } from '../lib/savedRecords';
import DictionarySource from './DictionarySource';

/** Historical content stays usable when the package is upgraded or removed. */
export default function SavedDictionaryDetails({ snapshot }: { snapshot: DictionarySnapshot }) {
  const { t } = useTranslation();
  return <details className="longman-more longman-saved-snapshot">
    <summary>{t('longman.savedSense')} · {t(`dictionary.${snapshot.source.provider}`)}</summary>
    <h3 lang="en">{snapshot.headword}</h3>
    <p>{snapshot.meaning.zh ?? snapshot.meaning.en}</p>
    {snapshot.meaning.zh && snapshot.meaning.en && <p lang="en">{snapshot.meaning.en}</p>}
    {!!snapshot.labels.length && <p>{snapshot.labels.map(label => label.text).join(' · ')}</p>}
    {snapshot.patterns.map((pattern, i) => <p className="longman-tag longman-tag--pattern" key={i} lang="en">{pattern}</p>)}
    {snapshot.examples.map(example => <div className="longman-example" key={example.id}><p lang="en">{example.english}</p>{example.chinese && <p>{example.chinese}</p>}</div>)}
    <DictionarySource source={snapshot.source} historical/>
  </details>;
}
