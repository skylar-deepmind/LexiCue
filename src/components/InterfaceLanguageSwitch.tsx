import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { SELF_NAMES, UI_LANGUAGES } from '../lib/languages';
import { usePreferencesStore } from '../stores/preferencesStore';

export default function InterfaceLanguageSwitch() {
  const { t } = useTranslation();
  const language = usePreferencesStore(state => state.uiLanguage), choose = usePreferencesStore(state => state.setUiLanguage);
  return <fieldset className="approved-interface-language"><legend><Languages size={20} aria-hidden="true"/>{t('settings.uiLanguage.title')}</legend>
    <div role="radiogroup" aria-label={t('settings.uiLanguage.title')} className="approved-language-slider" style={{ '--language-index': UI_LANGUAGES.indexOf(language) } as React.CSSProperties}>
      <span className="approved-language-selection" aria-hidden="true"/>
      {UI_LANGUAGES.map((value, i) => <button key={value} type="button" role="radio" aria-checked={language === value} tabIndex={language === value ? 0 : -1} onClick={() => choose(value)} onKeyDown={event => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        event.preventDefault(); const next = (i + step + UI_LANGUAGES.length) % UI_LANGUAGES.length;
        choose(UI_LANGUAGES[next]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
      }}>{SELF_NAMES[value]}</button>)}
    </div>
  </fieldset>;
}
