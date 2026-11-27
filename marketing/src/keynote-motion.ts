const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));
const smooth=(value:number)=>value*value*(3-2*value);

export function mountKeynote(root: HTMLElement) {
  const tour=root.querySelector<HTMLElement>('.kn-tour')!;
  const pin=tour.querySelector<HTMLElement>('.kn-pin')!;
  const stories=[...tour.querySelectorAll<HTMLElement>('.kn-story')];
  const links=[...tour.querySelectorAll<HTMLAnchorElement>('.kn-index a')];
  const titles=[...pin.querySelectorAll<HTMLElement>('.kn-titles span')];
  const views=[...pin.querySelectorAll<HTMLElement>('.kn-view')];
  const images=views.map(v=>v.querySelector('img')!);
  const words=[...pin.querySelectorAll<HTMLElement>('.kn-words')];
  const wings=[...pin.querySelectorAll<HTMLElement>('.kn-wing')];
  const hear=pin.querySelector<HTMLButtonElement>('.kn-hear')!;
  const voice=pin.querySelector<HTMLAudioElement>('audio')!;
  const hero=root.querySelector<HTMLElement>('.kn-hero')!;
  const nav=document.querySelector<HTMLElement>('.site-nav')!;
  const reduced=matchMedia('(prefers-reduced-motion:reduce)');
  const phone=matchMedia('(max-width:760px)');
  const controller=new AbortController();
  const options={signal:controller.signal};
  let frame=0, start=0, span=1, header=0, heroHeight=1;
  let cursor=NaN, lastTime=0, active=-1, held=-1, wasVisible=false;

  function schedule() { if (!frame) frame=requestAnimationFrame(paint); }
  function layout() {
    header=nav.getBoundingClientRect().height;
    tour.style.setProperty('--kn-nav',header+'px');
    const first=stories[0].getBoundingClientRect();
    start=scrollY+first.top-header;
    span=Math.max(1,first.height);
    heroHeight=Math.max(1,hero.offsetHeight);
    schedule();
  }
  function stopVoice() {voice.pause();voice.currentTime=0;}
  function syncSound() {
    const talking=!voice.paused && !voice.ended;
    hear.setAttribute('aria-pressed',String(talking));
    hear.setAttribute('aria-label',(talking?hear.dataset.active:hear.dataset.idle)!);
  }
  hear.addEventListener('click',()=>{
    if (!voice.paused) stopVoice();
    else {voice.currentTime=0;void voice.play().catch(syncSound);}
  },options);
  for(const event of ['play','pause','ended','error']) voice.addEventListener(event,syncSound,options);
  for(const image of images) image.addEventListener('load',schedule,options);

  function media(index:number, visible:boolean) {
    for(const [i,image] of images.entries()) {
      // Predecode the neighbouring takes. A take keeps the same image and clock
      // from its first pixels on screen until it has completely left the stage.
      if(visible && Math.abs(index-i)<=(reduced.matches?0:1)) {
        const base=phone.matches?image.dataset.phone:image.dataset.desktop;
        const src=base+(reduced.matches?'-still.webp':'.webp');
        if(image.getAttribute('src')!==src) image.src=src;
      } else if(image.hasAttribute('src') && (!visible || i!==held || reduced.matches)) {
        image.removeAttribute('src');
      }
    }
  }
  function paint(now:number) {
    frame=0;
    const y=window.scrollY, last=views.length-1;
    hero.style.setProperty('--kn-travel',reduced.matches?'0':clamp(y/heroHeight).toFixed(3));
    const visible=!document.hidden && y>start-innerHeight && y<start+(last+1)*span+header;
    const target=clamp((y-start)/span,0,last);
    const snap=reduced.matches || !wasVisible || !visible || !Number.isFinite(cursor);
    if(snap) cursor=target;
    else {
      // Only ease the camera. Native page scrolling and fragment navigation keep their normal timing.
      const delta=Math.min(64,Math.max(1,now-lastTime));
      cursor+=(target-cursor)*(1-Math.exp(-delta/62));
      if(Math.abs(target-cursor)<.0007) cursor=target;
    }
    lastTime=now;
    const index=Math.round(cursor);
    if(active!==index) {
      active=index;
      stories.forEach((story,i)=>{
        story.toggleAttribute('data-current',i===index);
        if(i===index) links[i].setAttribute('aria-current','step');
        else links[i].removeAttribute('aria-current');
        views[i].classList.toggle('is-current',i===index);
        views[i].setAttribute('aria-hidden',String(i!==index));
      });
    }
    hear.hidden=!visible || stories[index].id!=='listen';
    if(hear.hidden && !voice.paused) stopVoice();
    media(index,visible);
    wasVisible=visible;
    if(!visible) return;

    const from=Math.floor(cursor), to=Math.min(last,from+1);
    const part=cursor-from;
    const mix=reduced.matches?Number(part>=.5):smooth(clamp((part-.25)/.50));
    const nextReady=images[to].complete && images[to].naturalWidth>0;
    const prevReady=images[from].complete && images[from].naturalWidth>0;
    const holdPrevious=!prevReady && !nextReady && held>=0 && !reduced.matches;
    // Hold the decoded exposure on a slow connection. An opaque base also
    // prevents a dip in brightness halfway through the optical overlap.
    let imageMix=nextReady?mix:0;
    if(!prevReady && nextReady) imageMix=1;
    if(nextReady && (imageMix>=.5 || !prevReady)) held=to;
    else if(prevReady) held=from;
    views.forEach((view,i)=>{
      const outgoing=i===from, incoming=i===to && to!==from;
      const exposure=outgoing?Number(imageMix<1 || from===to):incoming?imageMix:0;
      view.style.opacity=String(holdPrevious?Number(i===held):exposure);
      const offset=outgoing?-mix:1-mix;
      if(outgoing || incoming) view.style.transform=reduced.matches?'none':
        'translate3d(0,'+(offset*2.6).toFixed(3)+'%,0) scale('+(1.015-offset*.025).toFixed(4)+')';

      const currentTitle=(outgoing && (from===to || mix<1)) || (incoming && mix>0);
      titles[i].style.opacity=currentTitle?'1':'0';
      if(currentTitle) titles[i].style.transform=reduced.matches?'none':
        'translate3d(0,'+((outgoing?-mix:1-mix)*100).toFixed(3)+'%,0)';
    });
    const phraseMix=from<2?0:from===2?mix:1;
    words[0].style.opacity=String(1-phraseMix);
    words[1].style.opacity=String(phraseMix);
    const encounter=from<3?0:from===3?mix:1;
    // The middle word is a single stationary node. Only its sentence changes.
    for(const wing of wings) {
      for(const [i,part] of Array.from(wing.children).entries()) {
        const fragment=part as HTMLElement;
        fragment.style.opacity=String(i?Number(encounter>0):Number(encounter<1));
        fragment.style.transform='translateY('+((i-encounter)*100).toFixed(2)+'%)';
      }
    }
    if(cursor!==target) schedule();
  }
  const observer=new ResizeObserver(layout);
  window.addEventListener('scroll',schedule,{passive:true,...options});
  window.addEventListener('resize',layout,options);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopVoice();schedule();},options);
  phone.addEventListener('change',layout,options);
  reduced.addEventListener('change',schedule,options);
  tour.classList.add('kn-enhanced');pin.hidden=false;
  observer.observe(nav);observer.observe(tour);observer.observe(stories[0]);observer.observe(hero);
  layout();
  return ()=>{
    controller.abort();observer.disconnect();cancelAnimationFrame(frame);stopVoice();
    pin.hidden=true;tour.classList.remove('kn-enhanced');hero.style.removeProperty('--kn-travel');
  };
}
