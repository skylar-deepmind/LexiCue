// Refresh selected scenes when copy changes but timeline/layout stays unchanged.
// Full export remains the canonical workflow for changes to timing or composition.
import {renderMedia,selectComposition} from '@remotion/renderer';
import {videoBundle} from './bundle.mjs';
import {horizontalTimeline,verticalTimeline} from '../src/catalogue.mjs';
import {resolve} from 'node:path';
import {mkdir,rename,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'../output/marketing'),patches=resolve(out,'patches');await mkdir(patches,{recursive:true});
const selected=(process.env.LEXICUE_REFRESH_SCENES||'lookup,review').split(',');
const previous=JSON.parse(await readFile(resolve(out,'manifest.json'),'utf8'));
if(JSON.stringify(previous.horizontalTimeline)!==JSON.stringify(horizontalTimeline)||JSON.stringify(previous.verticalTimeline)!==JSON.stringify(verticalTimeline))throw new Error('Timeline changed: run the full render instead.');
const serveUrl=await videoBundle(),browserExecutable=process.env.LEXICUE_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
function ffmpeg(args){const p=spawnSync('ffmpeg',['-y','-hide_banner','-loglevel','error',...args],{stdio:'inherit'});if(p.status!==0)throw new Error('Scene composition failed');}
for(const id of ['Horizontal','Vertical']){
 const portrait=id==='Vertical',name=portrait?'vertical-30s':'horizontal-90s',timeline=portrait?verticalTimeline:horizontalTimeline,segments=timeline.filter(s=>selected.includes(s.id));
 const composition=await selectComposition({serveUrl,id,browserExecutable});
 for(const subtitles of [true,false]){
  const files=[];
  for(const segment of segments){
   const path=resolve(patches,`${name}-${segment.id}-${subtitles}.mp4`);
   await renderMedia({serveUrl,composition,browserExecutable,codec:'h264',pixelFormat:'yuv420p',crf:18,x264Preset:'fast',concurrency:4,inputProps:{portrait,subtitles},frameRange:[segment.start*30,segment.end*30-1],outputLocation:path});files.push(path);
  }
  const final=resolve(out,name+(subtitles?'':'-clean')+'.mp4'),temporary=resolve(out,name+(subtitles?'':'-clean')+'-refreshed.mp4');
  const filters=['[0:v]scale=in_range=auto:out_range=limited,format=yuv420p[base0]'];
  segments.forEach((segment,n)=>{
   filters.push(`[${n+1}:v]scale=in_range=auto:out_range=limited,format=yuv420p,setpts=PTS-STARTPTS+${segment.start}/TB[patch${n}]`);
   filters.push(`[base${n}][patch${n}]overlay=eof_action=pass:repeatlast=0:enable='gte(t,${segment.start})*lt(t,${segment.end})'[base${n+1}]`);
  });
  ffmpeg(['-i',final,...files.flatMap(f=>['-i',f]),'-filter_complex',filters.join(';'),'-map',`[base${segments.length}]`,'-map','0:a','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-color_range','tv','-c:a','copy','-t',portrait?'30':'90','-movflags','+faststart',temporary]);
  await rename(temporary,final);
  // Retain a matching raw picture master for later audio-only edits.
  ffmpeg(['-i',final,'-map','0:v','-c:v','copy',resolve(out,name+(subtitles?'-raw':'-clean-raw')+'.mp4')]);
  console.log(`Refreshed ${name} ${subtitles?'subtitles':'clean'}: ${selected.join(', ')}`);
 }
}
