import './lookup-controls.css';
import { useTranslation } from 'react-i18next';
import { usePreferencesStore } from '../stores/preferencesStore';

export default function DictionaryPreferences() {
  const { t } = useTranslation();
  const provider = usePreferencesStore(state => state.onlineDictionary);
  const setProvider = usePreferencesStore(state => state.setOnlineDictionary);
  return <fieldset className="dictionary-preferences">
    <legend className="sr-only">{t('dictionaryPreferences.source')}</legend>
    {(['cambridge', 'wiktionary'] as const).map(value => <label className="dictionary-preference-row" key={value}>
      <input type="radio" name="online-dictionary" checked={provider === value} onChange={() => setProvider(value)}/>
      <span>{t(`dictionaryPreferences.${value}`)}<small>{t(`dictionaryPreferences.${value}Provider`)}</small></span>
    </label>)}
    <p>{t('dictionaryPreferences.onDemand')}</p>
  </fieldset>;
}
