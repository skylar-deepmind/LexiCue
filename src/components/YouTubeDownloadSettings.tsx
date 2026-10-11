import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import AppSelect from './AppSelect';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useYoutubeStore, type YtDlpStatus } from '../stores/youtubeStore';
import { EMPTY_BROWSER_SESSION, YOUTUBE_BROWSERS } from '../lib/youtubeDownload';

export default function YouTubeDownloadSettings({ status }: { status?: YtDlpStatus | null }) {
  const { t } = useTranslation();
  const session = usePreferencesStore(state => state.youtube.browserSession) ?? EMPTY_BROWSER_SESSION;
  const setSession = usePreferencesStore(state => state.setYouTubeBrowserSession);
  const [checkedStatus, setDiagnostics] = useState<YtDlpStatus | null>(null);
  const diagnostics = status ?? checkedStatus;
  const [checking, setChecking] = useState(status === undefined);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState('');
  const [profileDraft, setProfile] = useState<string | null>(null);
  const profile = profileDraft ?? session.profile;
  const invalidProfile = /[\n\r\0:]/.test(profile) || profile.length > 1024;
  useEffect(() => {
    if (status !== undefined) return;
    let active = true;
    void useYoutubeStore.getState().ytdlpStatus().then(result => { if (active) setDiagnostics(result); })
      .catch(() => { if (active) setNotice(t('youtube.downloadSettings.checkFailed')); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [status, t]);
  const clearCache = async () => {
    setClearing(true); setNotice('');
    try { await invoke('youtube_clear_subtitle_cache'); setNotice(t('youtube.downloadSettings.cacheCleared')); }
    catch { setNotice(t('youtube.downloadSettings.cacheFailed')); }
    finally { setClearing(false); }
  };
  return <div className="youtube-download-settings">
    <h4>{t('youtube.downloadSettings.browserTitle')}</h4>
    <button type="button" className="youtube-ai" role="switch" aria-checked={session.enabled}
      onClick={() => setSession({ ...session, enabled: !session.enabled })}>
      {t('youtube.downloadSettings.browserEnable')}<span>{t(session.enabled ? 'youtube.aiOn' : 'youtube.aiOff')}</span>
    </button>
    <p className="youtube-muted">{t('youtube.downloadSettings.browserHint')}</p>
    <label htmlFor="youtube-browser">{t('youtube.downloadSettings.browser')}</label>
    <AppSelect id="youtube-browser" value={session.browser} disabled={!session.enabled}
      onChange={browser => { setProfile(null); setSession({ ...session, browser, profile: '' }); }}
      options={YOUTUBE_BROWSERS.map(browser => ({ value: browser, label: browser === 'edge' ? 'Microsoft Edge' : browser[0].toUpperCase() + browser.slice(1) }))} />
    <label htmlFor="youtube-browser-profile">{t('youtube.downloadSettings.profile')}</label>
    <input id="youtube-browser-profile" className="youtube-input" value={profile} aria-invalid={invalidProfile} disabled={!session.enabled}
      placeholder={t('youtube.downloadSettings.defaultProfile')} onChange={event => { const value = event.target.value; setProfile(value); if (!/[\n\r\0:]/.test(value) && value.length <= 1024) setSession({ ...session, profile: value }); }} />
    <p className="youtube-muted">{t('youtube.downloadSettings.profileHint')}</p>
    {invalidProfile && <p role="alert" className="youtube-warning">{t('youtube.downloadSettings.invalidProfile')}</p>}
    {checking && <p role="status" className="youtube-muted">{t('youtube.downloadSettings.checking')}</p>}
    {diagnostics && <dl className="youtube-diagnostics">
      <dt>yt-dlp</dt><dd>{diagnostics.version ?? t('youtube.downloadSettings.missing')}<br />{diagnostics.path}</dd>
      <dt>{t('youtube.downloadSettings.javascript')}</dt><dd>{diagnostics.javascript ?? t('youtube.downloadSettings.missing')}</dd>
      <dt>EJS</dt><dd>{t(`youtube.downloadSettings.${diagnostics.ejs ?? 'unknown'}`)}</dd>
      <dt>ffmpeg</dt><dd>{diagnostics.ffmpeg ?? t('youtube.downloadSettings.missing')}</dd>
    </dl>}
    {diagnostics?.available === false && <p className="youtube-warning">{t('youtube.ytdlpErrorHint')}<br /><code>brew install yt-dlp deno</code></p>}
    <p className="youtube-muted">{t('youtube.downloadSettings.cacheHint')}</p>
    <button type="button" className="ui-button" disabled={clearing} onClick={() => void clearCache()}>{t('youtube.downloadSettings.clearCache')}</button>
    {notice && <p className="youtube-notice" role="status">{notice}</p>}
  </div>;
}
