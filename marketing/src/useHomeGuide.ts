import {useState,useRef,useEffect} from 'react';
import {guideTargets} from './home-copy.mjs';
const KEY='lexicue-home-guide-v1';
const read=()=>{try{const value=JSON.parse(sessionStorage.getItem(KEY));return Array.isArray(value)?value.filter(k=>Object.hasOwn(guideTargets,k)):[];}catch{return [];}};
export function useHomeGuide(key:string,blocked:boolean,enabled=true){
 const seen=useRef<string[]>(enabled?read():[]);const [active,setActive]=useState<string|null>(()=>!enabled||seen.current.includes(key)?null:key);
 const save=()=>{if(!enabled)return;try{sessionStorage.setItem(KEY,JSON.stringify(seen.current));}catch{}};
 useEffect(()=>{setActive(!enabled||seen.current.includes(key)?null:key);},[key,enabled]);
 useEffect(()=>{if(blocked)setActive(null);},[blocked]);
 const mark=()=>{if(!seen.current.includes(key)){seen.current.push(key);save();}};
 const dismiss=()=>{mark();setActive(null);};
 return {active:blocked||!enabled?null:active,mark,dismiss,show:()=>{if(enabled)setActive(key);},finish:(action:string)=>{if(enabled&&active===action){mark();setActive(null);return true;}return false;},reset:()=>{seen.current=[];save();setActive(enabled?'files':null);}};
}
