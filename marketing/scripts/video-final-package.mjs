import {readFile,writeFile,mkdir,copyFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {videoDuration,videoFps} from '../src/video-revision.mjs';

const root=resolve(import.meta.dirname,'..');
const source=resolve(root,'../output/marketing/video-final');
const destination=resolve(root,'../output/marketing/publishing-kit');
const delivery=JSON.parse(await readFile(resolve(source,'manifest.json'),'utf8'));
const entries=[];
const replacements=new Map();
async function hash(path){const sha=createHash('sha256');for await(const chunk of createReadStream(path))sha.update(chunk);return sha.digest('hex');}
async function copy(file,target,{locale,kind,expected}={}){
 const from=resolve(source,file),to=resolve(destination,target),before=await hash(from);
 if(expected&&before!==expected)throw Error('Source does not match the delivery manifest: '+file);
 await mkdir(dirname(to),{recursive:true});await copyFile(from,to);
 const after=await hash(to);if(after!==before)throw Error('Copied file checksum mismatch: '+target);
 entries.push({file:target,source:file,locale,kind,bytes:(await stat(to)).size,sha256:after});
 replacements.set(file,target);
}
for(const locale of ['zh','en']){
 const suffix=locale==='en'?'-en':'';
 for(const portrait of [false,true]){
  const name=`lexicue-${portrait?'vertical':'horizontal'}-${videoDuration(portrait)}s`;
  for(const clean of [false,true]){
   const file=`${name}${suffix}${clean?'-clean':''}.mp4`;
   const expected=delivery.files.find(item=>item.file===file)?.sha256;
   if(!expected)throw Error('Video is missing from the delivery manifest: '+file);
   await copy(file,`${locale}/videos/${file}`,{locale,kind:clean?'clean-video':'captioned-video',expected});
  }
  const subtitle=`${name}${suffix}.srt`;
  await copy(subtitle,`${locale}/subtitles/${subtitle}`,{locale,kind:'subtitles'});
  const poster=`${name}${suffix}-cover.png`;
  await copy(poster,`preview-posters/${poster}`,{locale,kind:'player-poster'});
 }
 for(const ratio of ['16x9','4x3']){
  const file=`lexicue-cover-${ratio}${suffix}.png`;
  const expected=delivery.covers.find(item=>item.file===file)?.sha256;
  if(!expected)throw Error('Cover is missing from the delivery manifest: '+file);
  await copy(file,`${locale}/covers/${file}`,{locale,kind:'promotional-cover',expected});
 }
}
for(const file of ['PUBLISHING.md','ASSET-LICENSES.md'])await copy(file,file,{kind:'publishing-notes'});
await copy('qa/verification.json','verification.json',{kind:'video-verification'});
let html=await readFile(resolve(source,'index.html'),'utf8');
for(const [from,to] of replacements)html=html.replaceAll(from,to);
html=html.replace('LexiCue · Video delivery','LexiCue · 投稿成品汇总').replace('Local deliverables, not yet published.','中文与英文投稿成品已分别整理；本文件夹不含渲染中间文件。');
await writeFile(resolve(destination,'index.html'),html);
await writeFile(resolve(destination,'README.md'),`# LexiCue 投稿成品汇总

打开本目录的 index.html 可预览中英文视频与封面；复制整个文件夹后仍可通过静态服务浏览。

- zh/：中文成品，用于 B 站等平台。
- en/：纯英文成品，用于 YouTube 等平台。
- 各语言的 videos/：横版 ${videoDuration(false)} 秒、竖版 ${videoDuration(true)} 秒，均为 ${videoFps} fps。普通 MP4 为讲解字幕版；-clean.mp4 去除底部讲解字幕，保留产品界面和功能标题。
- 各语言的 covers/：16:9（1280×720）、4:3（1440×1080）新版 PNG 封面。
- 各语言的 subtitles/：对应语言的 SRT 字幕。
- PUBLISHING.md：中英文投稿标题、简介、章节时间与配乐署名。发布时请保留音乐署名。
- ASSET-LICENSES.md：素材来源与授权说明。
- preview-posters/：仅用于汇总页播放器预览；投稿封面请使用各语言 covers/ 中的图片。
- manifest.json：每个复制文件的大小与 SHA-256 校验值。

视频逐文件复制，与原交付目录中的 MP4 完全一致。本次更新封面，未重新渲染视频，也未发布到任何平台。
`);
await writeFile(resolve(destination,'manifest.json'),JSON.stringify({name:'LexiCue publishing kit',horizontalSeconds:videoDuration(false),verticalSeconds:videoDuration(true),fps:videoFps,files:entries},null,2));
console.log(`Publishing kit copied and verified: ${entries.length} files → ${destination}`);
