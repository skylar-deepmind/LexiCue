import { playWallExposure } from './wallExposure';
import { restoreScroll, visualCopy } from './visualSnapshot';
import type { Material } from './materials';

export type Box = { x: number; y: number; width: number; height: number };
export type Piece = { box: Box; node: HTMLElement; image?: HTMLImageElement; fit?: string };
export type Entrance = { id: number; hash: string; origin: 'desk' | 'wall'; card: Box; cover?: Piece; title?: Piece; quote?: Piece; back?:Piece; text: string; segment: number | null; background?: HTMLElement; wall?: Box; plate?: {box:Box;color:string} };
let entrance: Entrance | null = null;
let returning: { title?: Piece; quote?: Piece; cover?: Piece; words?: Piece[]; background?: HTMLElement } | null = null;
let pending = false, cleanup = () => {};
let returnFrame = 0;
let returningMotion = false;
let hold:HTMLElement|null=null,holdTimer:ReturnType<typeof setTimeout>|undefined;
function clearHold(){clearTimeout(holdTimer);hold?.remove();hold=null;}
function pageCopy(source:HTMLElement){
 const copy=source.cloneNode(true) as HTMLElement,r=box(source);
 const cs=getComputedStyle(source);for(const key of cs)copy.style.setProperty(key,cs.getPropertyValue(key));
 // Computed WebKit text-fill resolves currentColor at the root. Freezing that
 // resolved value would recolor every descendant, including pale poster titles.
 copy.style.setProperty('-webkit-text-fill-color','currentColor');
 if(copy.classList.contains('reading-page')){copy.classList.remove('reading-page');copy.classList.add('approved-reader-snapshot');}
 copy.querySelectorAll<HTMLElement>('*').forEach(n=>{n.style.animation='none';n.style.transition='none';});
 Object.assign(copy.style,{position:'absolute',left:`${r.x}px`,top:`${r.y}px`,width:`${r.width}px`,height:`${r.height}px`,margin:'0'});
 return copy;
}
function holdPage(source:HTMLElement){
 clearHold();const copy=pageCopy(source);
 hold=document.createElement('div');hold.className='approved-reading-hold b-shell figma-shell';hold.setAttribute('aria-hidden','true');hold.inert=true;hold.append(copy);document.body.append(hold);restoreScroll(source,copy);holdTimer=setTimeout(clearHold,4000);return copy;
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function box(node: Element): Box { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; }
function piece(node: HTMLElement | null): Piece | undefined {
  if (!node) return;
  const style = getComputedStyle(node), clone = node.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id'); clone.removeAttribute('class');
  clone.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
  Object.assign(clone.style, { margin: '0', padding: '0', border: '0', boxSizing: 'border-box', color: style.color, font: style.font, letterSpacing: style.letterSpacing, lineHeight: style.lineHeight, textWrap: style.textWrap, whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap, background: 'transparent', overflow: 'hidden', objectFit: style.objectFit });
  return { box: box(node), node: clone, image: node instanceof HTMLImageElement ? node : undefined, fit: style.objectFit };
}
function findSentence(reader: HTMLElement, text: string): HTMLElement | null {
  const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();
  const nodes = [...reader.querySelectorAll<HTMLElement>('.reading-original')];
  return nodes.find(node => normalized(node.textContent ?? '') === normalized(text)) ?? null;
}
export function cancelReadingReturn() {
  if (!returning && !returningMotion) return;
  cancelAnimationFrame(returnFrame);
  returnFrame = 0;
  cleanup();
  clearHold();
  returning = null;
  returningMotion = false;
}
export function captureReadingEntrance(material: Material, card: HTMLElement, origin: 'desk' | 'wall') {
  cancelReadingReturn();
  cleanup(); pending = true;
  // Start the reader font while navigation and native material loading run.
  void document.fonts.load('1em "Source Serif 4"').catch(() => {});

  const title = card.querySelector<HTMLElement>('.approved-card-title,.approved-poster strong');
  const quote = card.querySelector<HTMLElement>('.approved-card-quote');
  const page=card.closest<HTMLElement>('.approved-desk');
  const background=!reduced()&&page?holdPage(page):undefined;
  const wall=card.closest<HTMLElement>('.approved-wall-viewport'),plate=card.querySelector<HTMLElement>('.approved-poster > button > span');
  const back=page?.querySelector<HTMLElement>('.approved-wall > header > button');
  entrance = { back:back?{box:box(back),node:visualCopy(back)}:undefined, background, wall:wall?box(wall):undefined,plate:plate?{box:box(plate),color:getComputedStyle(plate).backgroundColor}:undefined, id: material.id, hash: material.content_hash, origin, card: box(card), cover: piece(card.querySelector('img')), title: piece(title), quote: piece(quote), text: quote?.textContent ?? '', segment: material.position?.segment ?? null };
}
export function prepareReadingReturn(id: number) {
  if (!entrance || entrance.id !== id) return;
  cleanup();
  if(pending){pending=false;returning=null;clearHold();return;}
  const viewport = document.querySelector('.reader-scroll')?.getBoundingClientRect();
  const nodes = [...document.querySelectorAll<HTMLElement>('.reading-original')];
  const target = nodes.filter(node => { const r = node.getBoundingClientRect(); return r.bottom > (viewport?.top ?? 0) && r.top < (viewport?.bottom ?? innerHeight); }).sort((a, b) => Math.abs(box(a).y - (viewport?.top ?? 0) - (viewport?.height ?? innerHeight) * .37) - Math.abs(box(b).y - (viewport?.top ?? 0) - (viewport?.height ?? innerHeight) * .37))[0];
  if (target) { entrance.text = target.textContent ?? ''; entrance.segment = Number(target.closest<HTMLElement>('[data-sentence]')?.dataset.sentence ?? 0); }
  const page=document.querySelector<HTMLElement>('.reading-page');
  const background=!reduced()&&page?holdPage(page):undefined;
  background?.querySelectorAll('.context-panel').forEach(node=>node.remove());
  returning = { background, title: piece(document.querySelector('.reading-title')), cover: piece(document.querySelector('.folio-print')), quote: piece(target ?? null), words: [...(target?.querySelectorAll<HTMLElement>('.reading-word') ?? [])].slice(0,3).map(node=>piece(node)!).filter(Boolean) };
}
function contours(source: Piece | undefined, origin: Entrance['origin']): HTMLCanvasElement | null {
  const image = source?.image;
  if (!source || !image?.complete || !image.naturalWidth) return null;
  const canvas = document.createElement('canvas'); canvas.width = 420; canvas.height = origin === 'desk' ? 236 : Math.max(1,Math.round(420 * source.box.height / source.box.width));
  const width=canvas.width,height=canvas.height;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) return null;
    const scale=(source.fit==='contain'?Math.min:Math.max)(width/image.naturalWidth,height/image.naturalHeight);
    ctx.fillStyle='#f6ebce';ctx.fillRect(0,0,width,height);
    ctx.drawImage(image,(width-image.naturalWidth*scale)/2,(height-image.naturalHeight*scale)/2,image.naturalWidth*scale,image.naturalHeight*scale);
    const pixels = ctx.getImageData(0, 0, width, height), output = ctx.createImageData(width, height), values = new Float32Array(width * height);
    for (let i = 0; i < values.length; i++) { const k = i * 4; values[i] = origin === 'desk' ? .299 * pixels.data[k] + .587 * pixels.data[k + 1] + .114 * pixels.data[k + 2] : .23 * pixels.data[k] + .64 * pixels.data[k + 1] + .13 * pixels.data[k + 2]; }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, k = i * 4;
      const edge = Math.min(1, (Math.abs(values[i] - values[Math.max(i - 1, 0)]) + Math.abs(values[i] - values[Math.max(i - width, 0)])) / (origin === 'desk' ? 34 : 76));
      [246, 235, 206].forEach((value, channel) => { output.data[k + channel] = value - edge * (value - [42, 75, 67][channel]); }); output.data[k + 3] = 255;
    }
    ctx.putImageData(output, 0, 0); return canvas;
  } catch { return null; } // Cross-origin thumbnails still get a complete paper transition.
}
function run(reverse: boolean) {
  if (reverse && !returning) return;
  const data = entrance; if (!data) return;
  const reader = document.querySelector<HTMLElement>('.reading-page');
  const card = document.querySelector<HTMLElement>(`[data-motion-file="${data.id}"]`);
  if (reverse && !card || !reverse && (!reader || reader.dataset.readingMaterial !== String(data.id))) return;
  const newPlate=reverse?card?.querySelector<HTMLElement>('.approved-poster > button > span'):null;
  const source = reverse ? { ...data,plate:newPlate?{box:box(newPlate),color:getComputedStyle(newPlate).backgroundColor}:data.plate, card: box(card!), cover: piece(card!.querySelector('img')), title: piece(card!.querySelector('.approved-card-title,.approved-poster strong')), quote: piece(card!.querySelector('.approved-card-quote')) } : data;
  const real = reverse ? card! : reader!;
  const caption=reverse&&data.origin==='desk'?card?.querySelector<HTMLElement>('.approved-card-copy'):null;
  const badge=reverse&&data.origin==='desk'?card?.querySelector<HTMLElement>('.material-floating-tag'):null;
  const returnInk=caption?[{node:visualCopy(caption),box:box(caption)}]:[];
  const returnTag=badge?{node:visualCopy(badge),box:box(badge)}:null;
  if (reduced()) {
    if (data.origin === 'wall') real.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 });
    clearHold();returning = null; pending = false; return;
  }
  const liveTitle = reader?.querySelector<HTMLElement>('.reading-title') ?? null;
  const liveCover = reader?.querySelector<HTMLElement>('.folio-print') ?? null;
  const title = reverse ? returning?.title : piece(liveTitle);
  const cover = reverse ? returning?.cover : piece(liveCover);
  const sentenceNode = reader ? findSentence(reader, data.text) ?? reader.querySelector<HTMLElement>(`[data-sentence="${data.segment ?? 0}"] .reading-original`) : null;
  const quote = reverse ? returning?.quote : piece(sentenceNode);
  const layer = document.createElement('div'); layer.className = 'approved-handoff b-shell figma-shell'; layer.style.background='transparent'; layer.setAttribute('aria-hidden', 'true'); layer.inert = true;
  document.body.append(layer);
  returningMotion = reverse;
  if(data.origin==='wall'){
    const paper=reverse?returning?.background:reader? pageCopy(reader):undefined;
    if(!paper){clearHold();layer.remove();returningMotion=false;return;}
    const wallNode=reverse?document.querySelector<HTMLElement>('.approved-wall-viewport'):null;
    const wallBounds=wallNode?box(wallNode):data.wall;
    if(!reverse&&data.background)layer.append(data.background);
    const paperBox=reverse?{x:0,y:0,width:innerWidth,height:innerHeight}:box(paper);
    Object.assign(paper.style,{position:'absolute',left:'0',top:'0',width:`${innerWidth}px`,height:`${innerHeight}px`});layer.append(paper);
    if (!reverse && reader) restoreScroll(reader, paper);
    const index=reverse?data.segment:Number(sentenceNode?.closest<HTMLElement>('[data-sentence]')?.dataset.sentence??0);
    const paragraph=paper.querySelector<HTMLElement>(`[data-sentence="${index}"] .reading-original`)??paper.querySelector<HTMLElement>('.reading-original');
    const nodes=[...paragraph?.querySelectorAll<HTMLElement>('.reading-word')??[]].slice(0,3);
    let destinations=reverse?returning?.words??[]:nodes.map(node=>piece(node)!).filter(Boolean);
    if(destinations[0])destinations=destinations.filter(p=>Math.abs(p.box.y-destinations[0].box.y)<3);
    const dispose=playWallExposure({...source,wall:wallBounds},paper,layer,reverse,destinations,nodes.slice(0,destinations.length),paperBox,reverse ? null : reader);
    clearHold();cleanup=()=>{dispose();returningMotion=false;};returning=null;pending=false;return;
  }
  const jobs: Animation[] = [], hidden: { node: HTMLElement; visibility: string }[] = [];
  const hide = (node: HTMLElement | null) => { if (!node) return; hidden.push({ node, visibility: node.style.visibility }); node.style.visibility = 'hidden'; };
  const duration = 580;
  const options: KeyframeAnimationOptions = { duration, fill: 'both', direction: reverse ? 'reverse' : 'normal', easing: 'cubic-bezier(.4,0,.2,1)' };
  const coverArrival = reverse ? 1 : .76;

  const animate = (node: HTMLElement, frames: Keyframe[]) => { const a = node.animate(frames, options); jobs.push(a); };
  const frame = (r: Box) => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  const place = (node: HTMLElement, r: Box) => { Object.assign(node.style, { position: 'absolute', ...frame(r), transformOrigin: '0 0' }); layer.append(node); };
  const travel = (from: Piece | undefined, to: Piece | undefined, kind: 'cover' | 'title' | 'quote', end: number) => {
    if (!from || !to || !from.box.width || !from.box.height || !to.box.width || !to.box.height) return;
    const clone = from.node.cloneNode(true) as HTMLElement;
    clone.dataset.motionPiece = kind;
    place(clone, from.box);
    const textFrame = (p: Piece) => ({ ...frame(p.box), fontSize: p.node.style.fontSize, lineHeight: p.node.style.lineHeight, letterSpacing: p.node.style.letterSpacing, color: p.node.style.color });
    // The cover arrives at its layout size. A scaled bitmap can rasterize a
    // point away from the real image on WebKit even with equivalent bounds.
    const start = kind === 'cover' ? { ...frame(from.box), borderRadius: '16px 16px 0 0' } : textFrame(from);
    const target = kind === 'cover' ? { ...frame(to.box), borderRadius: '4px' } : textFrame(to);
    animate(clone, [{ ...start, offset: 0 }, { ...target, offset: end }, { ...target, offset: 1 }]);
    return clone;
  };
  const fadeOut = (node: HTMLElement, start: number, end: number) =>
    animate(node, [{ opacity: 1 }, { opacity: 1, offset: start }, { opacity: 0, offset: end }, { opacity: 0 }]);
  const fadeIn = (node: HTMLElement, start: number, end: number) =>
    animate(node, [{ opacity: 0 }, { opacity: 0, offset: start }, { opacity: 1, offset: end }, { opacity: 1 }]);
  const travelText = (from: Piece | undefined, to: Piece | undefined, live: HTMLElement | null,
      kind: 'title' | 'quote', arrival: number, handoff: number, reveal: number) => {
    const moving = travel(from, to, kind, arrival);
    if (!moving || !live) return false;
    // The card and page can wrap the same text differently. Retire the card
    // copy before painting any of the final text.
    fadeOut(moving, arrival, handoff);
    fadeIn(live, handoff, reveal);
    return true;
  };
  const clip = (r: Box, c: Box) => `inset(${Math.max(0,c.y-r.y)}px ${Math.max(0,r.x+r.width-c.x-c.width)}px ${Math.max(0,r.y+r.height-c.y-c.height)}px ${Math.max(0,c.x-r.x)}px round 16px)`;
  const paper = reverse ? returning?.background : reader;
  if(reverse&&paper){paper.querySelectorAll<HTMLElement>('.reading-title,.folio-print').forEach(hide);paper.querySelectorAll<HTMLElement>(`[data-sentence="${data.segment}"] .reading-original`).forEach(hide);}
  if (reverse && card) {
    // Keep the real card's hit area alive while the snapshot paints its artwork.
    jobs.push(card.animate([{opacity:0},{opacity:0}],{duration:duration+240,fill:'both'}));
  }
  if (data.origin === 'desk') {
    const background = reverse ? document.querySelector<HTMLElement>('.approved-desk') : source.background;
    if (background) {
      if (!reverse) { const clone=background;clone.querySelector<HTMLElement>(`[data-motion-file="${data.id}"]`)?.style.setProperty('visibility','hidden');place(clone,{x:0,y:0,width:innerWidth,height:innerHeight});animate(clone,[{opacity:1},{opacity:0,offset:.47},{opacity:0}]); }
      else animate(background,[{opacity:1},{opacity:0,offset:.47},{opacity:0}]);
    }
    if (paper) {
      if (reverse) place(paper,{x:0,y:0,width:innerWidth,height:innerHeight});
      const clipped = { clipPath: clip({x:0,y:0,width:innerWidth,height:innerHeight},source.card) };
      const open = { clipPath: 'inset(0px round 0px)' };
      // Drop the paper mask before the live cover is visible. Removing the
      // composited mask at cleanup can resample a fractional image edge.
      animate(paper, reverse
        ? [clipped, open]
        : [clipped, { ...open, offset: .68 }, { clipPath: 'none', offset: .70 }, { clipPath: 'none' }]);
      paper.querySelectorAll<HTMLElement>('.reading-layout,.reading-breadcrumb').forEach(node=>fadeIn(node,.62,reverse ? .9 : .80));
      if(!reverse){const controls=document.querySelector<HTMLElement>('.mobile-reading-tools');if(controls)animate(controls,[{opacity:0},{opacity:0,offset:.62},{opacity:1}]);}
    }
  }
  const ink = contours(source.cover, data.origin);
  if (ink && source.cover) {
    place(ink, source.cover.box); ink.style.zIndex='2'; ink.dataset.motionPiece='contours';
    if (data.origin === 'desk' && cover) {
      const from = { ...frame(source.cover.box), borderRadius: '16px 16px 0 0' };
      const to = { ...frame(cover.box), borderRadius: '4px' };
      animate(ink, [from, { ...to, offset: coverArrival }, { ...to, offset: 1 }]);
    }
    animate(ink,[{opacity:0},{opacity:.76,offset:.43},{opacity:0,offset:coverArrival},{opacity:0}]);
  }
  if (data.origin === 'desk') {
    const movingCover = travel(source.cover, cover, 'cover', coverArrival);
    if (!reverse && movingCover && liveCover) {
      // Present one raster at a time and make the real image the only
      // visible cover well before the animation layer is removed.
      fadeOut(movingCover, coverArrival, .82);
      fadeIn(liveCover, .82, .90);
    }
    if(reverse&&returnInk.length){
      // Return ink as one measured caption. Independent font/width interpolation
      // can reflow the title through the excerpt, particularly after scrolling.
      for(const ink of returnInk){const caption=ink.node;caption.dataset.motionPiece='caption';place(caption,ink.box);
      jobs.push(caption.animate([{opacity:0,translate:'0 8px',offset:0},{opacity:0,translate:'0 8px',offset:.44},{opacity:1,translate:'0 0',offset:.88},{opacity:1,translate:'0 0',offset:1}],{...options,direction:'normal'}));}
    } else if(!reverse) {
      travelText(source.title, title, liveTitle, 'title', .75, .82, .94);
      if (source.quote && !travelText(source.quote, quote, sentenceNode, 'quote', .66, .73, .87)) {
        place(source.quote.node, source.quote.box);
        fadeOut(source.quote.node, 0, .34);
      }
    }
  }
  // Stamp the label only after the artwork and measured caption have reassembled.
  if(reverse&&returnTag){
    returnTag.node.dataset.motionPiece='tag';place(returnTag.node,returnTag.box);
    jobs.push(returnTag.node.animate([{opacity:0},{opacity:1}],{duration:240,delay:duration,easing:'ease-in-out',fill:'both'}));
  }
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    jobs.forEach(a => a.cancel()); hidden.forEach(({ node, visibility }) => { node.style.visibility = visibility; }); layer.remove();
    window.removeEventListener('resize', dispose); window.removeEventListener('pagehide', dispose); document.removeEventListener('visibilitychange', visibility);
    if (cleanup === dispose) { cleanup = () => {}; returningMotion = false; }
  };
  const visibility = () => { if (document.hidden) dispose(); };
  cleanup = dispose; window.addEventListener('resize', dispose, { once: true }); window.addEventListener('pagehide', dispose, { once: true }); document.addEventListener('visibilitychange', visibility);
  const now = document.timeline.currentTime; if (typeof now === 'number') jobs.forEach(job => { job.startTime = now; });
  void Promise.allSettled(jobs.map(job => job.finished)).then(dispose);
  clearHold();returning = null; pending = false;
}
export function finishReadingEntrance(id: number): () => void {
  if (!pending || entrance?.id !== id || returning) return () => {};
  const reader=document.querySelector<HTMLElement>(`.page-live .reading-page[data-reading-material="${id}"]`),visibility=reader?.style.visibility??'';
  if(reader)reader.style.visibility='hidden';
  let frame=0,alive=true;
  void document.fonts.ready.then(()=>{if(!alive)return;frame=requestAnimationFrame(()=>{if(reader)reader.style.visibility=visibility;run(false);});});
  return () => {alive=false;cancelAnimationFrame(frame);if(reader)reader.style.visibility=visibility;cleanup();};
}
export function finishReadingReturn(origin: 'desk' | 'wall') {
  if (!returning || !entrance || entrance.origin !== origin || returnFrame) return;
  returnFrame = requestAnimationFrame(() => { returnFrame = 0; run(true); });
}

export function readingMotionExcerpt(material: Material): string | undefined { return entrance?.id === material.id && entrance.hash === material.content_hash && returning ? entrance.text : undefined; }
