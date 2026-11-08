import { useTranslation } from 'react-i18next';
import Overlay from './Overlay';

export default function ReadingTranslationDialog({count, onConfirm, onCancel}: {count: number; onConfirm: () => void; onCancel: () => void}) {
  const {t} = useTranslation();
  return <Overlay label={t('reader.translateFullTitle')} onClose={onCancel} className="translation-dialog">
    <h2>{t('reader.translateFullTitle')}</h2>
    <p>{t('reader.translateFullPrompt', {count})}</p>
    <footer><button type="button" className="ui-button" onClick={onCancel}>{t('common.cancel')}</button>
      <button type="button" className="ui-button saved-primary" onClick={onConfirm}>{t('reader.translateFullConfirm')}</button></footer>
  </Overlay>;
}
