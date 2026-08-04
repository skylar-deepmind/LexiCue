import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { FileText, Globe, Brain, BarChart3, MoreHorizontal, BookOpen, Layers, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const CORE_ITEMS = [
  { to: '/files', icon: FileText, labelKey: 'sidebar.files' },
  { to: '/reading', icon: Globe, labelKey: 'sidebar.reading' },
  { to: '/review', icon: Brain, labelKey: 'sidebar.review' },
  { to: '/insights', icon: BarChart3, labelKey: 'sidebar.insights' },
];

const MORE_ITEMS = [
  { to: '/words', icon: BookOpen, labelKey: 'sidebar.words' },
  { to: '/phrases', icon: Layers, labelKey: 'sidebar.phrases' },
  { to: '/settings', icon: Settings, labelKey: 'sidebar.settings' },
];

export default function MobileNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handler = (event: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [moreOpen]);

  const handleMoreNav = (to: string) => {
    setMoreOpen(false);
    navigate(to);
  };

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    `flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] transition-colors ${
      isActive ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
    }`;

  return (
    <nav className="sm:hidden flex items-stretch border-t border-gray-200 bg-white shrink-0" aria-label={t('sidebar.navAria')}>
      {CORE_ITEMS.map((item) => (
        <NavLink key={item.to} to={item.to} className={itemClass}>
          <item.icon size={20} />
          <span>{t(item.labelKey)}</span>
        </NavLink>
      ))}
      <div ref={moreRef} className="relative flex-1">
        <button
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-haspopup="menu"
          aria-label={t('sidebar.more')}
          className="w-full flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
        >
          <MoreHorizontal size={20} />
          <span>{t('sidebar.more')}</span>
        </button>
        {moreOpen && (
          <div
            role="menu"
            className="absolute bottom-full left-0 right-0 mb-1 rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
          >
            {MORE_ITEMS.map((item) => (
              <button
                key={item.to}
                role="menuitem"
                onClick={() => handleMoreNav(item.to)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <item.icon size={16} className="text-gray-400" />
                {t(item.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
