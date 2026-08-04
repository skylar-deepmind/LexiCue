import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, type Language } from '../lib/languages';

interface ImportLanguageDialogProps {
  fileName: string;
  defaultLanguage?: Language | 'all';
  onConfirm: (language: Language) => void;
  onCancel: () => void;
}

export default function ImportLanguageDialog({ fileName, defaultLanguage, onConfirm, onCancel }: ImportLanguageDialogProps) {
  const { t } = useTranslation();
  const [language, setLanguage] = useState<Language | ''>(
    defaultLanguage && defaultLanguage !== 'all' ? defaultLanguage : '',
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="border-b border-gray-100 p-5">
          <h3 className="text-lg font-semibold text-gray-900">{t('importLang.title')}</h3>
          <p className="mt-1 truncate text-sm text-gray-500" title={fileName}>{fileName}</p>
        </div>
        <div className="p-5">
          <label className="block text-sm font-medium text-gray-700" htmlFor="import-language">
            {t('importLang.mainLanguage')}
          </label>
          <select
            id="import-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value as Language)}
            className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="" disabled>{t('importLang.selectLanguage')}</option>
            {LANGUAGES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <p className="mt-3 text-xs leading-5 text-gray-500">
            {t('importLang.hint')}
          </p>
        </div>
        <div className="flex justify-end gap-3 border-t border-gray-100 p-4">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">{t('importLang.cancel')}</button>
          <button
            onClick={() => language && onConfirm(language)}
            disabled={!language}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {t('importLang.startParsing')}
          </button>
        </div>
      </div>
    </div>
  );
}
