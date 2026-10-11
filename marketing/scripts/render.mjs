import {renderMedia,selectComposition,renderStill} from '@remotion/renderer';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {videoBundle} from './bundle.mjs';
import {horizontalTimeline,verticalTimeline} from '../src/catalogue.mjs';
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'../output/marketing');
await mkdir(output,{recursive:true});
const serveUrl=await videoBundle();
const browserExecutable=process.env.LEXICUE_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
function ffmpeg(args){const r=spawnSync('ffmpeg',['-y','-hide_banner','-loglevel','error',...args],{stdio:'inherit'});if(r.status!==0)throw new Error('FFmpeg failed');}
const stamp=n=>{const ms=Math.round(n*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
for(const id of ['Horizontal','Vertical']){
 const portrait=id==='Vertical',name=portrait?'vertical-30s':'horizontal-90s',timeline=portrait?verticalTimeline:horizontalTimeline,duration=portrait?30:90;
 if(process.env.LEXICUE_RENDER_ONLY&&process.env.LEXICUE_RENDER_ONLY!==id)continue;
 const composition=await selectComposition({serveUrl,id,browserExecutable,inputProps:{portrait,subtitles:true}});
 await writeFile(resolve(output,name+'.srt'),timeline.map((s,i)=>`${i+1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${s.subtitle}\n`).join('\n'));
 for(const subtitles of [true,false]){
  const raw=resolve(output,name+(subtitles?'-raw':'-clean-raw')+'.mp4');
  let last=-1;
  await renderMedia({composition,serveUrl,browserExecutable,codec:'h264',pixelFormat:'yuv420p',crf:18,x264Preset:'fast',concurrency:4,inputProps:{portrait,subtitles},outputLocation:raw,onProgress:({progress})=>{const p=Math.floor(progress*10);if(p!==last){last=p;console.log(`${name} ${subtitles?'subtitles':'clean'} ${p*10}%`);}}});
  ffmpeg(['-i',raw,'-i',resolve(output,name+'-audio.wav'),'-map','0:v','-map','1:a','-vf','scale=in_range=auto:out_range=limited,format=yuv420p','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-color_range','tv','-c:a','aac','-b:a','192k','-t',String(duration),'-movflags','+faststart',resolve(output,name+(subtitles?'':'-clean')+'.mp4')]);
 }
 await renderStill({composition,serveUrl,browserExecutable,inputProps:{portrait,subtitles:false},frame:portrait?855:2630,output:resolve(output,name+'-cover.png'),imageFormat:'png'});
 console.log(`Completed ${name}`);
}
