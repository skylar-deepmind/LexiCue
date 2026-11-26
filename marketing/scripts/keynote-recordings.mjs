// Record real interactions in a fresh, disposable copy of the built browser demo.
import {chromium} from 'playwright';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const base = new URL(process.env.LEXICUE_STATIC_URL || 'http://127.0.0.1:4716/');
if (!['localhost', '127.0.0.1'].includes(base.hostname)) throw Error('A local demo server is required');
const out = resolve(import.meta.dirname, '../../docs/media/keynote/motion');
const scratch = await mkdtemp(join(tmpdir(), 'lexicue-keynote-'));
await mkdir(out, {recursive:true});
const browser = await chromium.launch({channel:'chrome', headless:true});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function record(locale, theme, layout) {
  const size = layout === 'phone' ? {width:414, height:526} : {width:832, height:560};
  const context = await browser.newContext({viewport:size, locale});
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const url = new URL('_demo/index.html', base);
  url.search = new URLSearchParams({locale, theme}).toString();
  const file = name => `${locale}-${theme}-${layout}-${name}`;
  async function clip(name, action) {
    const path = join(scratch, file(name)+'.webm');
    await page.screencast.start({path, size});
    await wait(420);
    await action();
    await wait(950);
    await page.screencast.stop();
    execFileSync('ffmpeg', ['-loglevel','error','-y','-i',path,'-an','-c:v','libx264','-crf','20','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart',join(out,file(name)+'.mp4')]);
    console.log(file(name));
  }

  // A visible pointer makes selection and the direction of the pocket gesture legible.
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const dot = document.createElement('div');
      dot.style.cssText = 'position:fixed;top:-10px;left:-10px;width:20px;height:20px;border:2px solid white;box-shadow:0 0 0 2px #26588d,0 3px 8px #0004;border-radius:50%;background:#407fc67d;pointer-events:none;z-index:2147483647;opacity:0';
      document.body.append(dot);
      window.addEventListener('pointermove', e => {dot.style.opacity='1';dot.style.transform=`translate(${e.clientX}px,${e.clientY}px)`;},true);
      window.addEventListener('pointerdown', () => {dot.style.background='#2863b9';},true);
      window.addEventListener('pointerup', () => {dot.style.background='#407fc67d';},true);
    });
  });
  const move = async (x,y) => {await page.mouse.move(x,y,{steps:22});};
  const center = async locator => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    return {x:box.x+box.width/2, y:box.y+box.height/2};
  };
  const tap = async locator => {
    const {x,y}=await center(locator);
    await move(x,y);await wait(230);await page.mouse.down();await wait(90);await page.mouse.up();
  };
  const selected = word => page.locator(`.context-panel[aria-label="${word}"]`);
  try {
    await page.goto(url.href);
    await page.locator('[data-testid=desk-continue]').waitFor();
    // Remove the pre-seeded example record from this recording context, then create it on camera.
    await page.goto(new URL('lexicue-icon.png',base).href);
    await page.evaluate(()=>{
      const key='lexicue-current-demo-v1', data=JSON.parse(sessionStorage.getItem(key));
      data.engine.records=[];data.engine.receipts=[];sessionStorage.setItem(key,JSON.stringify(data));
    });
    await page.goto(url.href);
    const cover=page.locator('[data-testid=desk-continue]');
    await cover.waitFor();
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode().catch(()=>{})));});
    await wait(500);
    await clip('desk',async()=>{
      await tap(cover);
      await page.locator('.reading-word').first().waitFor();
    });
    await clip('lookup',async()=>{
      await tap(page.locator('.reading-word').filter({hasText:/^quiet$/}).first());
      await selected('quiet').locator('.longman-meaning').first().waitFor();
    });
    await page.keyboard.press('Escape');
    await selected('quiet').waitFor({state:'hidden'});
    await clip('memory',async()=>{
      const take=page.locator('.reading-word').filter({hasText:/^take$/}).first();
      await take.scrollIntoViewIfNeeded();
      const a=await take.boundingBox(), b=await page.locator('.reading-word').filter({hasText:/^off$/}).first().boundingBox();
      await move(a.x+1,a.y+a.height/2);await page.mouse.down();await move(b.x+b.width-1,b.y+b.height/2);await page.mouse.up();
      await selected('take off').waitFor();
      await wait(500);
      const sheet=page.locator('[data-sheet-active] [data-sheet-id]'), pocket=page.locator('.quiet-pocket');
      const start=await center(sheet), end=await center(pocket);
      await move(start.x,start.y);await page.mouse.down();await move(end.x,end.y);await wait(160);await page.mouse.up();
      await page.waitForFunction(()=>document.querySelector('.quiet-pocket')?.getAttribute('aria-label')?.endsWith(' · 1'));
      await wait(1050);
      await page.evaluate(()=>location.hash='/files/7');
      const recalled=page.locator('.reading-word[data-recall="take off"]').first();
      await recalled.waitFor();await wait(580);await tap(recalled);
      await selected('take off').waitFor();await wait(320);await tap(pocket);
      await page.getByText(/We take off our coats and sit beside the window/).first().waitFor();
    });
  } finally { await context.close(); }
}
try {
  const [languages='zh,en,ja,de',themes='ocean,midnight',layouts='desktop,phone']=process.argv.slice(2);
  for(const locale of languages.split(',')) for(const theme of themes.split(',')) for(const layout of layouts.split(',')) await record(locale,theme,layout);
} finally { await browser.close(); await rm(scratch,{recursive:true,force:true}); }
