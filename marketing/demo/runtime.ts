import {DemoEngine,memoryStorage,validSnapshot} from './engine.mjs';
const KEY='lexicue-current-demo-v1';
let backing:Storage|null=null,initial:any=null;
try{backing=window.sessionStorage;initial=JSON.parse(backing.getItem(KEY)||'null');}catch{/* The in-memory demo also works when browser storage is blocked. */}
if(!validSnapshot(initial))initial=null;
export const engine=new DemoEngine();
if(initial){
 for(const key of ['next','tick','materials','records','tags'])if(initial.engine[key]!==undefined)(engine as any)[key]=initial.engine[key];
 for(const key of ['receipts','operations','jobs'])(engine as any)[key]=new Map(initial.engine[key]||[]);
}
const local=memoryStorage(),session=memoryStorage();
for(const [key,value]of Object.entries(initial?.local||{}))local.setItem(key,value);
for(const [key,value]of Object.entries(initial?.session||{}))session.setItem(key,value);
const dump=(storage:any)=>Object.fromEntries(Array.from({length:storage.length},(_,i)=>storage.key(i)).map(k=>[k,storage.getItem(k)]));
export function persist(){try{backing?.setItem(KEY,JSON.stringify({version:1,engine:{next:engine.next,tick:engine.tick,materials:engine.materials,records:engine.records,tags:engine.tags,receipts:[...engine.receipts],operations:[...engine.operations],jobs:[...engine.jobs]},local:dump(local),session:dump(session)}));}catch{/* Keep the current experience usable if the per-tab quota is exceeded. */}}
function wrapped(storage:any){return {get length(){return storage.length;},key:(i:number)=>storage.key(i),getItem:(k:string)=>storage.getItem(k),setItem:(k:string,v:string)=>{storage.setItem(k,v);persist();},removeItem:(k:string)=>{storage.removeItem(k);persist();},clear:()=>{storage.clear();persist();}};}
Object.defineProperty(window,'localStorage',{configurable:true,value:wrapped(local)});
Object.defineProperty(window,'sessionStorage',{configurable:true,value:wrapped(session)});
export function resetDemo(){try{backing?.removeItem(KEY);}catch{}location.reload();}
export const firstSession=!initial;
