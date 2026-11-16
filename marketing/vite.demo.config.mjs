import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url)),project=resolve(root,'..');
const native=resolve(root,'demo/native.ts');
const boundary=()=>({
  name:'lexicue-browser-demo-boundary',enforce:'pre',
  transform(code,id){
   if(id.startsWith(project+'/src/'))code=code.replaceAll('/design/','./design/');
   if(id===resolve(project,'src/App.tsx'))return code.replace("import { BrowserRouter,", "import { HashRouter as BrowserRouter,").replace("import MobileStartup", "import { DemoThemeBridge } from '../marketing/demo/theme';\nimport MobileStartup").replace(/<BrowserRouter useTransitions=\{[^}]+\}>/,'<BrowserRouter>').replace('<MobileStartup>','<MobileStartup><DemoThemeBridge/>');
   // The public demo keeps its original CC0 dictionary; it must never label
   // those illustrative definitions as content from a real Wiktionary pack.
   if(id===resolve(project,'src/lib/dictionaryResult.ts')){
    const start=code.indexOf('export async function lookupLocal('),end=code.indexOf('export async function lookupLongman(',start);
    if(start<0||end<start)throw Error('Local dictionary adapter changed; update the browser demo boundary.');
    return code.slice(0,start)+'export async function lookupLocal(expression: string, context: string): Promise<DictionaryResult> { return lookupLongman(expression, context); }\n'+code.slice(end);
   }
   if(id===resolve(project,'src/components/DictionaryPacks.tsx'))return `import {useTranslation} from 'react-i18next'; export default function DictionaryPacks(){const {t}=useTranslation();return <section><p>{t('dictionaryPacks.demoBoundary')}</p></section>;}`;
   if(id===resolve(project,'src/components/SpeechSettings.tsx'))return `
    import {useEffect,useRef} from 'react';
    import {useTranslation} from 'react-i18next';
    import {SPEECH_PREVIEW_TEXT} from '../lib/speechPreferences';
    import {usePreferencesStore} from '../stores/preferencesStore';
    import {useSpeechStore} from '../stores/speechStore';
    import {SpeechFeedback} from './SpeechButton';
    export default function SpeechSettings(){
      const {t}=useTranslation(),{speech,setSpeech}=usePreferencesStore();
      const owner=useRef('browser-demo-voice:'+crypto.randomUUID());
      useEffect(()=>()=>useSpeechStore.getState().stopOwned(owner.current),[]);
      return <section className="speech-settings" aria-label={t('speech.title')}>
        <button className="approved-action" onClick={()=>void useSpeechStore.getState().speak(SPEECH_PREVIEW_TEXT,'settings:speech-preview',{kind:'preview',owner:owner.current,restart:true})}>{t('speech.browserVoice')} · {t('speech.preview')}</button>
        <div className="approved-voice-speed" role="group" aria-label={t('speech.speed')}>{(['normal','slow'] as const).map(speed=><button key={speed} aria-pressed={speech.speed===speed} onClick={()=>setSpeech({speed})}>{t('speech.speeds.'+speed)}</button>)}</div>
        <SpeechFeedback prefix="settings:speech-preview"/><p>{t('speech.browserBoundary')}</p>
      </section>;
    }`;
   if(id===resolve(project,'src/lib/documentPdf.ts'))return code.replace("new URL('/pdfjs/', typeof location !== 'undefined' ? location.href : 'http://localhost/')","new URL('../pdfjs/', import.meta.url)");
   if(id.endsWith('.css')&&id.includes('/src/'))return code.replaceAll('url(/fonts/','url(../fonts/').replaceAll('url("/fonts/','url("../fonts/').replaceAll("url('/fonts/","url('../fonts/");
  },
});
export default defineConfig({
 root,base:'./',publicDir:false,
 plugins:[boundary(),{name:'lexicue-demo-fonts',generateBundle(){for(const name of readdirSync(resolve(project,'public/fonts')))this.emitFile({type:'asset',fileName:'fonts/'+name,source:readFileSync(resolve(project,'public/fonts',name))});}},react(),tailwind()],
 resolve:{dedupe:['react','react-dom','react-router-dom','react-i18next','i18next','zustand'],alias:[
  {find:/.*\/stores\/speechStore$/,replacement:resolve(root,'demo/speech.ts')},
  ...['@tauri-apps/api/core','@tauri-apps/api/app','@tauri-apps/api/event','@tauri-apps/api/window','@tauri-apps/plugin-dialog','@tauri-apps/plugin-fs','@tauri-apps/plugin-opener','@tauri-apps/plugin-clipboard-manager','@tauri-apps/plugin-updater','@tauri-apps/plugin-process'].map(find=>({find,replacement:native})),
 ]},
 build:{outDir:resolve(project,'docs/_demo'),emptyOutDir:true,assetsDir:'assets',rollupOptions:{input:resolve(root,'demo.html')}},
 worker:{format:'es',plugins:()=>[boundary()]},server:{fs:{allow:[project]}},
});
