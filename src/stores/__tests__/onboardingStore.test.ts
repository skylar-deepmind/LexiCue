import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ONBOARDING_KEY, readOnboardingOutcome, useOnboardingStore } from '../onboardingStore';
import type { SavedRecord } from '../../lib/savedRecords';
const storage = new Map<string,string>();
const record = (deleted_at:number|null=null)=>({record_id:'example',deleted_at} as SavedRecord);
beforeEach(()=>{storage.clear();vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});useOnboardingStore.setState({outcome:'unseen',active:false,step:1,records:[],persistError:false});});
describe('three-action optional example',()=>{
  it('validates a versioned completion flag without treating corrupt or old state as completed',()=>{
    expect(readOnboardingOutcome()).toBe('unseen');
    for(const value of ['bad','null','{"version":1,"status":"unknown"}','{"version":0,"status":"completed"}']){storage.set(ONBOARDING_KEY,value);expect(readOnboardingOutcome()).toBe('unseen');}
    for(const status of ['completed','skipped']){storage.set(ONBOARDING_KEY,JSON.stringify({version:1,status}));expect(readOnboardingOutcome()).toBe(status);}
  });
  it('completes only after a real save remains and its explanation is closed',()=>{
    const state=()=>useOnboardingStore.getState();state().begin();state().closed();expect(state().active).toBe(true);
    state().lookedUp();expect(state().step).toBe(2);state().recordChanged(record());state().recordChanged(record());expect(state().records).toEqual(['example']);expect(state().step).toBe(3);
    state().recordChanged(record(1));expect(state().step).toBe(2);state().closed();expect(state().active).toBe(true);
    state().recordChanged(record());state().closed();expect(state()).toMatchObject({active:false,outcome:'completed'});expect(readOnboardingOutcome()).toBe('completed');expect(storage.get(ONBOARDING_KEY)).not.toContain('example');
  });
  it.each([1,2,3])('permits skipping action %i without a compulsory save',step=>{
    const state=()=>useOnboardingStore.getState();state().begin();if(step>=2)state().lookedUp();if(step===3)state().recordChanged(record());state().finish('skipped');expect(readOnboardingOutcome()).toBe('skipped');expect(state().active).toBe(false);
  });
  it('replay starts empty without losing a previously remembered outcome',()=>{
    const state=()=>useOnboardingStore.getState();state().finish('completed');state().begin();expect(state()).toMatchObject({active:true,step:1,records:[],outcome:'completed'});expect(readOnboardingOutcome()).toBe('completed');
  });
  it('surfaces storage failure while keeping the app usable',()=>{
    vi.stubGlobal('localStorage',{setItem:()=>{throw Error('quota');},getItem:()=>null});useOnboardingStore.getState().finish('skipped');expect(useOnboardingStore.getState()).toMatchObject({active:false,outcome:'skipped',persistError:true});expect(readOnboardingOutcome()).toBe('unseen');
  });
});
