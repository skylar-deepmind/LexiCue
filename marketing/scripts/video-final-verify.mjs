import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {horizontalRevision,verticalRevision,videoDuration,videoFrames} from '../src/video-revision.mjs';
const out=resolve(import.meta.dirname,'../../output/marketing/video-final'),qa=resolve(out,'qa');await mkdir(qa,{recursive:true});const results=[];
for(const portrait of [false,true]){
 const duration=videoDuration(portrait),layout=portrait?'vertical':'horizontal',name=`lexicue-${layout}-${duration}s`,timeline=portrait?verticalRevision:horizontalRevision;
 assert.equal(timeline.at(-2).id,'languages');assert.ok(timeline.every((s,i)=>!i||s.start===timeline[i-1].end));
 const subtitles=await readFile(resolve(out,name+'.srt'),'utf8');assert.equal((subtitles.match(/ --> /g)||[]).length,timeline.length);assert.ok(!/\bTXT\b|\bVTT\b/.test(subtitles));
 for(const clean of [false,true]){
  const file=name+(clean?'-clean':'')+'.mp4',path=resolve(out,file),probe=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8'});assert.equal(probe.status,0,probe.stderr);
  const data=JSON.parse(probe.stdout),video=data.streams.find(s=>s.codec_type==='video'),audio=data.streams.find(s=>s.codec_type==='audio');
  assert.equal(video.codec_name,'h264');assert.equal(video.pix_fmt,'yuv420p');assert.equal(video.r_frame_rate,'30/1');assert.equal(video.width,portrait?1080:1920);assert.equal(video.height,portrait?1920:1080);assert.equal(Number(video.nb_frames),videoFrames(portrait));assert.equal(audio.codec_name,'aac');assert.equal(audio.sample_rate,'48000');assert.equal(audio.channels,2);assert.ok(Math.abs(Number(data.format.duration)-duration)<.1);assert.ok(Math.abs(Number(video.duration)-Number(audio.duration))<.1);
  const decoded=spawnSync('ffmpeg',['-v','error','-i',path,'-f','null','-'],{encoding:'utf8'});assert.equal(decoded.status,0);assert.equal(decoded.stderr.trim(),'');
  results.push({file,width:video.width,height:video.height,duration:Number(data.format.duration),frames:Number(video.nb_frames),fps:30,codec:video.codec_name,pixelFormat:video.pix_fmt,colorRange:video.color_range,audio:audio.codec_name,sampleRate:Number(audio.sample_rate),channels:audio.channels,bytes:Number(data.format.size),fullDecodePassed:true});
  if(!clean){
   const interval=duration/(portrait?15:24),sheet=spawnSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',path,'-vf',`fps=1/${interval},scale=${portrait?180:320}:-1,tile=${portrait?'5x3':'6x4'}`,'-frames:v','1',resolve(qa,layout+'-contact.png')],{encoding:'utf8'});assert.equal(sheet.status,0,sheet.stderr);
   for(const scene of timeline){const time=scene.start+(scene.end-scene.start)*.64,r=spawnSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-ss',String(time),'-i',path,'-frames:v','1',resolve(qa,layout+'-'+scene.id+'.png')],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
   for(const [label,t] of [['closing-white',timeline.at(-1).start],['closing-split',timeline.at(-1).start+2],['last',duration-1/30]]){const r=spawnSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-ss',String(t),'-i',path,'-frames:v','1',resolve(qa,layout+'-'+label+'.png')],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
  }
  console.log('Verified '+file);
 }
}
await writeFile(resolve(qa,'verification.json'),JSON.stringify(results,null,2));console.log('All four final videos passed full decoding, exact durations/frame counts and audio/video stream checks.');
