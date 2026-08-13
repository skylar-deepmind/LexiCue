import { useEffect, useState } from 'react';
import { BookOpen, Brain, Clapperboard, Database, Download, Eye, EyeOff, HardDrive, RefreshCw, Trash2, Upload } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { ask } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from 'react-i18next';
import { useFileStore } from '../stores/fileStore';
import { useUpdateStore } from '../stores/updateStore';
import { DEFAULT_OLLAMA_URL, OPENAI_PRESETS, useAiStore, type AiProvider } from '../stores/aiStore';
import type { DictionarySource } from '../lib/types';
import { useTheme } from '../components/useTheme';
import { THEMES } from '../lib/themes';
import { SELF_NAMES, UI_LANGUAGES, isLanguage } from '../lib/languages';
import { usePreferencesStore } from '../stores/preferencesStore';
import { formatBytes } from '../lib/format';

interface YtDlpStatus {
  available: boolean;
  version: string | null;
}

interface StorageComponent {
  key: string;
  bytes: number;
}

interface StorageUsage {
  total: number;
  components: StorageComponent[];
  database_breakdown: {
    user_data: number;
    builtin_dictionaries: number;
    dictionary_entries: number;
  };
}

function formatImportedAt(timestamp: number, locale: string) {
  return new Date(timestamp).toLocaleString(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const SECTION_NAV = [
  { id: 'ui-language', labelKey: 'settings.uiLanguage.title' },
  { id: 'ai', labelKey: 'settings.ai.title' },
  { id: 'youtube', labelKey: 'settings.youtube.title' },
  { id: 'theme', labelKey: 'settings.theme.title' },
  { id: 'dictionary', labelKey: 'settings.dictionary.title' },
  { id: 'storage', labelKey: 'settings.storage.title' },
  { id: 'updates', labelKey: 'settings.updates.title' },
];

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const uiLanguage = usePreferencesStore((state) => state.uiLanguage);
  const setUiLanguage = usePreferencesStore((state) => state.setUiLanguage);
  const importDictionaryPack = useFileStore((state) => state.importDictionaryPack);
  const [sources, setSources] = useState<DictionarySource[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [storageLoading, setStorageLoading] = useState(true);
  const aiEnabled = useAiStore((state) => state.enabled);
  const aiProvider = useAiStore((state) => state.provider);
  const aiBaseUrl = useAiStore((state) => state.baseUrl);
  const aiModel = useAiStore((state) => state.model);
  const aiApiKey = useAiStore((state) => state.apiKey);
  const setAiEnabled = useAiStore((state) => state.setEnabled);
  const setAiProvider = useAiStore((state) => state.setProvider);
  const setAiBaseUrl = useAiStore((state) => state.setBaseUrl);
  const selectAiBaseUrl = useAiStore((state) => state.selectBaseUrl);
  const setAiModel = useAiStore((state) => state.setModel);
  const setAiApiKey = useAiStore((state) => state.setApiKey);
  const aiStatus = useAiStore((state) => state.aiStatus);
  const aiModels = useAiStore((state) => state.aiModels);
  const aiError = useAiStore((state) => state.aiError);
  const setAiStatus = useAiStore((state) => state.setAiStatus);
  const setAiModels = useAiStore((state) => state.setAiModels);
  const setAiError = useAiStore((state) => state.setAiError);
  const aiFingerprint = useAiStore((state) => state.aiFingerprint);
  const setAiFingerprint = useAiStore((state) => state.setAiFingerprint);
  const resetAiCheck = useAiStore((state) => state.resetAiCheck);
  const [ytdlp, setYtdlp] = useState<YtDlpStatus | null>(null);
  const [ytdlpChecking, setYtdlpChecking] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showYtInstall, setShowYtInstall] = useState(false);
  const [currentVersion, setCurrentVersion] = useState('');
  const updateStatus = useUpdateStore((state) => state.status);
  const updateVersion = useUpdateStore((state) => state.version);
  const updateNotes = useUpdateStore((state) => state.notes);
  const updateProgress = useUpdateStore((state) => state.progress);
  const updateError = useUpdateStore((state) => state.error);
  const updateDownloadUrl = useUpdateStore((state) => state.downloadUrl);
  const checkUpdate = useUpdateStore((state) => state.check);
  const installUpdate = useUpdateStore((state) => state.install);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const checkYtdlp = async () => {
    setYtdlpChecking(true);
    try {
      setYtdlp(await invoke<YtDlpStatus>('youtube_ytdlp_status'));
    } catch (error) {
      console.error('Failed to check yt-dlp:', error);
    } finally {
      setYtdlpChecking(false);
    }
  };

  const loadSources = async () => {
    setLoading(true);
    try {
      setSources(await invoke<DictionarySource[]>('list_dictionary_sources'));
    } catch (error) {
      console.error('Failed to load dictionary sources:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStorage = async () => {
    setStorageLoading(true);
    try {
      setStorage(await invoke<StorageUsage>('get_storage_usage'));
    } catch (error) {
      console.error('Failed to load storage usage:', error);
    } finally {
      setStorageLoading(false);
    }
  };

  useEffect(() => {
    void loadSources();
    void loadStorage();
    void checkYtdlp();
    void getVersion()
      .then(setCurrentVersion)
      .catch(() => setCurrentVersion(''));
  }, []);

  const checkAi = async () => {
    setAiStatus('checking');
    setAiError('');
    const config = {
      provider: aiProvider,
      baseUrl: aiBaseUrl.trim() || DEFAULT_OLLAMA_URL,
      model: aiModel,
      apiKey: aiProvider === 'openai' ? aiApiKey : undefined,
    };
    const fingerprint = JSON.stringify(config);
    try {
      await invoke('ai_status', { config });
      setAiStatus('ready');
      setAiFingerprint(fingerprint);
      try {
        const models = await invoke<{ name: string }[]>('ai_models', { config });
        setAiModels(models.map((item) => item.name));
      } catch (error) {
        console.error('Failed to load AI model list:', error);
        setAiModels([]);
      }
    } catch (error) {
      console.error('Failed to connect to AI service:', error);
      setAiStatus('error');
      setAiError(String(error));
      setAiFingerprint(fingerprint);
    }
  };

  useEffect(() => {
    const fingerprint = JSON.stringify({
      provider: aiProvider,
      baseUrl: aiBaseUrl.trim() || DEFAULT_OLLAMA_URL,
      model: aiModel,
      apiKey: aiProvider === 'openai' ? aiApiKey : undefined,
    });
    if (aiStatus !== 'idle' && aiFingerprint && aiFingerprint !== fingerprint) {
      resetAiCheck();
    }
  }, [aiProvider, aiBaseUrl, aiModel, aiApiKey, aiStatus, aiFingerprint, resetAiCheck]);

  const switchProvider = (provider: AiProvider) => {
    setAiProvider(provider);
    resetAiCheck();
  };

  const selectPreset = (value: string) => {
    selectAiBaseUrl(value === 'custom' ? '' : value);
    resetAiCheck();
  };

  const handleImport = async () => {
    await importDictionaryPack();
    await loadSources();
  };

  const handleDelete = async (source: DictionarySource) => {
    const confirmed = await ask(t('settings.dictionary.deleteConfirm', {
      provider: source.provider,
      count: source.entry_count,
    }), {
      title: t('settings.dictionary.deleteTitle'),
      kind: 'warning',
      okLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!confirmed) return;
    setDeleting(source.provider);
    try {
      await invoke('delete_dictionary_source', { provider: source.provider, language: source.language });
      await loadSources();
    } catch (error) {
      console.error('Failed to delete dictionary source:', error);
    } finally {
      setDeleting(null);
    }
  };

  const locale = i18n.resolvedLanguage ?? 'zh';

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-gray-100 px-6 py-4">
        <h1 className="text-xl font-semibold text-gray-900">{t('settings.title')}</h1>
      </div>

      <div className="mx-auto max-w-5xl p-6">
        <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
          <nav className="hidden lg:block sticky top-6 self-start rounded-2xl border border-gray-200 bg-white p-2 shadow-sm" aria-label={t('settings.navAria')}>
            {SECTION_NAV.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
              >
                {t(item.labelKey)}
              </button>
            ))}
          </nav>

          <div className="min-w-0 space-y-6">
        <section id="ui-language" className="scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-gray-900">{t('settings.uiLanguage.title')}</h2>
              <p className="mt-1 text-sm text-gray-500">{t('settings.uiLanguage.description')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {UI_LANGUAGES.map((lang) => (
                <button
                  key={lang}
                  type="button"
                  aria-pressed={uiLanguage === lang}
                  onClick={() => setUiLanguage(lang)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${uiLanguage === lang ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  {SELF_NAMES[lang]}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section id="ai" className="scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-purple-50 p-2 text-purple-600"><Brain size={20} /></div>
              <div>
                <h2 className="font-semibold text-gray-900">{t('settings.ai.title')}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('settings.ai.description')}</p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={aiEnabled}
              onClick={() => setAiEnabled(!aiEnabled)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${aiEnabled ? 'bg-purple-600' : 'bg-gray-300'}`}
              aria-label={t('settings.ai.toggleAria')}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${aiEnabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>

          {aiEnabled ? (
            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                {(['ollama', 'openai'] as AiProvider[]).map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    onClick={() => switchProvider(provider)}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${aiProvider === provider ? 'border-purple-300 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {provider === 'ollama' ? t('settings.ai.providerLocal') : t('settings.ai.providerCloud')}
                  </button>
                ))}
              </div>

              {aiProvider === 'ollama' ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <input
                    value={aiBaseUrl}
                    onChange={(event) => setAiBaseUrl(event.target.value)}
                    placeholder={DEFAULT_OLLAMA_URL}
                    aria-label={t('settings.ai.ollamaUrlAria')}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                  />
                  <select
                    value={aiModel}
                    onChange={(event) => setAiModel(event.target.value)}
                    aria-label={t('settings.ai.ollamaModelAria')}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                  >
                    <option value="">{t('settings.ai.selectModel')}</option>
                    {aiModels.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                  <button
                    onClick={() => void checkAi()}
                    disabled={aiStatus === 'checking'}
                    className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
                  >
                    {aiStatus === 'checking' ? t('settings.ai.connecting') : t('settings.ai.connect')}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
                    <select
                      value={OPENAI_PRESETS.some((preset) => preset.baseUrl === aiBaseUrl) ? aiBaseUrl : 'custom'}
                      onChange={(event) => selectPreset(event.target.value)}
                      aria-label={t('settings.ai.cloudServiceAria')}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                    >
                      {OPENAI_PRESETS.map((preset) => (
                        <option key={preset.label} value={preset.baseUrl || 'custom'}>{preset.key === 'custom' ? t('settings.ai.custom') : preset.label}</option>
                      ))}
                    </select>
                    <input
                      value={aiBaseUrl}
                      onChange={(event) => setAiBaseUrl(event.target.value)}
                      placeholder="https://api.example.com/v1"
                      aria-label={t('settings.ai.cloudBaseUrlAria')}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <div className="relative">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={aiApiKey}
                        onChange={(event) => setAiApiKey(event.target.value)}
                        placeholder={t('settings.ai.apiKeyPlaceholder')}
                        aria-label="API Key"
                        autoComplete="off"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-10 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey((visible) => !visible)}
                        aria-label={t('settings.ai.apiKeyToggleAria')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600"
                      >
                        {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAiApiKey('')}
                      aria-label={t('settings.ai.clearKeyAria')}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
                    >
                      {t('settings.ai.clearKey')}
                    </button>
                    <button
                      onClick={() => void checkAi()}
                      disabled={aiStatus === 'checking'}
                      className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
                    >
                      {aiStatus === 'checking' ? t('settings.ai.connecting') : t('settings.ai.connect')}
                    </button>
                  </div>
                  <select
                    value={aiModel}
                    onChange={(event) => setAiModel(event.target.value)}
                    aria-label={t('settings.ai.cloudModelAria')}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                  >
                    <option value="">{t('settings.ai.selectModel')}</option>
                    {aiModels.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                </div>
              )}

              <div className="flex items-center gap-2 text-xs">
                <span className={`h-2 w-2 rounded-full ${aiStatus === 'ready' ? 'bg-green-500' : aiStatus === 'error' ? 'bg-red-500' : 'bg-gray-300'}`} />
                <span className="text-gray-500">
                  {aiStatus === 'ready' ? t('settings.ai.statusReady', { count: aiModels.length }) : aiStatus === 'error' ? t('settings.ai.statusError') : t('settings.ai.statusIdle')}
                </span>
              </div>
              {aiError && <p className="break-all text-xs text-red-600">{aiError}</p>}
            </div>
          ) : (
            <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-500">{t('settings.ai.disabledHint')}</p>
          )}
        </section>

        <section id="youtube" className="scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-red-50 p-2 text-red-600">
                <Clapperboard size={20} />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">{t('settings.youtube.title')}</h2>
                <p className="mt-1 max-w-xl text-sm text-gray-500">
                  {t('settings.youtube.description')}
                </p>
              </div>
            </div>
            <button
              onClick={() => void checkYtdlp()}
              disabled={ytdlpChecking}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={14} className={ytdlpChecking ? 'animate-spin' : ''} />
              {t('settings.youtube.recheck')}
            </button>
          </div>

          {ytdlp && (
            <div className="mt-4">
              {ytdlp.available ? (
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  <span>{t('settings.youtube.installed', { version: ytdlp.version ? ` (${ytdlp.version})` : '' })}</span>
                </div>
              ) : (
                <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <p className="font-medium">{t('settings.youtube.notInstalled')}</p>
                  <button
                    onClick={() => setShowYtInstall((visible) => !visible)}
                    aria-expanded={showYtInstall}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700 underline decoration-amber-300 underline-offset-2 hover:text-amber-900"
                  >
                    {showYtInstall ? t('settings.youtube.hideInstall') : t('settings.youtube.showInstall')}
                  </button>
                  {showYtInstall && (
                    <p className="mt-2 text-xs leading-5">
                      {t('settings.youtube.installHeader')}
                      <br />· {t('settings.youtube.macOs')}<code className="rounded bg-amber-100 px-1">brew install yt-dlp</code>
                      <br />· {t('settings.youtube.windows')}<code className="rounded bg-amber-100 px-1">winget install yt-dlp</code> {t('settings.youtube.or')} <code className="rounded bg-amber-100 px-1">pip install -U yt-dlp</code>
                      <br />· {t('settings.youtube.linux')}<code className="rounded bg-amber-100 px-1">sudo apt install yt-dlp</code> {t('settings.youtube.or')} <code className="rounded bg-amber-100 px-1">sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod +x /usr/local/bin/yt-dlp</code>
                      <br />{t('settings.youtube.installDone')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        <section id="theme" className="scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div>
            <h2 className="font-semibold text-gray-900">{t('settings.theme.title')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('settings.theme.description')}</p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {THEMES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={theme === item.id}
                onClick={() => setTheme(item.id)}
                className={`rounded-xl border p-3 text-left transition-all ${theme === item.id ? 'border-blue-500 bg-blue-50/60 ring-2 ring-blue-100' : 'border-gray-200 hover:border-blue-200 hover:bg-gray-50'}`}
              >
                <span className="flex items-center gap-2">
                  <span className="h-5 w-5 rounded-full ring-2 ring-white shadow-sm" style={{ backgroundColor: item.color }} />
                  <span className="font-medium text-gray-900">{t(`themes.${item.id}Label`)}</span>
                </span>
                <span className="mt-2 block text-xs text-gray-500">{t(`themes.${item.id}Description`)}</span>
              </button>
            ))}
          </div>
        </section>

        <section id="dictionary" className="scroll-mt-6 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-blue-50 p-2 text-blue-600">
                <BookOpen size={20} />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">{t('settings.dictionary.title')}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('settings.dictionary.description')}</p>
              </div>
            </div>
            <button
              onClick={() => void handleImport()}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              <Upload size={16} />
              {t('settings.dictionary.import')}
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-gray-400">
              <RefreshCw size={15} className="animate-spin" />
              {t('settings.dictionary.loading')}
            </div>
          ) : sources.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-10 text-center">
              <Database size={30} className="text-gray-300" />
              <p className="mt-3 text-sm font-medium text-gray-600">{t('settings.dictionary.empty')}</p>
              <p className="mt-1 text-xs text-gray-400">{t('settings.dictionary.emptyHint')}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {sources.map((source) => (
                <div key={`${source.language}-${source.provider}`} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                       <h3 className="font-medium text-gray-900">{source.provider} · {isLanguage(source.language) ? SELF_NAMES[source.language] : source.language}</h3>
                      {source.version && <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">v{source.version}</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>{t('settings.dictionary.entries', { count: source.entry_count })}</span>
                      <span>{t('settings.dictionary.importedAt', { date: formatImportedAt(source.imported_at, locale) })}</span>
                      {source.license && <span>{t('settings.dictionary.license', { license: source.license })}</span>}
                    </div>
                    {source.source_url && (
                      <p className="mt-1 truncate text-xs text-gray-400" title={source.source_url}>{source.source_url}</p>
                    )}
                  </div>
                  <button
                    onClick={() => void handleDelete(source)}
                    disabled={deleting === source.provider}
                    className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-red-100 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
                  >
                    <Trash2 size={15} />
                    {deleting === source.provider ? t('settings.dictionary.deleting') : t('settings.dictionary.delete')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section id="storage" className="scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-cyan-50 p-2 text-cyan-600">
                <HardDrive size={20} />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">{t('settings.storage.title')}</h2>
                <p className="mt-1 max-w-xl text-sm text-gray-500">{t('settings.storage.description')}</p>
              </div>
            </div>
            <button
              onClick={() => void loadStorage()}
              disabled={storageLoading}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={14} className={storageLoading ? 'animate-spin' : ''} />
              {t('settings.storage.recalc')}
            </button>
          </div>

          {storageLoading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-gray-400">
              <RefreshCw size={15} className="animate-spin" />
              {t('settings.storage.loading')}
            </div>
          ) : storage ? (
            <div className="mt-4">
              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-xs text-gray-500">{t('settings.storage.total')}</p>
                <p className="mt-1 text-3xl font-semibold text-gray-900">{formatBytes(storage.total)}</p>
              </div>
              <div className="mt-3 space-y-2">
                {storage.components.map((component) => (
                  <div key={component.key} className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-2.5 text-sm">
                    <span className="text-gray-700">{t(`settings.storage.${component.key}`)}</span>
                    <span className="font-medium text-gray-900">{formatBytes(component.bytes)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-gray-100 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-900">{t('settings.storage.dbBreakdown')}</h3>
                  <span className="text-xs text-gray-400">{t('settings.storage.estimated')}</span>
                </div>
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{t('settings.storage.userData')}</span>
                    <span className="font-medium text-gray-900">{formatBytes(storage.database_breakdown.user_data)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{t('settings.storage.builtinDictionaries')}</span>
                    <span className="font-medium text-gray-900">{formatBytes(storage.database_breakdown.builtin_dictionaries)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{t('settings.storage.dictionaryEntries')}</span>
                    <span className="font-medium text-gray-900">{formatBytes(storage.database_breakdown.dictionary_entries)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section id="updates" className="scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-green-50 p-2 text-green-600">
                <Download size={20} />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900">{t('settings.updates.title')}</h2>
                <p className="mt-1 max-w-xl text-sm text-gray-500">{t('settings.updates.description')}</p>
              </div>
            </div>
            <button
              onClick={() => void checkUpdate()}
              disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={14} className={updateStatus === 'checking' ? 'animate-spin' : ''} />
              {updateStatus === 'checking' ? t('settings.updates.checking') : t('settings.updates.check')}
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span>{t('settings.updates.currentVersion', { version: currentVersion || '-' })}</span>
            </div>

            {updateStatus === 'upToDate' && (
              <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">{t('settings.updates.upToDate')}</p>
            )}

            {updateStatus === 'available' && updateVersion && (
              <div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
                <p className="font-medium">{t('settings.updates.available', { version: updateVersion })}</p>
                {updateNotes && (
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-blue-700">{updateNotes}</p>
                )}
                {updateDownloadUrl ? (
                  <div>
                    <button
                      onClick={() => void openUrl(updateDownloadUrl)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                    >
                      <Download size={15} />
                      {t('settings.updates.downloadPage')}
                    </button>
                    <p className="mt-2 text-xs text-blue-500">{t('settings.updates.androidHint')}</p>
                  </div>
                ) : (
                  <div>
                    <button
                      onClick={() => void installUpdate()}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                    >
                      <Download size={15} />
                      {t('settings.updates.install')}
                    </button>
                    <p className="mt-2 text-xs text-blue-500">{t('settings.updates.installHint')}</p>
                  </div>
                )}
              </div>
            )}

            {updateStatus === 'downloading' && (
              <div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
                <p className="font-medium">{t('settings.updates.downloading')}</p>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-100">
                  <div className="h-full bg-blue-600 transition-all" style={{ width: `${updateProgress}%` }} />
                </div>
                <p className="mt-1 text-right text-xs">{updateProgress}%</p>
              </div>
            )}

            {updateStatus === 'error' && updateError && (
              <p className="rounded-lg bg-red-50 px-4 py-3 text-xs text-red-600">{updateError}</p>
            )}
          </div>
        </section>
          </div>
        </div>
      </div>
    </div>
  );
}
