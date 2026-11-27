import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('.',import.meta.url));
export const adapterAliases = [
 {find:/.*\/stores\/preferencesStore$/,replacement:root+'src/adapter.ts'},
 {find:/.*\/stores\/dictionaryStore$/,replacement:root+'src/adapter.ts'},
 {find:/.*\/lib\/tts$/,replacement:root+'src/adapter.ts'},
 ...['fileStore','aiStore','updateStore','youtubeStore','feedbackStore','modelDownloadStore','speechStore'].map(name=>({find:new RegExp('.*\\/stores\\/'+name+'$'),replacement:root+'src/capture-adapter.ts'})),
 ...['ai','syncCoordinator'].map(name=>({find:new RegExp('.*\\/lib\\/'+name+'$'),replacement:root+'src/capture-adapter.ts'})),
 ...['@tauri-apps/api/app','@tauri-apps/api/event','@tauri-apps/plugin-dialog','@tauri-apps/plugin-opener','@tauri-apps/plugin-fs'].map(find=>({find,replacement:root+'src/capture-adapter.ts'})),
 {find:'@tauri-apps/api/core',replacement:root+'src/adapter.ts'},
];
// Serve the same tracked images and built application during local website development.
const websiteAssets = {
 name:'website-preview-assets',
 configureServer(server){
  server.middlewares.use((request,_response,next)=>{
   if (/^\/(?:media|_demo)\//.test(request.url || '')) request.url='/@fs/'+root+'../docs'+request.url;
   next();
  });
 },
};
export default defineConfig({plugins:[react(),tailwind(),websiteAssets],base:'./',resolve:{dedupe:['react','react-dom','react-i18next','i18next'],alias:adapterAliases},server:{fs:{allow:[root+'..']}},build:{outDir:'dist',emptyOutDir:true,assetsDir:'_marketing',rollupOptions:{output:{entryFileNames:'_marketing/site.js',chunkFileNames:'_marketing/[name]-[hash].js',assetFileNames:'_marketing/[name][extname]'}}}});
