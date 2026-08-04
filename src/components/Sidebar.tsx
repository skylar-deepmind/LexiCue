import { NavLink } from 'react-router-dom';
import { FileText, BookOpen, Layers, Globe, Brain, BarChart3, Settings, ChevronDown } from 'lucide-react';
import { ask } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, type Language } from '../lib/languages';
import { usePreferencesStore } from '../stores/preferencesStore';
import { useReviewStore, hasActiveSession } from '../stores/reviewStore';

const NAV_ITEMS = [
  { to: '/files', icon: FileText, labelKey: 'sidebar.files' },
  { to: '/words', icon: BookOpen, labelKey: 'sidebar.words' },
  { to: '/phrases', icon: Layers, labelKey: 'sidebar.phrases' },
  { to: '/reading', icon: Globe, labelKey: 'sidebar.reading' },
  { to: '/review', icon: Brain, labelKey: 'sidebar.review' },
  { to: '/insights', icon: BarChart3, labelKey: 'sidebar.insights' },
];

const SETTINGS_ITEM = { to: '/settings', icon: Settings, labelKey: 'sidebar.settings' };

function NavLinkItem({ to, icon: Icon, labelKey, t }: { to: string; icon: typeof FileText; labelKey: string; t: (key: string) => string }) {
  const label = t(labelKey);
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `w-10 sm:w-full h-10 flex flex-col sm:flex-row items-center sm:justify-start sm:gap-3 sm:px-3 justify-center rounded-xl transition-colors ${
          isActive
            ? 'bg-blue-50 text-blue-600'
            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
        }`
      }
      title={label}
    >
      <Icon size={20} />
      <span className="hidden sm:inline text-sm">{label}</span>
    </NavLink>
  );
}

export default function Sidebar() {
  const { t } = useTranslation();
  const language = usePreferencesStore((state) => state.language);
  const setLanguage = usePreferencesStore((state) => state.setLanguage);

  return (
    <aside className="hidden sm:flex w-16 sm:w-48 bg-white border-r border-gray-200 flex-col items-center sm:items-stretch py-4 px-2 gap-1 shrink-0">
      <div className="mb-4 px-3 text-lg font-bold text-blue-600 select-none">
        <span className="sm:hidden">L</span>
        <span className="hidden sm:inline">LexiCue</span>
      </div>
      {NAV_ITEMS.map((item) => <NavLinkItem key={item.to} {...item} t={t} />)}
      <div className="w-full mt-auto hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl transition-colors hover:bg-gray-50">
        <Globe size={20} className="text-gray-400 shrink-0" />
        <select
          value={language}
          onChange={async (event) => {
            const next = event.target.value as Language | 'all';
            if (next === language) return;
            if (hasActiveSession(useReviewStore.getState())) {
              const ok = await ask(t('sidebar.switchLanguageConfirm'), {
                title: t('sidebar.switchLanguageTitle'),
                kind: 'warning',
                okLabel: t('sidebar.switch'),
                cancelLabel: t('common.cancel'),
              });
              if (!ok) {
                event.currentTarget.value = language;
                return;
              }
            }
            setLanguage(next);
          }}
          aria-label={t('sidebar.languageAria')}
          className="flex-1 min-w-0 bg-transparent text-sm text-gray-600 appearance-none focus:outline-none cursor-pointer"
        >
          <option value="all">{t('common.all')}</option>
          {LANGUAGES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <ChevronDown size={16} className="text-gray-400 shrink-0 pointer-events-none" />
      </div>
      <NavLinkItem {...SETTINGS_ITEM} t={t} />
    </aside>
  );
}
