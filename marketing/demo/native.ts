import {engine,persist} from './runtime';
const files=new Map<string,File>();
const noop=()=>{};
export async function invoke<T=unknown>(command:string,args:Record<string,any>={}):Promise<T>{
 try{if(command==='check_github_release'){const locale=JSON.parse(localStorage.getItem('lexicue-preferences')||'{}').state?.uiLanguage||'en';throw Error(({en:'App installation and updates are available in the installed app.',zh:'请在安装版应用中下载和更新软件。',ja:'アプリの導入と更新はインストール版で行ってください。',de:'Installation und Updates sind in der installierten App verfügbar.'} as any)[locale]);}const result=engine.invoke(command,args);persist();return result as T;}
 catch(error){throw error;}
}
export const isTauri=()=>false;
export const convertFileSrc=(path:string)=>{if(path.startsWith('blob:'))return path;throw Error('demo_native_file_unavailable');};
export const getVersion=async()=>'0.4.6 · browser demo';
export const getIdentifier=async()=>'com.lexicue.browser.demo';
export const listen=async<T=unknown>(_event:string,_handler?:(event:{payload:T})=>void)=>noop;
export const emit=async()=>{};
export const relaunch=async()=>{throw Error('Browser demo cannot install or restart an application.');};
export const check=async()=>{throw Error('Updates are not available in the browser demo.');};
export const BaseDirectory={AppData:1};
export async function open(options:any={},_fsOptions?:any):Promise<any>{
 if(typeof options==='string'){
  const file=files.get(options);if(!file)throw Error('material_read_failed');let offset=0;
  const bytes=new Uint8Array(await file.arrayBuffer());return {read:async(buffer:Uint8Array)=>{const count=Math.min(buffer.length,bytes.length-offset);buffer.set(bytes.subarray(offset,offset+count));offset+=count;return count||null;},close:async()=>{}};
 }
 return new Promise<string[]|string|null>(resolve=>{
  const input=document.createElement('input');input.type='file';input.multiple=!!options.multiple;
  const exts=options.filters?.flatMap((f:any)=>f.extensions||[])||['pdf','docx','epub','md','markdown','txt','srt','vtt'];input.accept=exts.map((ext:string)=>'.'+ext).join(',');
  input.style.display='none';document.body.append(input);
  const done=(selected:string[]|null)=>{input.remove();resolve(selected&&options.multiple?selected:selected?.[0]??null);};
  input.onchange=()=>{const paths=Array.from(input.files||[]).map(file=>{const path=`/demo-selected/${crypto.randomUUID()}/${file.name}`;files.set(path,file);return path;});done(paths.length?paths:null);};
  input.addEventListener('cancel',()=>done(null),{once:true});input.click();
 });
}
export const save=async(options:any={})=>'/demo-export/'+(options.defaultPath||'lexicue-demo-backup.json');
export async function writeTextFile(path:string,text:string){if(!path.startsWith('/demo-export/'))throw Error('demo_write_blocked');const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=path.split('/').at(-1)!;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function readTextFile(path:string){const file=files.get(path);if(!file)throw Error('demo_read_blocked');return file.text();}
export const readFile=async(path:string)=>{const file=files.get(path);if(!file)throw Error('demo_read_blocked');return new Uint8Array(await file.arrayBuffer());};
export const readText=()=>navigator.clipboard.readText();
export const writeText=(text:string)=>navigator.clipboard.writeText(text);
export async function ask(text:string,_options?:any){return window.confirm(text);}
export async function message(text:string,_options?:any){window.alert(text);}
export const confirm=ask;
export async function openUrl(value:string){const url=new URL(value);if(url.protocol!=='https:')throw Error('demo_link_blocked');window.open(url.href,'_blank','noopener,noreferrer');}
export const getCurrentWindow=()=>({listen,once:listen,onCloseRequested:listen,onDragDropEvent:async(_handler:any)=>noop,setTitle:async()=>{},setSize:async()=>{},hide:async()=>{},show:async()=>{}});
export class LogicalSize{constructor(public width:number,public height:number){}}

export type OpenDialogOptions=any;
export type DownloadEvent=any;
export type Update=any;
