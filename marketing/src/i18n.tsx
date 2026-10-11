import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { useMemo, type ReactNode } from 'react';
import en from '../../src/i18n/locales/en.json';
import zh from '../../src/i18n/locales/zh.json';
import ja from '../../src/i18n/locales/ja.json';
import de from '../../src/i18n/locales/de.json';
import {setDemoLocale} from './adapter';
const productLocales={en,zh,ja,de};
export const productStatusLabels=(locale:string)=>productLocales[locale].status;
const importHints={en:'Import SRT subtitles to start your vocabulary collection.',zh:'导入 SRT 字幕，开始积累自己的词汇。',ja:'SRT字幕を取り込み、自分の語彙を集めましょう。',de:'Importiere SRT-Untertitel und beginne deinen Wortschatz.'};
const resources=Object.fromEntries(Object.entries(productLocales).map(([locale,data])=>[locale,{translation:{...data,files:{...data.files,emptyDescription:importHints[locale]}}}]));
export function DemoI18n({locale,children}:{locale:string;children:ReactNode}) {
  const instance = useMemo(() => {
    const i = i18next.createInstance();
    void i.init({resources,lng:locale,fallbackLng:'en',initAsync:false,interpolation:{escapeValue:false}});
    return i;
  },[locale]);
  setDemoLocale(locale);
  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>;
}
