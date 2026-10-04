import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { navigationActive, navigationItems } from './NavigationItems';
import LearningLanguageSelect from './LearningLanguageSelect';
import { usePreferencesStore } from '../stores/preferencesStore';

export default function Sidebar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const kind = usePreferencesStore(state => state.vocabularyKind);
  return <aside className="app-sidebar">
    <Link to="/files" className="app-brand" aria-label="LexiCue"><span className="brand-mark">L</span><span className="brand-name">LexiCue</span></Link>
    <nav aria-label={t('sidebar.navAria')}>
      {navigationItems.map(item => {
        const active = navigationActive(pathname, item.to, item.vocabulary);
        return <Link key={item.key} to={item.vocabulary && kind === 'phrase' ? '/phrases' : item.to}
          title={t(item.key)} aria-label={t(item.key)} aria-current={active ? 'page' : undefined}
          className={`navigation-link${item.to === '/settings' ? ' navigation-link--settings' : ''}`}>
          <item.icon size={22} aria-hidden="true" /><span>{t(item.key)}</span>
        </Link>;
      })}
    </nav>
    <div className="sidebar-language"><LearningLanguageSelect /></div>
  </aside>;
}
