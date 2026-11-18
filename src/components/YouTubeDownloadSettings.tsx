import { BusyRing } from './LoadingFeedback';
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Download, Globe, RefreshCw, Trash2 } from 'lucide-react';
import { useFeedbackStore } from '../stores/feedbackStore';
import { useTranslation } from 'react-i18next';
import { isIOSPlatform } from '../lib/platform';
import AppSelect from './AppSelect';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useYoutubeStore, type YtDlpStatus } from '../stores/youtubeStore';
import { EMPTY_BROWSER_SESSION, YOUTUBE_BROWSERS } from '../lib/youtubeDownload';

function DesktopSubtitleTools({ status }: { status?: YtDlpStatus | null }) {
  const { t } = useTranslation();
  const session = usePreferencesStore(state => state.youtube.browserSession) ?? EMPTY_BROWSER_SESSION;
  const setSession = usePreferencesStore(state => state.setYouTubeBrowserSession);
  const [checkedStatus, setDiagnostics] = useState<YtDlpStatus | null>(null);
  const diagnostics = checkedStatus ?? status;
  const [checking, setChecking] = useState(status === undefined);
  const [checkFailed, setCheckFailed] = useState(false);
  const [profileDraft, setProfile] = useState<string | null>(null);
  const profile = profileDraft ?? session.profile;
  const invalidProfile = /[\n\r\0:]/.test(profile) || profile.length > 1024;
  const request=useRef(0);
  const probe=useCallback(async()=>{
    const token=++request.current;setChecking(true);setCheckFailed(false);
    try{const result=await useYoutubeStore.getState().ytdlpStatus();if(token===request.current)setDiagnostics(result);}
    catch{if(token===request.current)setCheckFailed(true);}
    finally{if(token===request.current)setChecking(false);}
  },[]);
  const invalidateProbe=useCallback(()=>{request.current++;},[]);
  useEffect(() => {
    if(status===undefined)void probe();
    else{setDiagnostics(null);setChecking(false);}
    return invalidateProbe;
  }, [status,probe,invalidateProbe]);
  const issue=diagnostics ? !diagnostics.available ? 'installTool' : !diagnostics.javascript ? 'missingRuntime' : diagnostics.ejs==='missing' ? 'missingEjs' : null : null;
  const command=/Macintosh|Mac OS X/.test(navigator.userAgent)?'brew install yt-dlp deno ffmpeg':/Windows/.test(navigator.userAgent)?'winget install --source winget --id yt-dlp.yt-dlp\nwinget install --id DenoLand.Deno':null;
  const showInstall=async(url:string)=>{try{await openUrl(url);}catch{useFeedbackStore.getState().show(t('materials.importDialog.openFailed'),'error');}};
  const copyInstall=async()=>{
    if(!command)return;
    try{if(isTauri())await writeText(command);else await navigator.clipboard.writeText(command);useFeedbackStore.getState().show(t('approved.commandCopied'),'success');}
    catch{useFeedbackStore.getState().show(t('approved.commandCopyFailed'),'error');}
  };
  return <>
    <section className="youtube-tool-status" aria-label={t('approved.subtitleTools')}>
      <div className="youtube-tool-summary"><Download size={18} aria-hidden="true"/><span>{t('approved.subtitleTools')}</span><span role="status">{checking?t('youtube.downloadSettings.checking'):checkFailed?t('youtube.downloadSettings.checkFailed'):diagnostics?issue?t('approved.toolsNeedSetup'):t('youtube.downloadSettings.available'):'—'}</span><button type="button" className="approved-icon" aria-label={t('approved.recheckTools')} title={t('approved.recheckTools')} disabled={checking} aria-busy={checking} onClick={()=>void probe()}>{checking?<BusyRing/>:<RefreshCw size={17} aria-hidden="true"/>}</button></div>
      <details className="youtube-tool-help">
        <summary>{t('approved.installAndDiagnostics')}</summary>
        {issue&&<p className="youtube-warning">{t(`youtube.downloadSettings.${issue}`)}</p>}
        {issue&&<p className="youtube-muted">{t('approved.youtubeExternalTools')}</p>}
        {command&&<div className="youtube-install-command"><code tabIndex={0}>{command}</code><button className="ui-button" onClick={()=>void copyInstall()}>{t('approved.copyInstallCommand')}</button></div>}
        <div className="youtube-install-links"><button className="ui-button" onClick={()=>void showInstall('https://github.com/yt-dlp/yt-dlp/wiki/Installation')}>{t('approved.officialInstall')}</button><button className="ui-button" onClick={()=>void showInstall('https://github.com/yt-dlp/yt-dlp/wiki/EJS')}>{t('approved.runtimeHelp')}</button></div>
        {command?.startsWith('brew')&&<p className="youtube-muted">{t('approved.requiresBrew')} <button className="youtube-help-link" onClick={()=>void showInstall('https://brew.sh/')}>Homebrew</button></p>}
        {diagnostics&&<dl className="youtube-diagnostics"><dt>yt-dlp</dt><dd>{diagnostics.version??t('youtube.downloadSettings.missing')}{diagnostics.path&&<><br/>{diagnostics.path}</>}</dd><dt>{t('youtube.downloadSettings.javascript')}</dt><dd>{diagnostics.javascript??t('youtube.downloadSettings.missing')}</dd><dt>EJS</dt><dd>{t(`youtube.downloadSettings.${diagnostics.ejs??'unknown'}`)}</dd><dt>ffmpeg</dt><dd>{diagnostics.ffmpeg??t('youtube.downloadSettings.missing')}</dd></dl>}
      </details>
    </section>
    <button type="button" className="subtitle-setting-row subtitle-session" role="switch" aria-checked={session.enabled}
      onClick={() => setSession({ ...session, enabled: !session.enabled })}>
      <Globe size={18} aria-hidden="true"/><span>{t('youtube.downloadSettings.browserEnable')}</span><i aria-hidden="true"/>
    </button>
    {session.enabled && <>
    <p className="youtube-muted">{t('approved.youtubePrivacy')}</p>
    <label htmlFor="youtube-browser">{t('youtube.downloadSettings.browser')}</label>
    <AppSelect id="youtube-browser" value={session.browser} disabled={!session.enabled}
      onChange={browser => { setProfile(null); setSession({ ...session, browser, profile: '' }); }}
      options={YOUTUBE_BROWSERS.map(browser => ({ value: browser, label: browser === 'edge' ? 'Microsoft Edge' : browser[0].toUpperCase() + browser.slice(1) }))} />
    <details className="youtube-advanced"><summary>{t('approved.youtubeAdvanced')}</summary>
    <label htmlFor="youtube-browser-profile">{t('youtube.downloadSettings.profile')}</label>
    <input id="youtube-browser-profile" className="youtube-input" value={profile} aria-invalid={invalidProfile} disabled={!session.enabled}
      placeholder={t('youtube.downloadSettings.defaultProfile')} onChange={event => { const value = event.target.value; setProfile(value); if (!/[\n\r\0:]/.test(value) && value.length <= 1024) setSession({ ...session, profile: value }); }} />
    <p className="youtube-muted">{t('youtube.downloadSettings.profileHint')}</p>
    {invalidProfile && <p role="alert" className="youtube-warning">{t('youtube.downloadSettings.invalidProfile')}</p>}
    </details></>}
  </>;
}

export default function YouTubeDownloadSettings({ status }: { status?: YtDlpStatus | null }) {
  const { t } = useTranslation();
  const [clearing, setClearing] = useState(false);
  const clearCache = async () => {
    setClearing(true);
    const { show } = useFeedbackStore.getState();
    try { await invoke('youtube_clear_subtitle_cache'); show(t('youtube.downloadSettings.cacheCleared'), 'success', 3200, undefined, 'top', { passive: true }); }
    catch { show(t('youtube.downloadSettings.cacheFailed'), 'error', 4800, undefined, 'top', { passive: true }); }
    finally { setClearing(false); }
  };
  return <div className="youtube-download-settings">
    {isIOSPlatform() ? <p>{t('youtube.downloadSettings.publicTracks')}</p> : <DesktopSubtitleTools status={status} />}
    <button type="button" className="subtitle-setting-row" disabled={clearing} aria-busy={clearing} onClick={() => void clearCache()}>
      {clearing ? <BusyRing/> : <Trash2 size={18} aria-hidden="true"/>}<span>{t('youtube.downloadSettings.clearCache')}</span>
    </button>
  </div>;
}
