import {useEffect,useState} from 'react';
import {currentCopy,screenshotScenes,screenshotPath} from './current-copy.mjs';
import {assetUrl} from './routes';
export function CurrentWorkspace({locale,theme}:{locale:string;theme:string}){
 const [mobile,setMobile]=useState(()=>matchMedia('(max-width:650px)').matches);
 useEffect(()=>{const query=matchMedia('(max-width:650px)'),update=()=>setMobile(query.matches);query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
 const [scene,setScene]=useState('materials'),c=currentCopy[locale],index=screenshotScenes.indexOf(scene);
 return <section className="current-workspace" aria-label={String(c.gallery)}>
  <div className="current-scenes" role="group" aria-label={String(c.gallery)}>{screenshotScenes.map(id=><button key={id} type="button" aria-pressed={scene===id} onClick={()=>setScene(id)}>{c[id]}</button>)}</div>
  <figure><a href={assetUrl(screenshotPath(locale,scene,theme,mobile?'mobile':'desktop'))} target="_blank" rel="noopener noreferrer" aria-label={`${c.enlarge} · ${c[scene]}`}><picture><source media="(max-width:650px)" srcSet={assetUrl(screenshotPath(locale,scene,theme,'mobile'))} width="390" height="844"/><img src={assetUrl(screenshotPath(locale,scene,theme))} width="1280" height="850" alt={`${c[scene]} — ${c.screenshots}`}/></picture></a><figcaption>{c.captions[index]}</figcaption></figure>
  <p className="current-provenance">{c.screenshots}</p>
 </section>;
}
