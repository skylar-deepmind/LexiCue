import {build} from 'vite';
import {spawnSync} from 'node:child_process';
import {rename,mkdir,cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),project=resolve(root,'..');
const types=spawnSync(resolve(root,'node_modules/.bin/tsc'),['-p',resolve(root,'demo/tsconfig.json'),'--noEmit'],{cwd:project,stdio:'inherit'});if(types.status!==0)throw Error('Demo TypeScript check failed');
const tests=spawnSync(process.execPath,['--experimental-strip-types','--test',resolve(root,'demo/engine.test.mjs'),resolve(root,'demo/runtime.test.mjs'),resolve(root,'demo/speech.test.mjs')],{cwd:project,stdio:'inherit'});if(tests.status!==0)throw Error('Demo engine tests failed');
await build({configFile:resolve(root,'vite.demo.config.mjs')});
const out=resolve(project,'docs/_demo');
await rename(resolve(out,'demo.html'),resolve(out,'index.html'));
// PDF.js workers use these local support resources, exactly as in the app build.
for(const folder of ['cmaps','standard_fonts','wasm']){await mkdir(resolve(out,'pdfjs',folder),{recursive:true});await cp(resolve(project,'node_modules/pdfjs-dist',folder),resolve(out,'pdfjs',folder),{recursive:true});}
console.log('Built real-component browser demo in docs/_demo/index.html');
