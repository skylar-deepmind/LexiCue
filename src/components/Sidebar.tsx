import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Upload, Settings } from 'lucide-react';
import { navigationItems, navigationActive } from './NavigationItems';
import { useImportStore } from '../stores/importStore';
export default function Sidebar() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const show = useImportStore(s => s.show);
    const open = useImportStore(s => s.open);
    const running = useImportStore(s => s.running);
    return <aside className="b-dock"><nav aria-label={t('sidebar.navAria')}>
    {navigationItems.slice(0, 2).map(item => <Link className="b-dock-control" key={item.to} to={item.to} aria-current={navigationActive(pathname, item.to) ? 'page' : undefined} onClick={() => useImportStore.getState().hide()}><item.icon size={21} aria-hidden="true"/><span>{t(item.key)}</span></Link>)}
    <button className="b-dock-control" onClick={show} aria-pressed={open} aria-label={t(running ? 'materials.importRunning' : 'materials.import')}><Upload size={21} aria-hidden="true"/><span>{t('materials.import')}</span>{running && <span className="dock-busy" aria-hidden="true"/>}</button>
    <span className="b-dock-divider"/>
    <Link className="b-dock-control" to="/settings" aria-current={pathname.startsWith('/settings') ? 'page' : undefined} onClick={() => useImportStore.getState().hide()}><Settings size={21} aria-hidden="true"/><span>{t('sidebar.settings')}</span></Link>
  </nav></aside>;
}
