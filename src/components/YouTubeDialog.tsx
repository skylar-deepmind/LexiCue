import { useState } from 'react';
import { Check, Clapperboard, Loader2, Search, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useYoutubeStore,
  type SubtitleTrack,
  type TrackSelection,
  type VideoSubInfo,
} from '../stores/youtubeStore';
import { useFileStore } from '../stores/fileStore';
import { useAiStore } from '../stores/aiStore';
import { getAiConfig } from '../lib/ai';
import { LANGUAGES, type Language } from '../lib/languages';
import { isCancelledError } from '../lib/errors';

function trackLabel(track: SubtitleTrack, locale: string): string {
  const base = track.lang.split('-')[0];
  try {
    return new Intl.DisplayNames([locale], { type: 'language', fallback: 'code' }).of(base) ?? track.lang;
  } catch {
    return track.lang;
  }
}

function suggestLanguage(lang: string): Language | null {
  const base = lang.toLowerCase().split('-')[0];
  switch (base) {
    case 'en':
      return 'en';
    case 'ja':
    case 'jp':
      return 'ja';
    case 'de':
      return 'de';
    case 'zh':
      return 'zh';
    default:
      return null;
  }
}

function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

type Step = 'url' | 'listing' | 'select' | 'running';

interface YouTubeDialogProps {
  onClose: () => void;
}

