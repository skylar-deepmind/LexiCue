import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { usePreferencesStore } from '../stores/preferencesStore';
import { isUILanguage } from '../lib/languages';
import zh from './locales/zh.json';
import en from './locales/en.json';
import ja from './locales/ja.json';
import de from './locales/de.json';

let initialized = false;

export function initI18n() {
  if (initialized) return;
  initialized = true;

  const stored = usePreferencesStore.getState().uiLanguage;
  const initialLanguage = isUILanguage(stored) ? stored : 'zh';

  void i18n.use(initReactI18next).init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
      ja: { translation: ja },
      de: { translation: de },
    },
    lng: initialLanguage,
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false,
    },
  });

  i18n.on('languageChanged', (language) => {
    document.documentElement.lang = language;
  });
  document.documentElement.lang = initialLanguage;

  usePreferencesStore.subscribe(
    (state) => state.uiLanguage,
    (language) => {
      if (isUILanguage(language) && language !== i18n.language) {
        void i18n.changeLanguage(language);
      }
    },
  );
}

export default i18n;
