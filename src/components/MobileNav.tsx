import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Upload, Settings } from 'lucide-react';
import { navigationItems, navigationActive } from './NavigationItems';
import { useImportStore } from '../stores/importStore';
export default function MobileNav() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const open = useImportStore(s => s.open);
    return <nav className="b-mobile-nav" aria-label={t('sidebar.navAria')}>
    {navigationItems.slice(0, 2).map(item => <Link className="b-dock-control" key={item.to} to={item.to} aria-current={navigationActive(pathname, item.to) ? 'page' : undefined} onClick={() => useImportStore.getState().hide()}><item.icon size={20} aria-hidden="true"/><span>{t(item.key)}</span></Link>)}
    <button className="b-dock-control" onClick={() => useImportStore.getState().show()} aria-pressed={open}><Upload size={20} aria-hidden="true"/><span>{t('materials.import')}</span></button>
    <Link className="b-dock-control" to="/settings" aria-current={pathname.startsWith('/settings') ? 'page' : undefined} onClick={() => useImportStore.getState().hide()}><Settings size={20} aria-hidden="true"/><span>{t('sidebar.settings')}</span></Link>
  </nav>;
}
