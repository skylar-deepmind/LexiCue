// Read-only fixtures for screenshots of installed-product components.
// These aliases exist only in marketing builds; every write is blocked.
import {create} from 'zustand';
import {version} from './version.mjs';
const blocked=()=>{throw new Error('Product screenshot adapter blocks writes and native I/O');};
const noop=()=>{};
export const getVersion=async()=>version;
export const ask=async()=>false,open=async()=>null,save=async()=>null;
export const openUrl=blocked,writeTextFile=blocked;
export const listen=async()=>noop;
export const useFileStore=create<any>(()=>({tags:[],selectedTagIds:[],untaggedOnly:false,loadingTags:false,tagsError:null,setTagFilter:noop,loadTags:async()=>{},importDictionaryPack:blocked}));
export const useAiStore=create<any>(()=>({enabled:false,provider:'gemma',baseUrl:'',model:'',apiKey:'',aiStatus:'idle',aiModels:[],aiError:null,aiFingerprint:null,setEnabled:noop,setProvider:noop,setBaseUrl:noop,selectBaseUrl:noop,setModel:noop,setApiKey:noop,resetAiCheck:noop}));
export const useUpdateStore=create<any>(()=>({status:'idle',version:null,notes:null,progress:null,error:null,downloadUrl:null,check:blocked,install:blocked}));
export const useYoutubeStore=create<any>(()=>({recheckEnvironment:async()=>{},environment:null}));
export const useFeedbackStore=create<any>(()=>({show:noop}));
export const useModelDownloadStore=create<any>(()=>({environment:null,environmentLoading:false,environmentError:null,installedInfo:[],deletion:null,deleteFailure:null,deleteError:null,activity:{},installedModels:[],installedError:null,installedLoading:false,download:null}));
export const OPENAI_PRESETS=[{label:'OpenAI',baseUrl:'https://api.openai.com/v1'},{key:'custom',label:'Custom',baseUrl:''}];
export const getAiConfig=()=>({provider:'gemma',model:''});
export const getAiConnectionFingerprint=()=>'',aiModelLabel=(model:string)=>model;
export const checkAiConnection=async()=>{},ensureAiConnection=async()=>{};
export const cancelModelDownload=blocked,deleteGemmaModel=blocked,downloadGemmaModel=blocked,selectInstalledGemmaModel=blocked;
export const initializeLocalActivity=async()=>{},loadLocalAiEnvironment=async()=>{},refreshInstalledModels=async()=>{},localModelOperationsBusy=()=>false;
export const syncCoordinator={runNow:blocked};
export function screenshotCommand(command:string){
 if(command==='get_frequency_baseline')return {language:'en',tier:null,enabled:false,marked_count:0,pending_count:0,pack_version:'sample',license:'CC0'};
 if(command==='sync_status')return {configured:false,email:null,last_synced_at:null,pending_uploads:0,pending_downloads:0,conflicts:0,auto_sync_enabled:false,phase:'idle',last_error:null,progress:null,diagnostic:null};
 if(command==='youtube_ytdlp_status')return {available:true,version:'sample',path:null,javascript:'ready',ejs:'available',ffmpeg:'ready'};
 if(command==='list_dictionary_sources')return [];
 if(command==='get_storage_usage')return {total:16384,components:[{key:'database',bytes:16384}],database_breakdown:{user_data:16384,builtin_dictionaries:0,dictionary_entries:0}};
 throw new Error(`Product screenshot adapter blocks command: ${command}`);
}
