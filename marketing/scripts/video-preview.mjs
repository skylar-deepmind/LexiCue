import {build} from 'vite';
import {resolve} from 'node:path';
import {mkdir,rename,writeFile,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {prepareVideoFixture} from './video-fixture.mjs';
import {videoDuration,horizontalRevision,verticalRevision} from '../src/video-revision.mjs';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'../output/marketing/video-preview');
await prepareVideoFixture();
await build({root,configFile:resolve(root,'vite.config.mjs'),base:'./',publicDir:resolve(root,'public'),build:{outDir:out,emptyOutDir:true,assetsDir:'assets',rollupOptions:{input:resolve(root,'video-preview.html'),output:{entryFileNames:'assets/preview.js',chunkFileNames:'assets/[name]-[hash].js',assetFileNames:'assets/[name][extname]'}}}});
await rename(resolve(out,'video-preview.html'),resolve(out,'index.html'));
await copyFile(resolve(out,'assets/video-preview.css'),resolve(root,'generated/video-revision.css'));
for(const [name,duration] of [['horizontal',videoDuration(false)],['vertical',videoDuration(true)]]){
 const result=spawnSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',resolve(root,'public/audio/carefree.mp3'),'-t',String(duration),'-af',`volume=0.28,afade=t=in:d=1.3,afade=t=out:st=${duration-2}:d=2`,'-c:a','aac','-b:a','160k',resolve(out,name+'-preview.m4a')],{stdio:'inherit'});
 if(result.status!==0)throw Error('Preview music build failed');
}
await mkdir(resolve(out,'stills'),{recursive:true});
await writeFile(resolve(out,'PREVIEW.md'),`# 宣传视频改版预览\n\n网站与已有视频保持原样，本目录仅供审阅。\n\n- 横版 ${videoDuration(false)} 秒，1920×1080；片尾 ${horizontalRevision.at(-1).start}–${videoDuration(false)} 秒。\n- 竖版 ${videoDuration(true)} 秒，1080×1920；片尾 ${verticalRevision.at(-1).start}–${videoDuration(true)} 秒。\n- 作者：Skylar · LexiCue 作者。\n- 片尾：欢迎关注我的 GitHub，发现更多开源项目。\n- 主页：https://github.com/skylar-deepmind\n- 头像：https://avatars.githubusercontent.com/u/173658591?s=512&v=4（作者要求使用其公开头像）。\n- 使用原有配乐试听；点击音效会在确认分镜后按新时序制作。\n- AI 为固定样例、过程已加速；同步为原理示意。\n- 新分镜加入文件标签，保留五项导航和两种查词弹层。\n- 语言与主题为倒数第二段：横版 ${horizontalRevision.at(-2).start}–${horizontalRevision.at(-2).end} 秒，竖版 ${verticalRevision.at(-2).start}–${verticalRevision.at(-2).end} 秒。此前全部亮色；依次展示 ocean、sage、amber、twilight，最后进入 midnight。\n- 作者片尾从全白过渡到约一半午夜色，1.5 秒后分界线持续轻微波动，直到末帧。横版左右分色，竖版上下分色。\n\n重建：在仓库运行 \`node marketing/scripts/video-preview.mjs\`。不会写入 docs/ 或现有 MP4。\n`);
console.log('Preview built: '+out);
