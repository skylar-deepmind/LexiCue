import { isTauri } from '@tauri-apps/api/core';
import { ChevronLeft, Plus } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useImportStore } from '../stores/importStore';
import { rememberImportFocus } from './importFocus';

/** Native desktop windows keep their OS titlebar; phones use the approved compact header. */
export default function WorkspaceHeader() {
    const { t } = useTranslation();
    const { pathname, state } = useLocation();
    const navigate = useNavigate();
    const importing = pathname.replace(/\/+$/, '') === '/files';
    if (pathname.startsWith('/settings')) return <>{!isTauri() && <header className="b-header"><span className="workspace-title">LexiCue</span></header>}<header className="mobile-workspace-header mobile-settings-header">
        <button type="button" aria-label={t('common.back')} onClick={() => navigate(state?.settingsOrigin === '/saved' ? '/saved' : '/files')}><ChevronLeft size={22} aria-hidden="true"/></button>
        <h1>{t('settings.title')}</h1><span aria-hidden="true"/>
    </header></>;
    return <>
        {!isTauri() && <header className="b-header"><span className="workspace-title">LexiCue</span></header>}
        <header className="mobile-workspace-header">
            <span>LexiCue</span>
            <div>{importing && <button data-guide="import" type="button" aria-label={t('materials.import')} title={t('materials.import')} onClick={event => { rememberImportFocus(event.currentTarget); useImportStore.getState().show(); }}><Plus size={22} aria-hidden="true"/></button>}
                <Link className="mobile-settings-link" to="/settings" state={{settingsOrigin: pathname.startsWith('/saved') ? '/saved' : '/files'}} aria-label={t('sidebar.settings')} title={t('sidebar.settings')} onClick={() => useImportStore.getState().hide()}><span className="mobile-settings-icon" aria-hidden="true"/></Link>
            </div>
        </header>
    </>;
}