export default function YouTubeDialog({ onClose }: YouTubeDialogProps) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<Step>('url');
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState<VideoSubInfo | null>(null);
  const [selected, setSelected] = useState<TrackSelection[]>([]);
  const [language, setLanguage] = useState<Language | ''>('');
  const [aiTranslate, setAiTranslate] = useState(false);
  const [error, setError] = useState('');

  const aiEnabled = useAiStore((state) => state.enabled);
  const translateProgress = useYoutubeStore((state) => state.translateProgress);
  const downloadProgress = useYoutubeStore((state) => state.downloadProgress);
  const listSubs = useYoutubeStore((state) => state.listSubs);
  const cancelTranslate = useYoutubeStore((state) => state.cancelTranslate);
  const cancelJob = useYoutubeStore((state) => state.cancelJob);
  const importFromYouTube = useFileStore((state) => state.importFromYouTube);
  const importing = useFileStore((state) => state.importingYouTube);
  const youtubePhase = useFileStore((state) => state.youtubePhase);

  const activeDownload = Object.values(downloadProgress).find((p) => p.status === 'processing');
  const activeJob = Object.values(translateProgress).find((p) => p.status === 'processing');

  const handleSearch = async () => {
    if (!url.trim()) {
      setError(t('youtube.urlRequired'));
      return;
    }
    setStep('listing');
    setError('');
    try {
      const result = await listSubs(url.trim());
      setInfo(result);
      const first = result.manual[0] ?? result.automatic[0];
      if (first) {
        setLanguage(suggestLanguage(first.lang) ?? '');
      }
      setStep('select');
    } catch (e) {
      setError(String(e));
      setStep('url');
    }
  };

  const toggleTrack = (track: TrackSelection) => {
    setError('');
    setSelected((prev) => {
      const index = prev.findIndex((t) => t.lang === track.lang && t.is_auto === track.is_auto);
      if (index >= 0) return prev.filter((_, i) => i !== index);
      if (prev.length >= 2) return prev;
      return [...prev, track];
    });
  };

  const isSelected = (track: TrackSelection) =>
    selected.some((t) => t.lang === track.lang && t.is_auto === track.is_auto);

  const handleImport = async () => {
    if (selected.length === 0 || !language) return;
    setError('');
    setStep('running');
    try {
      const primary = selected[0];
      const secondary = selected[1] ?? null;
      await importFromYouTube({
        url: url.trim(),
        title: info?.title ?? t('fileStore.youtubeTitle'),
        primary,
        secondary,
        language,
        aiTranslate: aiTranslate && !secondary,
        config: getAiConfig(),
      });
      onClose();
    } catch (e) {
      const message = String(e);
      if (isCancelledError(message)) {
        setStep('select');
      } else {
        setError(message);
        setStep('select');
      }
    }
  };

  const handleCancelRunning = () => {
    if (activeDownload) {
      void cancelJob(activeDownload.jobId);
    } else if (activeJob) {
      void cancelTranslate(activeJob.jobId);
    } else {
      onClose();
    }
  };

  const renderTrack = (track: SubtitleTrack) => {
    const selectedFlag = isSelected(track);
    return (
      <button
        key={`${track.is_auto ? 'a' : 'm'}-${track.lang}`}
        type="button"
        onClick={() => toggleTrack(track)}
        disabled={step === 'running' || importing}
        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
          selectedFlag
            ? 'border-blue-500 bg-blue-50 text-blue-700'
            : 'border-gray-200 text-gray-700 hover:bg-gray-50'
        }`}
      >
        <span className="truncate">{trackLabel(track, i18n.resolvedLanguage ?? 'zh')}</span>
        <span className="shrink-0 text-xs text-gray-400">{track.lang}</span>
        {selectedFlag && <Check size={15} className="shrink-0 text-blue-600" />}
      </button>
    );
  };

  const showAiOption = selected.length === 1 && aiEnabled;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 p-5">
          <div className="flex items-center gap-2">
            <Clapperboard size={20} className="text-red-600" />
            <h3 className="text-lg font-semibold text-gray-900">{t('youtube.title')}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label={t('youtube.closeAria')}
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              <p className="break-all">{error}</p>
              {(error.includes('yt-dlp') || error.includes('安装')) && (
                <p className="mt-1.5 text-xs text-red-500">
                  {t('youtube.ytdlpErrorHint')}
                </p>
              )}
            </div>
          )}

          {step === 'url' && (
            <div className="space-y-4">
              <label className="block text-sm font-medium text-gray-700" htmlFor="youtube-url">
                {t('youtube.urlLabel')}
              </label>
              <input
                id="youtube-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleSearch()}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <p className="text-xs leading-5 text-gray-500">
                {t('youtube.urlHint')}
              </p>
            </div>
          )}

          {step === 'listing' && (
            <div className="flex flex-col items-center gap-3 py-10 text-gray-400">
              <Loader2 size={26} className="animate-spin" />
              <p className="text-sm">{t('youtube.searching')}</p>
            </div>
          )}

          {step === 'select' && info && (
            <div className="space-y-4">
              <div>
                <p className="font-medium text-gray-900">{info.title}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {formatDuration(info.duration) ?? t('youtube.unknownDuration')} · {t('youtube.trackSummary', { count: info.manual.length, autoCount: info.automatic.length })}
                </p>
              </div>

              {info.manual.length === 0 && info.automatic.length === 0 && (
                <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {t('youtube.noSubtitles')}
                </div>
              )}

              {info.manual.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">{t('youtube.manualSubtitles')}</p>
                  <div className="grid grid-cols-2 gap-2">{info.manual.map(renderTrack)}</div>
                </div>
              )}

              {info.automatic.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">{t('youtube.autoSubtitles')}</p>
                  <div className="grid grid-cols-2 gap-2">{info.automatic.map(renderTrack)}</div>
                </div>
              )}

              {selected.length > 0 && (
                <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs text-gray-500">
                    {t('youtube.selectedCount', { count: selected.length })}
                    {selected.length === 2 && t('youtube.secondAsTranslation')}
                  </p>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700" htmlFor="youtube-language">
                      {t('youtube.learningLanguage')}
                    </label>
                    <select
                      id="youtube-language"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value as Language)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="" disabled>{t('youtube.selectLanguage')}</option>
                      {LANGUAGES.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </div>
                  {showAiOption && (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={aiTranslate}
                      onClick={() => setAiTranslate(!aiTranslate)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-purple-200 bg-white px-3 py-2.5 text-left"
                    >
                      <span className="flex items-center gap-2 text-sm text-gray-700">
                        <Sparkles size={15} className="text-purple-600" />
                        {t('youtube.aiTranslate')}
                      </span>
                      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${aiTranslate ? 'bg-purple-600' : 'bg-gray-300'}`}>
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${aiTranslate ? 'left-[18px]' : 'left-0.5'}`} />
                      </span>
                    </button>
                  )}
                  {!showAiOption && selected.length === 1 && (
                    <p className="text-xs text-gray-400">{t('youtube.aiTranslateHint')}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 'running' && (
            <div className="flex flex-col items-center gap-4 py-10">
              {activeDownload ? (
                <>
                  <div className="flex w-full items-center justify-between text-sm text-gray-600">
                    <span>{activeDownload.message || t('youtube.downloadingSubs')}</span>
                    <span>{Math.round(activeDownload.percent)}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-all"
                      style={{ width: `${Math.max(2, Math.round(activeDownload.percent))}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400">{activeDownload.stage}</p>
                </>
              ) : activeJob ? (
                <>
                  <div className="flex w-full items-center justify-between text-sm text-gray-500">
                    <span>{t('youtube.aiTranslating')}</span>
                    <span>{activeJob.percent}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-purple-600 transition-all"
                      style={{ width: `${activeJob.percent}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400">
                    {t('youtube.segmentsProgress', { processed: activeJob.processedSegments, total: activeJob.totalSegments })}
                  </p>
                </>
              ) : (
                <>
                  <Loader2 size={26} className="animate-spin text-gray-400" />
                  <p className="text-sm text-gray-500">
                    {youtubePhase === 'parsing'
                      ? t('youtube.parsing')
                      : youtubePhase === 'importing'
                        ? t('youtube.checkingImport')
                        : selected.length === 2
                          ? t('youtube.merging')
                          : t('youtube.downloadingSubs')}
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-100 p-4">
          {step === 'url' && (
            <button
              onClick={() => void handleSearch()}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              <Search size={15} />
              {t('youtube.findSubtitles')}
            </button>
          )}
          {(step === 'select' || step === 'listing') && (
            <>
              <button
                onClick={() => {
                  setStep('url');
                  setError('');
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                {t('youtube.back')}
              </button>
              {step === 'select' && (
                <button
                  onClick={() => void handleImport()}
                  disabled={selected.length === 0 || !language}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {t('youtube.downloadImport')}
                </button>
              )}
            </>
          )}
          {step === 'running' && (
            <button
              onClick={handleCancelRunning}
              disabled={!activeDownload && !activeJob && !importing}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
            >
              {activeDownload || activeJob ? t('youtube.cancel') : t('youtube.close')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
