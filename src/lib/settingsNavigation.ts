import { useLocation, useNavigate } from 'react-router-dom';

export const SETTINGS_LABELS = {
  language: 'settings.uiLanguage.title',
  speech: 'speech.title',
  guide: 'onboarding.replayTitle',
  sync: 'settings.deviceSync.title',
  backup: 'materials.backups',
  dictionary: 'settings.dictionary.title',
  youtube: 'settings.directory.captions',
  updates: 'settings.directory.updates',
} as const;

export type SettingsEntry = keyof typeof SETTINGS_LABELS;

export const SETTINGS_GROUPS = [
  { key: 'preferences', entries: ['language', 'speech', 'guide'] },
  { key: 'data', entries: ['sync', 'backup', 'dictionary'] },
  { key: 'tools', entries: ['youtube'] },
  { key: 'app', entries: ['updates'] },
] as const;

export function useSettingsNavigation() {
  const { search, state } = useLocation();
  const navigate = useNavigate();
  const value = new URLSearchParams(search).get('section');
  const restricted = import.meta.env.VITE_SLICE_PREVIEW === '1' && (value === 'sync' || value === 'updates');
  const section = !restricted && value && Object.hasOwn(SETTINGS_LABELS, value) ? value as SettingsEntry : null;
  const back = () => {
    if (section && state?.fromSettingsHome) navigate(-1);
    else if (section) navigate('/settings', { replace: true, state });
    else navigate(state?.settingsOrigin === '/saved' ? '/saved' : '/files');
  };
  return { section, back };
}
