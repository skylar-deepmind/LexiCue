import {bundle} from '@remotion/bundler';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
export async function videoBundle({revised=false}={}){return bundle({entryPoint:resolve(root,revised?'src/video-revision-entry.tsx':'src/video.tsx'),outDir:resolve(root,revised?'dist-video-revised':'dist-video'),publicDir:resolve(root,'public'),webpackOverride:config=>{
 config.resolve.alias={...config.resolve.alias,
  react:resolve(root,'node_modules/react'),'react-dom':resolve(root,'node_modules/react-dom'),
  'react-i18next':resolve(root,'../node_modules/react-i18next'),i18next:resolve(root,'../node_modules/i18next'),
  '@tauri-apps/api/core':resolve(root,'src/adapter.ts'),
  [resolve(root,'../src/stores/preferencesStore')]:resolve(root,'src/adapter.ts'),
  [resolve(root,'../src/stores/dictionaryStore')]:resolve(root,'src/adapter.ts'),
  [resolve(root,'../src/lib/tts')]:resolve(root,'src/adapter.ts'),
 };return config;
}});}
