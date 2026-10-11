import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const out=resolve(import.meta.dirname,'../../output/marketing');
for(const name of ['horizontal-90s','vertical-30s'])for(const clean of [false,true]){
 const r=spawnSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',resolve(out,name+(clean?'-clean-raw':'-raw')+'.mp4'),'-i',resolve(out,name+'-audio.wav'),'-map','0:v','-map','1:a','-vf','scale=in_range=auto:out_range=limited,format=yuv420p','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-color_range','tv','-c:a','aac','-b:a','192k','-t',name.startsWith('horizontal')?'90':'30','-movflags','+faststart',resolve(out,name+(clean?'-clean':'')+'.mp4')],{stdio:'inherit'});
 if(r.status!==0)throw new Error('Audio remux failed');
}console.log('Normalized color range and audio in all four compatible MP4s.');
