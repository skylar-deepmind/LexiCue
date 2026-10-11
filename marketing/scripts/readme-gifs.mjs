import {mkdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const root=resolve(import.meta.dirname,'../..');
const source=resolve(root,'output/marketing/video-final/lexicue-horizontal-76s-clean.mp4');
const destination=resolve(root,'docs/media/demo');
const scenes=[
 {id:'hero',start:10.1,duration:4.8},
 {id:'lookup',start:18,duration:4.5},
 {id:'phrases',start:26.2,duration:7.8},
 {id:'review',start:41.2,duration:7.3},
];

await stat(source).catch(()=>{throw new Error(`Missing horizontal clean video: ${source}`);});
await mkdir(destination,{recursive:true});

function run(args){
 const result=spawnSync('ffmpeg',['-y','-hide_banner','-loglevel','error',...args],{stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.status!==0)throw new Error(`FFmpeg exited with status ${result.status}`);
}

for(const scene of scenes){
 const gif=resolve(destination,`${scene.id}.gif`);
 run([
  '-ss',String(scene.start),'-t',String(scene.duration),'-i',source,
  '-filter_complex',
  '[0:v]crop=1240:720:590:200,fps=8,scale=800:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=112[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
  '-loop','0','-an',gif,
 ]);
 const {size}=await stat(gif);
 if(size>=3*1024*1024)throw new Error(`${scene.id}.gif exceeds the 3 MiB README limit (${size} bytes)`);
 console.log(`${scene.id}: ${(size/1024).toFixed(0)} KiB, ${scene.duration}s, looping`);
}

console.log('Updated the shared looping hero, lookup, phrase and review GIFs used by all four README locales.');
