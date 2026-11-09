import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryStorage} from './engine.mjs';
test('runtime uses one per-tab namespace without reading or changing product storage',async()=>{
 const realLocal=memoryStorage(),realSession=memoryStorage();realLocal.setItem('lexicue-preferences','PRIVATE');realSession.setItem('lexicue-library-view-v1','PRIVATE SESSION');
 globalThis.window={localStorage:realLocal,sessionStorage:realSession};let reloads=0;globalThis.location={reload(){reloads++;}};
 const runtime=await import('./runtime.ts?test=isolated');
 assert.equal(runtime.firstSession,true);assert.equal(window.localStorage.getItem('lexicue-preferences'),null);assert.equal(window.sessionStorage.getItem('lexicue-library-view-v1'),null);
 window.localStorage.setItem('lexicue-theme','midnight');runtime.engine.materials[0].material.name='Temporary title';runtime.persist();
 assert.equal(realLocal.getItem('lexicue-preferences'),'PRIVATE');assert.equal(realSession.getItem('lexicue-library-view-v1'),'PRIVATE SESSION');
 const saved=JSON.parse(realSession.getItem('lexicue-current-demo-v1'));assert.equal(saved.local['lexicue-theme'],'midnight');assert.equal(saved.engine.materials[0].material.name,'Temporary title');
 globalThis.window={localStorage:realLocal,sessionStorage:realSession};
 const reloaded=await import('./runtime.ts?test=reloaded');assert.equal(reloaded.firstSession,false);assert.equal(reloaded.engine.materials[0].material.name,'Temporary title');assert.equal(window.localStorage.getItem('lexicue-theme'),'midnight');
 reloaded.resetDemo();assert.equal(realSession.getItem('lexicue-current-demo-v1'),null);assert.equal(realSession.getItem('lexicue-library-view-v1'),'PRIVATE SESSION');assert.equal(reloads,1);
});
test('truthy corrupt and older snapshots produce a clean first session',async()=>{
 for(const [index,bad]of [{version:0,engine:{}},{version:1,engine:{materials:[],records:[]}},'broken-json'].entries()){
  const storage=memoryStorage();storage.setItem('lexicue-current-demo-v1',typeof bad==='string'?bad:JSON.stringify(bad));globalThis.window={sessionStorage:storage};
  const runtime=await import(`./runtime.ts?invalid=${index}`);assert.equal(runtime.firstSession,true);assert.equal(runtime.engine.materials.length,3);assert.equal(runtime.engine.active().length,1);
 }
});
