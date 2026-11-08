import {afterEach,expect,it,vi} from 'vitest';
import {readLibraryView,saveLibraryView} from '../libraryView';
afterEach(()=>vi.unstubAllGlobals());
it('round-trips the pre-reading placement and expanded preview with existing conditions',()=>{
  let stored='';vi.stubGlobal('sessionStorage',{setItem:(_key:string,value:string)=>stored=value,getItem:()=>stored});
  const view={query:'Walk',range:'stored' as const,tagsOpen:true,tagIds:[2],untagged:false,scroll:240,focusId:7,expandedId:7,placement:{width:375,height:812,bottomGap:47}};
  saveLibraryView(view);expect(readLibraryView()).toEqual(view);
});
it('accepts older snapshots and discards invalid geometry/preview ids',()=>{
  vi.stubGlobal('sessionStorage',{getItem:()=>JSON.stringify({query:'Walk',scroll:123,expandedId:-1,placement:{width:375,height:812,bottomGap:900}})});
  expect(readLibraryView()).toMatchObject({query:'Walk',scroll:123,expandedId:null,placement:null});
  vi.stubGlobal('sessionStorage',{getItem:()=>JSON.stringify({query:'Old',scroll:23})});
  expect(readLibraryView()).toMatchObject({query:'Old',scroll:23,expandedId:null,placement:null});
});
