import { useTranslation } from 'react-i18next';
import type { DictionaryReference } from '../lib/savedRecords';
import DictionarySource from './DictionarySource';

/** A portable dictionary excerpt is reference material, never a context verdict. */
export default function SavedReferenceDetails({ reference }: { reference: DictionaryReference }) {
  const { t } = useTranslation();
  return <details className="longman-more saved-reference">
    <summary>{t('dictionaryFlow.savedReference')}</summary>
    <p className="recall-note">{t('dictionaryFlow.referenceNote')}</p>
    {reference.senses.map(sense => <section key={sense.sense_id} className="saved-reference-sense">
      {sense.part_of_speech && <small>{sense.part_of_speech}</small>}
      <p lang={sense.meaning.zh ? undefined : 'en'}>{sense.meaning.zh || sense.meaning.en}{!sense.meaning.zh && <small> · {t('dictionaryFlow.englishOnly')}</small>}</p>
      {sense.meaning.zh && sense.meaning.en && <p lang="en">{sense.meaning.en}</p>}
      <DictionarySource source={sense.source} historical />
    </section>)}
  </details>;
}
