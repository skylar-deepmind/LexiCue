import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { navigationItems, navigationActive } from './NavigationItems';
import { useImportStore } from '../stores/importStore';
import MobileReadingTools from './MobileReadingTools';
export default function MobileNav() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    if (pathname.startsWith('/settings')) return null;
    return <><MobileReadingTools/><nav className="b-mobile-nav" aria-label={t('sidebar.navAria')}>
    <span className="mobile-nav-selection" aria-hidden="true" style={{transform: navigationActive(pathname,'/saved') ? 'translateX(calc(100% + 8px))' : 'translateX(0px)'}}/>
    {navigationItems.slice(0, 2).map(item => <Link className="b-dock-control" key={item.to} to={item.to} aria-current={navigationActive(pathname, item.to) ? 'page' : undefined} onClick={() => useImportStore.getState().hide()}><span className="mobile-nav-icon" aria-hidden="true">{item.to==='/saved'?<span className="mobile-saved-icon"/>:<item.icon size={22}/>}</span><span className="mobile-nav-label">{t(item.key)}</span></Link>)}

  </nav></>;
}
