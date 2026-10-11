import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BarChart3, RefreshCw, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import type { Language } from '../lib/languages';
import { SELF_NAMES } from '../lib/languages';
import { invalidateCaches } from '../lib/cacheInvalidation';
import SettingsCollapsibleSection from './SettingsCollapsibleSection';

interface Profile { language: Language; tier: number | null; enabled: boolean; marked_count: number; pending_count: number; pack_version: string; license: string; }
interface Preview { range_start: number; range_end: number; words: string[]; }
const LANGUAGES: Language[] = ['en', 'zh'];
const TIERS = [1000, 3000, 5000, 10000];

function TierButton({ value, selected, onClick }: { value: number; selected: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className="frequency-baseline-option rounded-lg px-3 py-2 text-left text-sm">
      <span className="block font-medium">{t(`frequencyBaseline.tiers.${value}.title`)}</span>
      <span className="frequency-baseline-option__detail block text-xs">{t(`frequencyBaseline.tiers.${value}.count`)}</span>
    </button>
  );
}

export default function FrequencyBaselineSettings() {
  const { t } = useTranslation();
  const location = useLocation();
  const [language, setLanguage] = useState<Language>('en');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tier, setTier] = useState(1000);
  const [batch, setBatch] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(() => location.hash === '#frequency-baseline');
  useEffect(() => {
    if (location.hash === '#frequency-baseline') setOpen(true);
  }, [location.hash]);
  const load = useCallback(async () => {
    const nextProfile = await invoke<Profile>('get_frequency_baseline', { language });
    setProfile(nextProfile);
    if (nextProfile.tier) setTier(nextProfile.tier);
  }, [language]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setBatch(0); }, [language, tier]);
  useEffect(() => {
    if (!open) return;
    setPreviewLoading(true);
    void invoke<Preview>('get_frequency_baseline_preview', { language, tier, batch })
      .then(setPreview)
      .finally(() => setPreviewLoading(false));
  }, [language, tier, batch, open]);
  const configure = async (tier: number) => {
    setSaving(true);
    try { await invoke('configure_frequency_baseline', { language, tier }); await load(); invalidateCaches('words', 'files', 'review', 'insights'); }
    finally { setSaving(false); }
  };
  const revoke = async () => {
    setSaving(true);
    try { await invoke('revoke_frequency_baseline', { language }); await load(); invalidateCaches('words', 'files', 'review', 'insights'); }
    finally { setSaving(false); }
  };
  const disable = async () => {
    setSaving(true);
    try { await invoke('configure_frequency_baseline', { language, tier: null }); await load(); invalidateCaches('words', 'files', 'review', 'insights'); }
    finally { setSaving(false); }
  };
  return (
    <SettingsCollapsibleSection
      id="frequency-baseline"
      icon={<span className="frequency-baseline-settings__icon rounded-xl p-2"><BarChart3 size={20} /></span>}
      title={t('frequencyBaseline.settingsTitle')}
      description={t('frequencyBaseline.settingsDescription')}
      summary={profile?.enabled && profile.tier ? t('frequencyBaseline.settingsSummaryEnabled', { language: SELF_NAMES[language], tier: profile.tier.toLocaleString() }) : t('frequencyBaseline.settingsSummaryDisabled', { language: SELF_NAMES[language] })}
      open={open}
      onOpenChange={setOpen}
      expandLabel={t('settings.expand')}
      collapseLabel={t('settings.collapse')}
    >
      <div className="mt-4 flex gap-2">{LANGUAGES.map((item) => <button key={item} type="button" aria-pressed={language === item} onClick={() => setLanguage(item)} className="frequency-baseline-option rounded-lg px-3 py-1.5 text-sm">{SELF_NAMES[item]}</button>)}</div>
      <div className="mt-4 flex flex-wrap gap-2">{TIERS.map((value) => <TierButton key={value} value={value} selected={tier === value} onClick={() => setTier(value)} />)}</div>
      <p className="mt-2 text-xs text-gray-500">{t(`frequencyBaseline.tiers.${tier}.description`)}</p>
      <div className="mt-3 rounded-xl bg-gray-50 p-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-gray-800">{t('frequencyBaseline.settingsPreview')}</p><button type="button" disabled={previewLoading} onClick={() => setBatch((value) => value + 1)} className="frequency-baseline-settings__link inline-flex items-center gap-1 rounded px-1 py-1 text-xs"><RefreshCw size={13} />{t('frequencyBaseline.nextSample')}</button></div>{previewLoading ? <p className="mt-3 text-sm text-gray-400">{t('frequencyBaseline.loading')}</p> : <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-700">{preview?.words.map((word) => <span key={word}>{word}</span>)}</div>}</div>
      <div className="mt-3"><button type="button" disabled={saving} onClick={() => void configure(tier)} className="frequency-baseline-settings__primary rounded-lg px-3 py-2 text-sm font-medium">{saving ? t('frequencyBaseline.applying') : t('frequencyBaseline.apply', { count: tier.toLocaleString() })}</button></div>
      {profile && <div className="mt-4 rounded-xl bg-gray-50 p-3 text-sm text-gray-600"><p>{t('frequencyBaseline.settingsImpact', { marked: profile.marked_count, pending: profile.pending_count })}</p><p className="mt-1 text-xs text-gray-400">{t('frequencyBaseline.data', { version: profile.pack_version, license: profile.license })}</p></div>}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><a className="frequency-baseline-settings__link rounded px-1 py-1" href="https://github.com/rspeer/wordfreq" target="_blank" rel="noreferrer">{t('frequencyBaseline.source')}</a><a className="frequency-baseline-settings__link rounded px-1 py-1" href="https://www.coe.int/en/web/language-policy/cefr-reference-level-descriptions" target="_blank" rel="noreferrer">{t('frequencyBaseline.cefr')}</a>{profile?.enabled && <><button type="button" disabled={saving} onClick={() => void disable()} className="frequency-baseline-settings__secondary rounded px-1 py-1">{t('frequencyBaseline.disable')}</button><button type="button" disabled={saving} onClick={() => void revoke()} className="frequency-baseline-settings__danger inline-flex items-center gap-1 rounded px-1 py-1"><RotateCcw size={13} />{t('frequencyBaseline.revoke')}</button></>}</div>
    </SettingsCollapsibleSection>
  );
}
