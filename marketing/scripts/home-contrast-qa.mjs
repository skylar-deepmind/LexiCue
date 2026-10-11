import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.env.LEXICUE_STATIC_URL||'http://127.0.0.1:4190/docs/';
const out=resolve(import.meta.dirname,'../../output/marketing/qa/home-revision');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});let checks=0;
const check=(v,label)=>{assert.ok(v,label);checks++;};
async function contrast(locator,shaded=false){return locator.evaluate((el,shaded)=>{
 const ctx=document.createElement('canvas').getContext('2d');ctx.canvas.width=ctx.canvas.height=1;
 const rgba=c=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=c;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
 let node=el,bg;while(node){const value=rgba(getComputedStyle(node).backgroundColor);if(value[3]===255){bg=value;break;}node=node.parentElement;}bg??=[255,255,255,255];let text=rgba(getComputedStyle(el).color);
 if(shaded){const probe=document.createElement('span');probe.style.background='var(--guide-shade)';el.closest('.sandbox').append(probe);const tint=rgba(getComputedStyle(probe).backgroundColor);probe.remove();const alpha=tint[3]/255;const mix=c=>c.map((v,i)=>i<3?v*(1-alpha)+tint[i]*alpha:v);text=mix(text);bg=mix(bg);}
 const lum=c=>c.slice(0,3).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);return (Math.max(lum(text),lum(bg))+.05)/(Math.min(lum(text),lum(bg))+.05);
 },shaded);}
try{
 for(const outer of ['ocean','midnight'])for(const product of ['ocean','sage','twilight','amber','midnight']){
  const p=await browser.newPage({viewport:{width:1440,height:1000}});await p.addInitScript(({outer,product})=>{localStorage.setItem('lexicue-marketing-theme',outer);const s=JSON.parse(sessionStorage.getItem('lexicue-demo-session-v1')||'null');if(s){s.theme=product;sessionStorage.setItem('lexicue-demo-session-v1',JSON.stringify(s));}},{outer,product});await p.goto(base+'zh/#experience',{waitUntil:'networkidle'});
  await p.locator('.sandbox').evaluate((el,product)=>el.dataset.theme=product,product);
  await p.locator('.home-guide-tip').waitFor();await p.waitForTimeout(240);
  for(const selector of ['.sample-file-open p','.sample-header h2','.sample-utilities button','.sample-nav-item[aria-current=page]']){const ratio=await contrast(p.locator(selector).first(),true);check(ratio>=4.5,`readable behind guidance ${outer}/${product}/${selector}: ${ratio}`);}
  check(await contrast(p.locator('.home-guide-tip p'))>=4.5,'tip text contrast');await p.locator('.home-guide-tip button').focus();check(await p.locator('.home-guide-tip button').evaluate(el=>el.matches(':focus-visible')&&parseFloat(getComputedStyle(el).outlineWidth)>=2),'tip keyboard focus');await p.keyboard.press('Escape');check(await p.locator('.home-guide-tip').count()===0,'keyboard dismiss');
  await p.locator('.sample-sidebar-nav button').last().click();await p.keyboard.press('Escape');await p.locator(`[data-swatch=${product}]`).click();await p.locator('#sample-setting-sync>summary').click();await p.locator('.sync-illustration').scrollIntoViewIfNeeded();await p.waitForTimeout(240);
  for(const selector of ['.sync-status','.sync-benefit','.sync-transfer>span','.sync-illustration>.sample-muted','.sync-controls .ui-button']){check(await contrast(p.locator(selector).first())>=4.5,'sync text/control contrast '+selector+product);}
  await p.locator('.sync-controls button').first().hover();check(await contrast(p.locator('.sync-controls button').first())>=4.5,'sync hover contrast');await p.locator('.sync-controls button').first().focus();await p.keyboard.press('Tab');check(await p.locator('.sync-controls button').last().evaluate(el=>el.matches(':focus-visible')&&parseFloat(getComputedStyle(el).outlineWidth)>=2),'sync focus');
  await p.close();
 }
 await writeFile(resolve(out,'contrast.json'),JSON.stringify({checks},null,2));console.log(`${checks} focused-guide/sync contrast checks passed.`);
}finally{await browser.close();}
