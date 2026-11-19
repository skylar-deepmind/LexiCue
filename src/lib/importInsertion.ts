import { visualCopy } from './visualSnapshot';
let active = () => {};
type Flight = { layer: HTMLElement; copy: HTMLElement; box: DOMRect; source: HTMLElement; visibility: string; dispose: () => void };
export function captureImportInsertion(source: HTMLElement | null): Flight | null {
  active();
  if (!source || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const box=source.getBoundingClientRect(),copy=visualCopy(source),layer=document.createElement('div'),visibility=source.style.visibility;
  layer.className='import-insertion-flight b-shell figma-shell';layer.inert=true;layer.setAttribute('aria-hidden','true');
  Object.assign(copy.style,{position:'absolute',left:`${box.x}px`,top:`${box.y}px`,width:`${box.width}px`,height:`${box.height}px`,margin:'0',transform:'none',transformOrigin:'0 0',willChange:'transform'});
  layer.append(copy);document.body.append(layer);source.style.visibility='hidden';
  const dispose=()=>{layer.remove();if(source.isConnected)source.style.visibility=visibility;};
  const flight={layer,copy,box,source,visibility,dispose};active=dispose;return flight;
}
export async function finishImportInsertion(flight: Flight|null, fileId: number) {
  let target:HTMLElement|null=null;
  const deadline=performance.now()+1400;
  while(!target&&performance.now()<deadline&&!document.hidden){target=document.querySelector<HTMLElement>(`.approved-card[data-motion-file="${fileId}"][data-desk-active="true"]`);if(!target)await new Promise<void>(done=>requestAnimationFrame(()=>done()));}
  if(!target||!flight||!flight.layer.isConnected){flight?.dispose();return;}
  const box=target.getBoundingClientRect(),visibility=target.style.visibility;
  target.style.visibility='hidden';
  const dx=box.x-flight.box.x,dy=box.y-flight.box.y,sx=box.width/flight.box.width,sy=box.height/flight.box.height;
  let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;clearTimeout(timer);animation.cancel();flight.dispose();if(target?.isConnected)target.style.visibility=visibility;window.removeEventListener('resize',dispose);document.removeEventListener('visibilitychange',hidden);if(active===dispose)active=()=>{};};
  const hidden=()=>{if(document.hidden)dispose();};
  const animation=flight.copy.animate([
    {transform:'none'},
    {transform:`translate(${dx*.25}px,${dy*.25-46}px) rotate(-5deg) scale(.94)`,offset:.28},
    {transform:`translate(${dx}px,${dy+14}px) rotate(1.2deg) scale(${sx},${sy})`,offset:.8},
    {transform:`translate(${dx}px,${dy}px) rotate(0deg) scale(${sx},${sy})`},
  ],{duration:680,easing:'cubic-bezier(.2,.75,.2,1)',fill:'both'});
  const timer=setTimeout(dispose,900);active=dispose;
  window.addEventListener('resize',dispose,{once:true});document.addEventListener('visibilitychange',hidden);
  void animation.finished.then(()=>{dispose();if(!document.hidden)target?.querySelector<HTMLButtonElement>('.approved-card-open')?.focus({preventScroll:true});}).catch(dispose);
}
