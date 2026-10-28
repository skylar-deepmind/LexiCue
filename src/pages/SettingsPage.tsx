import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTheme } from '../components/useTheme';
import { THEMES } from '../lib/themes';
import { UI_LANGUAGES, SELF_NAMES } from '../lib/languages';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useFileStore } from '../stores/fileStore';
import { useMaterialStore } from '../stores/materialStore';
import LongmanStatus from '../components/LongmanStatus';
import { useUpdateStore } from '../stores/updateStore';
import CloudSyncSettings from '../components/CloudSyncSettings';
import YouTubeDownloadSettings from '../components/YouTubeDownloadSettings';
import SpeechSettings from '../components/SpeechSettings';
import './materials-settings.css';
export default function SettingsPage() {
    const { t } = useTranslation();
    const { theme, setTheme } = useTheme();
    const prefs = usePreferencesStore();
    const updates = useUpdateStore();
    const [version, setVersion] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { void getVersion().then(setVersion).catch(() => { }); }, []);
    const backup = async (restore = false) => {
        setBusy(true);
        try {
            if (restore) {
                await useFileStore.getState().restoreAll();
                useMaterialStore.getState().changed();
            }
            else
                await useFileStore.getState().exportAll();
        }
        finally {
            setBusy(false);
        }
    };
    return <div className="materials-scroll"><section className="workspace-paper system-settings">
    <h1>{t('settings.title')}</h1>
    <section><h2>{t('settings.uiLanguage.title')}</h2><p>{t('settings.uiLanguage.description')}</p><div className="settings-options">{UI_LANGUAGES.map(language => <button className="ui-button settings-quiet-action" key={language} aria-pressed={prefs.uiLanguage === language} onClick={() => prefs.setUiLanguage(language)}>{SELF_NAMES[language]}</button>)}</div></section>
    <section><h2>{t('settings.theme.title')}</h2><div className="theme-choices" role="group" aria-label={t('settings.theme.title')}>{THEMES.map(item => <button className="theme-choice" key={item.id} aria-label={t(`themes.${item.id}Label`)} aria-pressed={theme === item.id} onClick={() => setTheme(item.id)}>
      <span className={`theme-preview theme-preview--${item.id}`} aria-hidden="true"><span className="theme-preview-rail"><i/><i/><i/></span><span className="theme-preview-copy"><span>Aa</span><i/><i/></span><span className="theme-choice-check"><Check size={13}/></span></span>
      <span className="ui-tooltip theme-choice-tooltip" role="tooltip" aria-hidden="true">{t(`themes.${item.id}Label`)}</span>
    </button>)}</div></section>
    <SpeechSettings/>
    <section><h2>{t('onboarding.replayTitle')}</h2><p>{t('onboarding.privacy')}</p><Link className="ui-button" to="/example">{t('onboarding.replay')}</Link></section>
    <section><h2>{t('materials.backups')}</h2><div className="settings-options"><button className="ui-button settings-quiet-action" disabled={busy} onClick={() => void backup()}>{t('history.export')}</button><button className="ui-button settings-quiet-action" disabled={busy} onClick={() => void backup(true)}>{t('history.restore')}</button><Link className="ui-button" to="/legacy">{t('materials.history')}</Link></div></section>
    <CloudSyncSettings />
    <LongmanStatus/>
    <details><summary>{t('settings.youtube.title')}</summary><YouTubeDownloadSettings /></details>
    <details><summary>{t('settings.updates.title')}</summary><p>{t('settings.updates.currentVersion', { version: version || '—' })}</p><button className="ui-button settings-quiet-action" disabled={updates.status === 'checking' || updates.status === 'downloading'} onClick={() => void updates.check()}>{t('settings.updates.check')}</button>{updates.status === 'upToDate' && <p>{t('settings.updates.upToDate')}</p>}{updates.status === 'available' && <><p>{t('settings.updates.available', { version: updates.version })}</p><button className="ui-button" onClick={() => void (updates.downloadUrl ? openUrl(updates.downloadUrl) : updates.install())}>{t(updates.downloadUrl ? 'settings.updates.downloadPage' : 'settings.updates.install')}</button></>}{updates.status === 'downloading' && <progress max={100} value={updates.progress}/>} {updates.error && <p role="alert">{updates.error}</p>}</details>
  </section></div>;
}
