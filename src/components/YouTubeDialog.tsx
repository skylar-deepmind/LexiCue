import Overlay from './Overlay';
import YouTubeDownloadSettings from './YouTubeDownloadSettings';
import { useNavigate } from 'react-router-dom';
import { cooldownRemaining, EMPTY_BROWSER_SESSION, isYouTubeCancelled } from '../lib/youtubeDownload';
import AppSelect from './AppSelect';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Check, Clapperboard, Loader2, Search, Sparkles, Star, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useYoutubeStore, type SubtitleTrack, type TrackSelection, type VideoSubInfo } from '../stores/youtubeStore';
import { useFileStore } from '../stores/fileStore';
import { useAiStore } from '../stores/aiStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { getAiConfig } from '../lib/ai';
import { LANGUAGES, type Language } from '../lib/languages';
import {
  filterSubtitleTracks, languageKey, quickLanguages, restoreYouTubeSelection, sameTrack,
  trackLanguage, subtitleLanguageLabel, suggestLearningLanguage, toggleYouTubeTrack, type YouTubeSelection,
} from '../lib/youtubeSelection';

function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

type Step = 'url' | 'listing' | 'select' | 'running' | 'settings';
type MissingTrack = { role: keyof YouTubeSelection; lang: string };

export default function YouTubeDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const listing = useRef(false);
  const submitting = useRef(false);
  const closeDialog = () => {
    request.current++;
    if (!useFileStore.getState().importingYouTube) useFileStore.getState().resetYouTubeRecovery();
    useYoutubeStore.setState({ dialogDraft: { url, info, selection, language, query, aiTranslate } });
    onClose();
  };
  useEffect(() => {
    // The counter invalidates asynchronous work rather than referring to a DOM node.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    return () => { request.current++; };
  }, []);
  const navigate = useNavigate();
  const [draft] = useState(() => useYoutubeStore.getState().dialogDraft);
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'zh';
  const [step, setStep] = useState<Step>(useFileStore.getState().importingYouTube ? 'running' : draft?.info ? 'select' : 'url');
  const [url, setUrl] = useState(draft?.url ?? '');
  const [info, setInfo] = useState<VideoSubInfo | null>(draft?.info ?? null);
  const [selection, setSelection] = useState<YouTubeSelection>(draft?.selection ?? { primary: null, secondary: null });
  const [missing, setMissing] = useState<MissingTrack[]>([]);
  const [restored, setRestored] = useState(false);
  const [query, setQuery] = useState(draft?.query ?? '');
  const [language, setLanguage] = useState<Language | ''>((draft?.language as Language) ?? '');
  const [aiTranslate, setAiTranslate] = useState(draft?.aiTranslate ?? false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (step === 'select') {
      if (useFileStore.getState().youtubeFailure) dialogRef.current?.querySelector<HTMLButtonElement>('.youtube-error button:not(:disabled)')?.focus();
      else searchRef.current?.focus();
    }
    else if (step === 'url') dialogRef.current?.querySelector<HTMLInputElement>('#youtube-url')?.focus();
    else if (step === 'settings') dialogRef.current?.querySelector<HTMLButtonElement>('[role="switch"]')?.focus();
    else if (step === 'running') dialogRef.current?.querySelector<HTMLButtonElement>('#youtube-cancel')?.focus();
  }, [step]);

  const preferences = usePreferencesStore(state => state.youtube);
  const toggleFavorite = usePreferencesStore(state => state.toggleYouTubeFavorite);
  const aiEnabled = useAiStore(state => state.enabled);
  const aiModel = useAiStore(state => state.model);
  const aiReady = aiEnabled && !!aiModel.trim();
  const translateProgress = useYoutubeStore(state => state.translateProgress);
  const downloadProgress = useYoutubeStore(state => state.downloadProgress);
  const listSubs = useYoutubeStore(state => state.listSubs);

  const importFromYouTube = useFileStore(state => state.importFromYouTube);
  const importing = useFileStore(state => state.importingYouTube);
  const youtubePhase = useFileStore(state => state.youtubePhase);
  const activeId = useFileStore(state => state.youtubeActiveJobId);
  const recovery = useFileStore(state => state.youtubeRecovery);
  const failure = useFileStore(state => state.youtubeFailure);
  const cooldownUntil = useFileStore(state => state.youtubeCooldownUntil);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!cooldownUntil) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [cooldownUntil]);
  const cooldown = cooldownRemaining(cooldownUntil, now);
  const activeDownload = activeId != null ? downloadProgress[activeId] : undefined;
  const activeJob = activeId != null ? translateProgress[activeId] : undefined;
  const session = preferences.browserSession ?? EMPTY_BROWSER_SESSION;
  const listedSession = useRef(JSON.stringify(session));
  const busy = step === 'running' || importing;
  useEffect(() => {
    if (step !== 'running' || importing) return;
    if (useFileStore.getState().pendingImport) {
      useYoutubeStore.setState({ dialogDraft: null }); onClose();
    } else setStep(info ? 'select' : 'url');
  }, [step, importing, info, onClose]);
  const label = (code: string) => subtitleLanguageLabel(code, locale);
  const roleLabel = (role: keyof YouTubeSelection) => t(`youtube.${role === 'primary' ? 'originalTrack' : 'translationTrack'}`);
  const sourceLabel = (track: TrackSelection) => t(`youtube.sources.${track.source ?? (track.is_auto ? 'unknown' : 'manual')}`);
  const manual = info ? filterSubtitleTracks(info.manual, query, locale) : [];
  const automatic = info ? filterSubtitleTracks(info.automatic, query, locale) : [];
  const quick = info ? quickLanguages(info, preferences) : { favorites: [], recent: [] };
  const hasTracks = !!info && info.manual.length + info.automatic.length > 0;

  const handleSearch = async (preserve = false) => {
    if (listing.current) return;
    if (!url.trim()) { setError(t('youtube.urlRequired')); return; }
    const id = ++request.current;
    const videoUrl = url.trim();
    const pair = preserve && selection.primary ? { primary: trackLanguage(selection.primary), secondary: selection.secondary ? trackLanguage(selection.secondary) : null }
      : usePreferencesStore.getState().youtube.lastSelection;
    const requestedSession = { ...session };
    listedSession.current = JSON.stringify(requestedSession);
    useFileStore.getState().resetYouTubeRecovery();
    listing.current = true;
    setStep('listing'); setError(''); setNotice(''); setInfo(null); setQuery('');
    setSelection({ primary: null, secondary: null }); setMissing([]); setRestored(false);
    setLanguage(''); setAiTranslate(false);
    try {
      const result = await listSubs(videoUrl, requestedSession);
      if (id !== request.current) return;
      const recovered = restoreYouTubeSelection(result, pair);
      setInfo(result); setSelection(recovered.selection); setMissing(recovered.missing);
      setRestored(!!pair && recovered.missing.length === 0 && !!recovered.selection.primary);
      setLanguage(recovered.selection.primary ? suggestLearningLanguage(trackLanguage(recovered.selection.primary)) : '');
      setStep('select');
    } catch (e) {
      if (id !== request.current) return;
      const code = typeof e === 'string' ? e : 'download_failed';
      setError(t(`youtube.errors.${code}`, { defaultValue: t('youtube.errors.download_failed'), role: roleLabel('primary'), language: '' })); setStep('url');
    } finally {
      if (id === request.current) listing.current = false;
    }
  };

  const applySelection = (next: YouTubeSelection) => {
    if (!sameTrack(next.primary, selection.primary)) {
      setLanguage(next.primary ? suggestLearningLanguage(trackLanguage(next.primary)) : '');
      setAiTranslate(false);
    }
    if (next.secondary) setAiTranslate(false);
    useFileStore.getState().resetYouTubeRecovery();
    setMissing(current => current.filter(item => !next[item.role]));
    setRestored(false); setError(''); setNotice(''); setSelection(next);
  };
  const toggleTrack = (track: TrackSelection) => {
    if (busy) return;
    const next = toggleYouTubeTrack(selection, track);
    if (next.limitReached) { setNotice(t('youtube.selectionLimit')); return; }
    applySelection(next.selection);
  };

  const handleImport = async (fallback?: 'ai' | 'original') => {
    if (submitting.current || !selection.primary || !language || !info) return;
    const id = request.current;
    submitting.current = true;
    setError(''); setNotice(''); setStep('running');
    try {
      const prepared = await importFromYouTube({
        url: url.trim(), title: info.title, primary: selection.primary, secondary: selection.secondary,
        language, aiTranslate: aiTranslate && !selection.secondary, config: getAiConfig(), session: { ...session }, fallback,
      });
      if (id !== request.current) return;
      if (prepared) { useYoutubeStore.setState({ dialogDraft: null }); onClose(); }
      else { setNow(Date.now()); setStep('select'); }
    } catch (e) {
      if (id !== request.current) return;
      if (!isYouTubeCancelled(e) && !useFileStore.getState().youtubeFailure) setError(t('youtube.errors.download_failed', { role: roleLabel('primary'), language: '' }));
      setNow(Date.now()); setStep('select');
    } finally { submitting.current = false; }
  };
  const handleBack = () => {
    request.current++; listing.current = false;
    useFileStore.getState().resetYouTubeRecovery();
    setStep('url'); setError(''); setNotice(''); setInfo(null); setQuery('');
    setSelection({ primary: null, secondary: null }); setMissing([]); setRestored(false);
    setLanguage(''); setAiTranslate(false);
  };
  const handleCancelRunning = () => { void useFileStore.getState().cancelYouTubeImport(); };
  const configureAi = () => {
    useYoutubeStore.setState({ dialogDraft: { url, info, selection, language, query, aiTranslate, resumeAfterSettings: true } });
    navigate('/settings#ai', { state: { youtubeReturn: true } });
  };
  const returnFromSettings = () => {
    if (listedSession.current !== JSON.stringify(session) && info) void handleSearch(true);
    else setStep(info ? 'select' : 'url');
  };

  const renderTrack = (track: SubtitleTrack | null, code: string) => {
    const role = track && sameTrack(selection.primary, track) ? 'primary'
      : track && sameTrack(selection.secondary, track) ? 'secondary' : null;
    const favorite = preferences.favoriteLanguages.some(item => languageKey(item) === languageKey(code));
    return (
      <div key={`${track?.is_auto ?? 'missing'}-${track?.lang ?? code}`} className="youtube-track" data-selected={!!role}>
        <button type="button" className="youtube-track__choose" disabled={!track || busy} aria-pressed={!!role}
          onClick={() => track && toggleTrack(track)}>
          <span className="youtube-track__name">{label(code)}</span>
          <span className="youtube-track__meta">
            <span>{code}</span><span>{track ? sourceLabel(track) : t('youtube.unavailable')}</span>
            {role && <span className="youtube-track__role"><Check size={12} aria-hidden="true" />{roleLabel(role)}</span>}
          </span>
        </button>
        <button type="button" className="youtube-track__favorite" disabled={busy} aria-pressed={favorite}
          aria-label={t(favorite ? 'youtube.removeFavorite' : 'youtube.addFavorite', { language: label(code) })}
          title={t(favorite ? 'youtube.removeFavorite' : 'youtube.addFavorite', { language: label(code) })}
          onClick={() => { toggleFavorite(code); searchRef.current?.focus(); }}>
          <Star size={16} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
      </div>
    );
  };

  const recoveryPanel = failure && <div className="youtube-error" role="alert">
            <p>{t(`youtube.errors.${failure.code}`, { role: roleLabel(failure.role), language: failure.language ? `${label(failure.language)} (${failure.language})` : '', defaultValue: t('youtube.errors.download_failed') })}</p>
            {recovery && <p>{t('youtube.originalSaved')}</p>}
            {cooldown > 0 && <p role="status">{t('youtube.cooldown', { count: cooldown })}</p>}
            {recovery && <div className="youtube-recovery-actions">
              <button type="button" className="ui-button" disabled={cooldown > 0 || busy || failure.stage === 'translate' && !aiReady} onClick={() => void handleImport(failure.stage === 'translate' ? 'ai' : undefined)}>{t(failure.stage === 'translate' ? 'youtube.retryAi' : 'youtube.retryTranslation')}</button>
              {(failure.stage !== 'translate' || !aiReady) && <button type="button" className="ui-button" disabled={busy} onClick={() => aiReady ? void handleImport('ai') : configureAi()}>{t(aiReady ? 'youtube.fallbackAi' : 'youtube.configureAi')}</button>}
              <button type="button" className="ui-button" disabled={busy} onClick={() => void handleImport('original')}>{t('youtube.importOriginal')}</button>
            </div>}
            {['rate_limited', 'access_denied', 'browser_session', 'missing_tool'].includes(failure.code) && <button type="button" className="ui-button" onClick={() => setStep('settings')}>{t('youtube.openDownloadSettings')}</button>}
          </div>;

  return (
    <Overlay label={t('youtube.title')} onClose={closeDialog} panelRef={dialogRef} variant="sheet" className="youtube-dialog">
        <div className="youtube-dialog__header">
          <h3><Clapperboard size={20} aria-hidden="true" />{t('youtube.title')}</h3>
          <button type="button" onClick={closeDialog} aria-label={t('youtube.closeAria')} className="ui-button ui-button--icon"><X size={18} /></button>
        </div>
        <div className={`youtube-dialog__body${step === 'select' ? ' youtube-dialog__body--select' : ''}`}>
          {error && <div role="alert" className="youtube-error">
            <p>{error}</p>
            {(error.includes('yt-dlp') || error.includes('安装')) && <p>{t('youtube.ytdlpErrorHint')}</p>}
          </div>}
          {step === 'settings' && <YouTubeDownloadSettings />}
          {step === 'url' && <div className="youtube-url">
            <label htmlFor="youtube-url">{t('youtube.urlLabel')}</label>
            <input id="youtube-url" value={url} onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleSearch(); } }}
              placeholder="https://www.youtube.com/watch?v=..." className="youtube-input" />
            <p className="youtube-muted">{t('youtube.urlHint')}</p>
          </div>}
          {step === 'listing' && <div className="youtube-running" role="status"><Loader2 size={26} className="animate-spin" /><p>{t('youtube.searching')}</p></div>}
          {step === 'select' && info && <>
            <div className="youtube-selection-summary">
              <div className="youtube-video"><p>{info.title}</p><span className="youtube-muted">{formatDuration(info.duration) ?? t('youtube.unknownDuration')} · {t('youtube.trackSummary', { count: info.manual.length, autoCount: info.automatic.length })}</span></div>
              <div className="youtube-selected" aria-label={t('youtube.selectedTracks')}>
                {(['primary', 'secondary'] as const).map(role => {
                  const track = selection[role];
                  const unavailable = missing.find(item => item.role === role);
                  return <div key={role} className="youtube-selected__slot">
                    <span className="youtube-muted">{roleLabel(role)}</span>
                    <span className="youtube-selected__value">{track ? `${label(trackLanguage(track))} · ${sourceLabel(track)}`
                      : unavailable ? t('youtube.missingLanguage', { language: `${label(unavailable.lang)} (${unavailable.lang})` }) : t('youtube.notSelected')}</span>
                    {track && <button type="button" className="ui-button ui-button--icon" onClick={() => { applySelection({ ...selection, [role]: null }); searchRef.current?.focus(); }}
                      aria-label={t('youtube.clearTrack', { role: roleLabel(role) })}><X size={15} /></button>}
                  </div>;
                })}
              </div>
            </div>
            <div className="youtube-picker-controls">
              {recoveryPanel}
              <div className="youtube-selection-tools">
                <button type="button" className="ui-button" disabled={!selection.primary && !selection.secondary}
                  onClick={() => applySelection({ primary: selection.secondary, secondary: selection.primary })}>
                  <ArrowLeftRight size={15} aria-hidden="true" />{t('youtube.swapTracks')}
                </button>
                <label htmlFor="youtube-language">{t('youtube.learningLanguage')}</label>
                <AppSelect id="youtube-language" value={language} disabled={!selection.primary}
                  onChange={value => setLanguage(value as Language)} placeholder={t('youtube.selectLanguage')}
                  options={LANGUAGES.map(item => ({ value: item.id, label: item.label }))} />
              </div>
              {restored && <p className="youtube-muted" role="status">{t('youtube.restoredSelection')}</p>}
              {selection.primary && !selection.secondary && (aiEnabled
                ? <button type="button" role="switch" aria-checked={aiTranslate} className="youtube-ai"
                    onClick={() => setAiTranslate(!aiTranslate)}><Sparkles size={15} aria-hidden="true" />{t('youtube.aiTranslate')}<span>{t(aiTranslate ? 'youtube.aiOn' : 'youtube.aiOff')}</span></button>
                : <p className="youtube-muted">{t('youtube.aiTranslateHint')}</p>)}
              <div className="youtube-search">
                <Search size={17} aria-hidden="true" />
                <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} className="youtube-input"
                  aria-label={t('youtube.searchLanguages')} placeholder={t('youtube.searchLanguages')} />
                {query && <button type="button" className="ui-button ui-button--icon" aria-label={t('youtube.clearSearch')}
                  onClick={() => { setQuery(''); searchRef.current?.focus(); }}><X size={16} /></button>}
              </div>
              <p className="youtube-muted" role="status">{t('youtube.matchCount', { count: manual.length + automatic.length })}</p>
              <p className="youtube-notice" role="status" aria-live="polite">{notice || t('youtube.selectionHint')}</p>
            </div>
            <div className="youtube-track-list" aria-label={t('youtube.availableTracks')} tabIndex={0}>
              {!hasTracks && <p className="youtube-warning">{t('youtube.noSubtitles')}</p>}
              {!query.trim() && quick.favorites.length > 0 && <section><h4>{t('youtube.favorites')}</h4><div className="youtube-track-grid">{quick.favorites.map(item => renderTrack(item.track, item.lang))}</div></section>}
              {!query.trim() && quick.recent.length > 0 && <section><h4>{t('youtube.recentLanguages')}</h4><div className="youtube-track-grid">{quick.recent.map(item => renderTrack(item.track, item.lang))}</div></section>}
              {!query.trim() && quick.favorites.length === 0 && quick.recent.length === 0 && hasTracks && <p className="youtube-muted">{t('youtube.quickHint')}</p>}
              {manual.length > 0 && <section><h4>{t('youtube.manualSubtitles')}</h4><div className="youtube-track-grid">{manual.map(track => renderTrack(track, trackLanguage(track)))}</div></section>}
              {automatic.length > 0 && <section><h4>{t('youtube.autoSubtitles')}</h4><div className="youtube-track-grid">{automatic.map(track => renderTrack(track, trackLanguage(track)))}</div></section>}
              {hasTracks && manual.length + automatic.length === 0 && <div className="youtube-empty"><p>{t('youtube.noLanguageMatches')}</p>
                <button type="button" className="ui-button" onClick={() => { setQuery(''); searchRef.current?.focus(); }}>{t('youtube.clearSearch')}</button></div>}
            </div>
          </>}
          {step === 'running' && <div className="youtube-running" role="status">
            {activeDownload ? <>
              <p>{t(`youtube.stages.${activeDownload.stage}`, { defaultValue: t('youtube.downloadingSubs') })}</p>
              <progress max={100} value={activeDownload.percent} aria-label={t('youtube.downloadingSubs')} />
              <p className="youtube-muted">{activeDownload.role && roleLabel(activeDownload.role)} {activeDownload.language && label(activeDownload.language)}</p>
              {activeDownload.remainingSeconds != null && <p>{t('youtube.waitCountdown', { count: activeDownload.remainingSeconds })}</p>}
            </> : activeJob ? <>
              <p>{t('youtube.aiTranslating')} · {activeJob.percent}%</p>
              <progress max={100} value={activeJob.percent} aria-label={t('youtube.aiTranslating')} />
              <p className="youtube-muted">{t('youtube.segmentsProgress', { processed: activeJob.processedSegments, total: activeJob.totalSegments })}</p>
            </> : <><Loader2 size={26} className="animate-spin" /><p>{t(youtubePhase === 'parsing' ? 'youtube.parsing' : youtubePhase === 'importing' ? 'youtube.checkingImport' : selection.secondary ? 'youtube.merging' : 'youtube.downloadingSubs')}</p></>}
          </div>}
        </div>
        <div className="youtube-dialog__footer">
          {busy && <span className="text-sm text-gray-500">{t('shell.taskContinues')}</span>}
          {step === 'settings' && <button type="button" className="ui-button" onClick={returnFromSettings}>{t('youtube.returnToImport')}</button>}
          {step === 'url' && <button type="button" onClick={() => void handleSearch()} className="ui-button youtube-primary"><Search size={15} aria-hidden="true" />{t('youtube.findSubtitles')}</button>}
          {(step === 'select' || step === 'listing') && <>
            <button type="button" onClick={handleBack} className="ui-button">{t('youtube.back')}</button>
            {step === 'select' && <button type="button" onClick={() => void handleImport()} disabled={!selection.primary || !language || importing || cooldown > 0}
              className="ui-button youtube-primary">{t('youtube.downloadImport')}</button>}
          </>}
          {step === 'running' && <button id="youtube-cancel" type="button" onClick={handleCancelRunning} disabled={!importing} className="ui-button">{t('youtube.cancel')}</button>}
        </div>
    </Overlay>
  );
}
