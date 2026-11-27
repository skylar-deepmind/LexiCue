import {createDissolve} from './keynote-particles';

export function mountKeynote(root: HTMLElement) {
  const tour = root.querySelector<HTMLElement>('.kn-tour')!;
  const pin = tour.querySelector<HTMLElement>('.kn-pin')!;
  const screen = pin.querySelector<HTMLElement>('.kn-screen')!;
  const stories = [...tour.querySelectorAll<HTMLElement>('.kn-story')];
  const links = [...tour.querySelectorAll<HTMLAnchorElement>('.kn-index a')];
  const views = [...pin.querySelectorAll<HTMLElement>('.kn-view')];
  const images = views.map(view => view.querySelector('img')!);
  const stills = views.map(() => new Image());
  const canvas = pin.querySelector<HTMLCanvasElement>('canvas')!;
  const dust = createDissolve(canvas);
  const hear = pin.querySelector<HTMLButtonElement>('.kn-hear')!;
  const voice = pin.querySelector<HTMLAudioElement>('audio')!;
  const hero = root.querySelector<HTMLElement>('.kn-hero')!;
  const nav = document.querySelector<HTMLElement>('.site-nav')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const phone = matchMedia('(max-width:760px)');
  const lifetime = new AbortController();
  const options = {signal:lifetime.signal};
  let frame = 0, active = -1, visible = false;
  let playing = -1;

  function schedule() { if (!frame) frame = requestAnimationFrame(measure); }
  function base(i:number) { return (phone.matches ? images[i].dataset.phone : images[i].dataset.desktop)!; }
  function prepare(i:number) {
    const src = base(i)+'-still.webp';
    if (stills[i].getAttribute('src') !== src) stills[i].src=src;
  }
  function show(i:number, opacity:number, animate:boolean) {
    const image = images[i];
    const src = base(i)+(animate ? '.webp' : '-still.webp');
    if (image.getAttribute('src') !== src) image.src=src;
    views[i].style.opacity=String(opacity);
  }
  function stopVoice() { voice.pause(); voice.currentTime=0; }
  function syncSound() {
    const talking=!voice.paused && !voice.ended;
    hear.setAttribute('aria-pressed',String(talking));
    hear.setAttribute('aria-label',(talking ? hear.dataset.active : hear.dataset.idle)!);
  }
  hear.addEventListener('click',()=>{
    if (!voice.paused) stopVoice();
    else { voice.currentTime=0; void voice.play().catch(syncSound); }
  },options);
  for (const event of ['play','pause','ended','error']) voice.addEventListener(event,syncSound,options);
  for (const still of stills) still.addEventListener('load',schedule,options);

  // Geometry is derived from the text, so layout changes and reverse scrolling
  // traverse exactly the same dissolve without grabbing the wheel or touch gesture.
  function measure() {
    frame=0;
    const header=nav.getBoundingClientRect().height;
    tour.style.setProperty('--kn-nav',header+'px');
    const heroBox=hero.getBoundingClientRect();
    const travel=Math.max(0,Math.min(1,(header-heroBox.top)/heroBox.height));
    hero.style.setProperty('--kn-travel',reduced.matches?'0':travel.toFixed(3));
    const box=screen.getBoundingClientRect();
    visible=!document.hidden && box.bottom>header && box.top<innerHeight;
    const mobile=phone.matches && innerHeight>480;
    const line=mobile ? box.bottom+(innerHeight-box.bottom)*.43 : header+(innerHeight-header)*.5;
    const centers=stories.map(story=>{const r=story.getBoundingClientRect();return r.top+r.height*.5;});
    let from=0;
    while(from<centers.length-1 && line>=centers[from+1]) from++;
    const to=Math.min(from+1,centers.length-1);
    const distance=centers[to]-centers[from];
    const progress=distance ? Math.max(0,Math.min(1,(line-centers[from])/distance)) : 0;
    const index=progress<.5 ? from : to;
    if (index!==active) {
      active=index;
      stories.forEach((story,i)=>{
        story.toggleAttribute('data-current',i===index);
        if (i===index) links[i].setAttribute('aria-current','step');
        else links[i].removeAttribute('aria-current');
        views[i].setAttribute('aria-hidden',String(i!==index));
      });
    }
    const speaking=visible && stories[index].id==='listen';
    hear.hidden=!speaking;
    if(!speaking && !voice.paused) stopVoice();
    const t=Math.max(0,Math.min(1,(progress-.32)/.36));
    const transitioning=visible && !reduced.matches && t>0 && t<1;
    // Stop decoding offstage motion and preload just the adjoining transition stills.
    const animated=visible && !reduced.matches && !transitioning ? index : -1;
    if (playing>=0 && playing!==animated) show(playing,0,false);
    playing=animated;
    views.forEach((view,i)=>{view.classList.toggle('is-current',i===index);view.style.opacity='0';});
    if(visible) for(const i of [index-1,index,index+1]) if(i>=0 && i<stills.length) prepare(i);
    if(transitioning) {
      const hasDust=dust.paint(stills[from],stills[to],t);
      canvas.hidden=!hasDust;
      const blend=t*t*(3-2*t);
      show(from,hasDust?Math.max(0,1-t*4):1-blend,false);
      show(to,hasDust?Math.max(0,t*4-3):blend,false);
      canvas.style.opacity=String(Math.min(1,t*4,(1-t)*4));
    } else {
      canvas.hidden=true;
      if(visible || images[index].hasAttribute('src')) show(index,1,animated===index);
    }
  }
  const observer=new ResizeObserver(schedule);
  observer.observe(nav); observer.observe(tour); observer.observe(screen);
  window.addEventListener('scroll',schedule,{passive:true,...options});
  window.addEventListener('resize',schedule,options);
  document.addEventListener('visibilitychange',measure,options);
  phone.addEventListener('change',schedule,options);
  reduced.addEventListener('change',schedule,options);
  tour.classList.add('kn-enhanced');pin.hidden=false;measure();
  return ()=>{
    lifetime.abort(); observer.disconnect(); cancelAnimationFrame(frame); stopVoice();
    pin.hidden=true; tour.classList.remove('kn-enhanced'); hero.style.removeProperty('--kn-travel');
  };
}
