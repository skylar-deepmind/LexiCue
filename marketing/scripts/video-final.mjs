import {renderMedia,selectComposition,renderStill} from '@remotion/renderer';
import {resolve} from 'node:path';
import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {videoBundle} from './bundle.mjs';
import {horizontalRevision,verticalRevision,videoDuration,videoFrames,videoFps,author} from '../src/video-revision.mjs';
import {videoTimeline} from '../src/video-copy.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'../output/marketing/video-final');
await mkdir(resolve(out,'masters'),{recursive:true});
const serveUrl=await videoBundle({revised:true}),browserExecutable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ffmpeg=args=>{const result=spawnSync('ffmpeg',['-y','-hide_banner','-loglevel','error',...args],{stdio:'inherit'});if(result.status!==0)throw Error('FFmpeg export failed');};
const stamp=n=>{const ms=Math.round(n*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
const clickPoints={import:[.14,.35,.43,.55,.73],tags:[.28,.54,.68,.86],lookup:[.28,.61,.87],phrases:[.1,.3,.5],collect:[.2,.57,.73],review:[.25,.7],languages:[.16,.32,.48,.64],sync:[.65]};
const manifest={fps:videoFps,renderer:'Remotion 4.0.534',author,files:[],horizontalTimeline:horizontalRevision,verticalTimeline:verticalRevision,liveAI:false,liveSync:false,personalLibraryUsed:false};
const locales=(process.env.LEXICUE_RENDER_LOCALES||'zh,en').split(',').map(value=>value.trim()).filter(value=>['zh','en'].includes(value));
try{const previous=JSON.parse(await readFile(resolve(out,'manifest.json'),'utf8'));manifest.files=previous.files.filter(item=>!locales.includes(item.locale||'zh'));}catch{}
for(const portrait of [false,true]){
 const id=portrait?'RevisedVertical':'RevisedHorizontal',layout=portrait?'vertical':'horizontal',duration=videoDuration(portrait),name=`lexicue-${layout}-${duration}s`,timeline=portrait?verticalRevision:horizontalRevision;
 if(process.env.LEXICUE_RENDER_ONLY&&process.env.LEXICUE_RENDER_ONLY!==layout)continue;
 const cues=timeline.flatMap(scene=>(clickPoints[scene.id]||[]).filter((point,i)=>!portrait||!['import','tags','languages'].includes(scene.id)||i===0||i===(clickPoints[scene.id].length-1)).map(point=>Math.min(duration-1/videoFps,(Math.ceil((scene.start+(scene.end-scene.start)*point)*videoFps)+1)/videoFps)));
 const audioSpec=resolve(out,'masters',layout+'-audio-spec.json');await writeFile(audioSpec,JSON.stringify({duration,cues,out:resolve(out,'masters',layout+'-audio.wav')}));
 const audio=spawnSync('python3',[resolve(root,'scripts/video-final-audio.py'),audioSpec],{stdio:'inherit'});if(audio.status!==0)throw Error('Audio mix failed');
 for(const locale of locales){
  const localizedTimeline=videoTimeline(locale,portrait,{horizontal:horizontalRevision,vertical:verticalRevision});
  const composition=await selectComposition({serveUrl,id,browserExecutable,inputProps:{portrait,subtitles:true,locale}});
  if(composition.durationInFrames!==videoFrames(portrait))throw Error('Composition duration mismatch');
  const localeSuffix=locale==='en'?'-en':'';
  await writeFile(resolve(out,name+localeSuffix+'.srt'),localizedTimeline.map((s,i)=>`${i+1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${s.subtitle}\n`).join('\n'));
  for(const subtitles of [true,false]){
   const cleanSuffix=subtitles?'':'-clean',file=name+localeSuffix+cleanSuffix+'.mp4',raw=resolve(out,'masters',name+localeSuffix+cleanSuffix+'-raw.mp4');
   let last=-1;await renderMedia({composition,serveUrl,browserExecutable,codec:'h264',pixelFormat:'yuv420p',crf:16,x264Preset:'fast',concurrency:4,inputProps:{portrait,subtitles,locale},outputLocation:raw,onProgress:({progress})=>{const p=Math.floor(progress*20);if(p!==last){last=p;console.log(`${layout} ${locale==='en'?'English':'Chinese'} ${subtitles?'subtitles':'clean'} ${p*5}%`);}}});
   ffmpeg(['-i',raw,'-i',resolve(out,'masters',layout+'-audio.wav'),'-map','0:v','-map','1:a','-vf','scale=in_range=auto:out_range=limited,format=yuv420p','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-color_range','tv','-c:a','aac','-b:a','192k','-t',String(duration),'-movflags','+faststart',resolve(out,file)]);
   manifest.files.push({file,locale,portrait,subtitles,duration,width:portrait?1080:1920,height:portrait?1920:1080,frames:videoFrames(portrait),audioCues:cues});
  }
  if(locale==='en')await renderStill({composition,serveUrl,browserExecutable,inputProps:{portrait,subtitles:false,locale},frame:Math.round((localizedTimeline.at(-1).start+2)*videoFps),output:resolve(out,name+'-en-cover.png'),imageFormat:'png'});
 }
 if(locales.includes('zh'))await renderStill({composition,serveUrl,browserExecutable,inputProps:{portrait,subtitles:false,locale:'zh'},frame:Math.round((timeline.at(-1).start+2)*videoFps),output:resolve(out,name+'-cover.png'),imageFormat:'png'});
 console.log('Completed '+layout);
}
await copyFile(resolve(root,'ASSET-LICENSES.md'),resolve(out,'ASSET-LICENSES.md'));
await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2));
console.log('Final renders saved: '+out);
