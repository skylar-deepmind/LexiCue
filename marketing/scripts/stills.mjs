import {selectComposition,renderStill} from '@remotion/renderer';
import {videoBundle} from './bundle.mjs';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'../output/marketing/qa');await mkdir(out,{recursive:true});
const serveUrl=await videoBundle(),browserExecutable=process.env.LEXICUE_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
for(const id of ['Horizontal','Vertical']){
 const composition=await selectComposition({serveUrl,id,browserExecutable});
 const frames=id==='Horizontal'?[100,350,700,1200,1600,1900,2200,2510,2640]:[35,130,230,450,550,660,715,780,850];
 for(const frame of frames)await renderStill({composition,serveUrl,browserExecutable,frame,output:resolve(out,`video-${id}-${frame}.png`),imageFormat:'png'});
 console.log(id+' storyboard stills rendered');
}
