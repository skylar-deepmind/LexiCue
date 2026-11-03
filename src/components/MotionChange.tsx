import { Component, createRef, type ReactNode } from 'react';

type Props = { changeKey: string; children: ReactNode; className?: string; resizeContainer?: string; interruptKey?: string };
type Snapshot = { panel: HTMLElement; rect: DOMRect; clone: HTMLElement } | null;
/** Animate explicit content changes, never ordinary input keystrokes. */
export default class MotionChange extends Component<Props> {
  root = createRef<HTMLDivElement>(); live = createRef<HTMLDivElement>(); ghost = createRef<HTMLDivElement>();
  animations: Animation[] = []; generation = 0; timer?: ReturnType<typeof setTimeout>; media?: MediaQueryList;
  componentDidMount() { this.media = matchMedia('(prefers-reduced-motion: reduce)'); this.media.addEventListener('change', this.finish); window.addEventListener('resize', this.finish); }
  getSnapshotBeforeUpdate(previous: Props): Snapshot {
    if (previous.changeKey === this.props.changeKey || this.media?.matches) return null;
    const live = this.live.current!, root = this.root.current!;
    const panel = this.props.resizeContainer ? root.closest<HTMLElement>(this.props.resizeContainer) ?? root : root;
    const clone = live.cloneNode(true) as HTMLElement;
    const sources = [live, ...live.querySelectorAll<HTMLElement>('*')], targets = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
    sources.forEach((node, index) => { const target = targets[index]; target.removeAttribute('id'); target.removeAttribute('autofocus'); target.style.animation = 'none'; target.style.transition = 'none'; if (node.scrollTop || node.scrollLeft) { target.dataset.motionScrollTop = String(node.scrollTop); target.dataset.motionScrollLeft = String(node.scrollLeft); } });
    clone.style.width = `${live.getBoundingClientRect().width}px`; clone.style.opacity = getComputedStyle(live).opacity; clone.inert = true;
    return { panel, rect: panel.getBoundingClientRect(), clone };
  }
  componentDidUpdate(previous: Props, _state: unknown, snapshot: Snapshot) {
    if (previous.changeKey === this.props.changeKey) { if (previous.interruptKey !== this.props.interruptKey) this.finish(); return; }
    this.finish(); if (!snapshot) return;
    const {panel, rect, clone} = snapshot, root = this.root.current!, live = this.live.current!, ghost = this.ghost.current!;
    const target = panel.getBoundingClientRect(); ghost.replaceChildren(clone);
    clone.querySelectorAll<HTMLElement>('[data-motion-scroll-top]').forEach(node => { node.scrollTop = Number(node.dataset.motionScrollTop); node.scrollLeft = Number(node.dataset.motionScrollLeft); });
    root.dataset.motionMoving = 'true';
    const options: KeyframeAnimationOptions = {duration:320, easing:'cubic-bezier(.16,1,.3,1)', fill:'both'};
    const from: Keyframe = {height:`${rect.height}px`}, to: Keyframe = {height:`${target.height}px`};
    if (this.props.resizeContainer) { from.width = `${rect.width}px`; to.width = `${target.width}px`; }
    this.animations = [panel.animate([from,to], options), live.animate([{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],options), ghost.animate([{opacity:1},{opacity:0}],{...options,duration:150})];
    const start = document.timeline.currentTime; if (typeof start === 'number') this.animations.forEach(animation => { animation.startTime = start; });
    const generation = this.generation; void Promise.all(this.animations.map(animation => animation.finished)).then(() => { if (generation === this.generation) this.finish(); }, () => {});
    this.timer = setTimeout(this.finish,400);
  }
  finish = () => { this.generation++; clearTimeout(this.timer); this.animations.forEach(animation => animation.cancel()); this.animations = []; this.ghost.current?.replaceChildren(); if (this.root.current) delete this.root.current.dataset.motionMoving; };
  componentWillUnmount() { this.finish(); this.media?.removeEventListener('change', this.finish); window.removeEventListener('resize', this.finish); }
  render() { return <div ref={this.root} className={`motion-change ${this.props.className ?? ''}`}><div ref={this.live} className="motion-live">{this.props.children}</div><div ref={this.ghost} className="motion-ghost" inert aria-hidden="true" /></div>; }
}
