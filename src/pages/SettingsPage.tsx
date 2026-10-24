import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTheme } from '../components/useTheme';
import { THEMES } from '../lib/themes';
import { UI_LANGUAGES, SELF_NAMES } from '../lib/languages';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useFileStore } from '../stores/fileStore';
import { useMaterialStore } from '../stores/materialStore';
import { useDictionaryStore } from '../stores/dictionaryStore';
import { useUpdateStore } from '../stores/updateStore';
import CloudSyncSettings from '../components/CloudSyncSettings';
import YouTubeDownloadSettings from '../components/YouTubeDownloadSettings';
export default function SettingsPage() {
    const { t } = useTranslation();
    const { theme, setTheme } = useTheme();
    const prefs = usePreferencesStore();
    const dictionary = useDictionaryStore();
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
    <section><h2>{t('settings.uiLanguage.title')}</h2><p>{t('settings.uiLanguage.description')}</p><div className="settings-options">{UI_LANGUAGES.map(language => <button className="ui-button" key={language} aria-pressed={prefs.uiLanguage === language} onClick={() => prefs.setUiLanguage(language)}>{SELF_NAMES[language]}</button>)}</div></section>
    <section><h2>{t('settings.theme.title')}</h2><div className="settings-options">{THEMES.map(item => <button className="ui-button" key={item.id} aria-pressed={theme === item.id} onClick={() => setTheme(item.id)}>{t(`themes.${item.id}Label`)}</button>)}</div></section>
    <section><h2>{t('materials.backups')}</h2><div className="settings-options"><button className="ui-button" disabled={busy} onClick={() => void backup()}>{t('history.export')}</button><button className="ui-button" disabled={busy} onClick={() => void backup(true)}>{t('history.restore')}</button><Link className="ui-button" to="/legacy">{t('materials.history')}</Link></div></section>
    <CloudSyncSettings />
    <details><summary>{t('settings.dictionary.title')}</summary><p role="status">{t(dictionary.ready ? 'systemSettings.dictionaryReady' : 'systemSettings.dictionaryPending')}</p>{dictionary.snapshot?.sources.map(source => <p key={source.name}>{source.name} · {source.processedRows.toLocaleString()} · {t(`dictionaryInit.states.${source.state}`, { defaultValue: source.state })}</p>)}{!dictionary.ready && <button className="ui-button" onClick={() => void dictionary.retry()}>{t('common.retry')}</button>}</details>
    <details><summary>{t('settings.youtube.title')}</summary><YouTubeDownloadSettings /></details>
    <details><summary>{t('settings.updates.title')}</summary><p>{t('settings.updates.currentVersion', { version: version || '—' })}</p><button className="ui-button" disabled={updates.status === 'checking' || updates.status === 'downloading'} onClick={() => void updates.check()}>{t('settings.updates.check')}</button>{updates.status === 'upToDate' && <p>{t('settings.updates.upToDate')}</p>}{updates.status === 'available' && <><p>{t('settings.updates.available', { version: updates.version })}</p><button className="ui-button" onClick={() => void (updates.downloadUrl ? openUrl(updates.downloadUrl) : updates.install())}>{t(updates.downloadUrl ? 'settings.updates.downloadPage' : 'settings.updates.install')}</button></>}{updates.status === 'downloading' && <progress max={100} value={updates.progress}/>} {updates.error && <p role="alert">{updates.error}</p>}</details>
  </section></div>;
}
