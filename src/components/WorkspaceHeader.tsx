import PageBack from './PageBack';
import { usePageReturn } from '../lib/pageNavigation';
import { useMaterialStore } from '../stores/materialStore';
import { isTauri } from '@tauri-apps/api/core';
import { ChevronLeft, Plus } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useImportStore } from '../stores/importStore';
import { SETTINGS_LABELS, useSettingsNavigation } from '../lib/settingsNavigation';
import VisitLink from './VisitLink';
import { rememberImportFocus } from './importFocus';

/** Native desktop windows keep their OS titlebar; phones use the approved compact header. */
export default function WorkspaceHeader() {
    const { t } = useTranslation();
    const { pathname } = useLocation();
    const { section, back } = useSettingsNavigation();
    const { origin } = usePageReturn();
    const sourceBack = pathname==='/legacy' || pathname==='/saved' && origin?.path.startsWith('/files/');
    const importing = pathname.replace(/\/+$/, '') === '/files';
    const empty = useMaterialStore(state => state.hasLoaded && state.files.length === 0 && !state.error);
    if (pathname.startsWith('/settings')) return <>{!isTauri() && <header className="b-header"><span className="workspace-title">LexiCue</span></header>}<header className="mobile-workspace-header mobile-settings-header">
        <button type="button" aria-label={t('common.back')} onClick={back}><ChevronLeft size={22} aria-hidden="true"/></button>
        <h1>{t(section ? SETTINGS_LABELS[section] : 'settings.title')}</h1><span aria-hidden="true"/>
    </header></>;
    return <>
        {!isTauri() && <header className="b-header"><span className="workspace-title">LexiCue</span></header>}
        <header className="mobile-workspace-header">
            {sourceBack ? <PageBack fallback={pathname==='/legacy'?'/settings?section=backup':'/files'}/> : <span>LexiCue</span>}
            <div>{importing && !empty && <button data-guide="import" type="button" aria-label={t('materials.import')} title={t('materials.import')} onClick={event => { rememberImportFocus(event.currentTarget); useImportStore.getState().show(); }}><Plus size={22} aria-hidden="true"/></button>}
                <VisitLink className="mobile-settings-link" to="/settings" aria-label={t('sidebar.settings')} title={t('sidebar.settings')} onClick={() => useImportStore.getState().hide()}><span className="mobile-settings-icon" aria-hidden="true"/></VisitLink>
            </div>
        </header>
    </>;
}
