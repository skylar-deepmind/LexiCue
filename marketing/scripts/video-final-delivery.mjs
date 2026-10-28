import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {author,horizontalRevision,verticalRevision,videoDuration,videoFps} from '../src/video-revision.mjs';
import {videoTimeline} from '../src/video-copy.mjs';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'../output/marketing/video-final'),h=videoDuration(false),v=videoDuration(true);
const label={intro:'从喜欢的内容开始',sources:'YouTube 字幕与自备 SRT',import:'导入 SRT 字幕',tags:'文件与标签',lookup:'点击查词',phrases:'词组与语境',collect:'词汇整理',review:'原句复习',progress:'学习进度',privacy:'本地优先',sync:'可选加密同步',languages:'四语与五色主题',outro:'作者 GitHub 与下载'};
const labelEn={intro:'Start with what you love',sources:'YouTube subtitles and your own SRTs',import:'Import an SRT subtitle',tags:'Files and tags',lookup:'Tap to look up a word',phrases:'Phrases and context',collect:'Build your vocabulary',review:'Review in context',progress:'Track your progress',privacy:'Local first',sync:'Optional encrypted sync',languages:'Four languages and five themes',outro:'Meet the maker and download'};
const chapters=(timeline,locale='zh')=>timeline.map(s=>`${Math.floor(s.start/60)}:${String(Math.floor(s.start%60)).padStart(2,'0')} ${locale==='en'?labelEn[s.id]:label[s.id]}`).join('\n');
const credit='“Carefree” by Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons Attribution 4.0 International\nhttps://creativecommons.org/licenses/by/4.0/\nSource: https://incompetech.com/music/royalty-free/index.html?gt=&isrc=USUAN1400037';

await writeFile(resolve(out,'PUBLISHING.md'),`# LexiCue Promotional Video Publishing Kit

## Chinese Bilibili title

我做了个追剧学外语工具：导入 SRT 字幕，点词就能查

## Other Chinese title options

1. 把喜欢的字幕变成词汇库｜免费开源语言学习工具 LexiCue
2. 点词查词、理解词组、原句复习：我做的语言学习工具 LexiCue
3. 不只背单词：在喜欢的内容里学语言｜LexiCue

## Chinese description

LexiCue 是一款免费、开源、本地优先的语言学习工具。导入 SRT 字幕，在原句中查词、积累和复习。用标签整理文件；单词与词组统一管理；支持英语、日语、德语和中文，以及五种界面主题。

官网：https://skylar-deepmind.github.io/LexiCue/zh/
下载：https://github.com/skylar-deepmind/LexiCue/releases/latest
作者 GitHub：${author.url}
支持作者：https://www.ifdian.net/a/skylar-lexicue

画面使用产品组件与原创固定样例。AI 为可选功能，演示过程已加速，不代表实际推理速度；同步为原理示意。安装版的本地模型需另行下载；云端 AI 和同步由用户主动开启。

## 中文横版章节（${h} 秒）

${chapters(horizontalRevision)}

## 中文竖版章节（${v} 秒）

${chapters(verticalRevision)}

## English YouTube titles

1. I Built a Tool to Learn Languages from the Shows You Love | LexiCue
2. Learn from the Videos You Love | LexiCue, Free Open-Source Language Learning
3. Look Up Words in Context, Then Review the Original Sentence | LexiCue

## English description

LexiCue is a free, open-source, local-first language learning app. Import SRT subtitles to look up words in context, build vocabulary, and review original sentences. Organize files with tags and keep every word connected to where you found it.

Supports English, Japanese, German, and Chinese learning, with five interface themes. Optional AI and encrypted sync are shown with fixed sample data; no live AI request or sync connection is made in the video.

Website: https://skylar-deepmind.github.io/LexiCue/en/
Download: https://github.com/skylar-deepmind/LexiCue/releases/latest
Creator: ${author.url}

## English horizontal chapters (${h} seconds)

${chapters(videoTimeline('en',false,{horizontal:horizontalRevision,vertical:verticalRevision}),'en')}

## English vertical chapters (${v} seconds)

${chapters(videoTimeline('en',true,{horizontal:horizontalRevision,vertical:verticalRevision}),'en')}

## Suggested English tags

Language learning, English learning, subtitle learning, open source, vocabulary, contextual learning, offline dictionary, sentence review, LexiCue

## Music credit (include in the video description)

${credit}

Edited: ${h} / ${v} second cuts, volume adjustment, fades, and original UI sounds.

## Deliverables

- lexicue-horizontal-${h}s.mp4 and lexicue-vertical-${v}s.mp4: Chinese on-screen copy and subtitles.
- Matching -en.mp4 files: English product UI, titles, captions, and creator outro.
- Matching -clean.mp4 files: no bottom explanatory subtitle overlay; product UI and feature titles remain.
- .srt / -en.srt: separate Chinese and English subtitle files.
- lexicue-cover-16x9*.png and lexicue-cover-4x3*.png: Chinese and English covers with localized headlines, the author avatar, and a product UI preview; 16:9 (1280×720) and 4:3 (1440×1080).
- Existing vertical player posters use 9:16; they serve a different purpose from the promotional covers.
- masters/: high-quality local renders and audio, not committed to the repository.

Both cuts are ${videoFps} fps with continuous push transitions. The vertical version is ${v} seconds to leave more time with each feature; the horizontal version is ${h} seconds. These are local deliverables and have not been published.
`);

