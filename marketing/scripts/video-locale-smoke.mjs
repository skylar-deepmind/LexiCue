import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {renderStill,selectComposition} from '@remotion/renderer';
import {videoBundle} from './bundle.mjs';
import {videoFps} from '../src/video-revision.mjs';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'../output/marketing/video-final/qa');
await mkdir(out,{recursive:true});
const serveUrl=await videoBundle({revised:true}),browserExecutable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const props={portrait:false,subtitles:true,locale:'en'};
const composition=await selectComposition({serveUrl,id:'RevisedHorizontal',browserExecutable,inputProps:props});
await renderStill({composition,serveUrl,browserExecutable,inputProps:props,frame:Math.round(25.8*videoFps),output:resolve(out,'horizontal-lookup-en-smoke.png'),imageFormat:'png'});
console.log('English Remotion frame saved for visual preflight.');
