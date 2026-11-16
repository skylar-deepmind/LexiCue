import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Archive, AudioLines, BookOpen, Captions, Check, ChevronLeft, ChevronRight, Compass, Languages, MonitorSmartphone, RefreshCw, Settings, Wrench } from 'lucide-react';
import { backNavigation } from '../lib/backNavigation';
import { SETTINGS_LABELS, useSettingsNavigation, type SettingsEntry } from '../lib/settingsNavigation';
import { visitState, usePageReturn } from '../lib/pageNavigation';
import { SELF_NAMES, UI_LANGUAGES } from '../lib/languages';
import { usePreferencesStore } from '../stores/preferencesStore';
import BackupSettings from '../components/BackupSettings';
import DictionaryPacks from '../components/DictionaryPacks';
import DeviceSyncSettings, { DeviceSyncSummary } from '../components/DeviceSyncSettings';
import YouTubeDownloadSettings from '../components/YouTubeDownloadSettings';
import SpeechSettings from '../components/SpeechSettings';
import DictionaryPreferences from '../components/DictionaryPreferences';
import SoftwareUpdateSettings from '../components/SoftwareUpdateSettings';
import './materials-settings.css';
import './settings-directory.css';
const icons = { language: Languages, speech: AudioLines, lookup: BookOpen, guide: Compass, sync: MonitorSmartphone, backup: Archive, dictionary: BookOpen, youtube: Captions, updates: RefreshCw };
const categories = [
  { key: 'preferences', icon: Settings, entries: ['language', 'speech', 'lookup', 'guide'] },
  { key: 'data', icon: Archive, entries: ['sync', 'backup'] },
  { key: 'tools', icon: Wrench, entries: ['youtube'] },
  { key: 'updates', icon: RefreshCw, entries: ['updates'] },
] as const;
function Detail({ entry }: { entry: SettingsEntry }) {
  const { t } = useTranslation(), { uiLanguage, setUiLanguage } = usePreferencesStore();
  switch (entry) {
    case 'language': return <div className="settings-list">{UI_LANGUAGES.map(language => <button className="settings-row" key={language} aria-pressed={uiLanguage === language} onClick={() => setUiLanguage(language)}>{SELF_NAMES[language]}{uiLanguage === language && <Check size={18}/>}</button>)}</div>;
    case 'speech': return <SpeechSettings/>;
    case 'lookup': case 'dictionary': return <div className="approved-dictionary-detail"><div className="approved-dict-online"><h2>{t('dictionaryPreferences.title')}</h2><DictionaryPreferences/></div><h2>{t('settings.dictionary.title')}</h2><DictionaryPacks/></div>;
    case 'sync': return <DeviceSyncSettings/>;
    case 'backup': return <BackupSettings/>;
    case 'youtube': return <YouTubeDownloadSettings/>;
    case 'updates': return <SoftwareUpdateSettings/>;
    case 'guide': return <button className="ui-button" onClick={() => { location.href = '/files?guide=1'; }}>{t('onboarding.replay')}</button>;
  }
}
export default function SettingsPage() {
  const { t } = useTranslation(), location = useLocation(), navigate = useNavigate();
  const { section, back } = useSettingsNavigation();
  const { back: close } = usePageReturn('/files');
  const [category, setCategory] = useState(() => Math.max(0, categories.findIndex(group => group.entries.some(entry => entry === section || section === 'dictionary' && entry === 'lookup'))));
  const heading = useRef<HTMLHeadingElement>(null), page = useRef<HTMLDivElement>(null);
  useEffect(() => { if (section) setCategory(Math.max(0, categories.findIndex(group => group.entries.some(entry => entry === section || section === 'dictionary' && entry === 'lookup')))); }, [section]);
  useLayoutEffect(() => { page.current?.scrollTo(0, 0); if (section) heading.current?.focus({ preventScroll: true }); }, [section, category]);
  useEffect(() => backNavigation.setPage(() => { if (section) back(); else close(); return true; }, 2), [section, back, close]);
  const choose = (index: number) => {
    setCategory(index);
    navigate(index === 3 ? '/settings?section=updates' : '/settings', { replace: true, state: location.state });
  };
  const open = (entry: SettingsEntry) => {
    if (entry === 'guide') navigate('/files?guide=1');
    else navigate(`/settings?section=${entry}`, { state: { ...visitState(location), fromSettingsHome: true } });
  };
  return <div className="materials-scroll settings-scroll approved-settings" data-detail={section || undefined} ref={page}>
    <div className="system-settings settings-directory">
      <button className="approved-icon approved-settings-back" aria-label={t('common.back')} onClick={section ? back : close}><ChevronLeft size={22}/></button>
      <div className="approved-settings-columns">
        <nav className="approved-settings-tabs" aria-label={t('settings.title')}>{categories.map((group, index) => <button key={group.key} aria-current={index === category ? 'page' : undefined} onClick={() => choose(index)}><group.icon size={20}/><span>{t(`approved.${group.key}`)}</span></button>)}</nav>
        <section className="approved-settings-paper">
          <h1 ref={heading} tabIndex={-1}>{t(section ? section === 'lookup' || section === 'dictionary' ? 'approved.dictionary' : SETTINGS_LABELS[section] : `approved.${categories[category].key}`)}</h1>
          {section ? <div className="settings-detail"><Detail entry={section}/></div> : <div className="settings-list">{categories[category].entries.map(entry => {
            const Icon = icons[entry]; return <button key={entry} data-entry={entry} className="settings-row" onClick={() => open(entry)}><Icon className="settings-row-icon" size={20}/><span className="settings-row-label">{t(entry === 'lookup' ? 'approved.dictionary' : SETTINGS_LABELS[entry])}</span><span className="settings-value">{entry === 'language' ? SELF_NAMES[usePreferencesStore.getState().uiLanguage] : entry === 'sync' ? <DeviceSyncSummary/> : null}</span><ChevronRight size={18} className="settings-chevron"/></button>;
          })}</div>}
        </section>
      </div>
    </div>
  </div>;
}
