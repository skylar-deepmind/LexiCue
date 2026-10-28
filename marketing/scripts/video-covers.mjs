import sharp from 'sharp';
import {readFile, mkdir, writeFile, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {author} from '../src/video-revision.mjs';
import {videoThemeStyles} from '../generated/video-theme-tokens.mjs';

const root=resolve(import.meta.dirname,'..'),out=resolve(root,'../output/marketing/video-final');
const previewOnly=process.argv.includes('--preview');
const destination=previewOnly?resolve(out,'cover-preview'):out;
await mkdir(destination,{recursive:true});
const icon=await readFile(resolve(root,'public/lexicue-icon.png'));
const avatarBytes=await readFile(resolve(root,'public',author.avatar));
const light=videoThemeStyles.ocean,dark=videoThemeStyles.midnight;
const palette={dark:dark['--marketing-bg'],light:light['--marketing-bg'],heading:dark['--marketing-heading'],muted:dark['--marketing-muted'],accent:light['--accent-200'],line:light['--marketing-line']};
const copy={
 zh:{eyebrow:'我做了个工具',wideTitle:['追剧也能','学外语'],compactTitle:['追剧也能学外语'],subtitle:'导入 SRT · 点词查义 · 原句复习',brand:'免费 · 开源 · 本地优先',role:'LexiCue 作者'},
 en:{eyebrow:'I built a tool',wideTitle:['Learn languages','from shows','you love'],compactTitle:['Learn languages','from shows you love'],subtitle:'Import SRT · Look up words · Review in context',brand:'FREE · OPEN SOURCE · LOCAL FIRST',role:'Creator of LexiCue'},
};
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const font="-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,'Noto Sans CJK SC',sans-serif";

function artwork({width,height,locale,ratio}){
 const zh=locale==='zh',wide=ratio==='16x9',text=copy[locale];
 const screen=wide?{x:540,y:119,w:704,h:470}:{x:110,y:421,w:1220,h:610};
 const avatar=wide?{x:52,y:580,size:62}:{x:1168,y:70,size:66};
 const logo=wide?{x:52,y:49,size:42}:{x:66,y:46,size:48};
 const titleX=wide?52:66;
 const titleYs=wide?(zh?[321,425]:[291,368,445]):(zh?[269]:[219,302]);
 const sizes=wide?(zh?[79,90]:[49,59,64]):(zh?[100]:[70,76]);
 const titleMarkup=(wide?text.wideTitle:text.compactTitle).map((line,index)=>`<text x="${titleX}" y="${titleYs[index]}" font-size="${sizes[index]}" font-weight="750" letter-spacing="${zh?-2.8:-1.8}" fill="${index?palette.accent:palette.heading}">${!wide&&zh?`追剧也能<tspan fill="${palette.accent}">学外语</tspan>`:xml(line)}</text>`).join('');
 const divider=wide?`M0 0H510C474 200 562 453 514 720H0Z`:`M0 0H1440V371C1020 348 429 402 0 374Z`;
 const authorX=wide?avatar.x+avatar.size+16:avatar.x+avatar.size+14;
 const authorY=wide?avatar.y+24:avatar.y+24;
 const authorMarkup=`<circle cx="${avatar.x+avatar.size/2}" cy="${avatar.y+avatar.size/2}" r="${avatar.size/2+2}" fill="${palette.muted}" opacity=".3"/><text x="${authorX}" y="${authorY}" font-size="${wide?22:23}" font-weight="650" fill="${palette.heading}">Skylar</text><text x="${authorX}" y="${authorY+24}" font-size="${wide?13:14}" fill="${palette.muted}">${xml(text.role)}</text>`;
 const subtitle=wide&&!zh?`<text x="${titleX}" y="494" class="sub">Import SRT · Look up words</text><text x="${titleX}" y="521" class="sub">Review in context</text>`:`<text x="${titleX}" y="${wide?491:349}" class="sub">${xml(text.subtitle)}</text>`;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="155%"><feDropShadow dx="0" dy="16" stdDeviation="17" flood-color="#143263" flood-opacity=".12"/></filter></defs>
  <rect width="100%" height="100%" fill="${palette.light}"/>
  <path d="${divider}" fill="${palette.dark}"/>
  <image href="data:image/png;base64,${icon.toString('base64')}" x="${logo.x}" y="${logo.y}" width="${logo.size}" height="${logo.size}"/>
  <text x="${logo.x+logo.size+12}" y="${logo.y+logo.size*.76}" font-size="${wide?29:34}" font-weight="650" letter-spacing="-.8" fill="${palette.heading}">LexiCue</text>
  ${wide?'':`<text x="${logo.x+logo.size+155}" y="${logo.y+logo.size*.7}" font-size="${zh?16:13}" fill="${palette.muted}">${xml(text.brand)}</text>`}
  <text x="${titleX}" y="${wide?203:145}" font-size="${wide?21:23}" fill="${palette.muted}">${xml(text.eyebrow)}</text>
  ${titleMarkup}${subtitle}${authorMarkup}
  <rect x="${screen.x}" y="${screen.y}" width="${screen.w}" height="${screen.h}" rx="15" fill="#fff" filter="url(#shadow)"/>
  <style>text{font-family:${font}}.sub{font-size:${wide?18:22}px;fill:${palette.muted};letter-spacing:${zh?.15:0}px}</style>
 </svg>`;
 return {svg,screen,avatar};
}

async function makeCover(locale,ratio){
 const wide=ratio==='16x9',width=wide?1280:1440,height=wide?720:1080;
 const file=`lexicue-cover-${ratio}${locale==='en'?'-en':''}.png`;
 const source=resolve(out,'qa',`cover-lookup-${locale}-${ratio}.png`);
 const {svg,screen,avatar}=artwork({width,height,locale,ratio});
 const backdrop=await sharp(Buffer.from(svg)).png().toBuffer();
 const screenshot=await sharp(source).resize(screen.w,screen.h,{fit:'fill'}).png().toBuffer();
 const mask=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${screen.w}" height="${screen.h}"><rect width="100%" height="100%" rx="14" fill="#fff"/></svg>`);
 const rounded=await sharp(screenshot).composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
 const avatarMask=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${avatar.size}" height="${avatar.size}"><circle cx="${avatar.size/2}" cy="${avatar.size/2}" r="${avatar.size/2}" fill="#fff"/></svg>`);
 const circularAvatar=await sharp(avatarBytes).resize(avatar.size,avatar.size,{fit:'cover'}).composite([{input:avatarMask,blend:'dest-in'}]).png().toBuffer();
 const frame=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="${screen.x+.5}" y="${screen.y+.5}" width="${screen.w-1}" height="${screen.h-1}" rx="14" fill="none" stroke="${palette.line}" stroke-width="1"/></svg>`);
 await sharp(backdrop).composite([{input:rounded,left:screen.x,top:screen.y},{input:circularAvatar,left:avatar.x,top:avatar.y},{input:frame}]).png({compressionLevel:9}).toFile(resolve(destination,file));
 return {file,width,height,locale,ratio,bytes:(await stat(resolve(destination,file))).size};
}

const manifest=[];
for(const locale of previewOnly?['zh']:['zh','en'])for(const ratio of previewOnly?['16x9']:['16x9','4x3'])manifest.push(await makeCover(locale,ratio));
await writeFile(resolve(destination,'covers.json'),JSON.stringify(manifest,null,2));
if(previewOnly)await writeFile(resolve(destination,'index.html'),`<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LexiCue · 新版封面预览</title><style>:root{color-scheme:light dark;--bg:${palette.light};--text:${light['--marketing-heading']};--muted:${light['--marketing-muted']};--line:${palette.line};--accent:${light['--marketing-primary']}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:${font};padding:36px 22px}main{max-width:1280px;margin:auto}h1{font-size:24px;margin:0 0 10px}p{color:var(--muted);line-height:1.7}img{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:12px;margin:24px 0}a{color:var(--accent);text-underline-offset:4px}a:hover{opacity:.8}a:focus-visible{outline:3px solid var(--accent);outline-offset:5px}@media(prefers-color-scheme:dark){:root{--bg:${palette.dark};--text:${palette.heading};--muted:${palette.muted};--line:${dark['--border']};--accent:${dark['--accent-700']}}@media(max-width:600px){body{padding:24px 14px}h1{font-size:21px}}</style></head><body><main><h1>LexiCue · 中文 16:9 封面预览</h1><p>黑白分区 · 真实产品界面 · 作者署名</p><img src="lexicue-cover-16x9.png" alt="LexiCue 封面：追剧也能学外语，右侧展示原句查词界面，下方为 Skylar 作者署名" width="1280" height="720"><p><a href="lexicue-cover-16x9.png" download>下载预览 PNG</a> · <a href="../">返回视频交付页</a></p></main></body></html>`);
console.log(manifest.map(({file,width,height,bytes})=>`${previewOnly?'cover-preview/':''}${file} · ${width}×${height} · ${(bytes/1024).toFixed(0)} KB`).join('\n'));
