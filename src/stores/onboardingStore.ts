import { create } from 'zustand';
import type { SavedRecord } from '../lib/savedRecords';
export type GuideStage='import'|'lookup'|'save'|'tools'|'recall';
export type OnboardingOutcome='unseen'|'completed'|'skipped';
export const ONBOARDING_KEY='lexicue-onboarding-v1';
export function readOnboardingOutcome():OnboardingOutcome {
  try {const saved=JSON.parse(localStorage.getItem(ONBOARDING_KEY)??'null');return saved?.version===1&&['completed','skipped'].includes(saved.status)?saved.status:'unseen';}catch{return 'unseen';}
}
export const useOnboardingStore=create<{
  tour:GuideStage|null;saved:SavedRecord[];setTour:(tour:GuideStage)=>void;
  outcome:OnboardingOutcome;active:boolean;step:1|2|3;records:string[];persistError:boolean;
  begin:(tour?:GuideStage)=>void;lookedUp:()=>void;recordChanged:(record:SavedRecord)=>void;closed:()=>void;finish:(outcome:'completed'|'skipped')=>void;
}>((set,get)=>({
  tour:null,saved:[],setTour:tour=>set({tour}),
  outcome:readOnboardingOutcome(),active:false,step:1,records:[],persistError:false,
  begin:(tour)=>set({active:true,tour:tour??null,saved:[],step:1,records:[],persistError:false}),
  lookedUp:()=>{if(get().active&&get().step===1)set({step:2,...(get().tour==='lookup'?{tour:'save' as const}:{})});},
  recordChanged:record=>{if(!get().active)return;const records=get().records.filter(id=>id!==record.record_id);if(record.deleted_at===null)records.push(record.record_id);const saved=get().saved.filter(item=>item.record_id!==record.record_id);if(record.deleted_at===null)saved.push(record);set({records,saved,step:records.length?3:2});},
  closed:()=>{if(get().active&&!get().tour&&get().records.length)get().finish('completed');},
  finish:outcome=>{let persistError=false;try{localStorage.setItem(ONBOARDING_KEY,JSON.stringify({version:1,status:outcome}));}catch{persistError=true;}set({outcome,active:false,persistError});},
}));
