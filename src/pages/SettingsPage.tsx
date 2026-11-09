import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Archive, AudioLines, BookOpen, Captions, Check, ChevronLeft, ChevronRight, Compass, Languages, MonitorSmartphone, RefreshCw } from 'lucide-react';
import { useTheme } from '../components/useTheme';
import { THEMES } from '../lib/themes';
import { SELF_NAMES, UI_LANGUAGES } from '../lib/languages';
import { backNavigation } from '../lib/backNavigation';
import { SETTINGS_LABELS, SETTINGS_GROUPS, useSettingsNavigation, type SettingsEntry } from '../lib/settingsNavigation';
import { usePreferencesStore } from '../stores/preferencesStore';
import BackupSettings from '../components/BackupSettings';
import LongmanStatus from '../components/LongmanStatus';
import DeviceSyncSettings, { DeviceSyncSummary } from '../components/DeviceSyncSettings';
import YouTubeDownloadSettings from '../components/YouTubeDownloadSettings';
import SpeechSettings from '../components/SpeechSettings';
import SoftwareUpdateSettings from '../components/SoftwareUpdateSettings';
import './materials-settings.css';
import './settings-directory.css';

const icons = { language: Languages, speech: AudioLines, guide: Compass, sync: MonitorSmartphone, backup: Archive, dictionary: BookOpen, youtube: Captions, updates: RefreshCw };
const preview = import.meta.env.VITE_SLICE_PREVIEW === '1';

function ThemeChoices() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  return <section className="settings-themes" aria-labelledby="themes-label">
    <div className="settings-theme-heading"><h2 id="themes-label">{t('settings.theme.title')}</h2><span>{t(`themes.${theme}Label`)}</span></div>
    <div className="theme-choices" role="group" aria-labelledby="themes-label">
      {THEMES.map(({ id }) => <button key={id} aria-label={t(`themes.${id}Label`)} aria-pressed={id === theme} className={`theme-choice theme-preview--${id}`} onClick={() => setTheme(id)}>
        <span className="settings-theme-sample" aria-hidden="true"><span className="settings-book"><em>Aa</em><i/><i/></span></span>
        <span className="settings-theme-name">{t(`themes.${id}Label`)}</span>
        {id === theme && <span className="settings-theme-tick"><Check size={12} aria-hidden="true"/></span>}
      </button>)}
    </div>
  </section>;
}

function EntrySummary({entry}: {entry: SettingsEntry}) {
  const { t } = useTranslation();
  const { uiLanguage, speech } = usePreferencesStore();
  switch (entry) {
    case 'language': return SELF_NAMES[uiLanguage];
    case 'speech': return t(`speech.accents.${speech.accent}`) + ' · ' + t(`speech.speeds.${speech.speed}`);
    case 'sync': return <DeviceSyncSummary/>;
    default: return null;
  }
}

function SettingsDetail({ entry }: {entry: SettingsEntry}) {
  const { t } = useTranslation();
  const { uiLanguage, setUiLanguage } = usePreferencesStore();
  switch (entry) {
    case 'language': return <div className="settings-list">{UI_LANGUAGES.map(language => <button className="settings-row" key={language} aria-pressed={uiLanguage === language} onClick={() => setUiLanguage(language)}>{SELF_NAMES[language]}{uiLanguage === language && <Check size={18} aria-hidden="true"/>}</button>)}</div>;
    case 'speech': return <SpeechSettings/>;
    case 'sync': return <DeviceSyncSettings/>;
    case 'backup': return <BackupSettings/>;
    case 'dictionary': return <LongmanStatus/>;
    case 'youtube': return <YouTubeDownloadSettings/>;
    case 'updates': return <SoftwareUpdateSettings/>;
    case 'guide': return <Link className="ui-button" to="/files?guide=1">{t('onboarding.replay')}</Link>;
  }
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const { state } = useLocation();
  const { section, back } = useSettingsNavigation();
  const page = useRef<HTMLDivElement>(null);
  const previous = useRef(section);
  const heading = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (previous.current === section) return;
    if (section) {
      page.current?.scrollTo(0, 0);
      heading.current?.focus({ preventScroll: true });
    } else {
      page.current?.querySelector<HTMLElement>(`[data-entry="${previous.current}"]`)?.focus();
    }
    previous.current = section;
  }, [section]);
  useEffect(() => backNavigation.setPage(() => { back(); return true; }, 1), [back]);
  return <div className="materials-scroll settings-scroll" ref={page}>
    <div className="system-settings settings-directory">
      <div className="settings-heading" ref={heading} tabIndex={-1} aria-label={t(section ? SETTINGS_LABELS[section] : 'settings.title')}>
        {section && <button className="settings-back" onClick={back} aria-label={t('common.back')}><ChevronLeft size={17} aria-hidden="true"/>{t('settings.title')}</button>}
        <h1>{t(section ? SETTINGS_LABELS[section] : 'settings.title')}</h1>
      </div>
      {section ? <div className="settings-detail"><SettingsDetail entry={section}/></div> : <>
        <ThemeChoices/>
        <div className="settings-groups">
          {SETTINGS_GROUPS.map(group => {
            const entries = group.entries.filter(entry => !preview || (entry !== 'sync' && entry !== 'updates'));
            return entries.length > 0 && <section key={group.key}>
              <h2>{t(`settings.directory.${group.key}`)}</h2>
              <div className="settings-list">{entries.map(entry => {
                const Icon = icons[entry];
                return <Link className="settings-row" key={entry} data-entry={entry}
                  to={entry === 'guide' ? '/files?guide=1' : `/settings?section=${entry}`} state={{...state, fromSettingsHome: true}}>
                  <Icon className="settings-row-icon" size={21} aria-hidden="true"/>
                  <span className="settings-row-label">{t(SETTINGS_LABELS[entry])}</span>
                  <span className="settings-value"><EntrySummary entry={entry}/></span>
                  <ChevronRight className="settings-chevron" size={16} aria-hidden="true"/>
                </Link>;
              })}</div>
            </section>;
          })}
        </div>
      </>}
    </div>
  </div>;
}
