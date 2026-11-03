import { defineConfig, type Plugin } from 'vite'
import { readdirSync, readFileSync, createReadStream, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// PDF text extraction is fully local, including uncommon character maps/fonts.
function localPdfAssets(): Plugin {
  const base = resolve('node_modules/pdfjs-dist');
  const folders = ['cmaps', 'standard_fonts', 'wasm'];
  return {
    name: 'lexicue-local-pdf-assets',
    generateBundle() {
      for (const folder of folders) for (const name of readdirSync(join(base, folder))) {
        const path = join(base, folder, name);
        if (statSync(path).isFile()) this.emitFile({ type: 'asset', fileName: `pdfjs/${folder}/${name}`, source: readFileSync(path) });
      }
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs', (request, response, next) => {
        const path = decodeURIComponent((request.url ?? '').split('?')[0]);
        if (!/^\/(?:cmaps|standard_fonts|wasm)\/[A-Za-z0-9_.-]+$/.test(path)) return next();
        const file = join(base, path);
        try { if (!statSync(file).isFile()) return next(); } catch { return next(); }
        response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        createReadStream(file).pipe(response);
      });
    },
  };
}
export default defineConfig({
  plugins: [react(), tailwindcss(), localPdfAssets()],
  clearScreen: false,
  worker: { format: 'es' },
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/scripts/cache/**', '**/src-tauri/resources/gemma-runtime/**'] },
  },
})
