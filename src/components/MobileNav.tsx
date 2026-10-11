import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { navigationActive, navigationItems, normalizeNavigationPath } from './NavigationItems';
import { usePreferencesStore } from '../stores/preferencesStore';

export default function MobileNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const kind = usePreferencesStore(state => state.vocabularyKind);
  if (normalizeNavigationPath(pathname).startsWith('/files/')) return null;
  return <nav className="mobile-nav" aria-label={t('sidebar.navAria')}>
    {navigationItems.map(item => {
      const active = navigationActive(pathname, item.to, item.vocabulary);
      return <Link key={item.key} to={item.vocabulary && kind === 'phrase' ? '/phrases' : item.to}
        aria-current={active ? 'page' : undefined} className="navigation-link">
        <item.icon size={22} aria-hidden="true" /><span>{t(item.key)}</span>
      </Link>;
    })}
  </nav>;
}
