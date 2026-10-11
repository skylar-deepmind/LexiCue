import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const out=resolve(import.meta.dirname,'../../output/marketing'),qa=resolve(out,'qa');await mkdir(qa,{recursive:true});const results=[];
for(const layout of ['horizontal-90s','vertical-30s'])for(const clean of [false,true]){
 const path=resolve(out,layout+(clean?'-clean':'')+'.mp4'),portrait=layout.startsWith('vertical');
 const probe=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8'});assert.equal(probe.status,0);
 const data=JSON.parse(probe.stdout),video=data.streams.find(s=>s.codec_type==='video'),audio=data.streams.find(s=>s.codec_type==='audio');
 assert.equal(video.codec_name,'h264');assert.equal(video.pix_fmt,'yuv420p');assert.equal(video.r_frame_rate,'30/1');assert.equal(video.width,portrait?1080:1920);assert.equal(video.height,portrait?1920:1080);assert.equal(Number(video.nb_frames),portrait?900:2700);assert.equal(audio.codec_name,'aac');assert.ok(Math.abs(Number(data.format.duration)-(portrait?30:90))<.1);
 const decode=spawnSync('ffmpeg',['-v','error','-i',path,'-f','null','-'],{encoding:'utf8'});assert.equal(decode.status,0);assert.equal(decode.stderr.trim(),'');
 results.push({file:path,width:video.width,height:video.height,frames:video.nb_frames,fps:video.r_frame_rate,pixelFormat:video.pix_fmt,audio:audio.codec_name,duration:data.format.duration,bytes:data.format.size,decodeErrors:0});
 if(!clean){
  const sheet=spawnSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',path,'-vf',portrait?'fps=1/2,scale=180:-1,tile=5x3':'fps=1/3,scale=320:-1,tile=5x6','-frames:v','1',resolve(qa,layout+'-contact.png')],{encoding:'utf8'});assert.equal(sheet.status,0,sheet.stderr);
 }
}
await writeFile(resolve(qa,'video-results.json'),JSON.stringify(results,null,2));console.log('All four videos: dimensions, 30 fps, exact frame counts, AAC, duration and full decode passed.');
