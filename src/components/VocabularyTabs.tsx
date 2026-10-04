import { normalizeNavigationPath } from './NavigationItems';
import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePreferencesStore } from '../stores/preferencesStore';

export default function VocabularyTabs() {
  const { t } = useTranslation();
  const { pathname: rawPathname } = useLocation();
  const pathname = normalizeNavigationPath(rawPathname);
  const setVocabularyKind = usePreferencesStore(state => state.setVocabularyKind);
  useEffect(() => { setVocabularyKind(pathname === '/phrases' ? 'phrase' : 'word'); }, [pathname, setVocabularyKind]);
  return <nav className="vocabulary-tabs" aria-label={t('shell.vocabulary')}>
    <NavLink to="/words">{t('sidebar.words')}</NavLink>
    <NavLink to="/phrases">{t('sidebar.phrases')}</NavLink>
  </nav>;
}
