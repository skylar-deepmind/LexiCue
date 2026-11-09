import {afterEach,expect,it,vi} from 'vitest';
import {readLibraryView,saveLibraryView} from '../libraryView';
afterEach(()=>vi.unstubAllGlobals());
it('round-trips the expanded preview with existing conditions',()=>{
  let stored='';vi.stubGlobal('sessionStorage',{setItem:(_key:string,value:string)=>stored=value,getItem:()=>stored});
  const view={query:'Walk',range:'stored' as const,tagsOpen:true,tagIds:[2],untagged:false,scroll:240,focusId:7,expandedId:7};
  saveLibraryView(view);expect(readLibraryView()).toEqual(view);
});
it('accepts older snapshots and ignores saved viewport geometry and invalid preview ids',()=>{
  vi.stubGlobal('sessionStorage',{getItem:()=>JSON.stringify({query:'Walk',scroll:123,expandedId:-1,placement:{width:375,height:812,bottomGap:400}})});
  expect(readLibraryView()).toMatchObject({query:'Walk',scroll:123,expandedId:null});
  expect(readLibraryView()).not.toHaveProperty('placement');
  vi.stubGlobal('sessionStorage',{getItem:()=>JSON.stringify({query:'Old',scroll:23})});
  expect(readLibraryView()).toMatchObject({query:'Old',scroll:23,expandedId:null});
});
