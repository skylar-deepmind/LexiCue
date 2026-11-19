/** Freeze the painted element; its clone never restarts CSS entrance/hover motion. */
export function visualCopy(source: HTMLElement) {
  const copy=source.cloneNode(true) as HTMLElement;
  const originals=[source,...source.querySelectorAll<HTMLElement>('*')],copies=[copy,...copy.querySelectorAll<HTMLElement>('*')];
  originals.forEach((node,i)=>{const style=getComputedStyle(node),target=copies[i];for(const key of style)target.style.setProperty(key,style.getPropertyValue(key));target.removeAttribute('id');target.style.animation='none';target.style.transition='none';target.style.pointerEvents='none';});
  copy.inert=true;copy.setAttribute('aria-hidden','true');return copy;
}


export function restoreScroll(source:HTMLElement,copy:HTMLElement){
 const a=[source,...source.querySelectorAll<HTMLElement>('*')],b=[copy,...copy.querySelectorAll<HTMLElement>('*')];a.forEach((node,i)=>{if(node.scrollTop)b[i].scrollTop=node.scrollTop;if(node.scrollLeft)b[i].scrollLeft=node.scrollLeft;});
}

/** Preserve the source's actual rotated/scaled footprint, including ancestor scale. */
export function paintedCopy(source:HTMLElement) {
 const r=source.getBoundingClientRect(),style=getComputedStyle(source),matrix=new DOMMatrix(style.transform==='none'?undefined:style.transform);
 const width=source.offsetWidth,height=source.offsetHeight,[ox,oy]=style.transformOrigin.split(' ').map(parseFloat);
 const points=[[0,0],[width,0],[0,height],[width,height]].map(([x,y])=>({x:matrix.a*(x-ox)+matrix.c*(y-oy)+ox+matrix.e,y:matrix.b*(x-ox)+matrix.d*(y-oy)+oy+matrix.f}));
 const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),paintWidth=Math.max(...points.map(p=>p.x))-minX;
 const scale=paintWidth?r.width/paintWidth:1,wrapper=document.createElement('div'),inner=document.createElement('div'),copy=visualCopy(source);
 Object.assign(wrapper.style,{position:'absolute',width:`${r.width}px`,height:`${r.height}px`,transformOrigin:'0 0',pointerEvents:'none'});
 Object.assign(inner.style,{position:'absolute',left:`${-minX*scale}px`,top:`${-minY*scale}px`,transform:`scale(${scale})`,transformOrigin:'0 0'});
 Object.assign(copy.style,{position:'relative',left:'0',top:'0',right:'auto',bottom:'auto',width:`${width}px`,height:`${height}px`,margin:'0',visibility:'visible'});
 inner.append(copy);wrapper.append(inner);return wrapper;
}

/** Import previews already have self-contained styles. Keep the label's stage colours. */
export function copyImportCard(source: HTMLElement) {
  const copy = source.cloneNode(true) as HTMLElement;
  const label = source.querySelector<HTMLElement>('.import-edge-label');
  const second = copy.querySelector<HTMLElement>('.import-edge-label');
  if (label && second) {
    const style = getComputedStyle(label);
    for (const key of ['background-color','color','top','left','font','padding','border-radius','height']) {
      second.style.setProperty(key, style.getPropertyValue(key));
    }
  }
  copy.inert = true;
  copy.setAttribute('aria-hidden','true');
  return copy;
}
