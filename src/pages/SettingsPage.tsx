import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Archive, AudioLines, BookOpen, Captions, ChevronLeft, ChevronRight, MonitorSmartphone, RefreshCw, Settings, Wrench } from 'lucide-react';
import { backNavigation } from '../lib/backNavigation';
import { SETTINGS_LABELS, useSettingsNavigation, type SettingsEntry } from '../lib/settingsNavigation';
import { visitState, usePageReturn } from '../lib/pageNavigation';
import BackupSettings from '../components/BackupSettings';
import DictionaryPacks from '../components/DictionaryPacks';
import DeviceSyncSettings, { DeviceSyncSummary } from '../components/DeviceSyncSettings';
import YouTubeDownloadSettings from '../components/YouTubeDownloadSettings';
import SpeechSettings from '../components/SpeechSettings';
import DictionaryPreferences from '../components/DictionaryPreferences';
import SoftwareUpdateSettings from '../components/SoftwareUpdateSettings';
import InterfaceLanguageSwitch from '../components/InterfaceLanguageSwitch';
import './materials-settings.css';
import './settings-directory.css';
const icons = { speech: AudioLines, lookup: BookOpen, sync: MonitorSmartphone, backup: Archive, youtube: Captions, updates: RefreshCw };
const categories = [
  { key: 'preferences', icon: Settings, entries: ['speech', 'lookup'] },
  { key: 'data', icon: Archive, entries: ['sync', 'backup'] },
  { key: 'tools', icon: Wrench, entries: ['youtube'] },
  { key: 'updates', icon: RefreshCw, entries: ['updates'] },
] as const;
function Detail({ entry }: { entry: SettingsEntry }) {
  const { t } = useTranslation();
  switch (entry) {
    case 'language': return <InterfaceLanguageSwitch/>;
    case 'speech': return <SpeechSettings/>;
    case 'lookup': case 'dictionary': return <div className="approved-dictionary-detail"><div className="approved-dict-online"><h2>{t('dictionaryPreferences.title')}</h2><DictionaryPreferences/></div><h2>{t('settings.dictionary.title')}</h2><DictionaryPacks/></div>;
    case 'sync': return <DeviceSyncSettings/>;
    case 'backup': return <BackupSettings/>;
    case 'youtube': return <YouTubeDownloadSettings/>;
    case 'updates': return <SoftwareUpdateSettings/>;
    case 'guide': return null;
  }
}
export default function SettingsPage() {
  const { t } = useTranslation(), location = useLocation(), navigate = useNavigate();
  const { section, back } = useSettingsNavigation();
  const { back: close } = usePageReturn('/files');
  const [category, setCategory] = useState(() => Math.max(0, categories.findIndex(group => group.entries.some(entry => entry === section || section === 'dictionary' && entry === 'lookup'))));
  const heading = useRef<HTMLHeadingElement>(null), page = useRef<HTMLDivElement>(null);
  useEffect(() => { if (section) setCategory(Math.max(0, categories.findIndex(group => group.entries.some(entry => entry === section || section === 'dictionary' && entry === 'lookup')))); }, [section]);
  useLayoutEffect(() => { page.current?.scrollTo(0, 0); heading.current?.focus({ preventScroll: true }); }, [section, category]);
  useEffect(() => backNavigation.setPage(() => { if (section) back(); else close(); return true; }, 2), [section, back, close]);
  const choose = (index: number) => {
    setCategory(index);
    navigate(index === 3 ? '/settings?section=updates' : '/settings', { replace: true, state: location.state });
  };
  const open = (entry: SettingsEntry) => navigate(`/settings?section=${entry}`, { state: { ...visitState(location), fromSettingsHome: true } });
  const label = t(section ? section === 'lookup' || section === 'dictionary' ? 'approved.dictionary' : SETTINGS_LABELS[section] : `approved.${categories[category].key}`);
  return <div className="materials-scroll settings-scroll approved-settings" data-detail={section || undefined} ref={page}>
    <div className="system-settings settings-directory">
      <button className="approved-icon approved-back approved-settings-back" aria-label={t('common.back')} onClick={section ? back : close}><ChevronLeft size={22}/></button>
      <div className="approved-settings-columns">
        <nav className="approved-settings-tabs" aria-label={t('settings.title')}>{categories.map((group, index) => <button key={group.key} aria-label={t(`approved.${group.key}`)} aria-current={index === category ? 'page' : undefined} onClick={() => choose(index)}><group.icon size={20}/><span>{t(`approved.settingsTabs.${group.key}`)}</span></button>)}</nav>
        <section className="approved-settings-paper" aria-labelledby="settings-content-heading">
          <h1 id="settings-content-heading" className={!section || section === 'updates' || section === 'language' ? 'sr-only' : undefined} ref={heading} tabIndex={-1}>{label}</h1>
          {section ? <div className="settings-detail"><Detail entry={section}/></div> : <>{category === 0 && <InterfaceLanguageSwitch/>}<div className="settings-list">{categories[category].entries.map(entry => {
            const Icon = icons[entry]; return <button key={entry} data-entry={entry} className="settings-row" onClick={() => open(entry)}><Icon className="settings-row-icon" size={20}/><span className="settings-row-label">{t(entry === 'lookup' ? 'approved.dictionary' : SETTINGS_LABELS[entry])}</span>{entry === 'sync' && <span className="settings-value"><DeviceSyncSummary/></span>}<ChevronRight size={18} className="settings-chevron"/></button>;
          })}</div></>}
        </section>
      </div>
    </div>
  </div>;
}