const license=(await readFile(resolve(root,'ASSET-LICENSES.md'),'utf8')).replace('90 / 30 seconds',`${h} / ${v} seconds`)+`\n## Author closing card\n\nThe author requested use of their GitHub avatar and approved the closing text. Profile: ${author.url}. Avatar source: https://avatars.githubusercontent.com/u/173658591?s=512&v=4. The avatar is not included in the music license.\n`;
await writeFile(resolve(out,'ASSET-LICENSES.md'),license);

const videos=[{portrait:false,locale:'zh'},{portrait:true,locale:'zh'},{portrait:false,locale:'en'},{portrait:true,locale:'en'}];
const coverFiles=['lexicue-cover-16x9.png','lexicue-cover-4x3.png','lexicue-cover-16x9-en.png','lexicue-cover-4x3-en.png'];
const coverVersions={};for(const file of coverFiles)coverVersions[file]=createHash('sha256').update(await readFile(resolve(out,file))).digest('hex').slice(0,12);
const coverGallery=coverFiles.map(file=>`<a class="cover" href="${file}" download><img src="${file}?v=${coverVersions[file]}" alt="${file.includes('-en')?'English':'Chinese'} ${file.includes('16x9')?'16:9':'4:3'} promotional cover with a white/midnight split and an original-sentence lookup"><span>${file.includes('-en')?'English':'中文'} · ${file.includes('16x9')?'16:9':'4:3'}</span></a>`).join('');
const sections=videos.map(({portrait,locale})=>{const duration=videoDuration(portrait),name=`lexicue-${portrait?'vertical':'horizontal'}-${duration}s`,suffix=locale==='en'?'-en':'',layout=portrait?'Vertical':'Horizontal',poster=name+(locale==='en'?'-en-cover.png':'-cover.png');return `<section class="${portrait?'vertical':''}"><h2>${locale==='en'?'English':'中文'} · ${layout} · ${duration}s</h2><video controls preload="metadata" poster="${poster}" src="${name}${suffix}.mp4"></video><p><a href="${name}${suffix}.mp4" download>Download MP4</a> · <a href="${name}${suffix}-clean.mp4" download>Clean video</a> · <a href="${name}${suffix}.srt" download>Subtitle file (.srt)</a></p></section>`;}).join('');
await writeFile(resolve(out,'index.html'),`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LexiCue · Video Delivery</title><style>*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f8fc;color:#102348;max-width:1150px;margin:40px auto;padding:0 22px}h1{font-size:32px}p{color:#526177;line-height:1.8}a{color:#235ce0}section{padding:24px;margin:28px 0;border:1px solid #dce5f0;border-radius:14px;background:white}video{display:block;width:100%;background:#0d1423;border-radius:10px}.vertical video{max-width:390px;margin:auto}nav{display:flex;gap:18px;flex-wrap:wrap}.covers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.cover{display:block;color:inherit;text-decoration:none}.cover img{display:block;width:100%;border-radius:10px;border:1px solid #dce5f0}.cover span{display:block;margin-top:7px}a:focus-visible{outline:3px solid #235ce0;outline-offset:4px}@media(max-width:650px){.covers{grid-template-columns:1fr}}@media(prefers-color-scheme:dark){body{background:#0d1423;color:#edf2ff}p{color:#b1bed5}section{background:#1d222c;border-color:#353d4b}a{color:#b3bef0}.cover img{border-color:#353d4b}}</style></head><body><h1>LexiCue · Video delivery</h1><p>Horizontal ${h}s and vertical ${v}s versions at ${videoFps} fps. English editions include English product UI, titles, captions, and creator outro; music and light sound effects are unchanged.</p><nav><a href="PUBLISHING.md">YouTube titles, description & chapters</a><a href="ASSET-LICENSES.md">Music credits & source notes</a><a href="qa/verification.json">Video verification</a></nav><h2>Video files</h2>${sections}<section><h2>Promotional covers</h2><p>Localized Bilibili and YouTube artwork with the maker avatar and product UI, in 16:9 and 4:3 layouts.</p><div class="covers">${coverGallery}</div></section><p>Local deliverables, not yet published.</p><script>/* Blob-backed playback also supports seeking on local servers without HTTP Range. */for(const video of document.querySelectorAll('video')){const source=video.getAttribute('src');video.removeAttribute('src');video.load();fetch(source).then(response=>{if(!response.ok)throw Error('Video unavailable');return response.blob();}).then(blob=>{video.src=URL.createObjectURL(blob);video.load();}).catch(()=>{video.src=source;video.load();});}</script></body></html>`);

const manifest=JSON.parse(await readFile(resolve(out,'manifest.json'),'utf8'));
for(const item of manifest.files)item.sha256=createHash('sha256').update(await readFile(resolve(out,item.file))).digest('hex');
manifest.covers=[];for(const file of coverFiles)manifest.covers.push({file,sha256:createHash('sha256').update(await readFile(resolve(out,file))).digest('hex')});
manifest.music={title:'Carefree',author:'Kevin MacLeod',license:'CC BY 4.0',source:'https://incompetech.com/music/royalty-free/index.html?gt=&isrc=USUAN1400037'};
manifest.verification=JSON.parse(await readFile(resolve(out,'qa/verification.json'),'utf8'));
await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2));
console.log('Final delivery page, bilingual captions, chapters, cover gallery and provenance saved.');
