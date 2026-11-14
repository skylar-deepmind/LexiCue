import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FilePlus2, Settings } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { navigationItems, navigationActive, importEntryVisible } from './NavigationItems';
import { useImportStore } from '../stores/importStore';
import ReadingTools from './ReadingTools';
import DockPresence from './DockPresence';
import VisitLink from './VisitLink';
import { visitState } from '../lib/pageNavigation';
import { rememberImportFocus } from './importFocus';
import './navigation.css';
export default function Sidebar() {
    const { t } = useTranslation();
    const location = useLocation();
    const { pathname } = location;
    const show = useImportStore(s => s.show);
    const open = useImportStore(s => s.open);
    const running = useImportStore(s => s.running);
    const dockRef = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
        const center = () => {
            const viewport = window.visualViewport;
            dockRef.current?.style.setProperty('--dock-center', `${viewport ? viewport.offsetTop + viewport.height / 2 : window.innerHeight / 2}px`);
        };
        center();
        window.addEventListener('resize', center);
        window.visualViewport?.addEventListener('resize', center);
        window.visualViewport?.addEventListener('scroll', center);
        return () => {
            window.removeEventListener('resize', center);
            window.visualViewport?.removeEventListener('resize', center);
            window.visualViewport?.removeEventListener('scroll', center);
        };
    }, []);
    return <aside className="b-dock b-dock-centered" ref={dockRef}><nav aria-label={t('sidebar.navAria')}>
    <div className="dock-base-controls">
    {navigationItems.slice(0, 2).map(item => <Link state={pathname.startsWith('/files/') && item.to==='/saved' ? visitState(location) : undefined} className="b-dock-control" key={item.to} to={item.to} aria-label={t(item.key)} aria-current={navigationActive(pathname, item.to) ? 'page' : undefined} onClick={() => useImportStore.getState().hide()}><item.icon size={22} aria-hidden="true"/></Link>)}
    <span className="b-dock-divider"/>
    <DockPresence visible={importEntryVisible(pathname)} className="dock-import-presence">
      <div className="dock-import-slot"><button data-guide="import" className="b-dock-control" onClick={event => { rememberImportFocus(event.currentTarget); show(); }} aria-pressed={open} aria-label={t(running ? 'materials.importRunning' : 'materials.import')}><FilePlus2 size={22} aria-hidden="true"/>{running && <span className="dock-busy" aria-hidden="true"/>}</button></div>
    </DockPresence>
    <VisitLink className="b-dock-control" to="/settings" aria-label={t('sidebar.settings')} aria-current={pathname.startsWith('/settings') ? 'page' : undefined} onClick={() => useImportStore.getState().hide()}><Settings size={22} aria-hidden="true"/></VisitLink>
    </div>
  <ReadingTools/>
  </nav></aside>;
}
