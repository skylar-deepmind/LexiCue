export type Language = 'en' | 'ja' | 'de' | 'zh';

export type UILanguage = 'zh' | 'en' | 'ja' | 'de';

export const UI_LANGUAGES: UILanguage[] = ['zh', 'en', 'ja', 'de'];

export const SELF_NAMES: Record<Language, string> = {
  en: 'English',
  ja: '日本語',
  de: 'Deutsch',
  zh: '中文',
};

export const LANGUAGES: Array<{ id: Language; label: string }> = [
  { id: 'en', label: SELF_NAMES.en },
  { id: 'ja', label: SELF_NAMES.ja },
  { id: 'de', label: SELF_NAMES.de },
  { id: 'zh', label: SELF_NAMES.zh },
];

export function languageLabel(language: Language): string {
  return LANGUAGES.find((item) => item.id === language)?.label ?? language;
}

export function isLanguage(value: string): value is Language {
  return value === 'en' || value === 'ja' || value === 'de' || value === 'zh';
}

export function isUILanguage(value: unknown): value is UILanguage {
  return typeof value === 'string' && (UI_LANGUAGES as string[]).includes(value);
}

export function detectSystemLanguage(): UILanguage {
  const lang = (navigator.language ?? '').toLowerCase();
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('ja')) return 'ja';
  if (lang.startsWith('de')) return 'de';
  if (lang.startsWith('en')) return 'en';
  return 'zh';
}
