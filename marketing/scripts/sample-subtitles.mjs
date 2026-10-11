import {FILES,IMPORT_SAMPLE} from '../src/demo-model.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const stamp=milliseconds=>{const seconds=Math.floor(milliseconds/1000);return `00:${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')},${String(milliseconds%1000).padStart(3,'0')}`;};
export async function writeSampleSubtitles(){
 const source=resolve(import.meta.dirname,'../samples'),publicDir=resolve(import.meta.dirname,'../../docs/media/samples');await mkdir(source,{recursive:true});await mkdir(publicDir,{recursive:true});
 for(const file of [...FILES,IMPORT_SAMPLE]){const text=file.lines.map((line,index)=>`${index+1}\n${stamp(index*4000)} --> ${stamp(index*4000+3500)}\n${line}\n`).join('\n');await writeFile(resolve(source,file.name),text);await writeFile(resolve(publicDir,file.name),text);}
}
