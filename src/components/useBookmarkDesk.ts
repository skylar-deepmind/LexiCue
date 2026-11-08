import {useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {fitBookmarkShelf} from '../lib/bookmarkDesk';

/** Change geometry in place: no cloned list, opacity reset or remounted rows. */
export default function useBookmarkDesk(stackRef:RefObject<HTMLDivElement|null>,shelfRef:RefObject<HTMLDivElement|null>,id:number|undefined,items:number) {
    const [fit,setFit]=useState({count:0,rowHeight:72,height:60});
    const initialized=useRef(false);
    useLayoutEffect(()=>{
        const stack=stackRef.current,shelf=shelfRef.current;
        const content=stack?.closest<HTMLElement>('.reading-stage-content');
        if(!stack||!shelf||!content)return;
        let frame=0,enableFrame=0;
        const align=()=>{
            if(innerWidth>=768){stack.style.removeProperty('height');shelf.style.removeProperty('height');delete content.dataset.bookmarkReady;initialized.current=false;return;}
            const paper=stack.querySelector<HTMLElement>('[data-desk-active="true"]');
            if(!paper)return;
            const style=getComputedStyle(content),height=paper.offsetHeight+8;
            const feedback=shelf.querySelector<HTMLElement>('.desk-feedback')?.offsetHeight??0;
            const available=content.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom)-parseFloat(style.rowGap)-height-feedback;
            const next=fitBookmarkShelf(available,items);
            stack.style.height=`${height}px`;shelf.style.height=`${next.height+feedback}px`;
            shelf.style.setProperty('--shelf-row-height',`${next.rowHeight}px`);
            setFit(previous=>previous.count===next.count&&previous.rowHeight===next.rowHeight&&previous.height===next.height?previous:next);
            if(!initialized.current||content.dataset.bookmarkReady!=='true'){initialized.current=true;cancelAnimationFrame(enableFrame);enableFrame=requestAnimationFrame(()=>{content.dataset.bookmarkReady='true';});}
        };
        const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(align);};
        align();
        const observer=new ResizeObserver(schedule);observer.observe(content);
        stack.querySelectorAll<HTMLElement>(':scope > .desk-card-viewport > .desk-paper').forEach(paper=>observer.observe(paper));
        window.addEventListener('resize',schedule);
        return()=>{observer.disconnect();cancelAnimationFrame(frame);cancelAnimationFrame(enableFrame);window.removeEventListener('resize',schedule);};
    },[stackRef,shelfRef,id,items]);
    return fit;
}
