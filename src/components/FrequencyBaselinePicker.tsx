import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BarChart3, RefreshCw, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Language } from '../lib/languages';
import { SELF_NAMES } from '../lib/languages';
import { invalidateCaches } from '../lib/cacheInvalidation';

interface Profile { tier: number | null; enabled: boolean; }
interface Preview {
  tier: number;
  range_start: number;
  range_end: number;
  words: string[];
  matching_count: number;
  will_skip_count: number;
  retained_count: number;
}

export const TIERS = [1000, 3000, 5000, 10000];
const isBaselineLanguage = (language: Language | 'all'): language is 'en' | 'zh' => language === 'en' || language === 'zh';

export function TierButton({ value, selected, onClick }: { value: number; selected: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return <button onClick={onClick} className={`rounded-lg border px-3 py-2 text-left text-sm ${selected ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-emerald-100 bg-white text-gray-700'}`}>
    <span className="block font-medium">{t(`frequencyBaseline.tiers.${value}.title`)}</span>
    <span className={`block text-xs ${selected ? 'text-emerald-50' : 'text-gray-500'}`}>{t(`frequencyBaseline.tiers.${value}.count`)}</span>
  </button>;
}

export default function FrequencyBaselinePicker({ selectedLanguage }: { selectedLanguage: Language | 'all' }) {
  const { t } = useTranslation();
  const [language, setLanguage] = useState<'en' | 'zh'>(selectedLanguage === 'zh' ? 'zh' : 'en');
  const [tier, setTier] = useState(1000);
  const [batch, setBatch] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const activeLanguage = isBaselineLanguage(selectedLanguage) ? selectedLanguage : null;
  useEffect(() => {
    if (!activeLanguage) return;
    setProfile(null);
    setPreview(null);
    setLanguage(activeLanguage);
  }, [activeLanguage]);
  useEffect(() => { setBatch(0); }, [language, tier]);
  useEffect(() => {
    if (!activeLanguage) return;
    setLoading(true);
    void Promise.all([
      invoke<Preview>('get_frequency_baseline_preview', { language, tier, batch }),
      invoke<Profile>('get_frequency_baseline', { language }),
    ]).then(([nextPreview, nextProfile]) => {
      setPreview(nextPreview);
      setProfile(nextProfile);
    }).finally(() => setLoading(false));
  }, [language, tier, batch]);

  const apply = async () => {
    setApplying(true);
    try {
      await invoke('configure_frequency_baseline', { language, tier });
      setProfile(await invoke<Profile>('get_frequency_baseline', { language }));
      invalidateCaches('words', 'files', 'review', 'insights');
    } finally { setApplying(false); }
  };
  if (!activeLanguage) return <section className="mx-6 mt-3 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
    <span className="text-sm text-gray-600">{t('frequencyBaseline.allLanguagesHint')}</span>
    <Link to="/settings#frequency-baseline" className="inline-flex shrink-0 items-center gap-1 text-sm text-emerald-700 hover:underline"><Settings size={15} />{t('frequencyBaseline.manage')}</Link>
  </section>;

  // A tier is retained after auto-marking is stopped, so it still counts as configured.
  if (profile?.tier !== null && profile?.tier !== undefined) return <section className="mx-6 mt-3 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
    <div className="min-w-0"><p className="text-sm font-medium text-gray-800">{t('frequencyBaseline.currentSummary', { language: SELF_NAMES[language], tier: t(`frequencyBaseline.tiers.${profile.tier}.title`) })}</p><p className="mt-0.5 text-xs text-gray-500">{t('frequencyBaseline.currentHint')}</p></div>
    <Link to="/settings#frequency-baseline" className="inline-flex shrink-0 items-center gap-1 text-sm text-emerald-700 hover:underline"><Settings size={15} />{t('frequencyBaseline.manage')}</Link>
  </section>;

  const rangeLabel = preview && preview.range_start === 0
    ? t('frequencyBaseline.firstRange', { count: preview.range_end.toLocaleString() })
    : preview ? t('frequencyBaseline.addedRange', { start: preview.range_start.toLocaleString(), end: preview.range_end.toLocaleString() }) : '';

  return (
    <section className="mx-6 mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-emerald-100 p-2 text-emerald-700"><BarChart3 size={20} /></div>
        <div className="min-w-0 flex-1"><h2 className="font-semibold text-emerald-950">{t('frequencyBaseline.chooseTitle')}</h2><p className="mt-1 text-sm text-emerald-800">{t('frequencyBaseline.chooseDescription')}</p></div>
      </div>
      <div className="mt-4 flex gap-2">
        {(['en', 'zh'] as const).map((item) => <button key={item} onClick={() => setLanguage(item)} className={`rounded-lg border px-3 py-1.5 text-sm ${language === item ? 'border-emerald-500 bg-emerald-100 text-emerald-800' : 'border-emerald-100 text-emerald-700'}`}>{SELF_NAMES[item]}</button>)}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">{TIERS.map((value) => <TierButton key={value} value={value} selected={tier === value} onClick={() => setTier(value)} />)}</div>
      <p className="mt-2 text-xs text-emerald-900">{t(`frequencyBaseline.tiers.${tier}.description`)}</p>
      <div className="mt-3 rounded-xl bg-white p-3">
        <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-gray-800">{rangeLabel} · {t('frequencyBaseline.sampleCount')}</p><button disabled={loading} onClick={() => setBatch((value) => value + 1)} className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline disabled:opacity-50"><RefreshCw size={13} />{t('frequencyBaseline.nextSample')}</button></div>
        {loading ? <p className="mt-3 text-sm text-gray-400">{t('frequencyBaseline.loading')}</p> : <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-700">{preview?.words.map((word) => <span key={word}>{word}</span>)}</div>}
      </div>
      {preview && <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-emerald-900">{t('frequencyBaseline.impact', { matching: preview.matching_count, skipped: preview.will_skip_count, retained: preview.retained_count })}</p><button disabled={applying} onClick={() => void apply()} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{applying ? t('frequencyBaseline.applying') : t('frequencyBaseline.apply', { count: tier.toLocaleString() })}</button></div>}
    </section>
  );
}
