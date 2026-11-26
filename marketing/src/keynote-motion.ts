import {tourControls} from './keynote-copy.mjs';

// Enhance the static story only after mounting. All chapters and anchor links also work without JS.
export function mountKeynote(root: HTMLElement, locale: string) {
  const tour = root.querySelector<HTMLElement>('.kn-tour')!;
  const pin = tour.querySelector<HTMLElement>('.kn-pin')!;
  const player = pin.querySelector<HTMLElement>('.kn-player')!;
  const chapters = [...tour.querySelectorAll<HTMLElement>('.kn-story')];
  const links = [...tour.querySelectorAll<HTMLAnchorElement>('.kn-index a')];
  const views = [...pin.querySelectorAll<HTMLElement>('.kn-view')];
  const videos = views.map(view => view.querySelector('video')!);
  const toggle = pin.querySelector<HTMLButtonElement>('.kn-play')!;
  const label = toggle.querySelector<HTMLElement>('.kn-play-label')!;
  const caption = pin.querySelector<HTMLElement>('.kn-transport-label')!;
  const meter = pin.querySelector<HTMLElement>('.kn-meter i')!;
  const hero = root.querySelector<HTMLElement>('.kn-hero')!;
  const nav = document.querySelector<HTMLElement>('.site-nav')!;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = matchMedia('(max-width: 760px)');
  const copy = tourControls[locale];
  const lifetime = new AbortController();
  const options = {signal:lifetime.signal};
  let active = -1;
  let inView = false;
  let manualPause = false;
  let allowMotion = !motion.matches;
  let requested = false;
  let frame = 0;

  function updateControls() {
    const video = videos[active];
    if (!video) return;
    const state = video.error ? 'unavailable' : video.ended ? 'replay' : video.paused ? 'play' : 'pause';
    toggle.dataset.state = state;
    toggle.disabled = state === 'unavailable';
    label.textContent = copy[state];
    const progress = video.duration ? video.currentTime / video.duration : 0;
    meter.style.transform = `scaleX(${Number.isFinite(progress) ? progress : 0})`;
    views[active].classList.toggle('closeup', active === 1 && progress > .45 && !motion.matches);
  }

  function play() {
    const video = videos[active];
    if (!video || requested || !inView || document.hidden || manualPause || !allowMotion || video.error || video.ended) return;
    requested = true;
    const source = (narrow.matches ? video.dataset.phone : video.dataset.desktop)!;
    if (video.getAttribute('src') !== source) video.src = source;
    video.play().catch(() => { if (video === videos[active]) updateControls(); });
  }

  function select(index: number) {
    if (index === active) return;
    if (active >= 0) videos[active].pause();
    active = index;
    requested = false;
    views.forEach((view,i)=>{
      view.classList.toggle('is-current',i===index);
      view.setAttribute('aria-hidden', String(i!==index));
      chapters[i].toggleAttribute('data-current',i===index);
      if(i===index) links[i].setAttribute('aria-current','step');
      else links[i].removeAttribute('aria-current');
    });
    const video = videos[index];
    if (video.readyState && !video.error) video.currentTime = 0;
    caption.textContent = links[index].textContent;
    updateControls();
  }

  function measure() {
    frame = 0;
    const header = nav.getBoundingClientRect().height;
    tour.style.setProperty('--kn-nav',header+'px');
    const heroRect = hero.getBoundingClientRect();
    const travel = Math.max(0, Math.min(1,(header-heroRect.top)/heroRect.height));
    hero.style.setProperty('--kn-travel',motion.matches ? '0' : travel.toFixed(3));
    const rect = player.getBoundingClientRect();
    const mobilePin = narrow.matches && innerHeight > 480;
    const line = mobilePin ? rect.bottom + Math.max(60,(innerHeight-rect.bottom)*.42) : header+(innerHeight-header)*.52;
    let index = 0;
    chapters.forEach((chapter,i)=>{if (chapter.getBoundingClientRect().top <= line) index=i;});
    select(index);
    const seen = Math.min(innerHeight,rect.bottom)-Math.max(header,rect.top);
    inView = seen > Math.min(rect.height*.5,(innerHeight-header)*.5);
    if (!inView || document.hidden) { videos[active].pause(); requested=false; }
    else play();
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(measure); }

  videos.forEach((video,i)=>{
    video.muted = true;
    for(const event of ['playing','pause','ended','timeupdate','error','loadeddata']){
      video.addEventListener(event,()=>{
        if(event==='loadeddata') views[i].classList.add('has-frame');
        if(event==='error') views[i].classList.remove('has-frame');
        if(i===active) updateControls();
      },options);
    }
  });
  toggle.addEventListener('click',()=>{
    const video = videos[active];
    if (!video.paused && !video.ended) { manualPause=true; video.pause(); }
    else {
      manualPause=false; allowMotion=true; requested=false;
      if(video.ended) video.currentTime=0;
      play();
    }
    updateControls();
  },options);
  motion.addEventListener('change',()=>{
    allowMotion=!motion.matches;
    if (!allowMotion) videos[active]?.pause();
    requested=false; schedule();
  },options);
  narrow.addEventListener('change',()=>{
    for(const [i,video] of videos.entries()){
      if (!video.hasAttribute('src')) continue;
      video.pause(); video.removeAttribute('src'); video.load();
      views[i].classList.remove('has-frame','closeup');
    }
    requested=false; schedule();
  },options);
  window.addEventListener('scroll',schedule,{passive:true, ...options});
  window.addEventListener('resize',schedule,options);
  document.addEventListener('visibilitychange',measure,options);
  const observer = new ResizeObserver(schedule);
  observer.observe(nav);
  observer.observe(tour);
  tour.classList.add('kn-enhanced');
  pin.hidden=false;
  measure();
  return ()=>{
    lifetime.abort(); observer.disconnect(); cancelAnimationFrame(frame);
    videos.forEach(video=>{video.pause();video.removeAttribute('src');video.load();});
    pin.hidden=true; tour.classList.remove('kn-enhanced');
    hero.style.removeProperty('--kn-travel');
  };
}
