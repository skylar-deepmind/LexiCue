// Fade lookup content in place within the fixed card.
import React, { Component, createRef, type ReactNode } from 'react';
import './soft-content-refresh.css';

interface Props {
  contentKey: string;
  ready: boolean;
  label: string;
  pendingLabel: string;
  className?: string;
  children: ReactNode;
}

/** Capture before React replaces the keyed content. Only the current child owns
 * state/actions; the outgoing DOM is one inert, disposable visual snapshot. */
export default class SoftContentRefresh extends Component<Props> {
  private stage = createRef<HTMLDivElement>();
  private current = createRef<HTMLDivElement>();
  private ghost = createRef<HTMLDivElement>();
  private presentedKey: string | null = null;
  private frame = 0;
  private cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  private motion: MediaQueryList | undefined;
  componentDidMount() {
    this.motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener('change', this.finish);
    window.addEventListener('resize', this.finish);
    if (this.props.ready) this.presentedKey = this.props.contentKey;
  }

  getSnapshotBeforeUpdate(previous: Props): HTMLElement | null {
    if (previous.contentKey === this.props.contentKey || this.presentedKey === null || this.motion?.matches) return null;
    const current = this.current.current, stage = this.stage.current;
    if (!current || !stage) return null;
    const frame = document.createElement('div');
    frame.className = 'soft-refresh-frame';
    frame.style.height = `${stage.getBoundingClientRect().height}px`;
    const copy = (source: HTMLElement, opacity?: string) => {
      const clone = source.cloneNode(true) as HTMLElement;
      clone.classList.replace('soft-refresh-current', 'soft-refresh-snapshot');
      for (const target of clone.querySelectorAll<HTMLElement>('[id],[autofocus],[data-user-scrolling],[data-refresh-scroll-top],[data-refresh-scroll-left]')) {
        target.removeAttribute('id');
        target.removeAttribute('autofocus');
        target.removeAttribute('data-user-scrolling');
        delete target.dataset.refreshScrollTop;
        delete target.dataset.refreshScrollLeft;
      }
      const scrollable = (node: HTMLElement) => [node, ...node.querySelectorAll<HTMLElement>('.lookup-body,.lookup-tabs')];
      const targets = scrollable(clone);
      scrollable(source).forEach((node, index) => {
        const { scrollTop, scrollLeft } = node;
        if (scrollTop) targets[index].dataset.refreshScrollTop = String(scrollTop);
        if (scrollLeft) targets[index].dataset.refreshScrollLeft = String(scrollLeft);
      });
      Object.assign(clone.style, { visibility:'visible', opacity:opacity ?? getComputedStyle(source).opacity,
        height:`${source.getBoundingClientRect().height}px` });
      clone.inert = true; clone.setAttribute('aria-hidden', 'true');
      return clone;
    };
    // An interruption captures the visible composite, rather than flashing
    // either unfinished layer at full opacity. Keep the visual stack bounded.
    const outgoing = this.ghost.current?.firstElementChild;
    if (outgoing instanceof HTMLElement && stage.dataset.refreshState !== 'ready') {
      [...outgoing.children].forEach(node => { if (node instanceof HTMLElement) frame.append(copy(node)); });
    }
    if (stage.dataset.refreshState !== 'waiting' || !frame.childElementCount) frame.append(copy(current));
    while (frame.childElementCount > 4) frame.children[1]?.remove();
    if (frame.firstElementChild instanceof HTMLElement) frame.firstElementChild.style.opacity = '1';
    frame.inert = true; frame.setAttribute('aria-hidden','true');
    return frame;
  }

  componentDidUpdate(previous: Props, _state: unknown, snapshot: HTMLElement | null) {
    const changed = previous.contentKey !== this.props.contentKey;
    if (changed) {
      this.cancel();
      if (snapshot) {
        this.ghost.current?.replaceChildren(snapshot);
        for (const node of [snapshot, ...snapshot.querySelectorAll<HTMLElement>('[data-refresh-scroll-top],[data-refresh-scroll-left]')]) {
          node.scrollTop = Number(node.dataset.refreshScrollTop ?? 0);
          node.scrollLeft = Number(node.dataset.refreshScrollLeft ?? 0);
        }
      }
      if (this.ghost.current?.childElementCount) this.stage.current!.dataset.refreshState = 'waiting';
    }
    if (this.props.ready && (changed || !previous.ready)) {
      if (this.ghost.current?.childElementCount && !this.motion?.matches) {
        this.presentedKey = this.props.contentKey;
        this.reveal();
      }
      else this.finish();
    } else if (changed && this.ghost.current?.childElementCount) {
      this.stage.current!.dataset.refreshState = 'waiting';
    }
  }

  componentWillUnmount() {
    this.cancel();
    this.motion?.removeEventListener('change', this.finish);
    window.removeEventListener('resize', this.finish);
  }

  private cancel = () => {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.cleanupTimer);
  };

  private finish = () => {
    this.cancel();
    // Keep the old view until the new content is ready.
    if (!this.props.ready) return;
    this.presentedKey = this.props.contentKey;
    this.stage.current?.style.removeProperty('--refresh-opacity');
    this.ghost.current?.replaceChildren();
    if (this.stage.current) this.stage.current.dataset.refreshState = 'ready';
  };

  private reveal() {
    this.cancel();
    const stage = this.stage.current!;
    stage.dataset.refreshState = 'revealing';
    const paint = (progress: number) => {
      stage.style.setProperty('--refresh-opacity', String(progress * progress * (3 - 2 * progress)));
    };
    paint(0);
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - started) / 300));
      paint(progress);
      if (progress < 1) this.frame = requestAnimationFrame(tick);
      else this.finish();
    };
    this.frame = requestAnimationFrame(tick);
    // Cleanup is independent of animation events and throttled background frames.
    this.cleanupTimer = setTimeout(this.finish, 350);
  }

  render() {
    const { contentKey, ready, label, pendingLabel, className = '', children } = this.props;
    const waiting = !ready && this.presentedKey !== null && !this.motion?.matches;
    return <div className={`soft-refresh ${className}`} ref={this.stage} data-content-key={contentKey}>
      <div className="soft-refresh-ghost" ref={this.ghost} aria-hidden="true" inert />
      <div className="soft-refresh-current" ref={this.current} inert={waiting} aria-hidden={waiting || undefined} style={{ visibility: waiting ? 'hidden' : undefined }}>{children}</div>
      {waiting && <p className="lookup-pending" role="status">{label} · {pendingLabel}</p>}
    </div>;
  }
}
