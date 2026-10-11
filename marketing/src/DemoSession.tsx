import {useState,useEffect} from 'react';
import {initialSession,loadSession,saveSession} from './demo-model.mjs';
export function useDemoSession({isolated=false,module:initialModule='files'}:{isolated?:boolean;module?:string}={}){
 const [session,setSession]=useState<any>(()=>{if(isolated)return {...initialSession(),module:initialModule,selectedTerm:null};let value;try{value=loadSession(sessionStorage);}catch{value=initialSession();}const module=new URLSearchParams(location.search).get('demo');if(['files','reading','vocabulary','review','insights','settings'].includes(module))value.module=module;return value;});
 useEffect(()=>{if(isolated)return;const url=new URL(location.href);if(url.searchParams.has('demo')){url.searchParams.delete('demo');history.replaceState(history.state,'',url.pathname+url.search+url.hash);}},[isolated]);
 useEffect(()=>{if(isolated)return;try{saveSession(sessionStorage,session);}catch{}},[session,isolated]);
 return [session,setSession] as const;
}
