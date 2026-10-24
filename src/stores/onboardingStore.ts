import { create } from 'zustand';
import type { SavedRecord } from '../lib/savedRecords';
export type OnboardingOutcome='unseen'|'completed'|'skipped';
export const ONBOARDING_KEY='lexicue-onboarding-v1';
export function readOnboardingOutcome():OnboardingOutcome {
  try {const saved=JSON.parse(localStorage.getItem(ONBOARDING_KEY)??'null');return saved?.version===1&&['completed','skipped'].includes(saved.status)?saved.status:'unseen';}catch{return 'unseen';}
}
export const useOnboardingStore=create<{
  outcome:OnboardingOutcome;active:boolean;step:1|2|3;records:string[];persistError:boolean;
  begin:()=>void;lookedUp:()=>void;recordChanged:(record:SavedRecord)=>void;closed:()=>void;finish:(outcome:'completed'|'skipped')=>void;
}>((set,get)=>({
  outcome:readOnboardingOutcome(),active:false,step:1,records:[],persistError:false,
  begin:()=>set({active:true,step:1,records:[],persistError:false}),
  lookedUp:()=>{if(get().active&&get().step===1)set({step:2});},
  recordChanged:record=>{if(!get().active)return;const records=get().records.filter(id=>id!==record.record_id);if(record.deleted_at===null)records.push(record.record_id);set({records,step:records.length?3:2});},
  closed:()=>{if(get().active&&get().records.length)get().finish('completed');},
  finish:outcome=>{let persistError=false;try{localStorage.setItem(ONBOARDING_KEY,JSON.stringify({version:1,status:outcome}));}catch{persistError=true;}set({outcome,active:false,persistError});},
}));
