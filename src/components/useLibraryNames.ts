import { useTranslation } from 'react-i18next';
import { usePreferencesStore } from '../stores/preferencesStore';

export function useLibraryNames() {
  const { t } = useTranslation(), names = usePreferencesStore(state => state.libraryNames);
  return { all: names.all ?? t('readingDesk.library'), untagged: names.untagged ?? t('tags.untagged') };
}
