import { isMobilePlatform } from '../lib/platform';
import {Component,createRef,type ReactNode} from 'react';

// Only the incoming page is live. The inert outgoing snapshot preserves its
// scroll position until the shared navigation motion has finished.
export default class PageTransition extends Component<{pageKey:string; children:ReactNode}>{
 live=createRef<HTMLDivElement>();ghost=createRef<HTMLDivElement>();root=createRef<HTMLDivElement>();animations: Animation[]=[];timer: ReturnType<typeof setTimeout> | undefined;generation=0;media!: MediaQueryList;
 componentDidMount(){
  this.media=matchMedia('(prefers-reduced-motion: reduce)');
  this.media.addEventListener('change',this.finish);
  window.addEventListener('resize',this.finish);
 }
 getSnapshotBeforeUpdate(previous: Readonly<{pageKey:string; children:ReactNode}>){
  if(previous.pageKey===this.props.pageKey||this.media.matches || this.live.current?.querySelector('[data-library-open="true"]'))return null;
  // Never clone a native WebView: older composited frames can survive a tab
  // change until the next scroll. Phones use a small incoming motion instead.
  if(isMobilePlatform()||innerWidth<768)return null;
  const live=this.live.current!,clone=live.cloneNode(true) as HTMLElement;
  // Route-dependent shell selectors must only see the incoming live page.
  // A reader snapshot otherwise hides home navigation until its fade ends.
  clone.classList.replace('page-live','page-snapshot');
  const source=[live,...live.querySelectorAll<HTMLElement>('*')],target=[clone,...clone.querySelectorAll<HTMLElement>('*')];
  source.forEach((node,i)=>{
   target[i].removeAttribute('id');target[i].removeAttribute('autofocus');target[i].removeAttribute('data-testid');
   target[i].style.animation='none';target[i].style.transition='none';
   if(node.scrollTop||node.scrollLeft){target[i].dataset.pageScrollTop=String(node.scrollTop);target[i].dataset.pageScrollLeft=String(node.scrollLeft);}
  });
  clone.style.opacity=getComputedStyle(live).opacity;
  clone.style.transform=getComputedStyle(live).transform;
  clone.inert=true;clone.setAttribute('aria-hidden','true');
  return clone;
 }
 componentDidUpdate(previous: Readonly<{pageKey:string; children:ReactNode}>,_state: unknown,snapshot: HTMLElement | null){
  if(previous.pageKey===this.props.pageKey)return;
  this.finish();
  // A portalled phone library is restored in place, including its underlying
  // desk. Neither direction should animate a snapshot of only that desk.
  if(!snapshot){
   if(this.media.matches||!(isMobilePlatform()||innerWidth<768)||
      ![previous.pageKey,this.props.pageKey].every(key=>['/files','/saved','/settings'].includes(key))||
      this.live.current?.querySelector('[data-library-restored="true"]'))return;
   // Keep content visible throughout; never fade an entire phone page to zero.
   this.animations=[this.live.current!.animate([{opacity:.94,transform:'translateX(6px)'},{opacity:1,transform:'translateX(0)'}],{duration:200,easing:'cubic-bezier(.2,.8,.2,1)'})];
   const generation=this.generation;
   void this.animations[0].finished.then(()=>{if(generation===this.generation)this.finish()},()=>{});
   this.timer=setTimeout(this.finish,280);
   return;
  }
  const ghost=this.ghost.current!;
  ghost.replaceChildren(snapshot);
  for(const node of snapshot.querySelectorAll<HTMLElement>('[data-page-scroll-top]')){node.scrollTop=Number(node.dataset.pageScrollTop);node.scrollLeft=Number(node.dataset.pageScrollLeft);}
  this.root.current!.dataset.pageMoving='true';
  const options: KeyframeAnimationOptions={duration:240,easing:'ease-in-out',fill:'both'};
  this.animations=[
   ghost.animate([{opacity:1},{opacity:0}],options)
  ];
  const start=document.timeline.currentTime;
  if(typeof start === 'number')this.animations.forEach(a=>a.startTime=start);
  const generation=this.generation;
  Promise.all(this.animations.map(a=>a.finished)).then(()=>{if(generation===this.generation)this.finish()},()=>{});
  this.timer=setTimeout(this.finish,320);
 }
 finish=()=>{
  this.generation++;clearTimeout(this.timer);
  this.animations.forEach(a=>a.cancel());this.animations=[];
  this.ghost.current?.replaceChildren();
  if(this.root.current)delete this.root.current.dataset.pageMoving;
 };
 componentWillUnmount(){this.finish();this.media.removeEventListener('change',this.finish);window.removeEventListener('resize',this.finish)}
 render(){return <div className="page-transition" ref={this.root}><div className="page-live" ref={this.live}>{this.props.children}</div><div className="page-ghost" ref={this.ghost} inert aria-hidden="true"/></div>}
}
