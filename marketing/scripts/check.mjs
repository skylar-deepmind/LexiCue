import {experienceCopy,guides} from '../src/experience-copy.mjs';
import {manualContent} from '../src/manual-content.mjs';
import {manualCopy} from '../src/manual-copy.mjs';
import {homeCopy} from '../src/home-copy.mjs';
import assert from 'node:assert/strict';
import {readFile,stat,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareVideoFixture} from './video-fixture.mjs';
import {copy,locales,features,horizontalTimeline,verticalTimeline} from '../src/catalogue.mjs';
const root=resolve(import.meta.dirname,'../..');let checks=0;
const check=(condition,label)=>{assert.ok(condition,label);checks++;};
// The video adapter and semantic theme tokens are generated, ignored build inputs.
// Prepare them here so a clean checkout can run the same TypeScript check as a developer machine.
await prepareVideoFixture();
function keys(value,prefix=''){return Object.entries(value).flatMap(([k,v])=>v&&typeof v==='object'&&!Array.isArray(v)?keys(v,prefix+k+'.'):[prefix+k]);}
for(const locale of locales){
 check(JSON.stringify(Object.keys(manualCopy[locale]).sort())===JSON.stringify(Object.keys(manualCopy.en).sort()),`manual translations ${locale}`);check(Object.values(manualCopy[locale].descriptions).every(v=>v.trim()),`manual descriptions ${locale}`);
 check(JSON.stringify(Object.keys(homeCopy[locale]).sort())===JSON.stringify(Object.keys(homeCopy.en).sort()),`homepage translations ${locale}`);
 check(Object.values(homeCopy[locale]).every(v=>typeof v==='string'&&v.trim()),`homepage translation values ${locale}`);
 check(JSON.stringify(keys(experienceCopy[locale]).sort())===JSON.stringify(keys(experienceCopy.en).sort()),`experience translations ${locale}`);
 for(const chapter of guides[locale]){
  const manual=await readFile(resolve(root,`docs/${locale==='en'?'':locale+'/'}guide/${chapter.id}/index.html`),'utf8');check(manual.includes(`<h1>${chapter.title}</h1>`),`static manual ${locale}/${chapter.id}`);check(manual.includes(manualCopy[locale].descriptions[chapter.id]),'chapter intro');
  check(manual.includes('#experience')&&manual.includes('https://www.ifdian.net/a/skylar-lexicue'),'public navigation');check(!manual.includes('manual-animation')&&!manual.includes('?demo='),'standard docs without demo CTA');
  const content=manualContent[locale][chapter.id];check(JSON.stringify(content.sections.map(s=>s.id))===JSON.stringify(manualContent.en[chapter.id].sections.map(s=>s.id)),'shared translated section IDs');
  for(const section of content.sections){check(section.title.trim()&&manual.includes(`id="${section.id}"`),'translated static section');check(section.body.every(p=>p.trim())&&section.steps.every(p=>p.trim()),'nonempty translated text');if(section.image)for(const suffix of ['', '-midnight']){await access(resolve(root,`docs/media/${locale}/guide-${section.image}${suffix}.webp`));checks++;}for(const target of section.related||[]){const [id,anchor]=target.split('#');check(manualContent[locale][id]&&(!anchor||manualContent[locale][id].sections.some(s=>s.id===anchor)),'related chapter/section exists');}}
  check(!/\b(?:TXT|VTT)\b/i.test(manual),'SRT-only manual claims');
  for(const match of manual.matchAll(/(?:src|href)="([^"]+)"/g)){if(/^(?:https?:|#|data:)/.test(match[1])||match[1].includes('?'))continue;await access(resolve(root,`docs/${locale==='en'?'':locale+'/'}guide/${chapter.id}/`,match[1].split('#')[0]));checks++;}
 }
 check(JSON.stringify(keys(copy[locale]).sort())===JSON.stringify(keys(copy.en).sort()),`translation keys ${locale}`);
 check(copy[locale].titles.length===features.length&&copy[locale].descriptions.length===features.length,`translated feature count ${locale}`);
 check(!/\b(?:TXT|VTT)\b/i.test(JSON.stringify(copy[locale])),'SRT-only publicity catalogue');
 const readme=await readFile(resolve(root,locale==='en'?'README.md':`README.${locale==='zh'?'zh-CN':locale}.md`),'utf8');
 check(!/\b(?:TXT|VTT)\b/i.test(readme)&&readme.includes('SRT'),'SRT-only README claims');
 for(const match of readme.matchAll(/\]\((?!https?:)([^)]+)\)/g)){await access(resolve(root,match[1]));checks++;}
 for(const id of ['hero','lookup','phrases','review'])check((await stat(resolve(root,`docs/media/demo/${id}.gif`))).size<3*1024*1024,`shared GIF under 3 MiB: ${id}`);
 const html=await readFile(resolve(root,locale==='en'?'docs/index.html':`docs/${locale}/index.html`),'utf8');
 const schema=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
 check(schema.softwareVersion===JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).version,`current version ${locale}`);
 for(const f of features){check(html.includes(copy[locale].titles[f.index]),`static SEO text ${locale}/${f.id}`);await access(resolve(root,`docs/media/${locale}/${f.id}.webp`));checks++;}
 await access(resolve(root,`docs/media/${locale}/social.png`));checks++;
 check(!html.includes('Ollama')&&!readme.includes('无需安装'),`no obsolete claims ${locale}`);
}
for(const [timeline,duration] of [[horizontalTimeline,90],[verticalTimeline,30]]){check(timeline[0].start===0,'timeline begins at zero');for(let n=1;n<timeline.length;n++)check(timeline[n].start===timeline[n-1].end,'no timeline gaps');check(timeline.at(-1).end===duration,`timeline duration ${duration}`);}
const typecheck=spawnSync(resolve(root,'marketing/node_modules/.bin/tsc'),['--noEmit'],{cwd:resolve(root,'marketing'),stdio:'inherit'});check(typecheck.status===0,'marketing TypeScript');
console.log(`${checks} marketing content and type checks passed.`);
