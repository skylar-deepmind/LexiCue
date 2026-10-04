import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ask } from '@tauri-apps/plugin-dialog';
import AppSelect from './AppSelect';
import { LANGUAGES, type Language } from '../lib/languages';
import { usePreferencesStore } from '../stores/preferencesStore';
import { hasActiveSession, useReviewStore } from '../stores/reviewStore';

export default function LearningLanguageSelect() {
  const { t } = useTranslation();
  const language = usePreferencesStore(state => state.language);
  const setLanguage = usePreferencesStore(state => state.setLanguage);
  return <div className="learning-language-select">
    <Globe size={18} aria-hidden="true" />
    <AppSelect value={language} aria-label={t('shell.learningLanguage')}
      options={[{ value: 'all', label: t('shell.allLanguages') }, ...LANGUAGES.map(item => ({ value: item.id, label: item.label }))]}
      onChange={async value => {
        if (value === language) return;
        if (hasActiveSession(useReviewStore.getState()) && !await ask(t('sidebar.switchLanguageConfirm'), {
          title: t('sidebar.switchLanguageTitle'), kind: 'warning', okLabel: t('sidebar.switch'), cancelLabel: t('common.cancel'),
        })) return;
        setLanguage(value as Language | 'all');
      }} />
  </div>;
}
