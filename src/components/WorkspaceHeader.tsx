import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { useMaterialStore } from '../stores/materialStore';
import appLogo from '../media/app-logo.png';
export default function WorkspaceHeader() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const current = useMaterialStore(s => s.current);
    const reading = pathname.startsWith('/files/');
    const fileId = Number(pathname.split('/')[2]);
    return <header className="b-header"><Link to="/files" className="b-brand" aria-label="LexiCue"><img src={appLogo} alt="" width={32} height={32}/><span>LexiCue</span></Link>
    <nav className="b-path" aria-label={t('materials.path')}>
      {reading ? <><Link to="/files">{t('materials.title')}</Link><ChevronRight size={15} aria-hidden="true"/><span title={current?.id === fileId ? current.name : undefined}>{current?.id === fileId ? current.name : t('common.loading')}</span></> : <span>{t(pathname.startsWith('/saved') ? 'savedRecords.title' : pathname.startsWith('/settings') ? 'sidebar.settings' : pathname.startsWith('/legacy') ? 'materials.history' : 'materials.title')}</span>}
    </nav>
  </header>;
}
