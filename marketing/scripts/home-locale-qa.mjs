import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {experienceCopy} from '../src/experience-copy.mjs';
import {copy} from '../src/catalogue.mjs';
const base=process.env.LEXICUE_STATIC_URL||'http://127.0.0.1:4190/docs/';
const out=resolve(import.meta.dirname,'../../output/marketing/qa/locales');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});let checks=0;const errors=[];
const check=(value,message)=>{assert.ok(value,message);checks++;};
const settle=page=>page.waitForTimeout(220);
const outer=locale=>locale==='zh'?'zh-CN':locale;
const nav=page=>page.locator(page.viewportSize().width<=650?'.sample-mobile-nav button':'.sample-sidebar-nav button');
const pick=async(page,locale)=>{await page.locator(`.language-switch a[lang=${locale}]`).click();await settle(page);};
const localeIs=async(page,locale,module)=>{
 check(await page.evaluate(()=>document.documentElement.lang)===outer(locale),'page language '+locale);
 check(await page.locator('.language-switch a[aria-current=page]').getAttribute('lang')===locale,'navbar language '+locale);
 check(await page.locator('.sample-header h2').textContent()===experienceCopy[locale][module],'sample language '+locale);
};
const session=page=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('lexicue-demo-session-v1')));
try{
 if(!process.env.LEXICUE_LOCALE_SKIP_MATRIX)for(const language of ['en-GB','zh-TW','ja-JP','de-AT'])for(const theme of ['ocean','midnight'])for(const width of [390,1440]){
  const locale=language.split('-')[0],localOnly=locale==='de'?'ja':'de';const context=await browser.newContext({locale:language,viewport:{width,height:1000}});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));let documents=0;page.on('request',request=>{if(request.isNavigationRequest())documents++;});
  await page.addInitScript(value=>localStorage.setItem('lexicue-marketing-theme',value),theme);
  await page.goto(base+'?campaign=locale-test#experience',{waitUntil:'networkidle'});await settle(page);await page.keyboard.press('Escape');
  await localeIs(page,locale,'files');check(documents===1,'browser default does not reload document');check(new URL(page.url()).searchParams.get('campaign')==='locale-test'&&new URL(page.url()).hash==='#experience','automatic locale keeps parameters and anchor');
  check(await page.locator('.hero-intro').textContent()===copy[locale].intro,'browser language translates whole homepage');check(await page.locator('.sandbox').getAttribute('data-theme')===theme,'browser language retains theme');
  await nav(page).last().click();await page.keyboard.press('Escape');const beforeTitle=await page.title(),beforeUrl=page.url();
  await page.locator(`#sample-setting-language button`).filter({hasText:localOnly==='de'?'Deutsch':'日本語'}).click();await settle(page);
  check(await page.locator('.sample-header h2').textContent()===experienceCopy[localOnly].settings,'sample-only choice changes sample');check(await page.title()===beforeTitle&&page.url()===beforeUrl,'sample-only choice leaves outer page and URL');check(await page.evaluate(()=>document.documentElement.lang)===outer(locale),'sample-only choice leaves page language');
  await page.reload({waitUntil:'networkidle'});await settle(page);check(await page.locator('.sample-header h2').textContent()===experienceCopy[localOnly].settings,'refresh retains local sample override');check(await page.evaluate(()=>document.documentElement.lang)===outer(locale),'refresh retains website language');
  await page.locator('.sandbox').evaluate(element=>element.dataset.localeMount='retained');
  const initialDocuments=documents;await pick(page,locale);await localeIs(page,locale,'settings');check((await session(page)).uiLocale===null,'clicking current navbar locale clears local override');check(documents===initialDocuments,'same-locale selection stays in place');
  await page.locator('#sample-setting-language button').filter({hasText:localOnly==='de'?'Deutsch':'日本語'}).click();
  await nav(page).first().click();await page.keyboard.press('Escape');await page.locator('.sample-file-open').first().click();await page.keyboard.press('Escape');await page.locator('.sample-segments [role=button]').filter({hasText:'meaningful'}).click();await page.locator('.sample-statuses button').nth(2).click();
  const previous=await session(page),scroll=await page.evaluate(()=>({y:scrollY,inner:document.querySelector('.sample-content').scrollTop}));
  const next=locale==='ja'?'en':'ja';await pick(page,next);await localeIs(page,next,'reading');
  check(await page.locator('.sample-detail-heading h3').textContent()==='meaningful','navbar selection keeps open lookup');check(await page.locator('.sample-definition-text').textContent()===({ja:'意味のある、価値のある。',en:'Having real importance or value.'})[next],'navbar selection translates lookup');
  const current=await session(page);check(current.module===previous.module&&current.fileId===previous.fileId&&current.selectedTerm===previous.selectedTerm&&JSON.stringify(current.statuses)===JSON.stringify(previous.statuses)&&JSON.stringify(current.tags)===JSON.stringify(previous.tags),'navbar selection preserves sample records');
  check(await page.locator('.sandbox').getAttribute('data-locale-mount')==='retained','navbar selection does not remount demo');check(await page.locator('.sample-content').evaluate(element=>element.scrollTop)===scroll.inner,'navbar selection keeps demo scroll');check(documents===initialDocuments,'navbar selection never reloads document');
  await page.reload({waitUntil:'networkidle'});await settle(page);await localeIs(page,next,'reading');check((await session(page)).statuses[3]==='known','refresh retains changed learning state');check(await page.locator('.sample-detail-overlay').count()===1,'refresh retains lookup');await page.keyboard.press('Escape');await page.locator('.sample-detail-overlay').waitFor({state:'hidden'});
  await page.goBack();await settle(page);await localeIs(page,locale,'reading');await page.goForward();await settle(page);await localeIs(page,next,'reading');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'locale changes do not overflow');await context.close();if(width===1440)console.log(`Languages verified: ${language}/${theme}`);
 }
 const context=await browser.newContext({locale:'fr-FR'}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>Object.defineProperty(navigator,'languages',{get:()=>['fr-FR','de-DE','en']}));await page.goto(base,{waitUntil:'networkidle'});await localeIs(page,'de','files');
 await pick(page,'en');await page.reload({waitUntil:'networkidle'});await localeIs(page,'en','files');
 await page.goto(base+'?lang=en',{waitUntil:'networkidle'});await localeIs(page,'en','files');
 await page.goto(base+'zh/',{waitUntil:'networkidle'});await localeIs(page,'zh','files');
 await page.goto(base+'guide/reading/',{waitUntil:'networkidle'});check(await page.evaluate(()=>document.documentElement.lang)==='en','manual language remains unchanged');
 await page.goto(base,{waitUntil:'networkidle'});await localeIs(page,'en','files');await page.keyboard.press('Escape');await nav(page).last().click();await page.locator('#sample-setting-language button').filter({hasText:'日本語'}).click();await page.locator('.site-nav>nav a[href$="#download"]').click();await page.waitForTimeout(700);await page.goBack();await settle(page);check(await page.locator('.sample-header h2').textContent()===experienceCopy.ja.settings,'same-language anchor history keeps local override');await context.close();
 const blocked=await browser.newContext({locale:'zh-HK'}),p=await blocked.newPage();p.on('pageerror',error=>errors.push(error.message));
 await p.addInitScript(()=>{Object.defineProperty(window,'sessionStorage',{get(){throw Error('blocked');}});Object.defineProperty(window,'localStorage',{get(){throw Error('blocked');}});});
 await p.goto(base+'#experience',{waitUntil:'networkidle'});await localeIs(p,'zh','files');await p.keyboard.press('Escape');await nav(p).last().click();await p.locator('#sample-setting-language button').filter({hasText:'Deutsch'}).click();check(await p.locator('.sample-header h2').textContent()==='Einstellungen','local language works without storage');await pick(p,'en');await localeIs(p,'en','settings');await p.reload({waitUntil:'networkidle'});await localeIs(p,'en','files');await blocked.close();
 check(!errors.length,'browser errors: '+errors.join(';'));await writeFile(resolve(out,process.env.LEXICUE_LOCALE_SKIP_MATRIX?'boundaries.json':'report.json'),JSON.stringify({checks,errors},null,2));console.log(`${checks} homepage language checks passed.`);
}finally{await browser.close();}
