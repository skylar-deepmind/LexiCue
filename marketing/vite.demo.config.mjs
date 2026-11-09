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
   if(id===resolve(project,'src/App.tsx'))return code.replace("import { BrowserRouter,", "import { HashRouter as BrowserRouter,").replace("import MobileStartup", "import { DemoThemeBridge } from '../marketing/demo/theme';\nimport MobileStartup").replace('<BrowserRouter useTransitions={!isMobilePlatform()}>','<BrowserRouter>').replace('<MobileStartup>','<MobileStartup><DemoThemeBridge/>');
   if(id===resolve(project,'src/components/SpeechSettings.tsx')){
    const voices="options={SPEECH_VOICES[speech.accent].map(voice => ({ value: voice.id, label: `${voice.name} · ${t(`speech.${voice.gender}`)}` }))}";
    if(!code.includes(voices)||!code.includes("<details><summary>{t('speech.connection')}</summary>"))throw Error('Speech settings changed; update the browser demo boundary.');
    return code.replace('id="speech-voice" value=','id="speech-voice" disabled value=').replace(voices,"options={[{value:speech.voices[speech.accent],label:t('speech.browserVoice')}] }").replace(/<details><summary>\{t\('speech.connection'\)\}<\/summary>[\s\S]*?<\/details>/,"<p>{t('speech.browserBoundary')}</p>");
   }
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
