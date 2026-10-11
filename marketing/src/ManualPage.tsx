import {useLayoutEffect,useMemo,useRef,useState} from 'react';
import {ChevronLeft,ChevronRight,X} from 'lucide-react';
import {experienceCopy,guides} from './experience-copy.mjs';
import {manualContent,manualLabels} from './manual-content.mjs';
import {renderManualSections,renderManualToc} from './manual-render.mjs';
import {assetUrl,guideUrl,homeUrl} from './routes';

export function ManualPage({chapter,locale,theme}:{chapter:any;locale:string;theme:string}){
 const u=experienceCopy[locale],labels=manualLabels[locale],data=manualContent[locale][chapter.id],chapters=guides[locale],index=chapters.findIndex(item=>item.id===chapter.id),previous=chapters[index-1],next=chapters[index+1];
 // Stable HTML props preserve the clicked link while the lightbox changes state.
 const articleHTML=useMemo(()=>({__html:renderManualSections(locale,chapter.id,homeUrl(locale),assetUrl(''),id=>guideUrl(locale,id))}),[locale,chapter.id]);
 const tocHTML=useMemo(()=>({__html:renderManualToc(locale,chapter.id)}),[locale,chapter.id]);
 const [image,setImage]=useState<{src:string;alt:string}|null>(null),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLElement|null>(null);
 useLayoutEffect(()=>{if(!image)return;const element=dialog.current;const previousOverflow=document.body.style.overflow;element?.showModal();document.body.style.overflow='hidden';return()=>{element?.close();document.body.style.overflow=previousOverflow;requestAnimationFrame(()=>trigger.current?.focus({preventScroll:true}));};},[image]);
 const chapterList=<nav aria-label={u.chapters}>{chapters.map((item,i)=><span key={item.id}>{[0,1,6].includes(i)&&<strong className="doc-nav-group">{labels.groups[i===0?0:i===1?1:2]}</strong>}<a href={guideUrl(locale,item.id)} aria-current={chapter.id===item.id?'page':undefined}>{item.title}</a></span>)}</nav>;
 return <main id="main" className="manual-layout"><aside className="manual-sidebar"><h2>{u.manual}</h2>{chapterList}</aside><article className="manual-article">
  <details className="manual-mobile-menu"><summary>{u.chapters}</summary>{chapterList}</details>
  <h1>{chapter.title}</h1><p className="manual-intro">{data.intro}</p>
  <details className="doc-mobile-toc"><summary>{labels.toc}</summary><nav aria-label={labels.toc} dangerouslySetInnerHTML={tocHTML}/></details>
  <div className="doc-body" dangerouslySetInnerHTML={articleHTML} onClick={event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;const link=(event.target as HTMLElement).closest<HTMLAnchorElement>('[data-doc-image]');if(!link)return;const picture=link.querySelector<HTMLImageElement>(theme==='midnight'?'.doc-image-dark':'.doc-image-light');if(!picture)return;event.preventDefault();trigger.current=link;setImage({src:picture.src,alt:picture.alt});}}/>
  <nav className="manual-chapter-links" aria-label={u.chapters}>{previous?<a href={guideUrl(locale,previous.id)}><ChevronLeft size={17}/>{previous.title}</a>:<span/>}{next&&<a href={guideUrl(locale,next.id)}>{next.title}<ChevronRight size={17}/></a>}</nav>
 </article><aside className="doc-toc"><h2>{labels.toc}</h2><nav aria-label={labels.toc} dangerouslySetInnerHTML={tocHTML}/></aside>
 {image&&<dialog ref={dialog} className="doc-lightbox" aria-label={labels.enlarge} onCancel={e=>{e.preventDefault();setImage(null);}} onClick={e=>{if(e.target===e.currentTarget)setImage(null);}}><button className="ui-button" autoFocus aria-label={labels.close} onClick={()=>setImage(null)}><X size={22}/></button><img src={image.src} alt={image.alt}/></dialog>}
 </main>;
}
