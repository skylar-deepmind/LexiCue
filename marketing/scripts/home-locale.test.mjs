import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserLocale,initialHomeLocale,rememberHomeLocale,HOME_LOCALE_KEY} from '../src/home-locale.mjs';
test('browser language negotiation supports regional variants and ordered preferences',()=>{
 for(const [languages,expected] of [[['zh-TW'],'zh'],[['ja-JP'],'ja'],[['de-AT'],'de'],[['EN_gb'],'en'],[['fr-FR','de-DE','en'],'de'],[['fr','es'],'en'],[[],'en']])assert.equal(browserLocale(languages),expected);
});
test('default entrance follows the browser while chosen locales survive refresh and return',()=>{
 const route={locale:'en',explicitLocale:false,chapter:null};assert.equal(initialHomeLocale(route,['ja-JP']),'ja');
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 rememberHomeLocale('en',storage);assert.equal(values.get(HOME_LOCALE_KEY),'en');assert.equal(initialHomeLocale(route,['ja-JP'],storage),'en');
 assert.equal(initialHomeLocale(route,['ja-JP'],storage,{lexicueLocale:'de'}),'de');
 values.set(HOME_LOCALE_KEY,'unsupported');assert.equal(initialHomeLocale(route,['zh-HK'],storage),'zh');
});
test('deliberate localized links and manuals preserve their requested language',()=>{
 const storage={getItem:()=> 'ja'};assert.equal(initialHomeLocale({locale:'de',explicitLocale:true,chapter:null},['zh'],storage),'de');
 assert.equal(initialHomeLocale({locale:'en',explicitLocale:false,chapter:'reading'},['zh'],storage),'en');
});
test('blocked storage permits browser negotiation and manual selection',()=>{
 const storage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
 assert.equal(initialHomeLocale({locale:'en',explicitLocale:false,chapter:null},['de-DE'],storage),'de');assert.doesNotThrow(()=>rememberHomeLocale('ja',storage));
});
