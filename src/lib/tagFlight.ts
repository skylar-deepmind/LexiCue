export function playTagFlight(panel: HTMLElement | null, anchor: HTMLElement | null, closing = false) {
  const jobs: Animation[] = [],restore: (()=>void)[]=[];
  if(!panel||!anchor||matchMedia('(prefers-reduced-motion: reduce)').matches)return {jobs,dispose:()=>{}};
  const layer=document.createElement('div');layer.className='approved-tag-flight figma-shell';layer.setAttribute('aria-hidden','true');layer.inert=true;document.body.append(layer);
  const a=anchor.getBoundingClientRect(),point={x:a.x+a.width/2,y:a.y+a.height/2};
  const rail=panel.querySelector('.approved-tag-rail')?.getBoundingClientRect();
  const cards=[...panel.querySelectorAll<HTMLElement>('.approved-tag-stack')].filter(node=>{const r=node.getBoundingClientRect();return r.right>(rail?.left??0)+8&&r.left<(rail?.right??innerWidth)-8;});
  cards.forEach((card,i)=>{
    const r=card.getBoundingClientRect(),copy=card.cloneNode(true) as HTMLElement,visibility=card.style.visibility;
    Object.assign(copy.style,{position:'absolute',left:`${r.x}px`,top:`${r.y}px`,width:`${r.width}px`,height:`${r.height}px`,margin:'0',transform:'none',transformOrigin:'50% 44%',transition:'none'});
    copy.removeAttribute('id');copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));layer.append(copy);
    card.style.visibility='hidden';restore.push(()=>{card.style.visibility=visibility;});
    jobs.push(copy.animate([{transform:`translate(${point.x-r.x-r.width/2}px,${point.y-r.y-r.height*.44}px) rotate(-13deg) scale(.24)`,opacity:.18},{opacity:1,offset:.2},{transform:'none',opacity:1}],{duration:closing?310:430,delay:(closing?cards.length-1-i:i)*32,easing:'cubic-bezier(.22,.68,.22,1)',direction:closing?'reverse':'normal',fill:'both'}));
  });
  const scrim=panel.closest('.overlay-layer')?.querySelector('.overlay-scrim');
  if(scrim)jobs.push(scrim.animate([{opacity:0},{opacity:1}],{duration:closing?310:430,direction:closing?'reverse':'normal',fill:'both'}));
  let disposed=false;const dispose=()=>{if(disposed)return;disposed=true;jobs.forEach(job=>job.cancel());restore.forEach(fn=>fn());layer.remove();window.removeEventListener('resize',dispose);};
  window.addEventListener('resize',dispose,{once:true});void Promise.allSettled(jobs.map(job=>job.finished)).then(dispose);
  return {jobs,dispose};
}
