import { Component, createRef, type ReactNode } from 'react';
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
  private edge = createRef<HTMLDivElement>();
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
    if (previous.contentKey === this.props.contentKey || this.presentedKey !== previous.contentKey) return null;
    const current = this.current.current;
    if (!current) return null;
    const clone = current.cloneNode(true) as HTMLElement;
    clone.style.maskImage = clone.style.webkitMaskImage = 'none';
    clone.style.visibility = 'visible';
    clone.inert = true;
    clone.setAttribute('aria-hidden', 'true');
    // Duplicate IDs/autofocus must never participate in the live document.
    for (const node of [clone, ...clone.querySelectorAll<HTMLElement>('*')]) {
      node.removeAttribute('id'); node.removeAttribute('autofocus');
    }
    // cloneNode does not retain native scroll positions.
    const source = [current, ...current.querySelectorAll<HTMLElement>('*')];
    const target = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
    source.forEach((node, index) => {
      if (node.scrollTop || node.scrollLeft) {
        target[index].dataset.refreshScrollTop = String(node.scrollTop);
        target[index].dataset.refreshScrollLeft = String(node.scrollLeft);
      }
    });
    return clone;
  }

  componentDidUpdate(previous: Props, _state: unknown, snapshot: HTMLElement | null) {
    const changed = previous.contentKey !== this.props.contentKey;
    if (changed) {
      this.cancel();
      this.clearMask();
      if (snapshot) {
        this.ghost.current?.replaceChildren(snapshot);
        for (const node of [snapshot, ...snapshot.querySelectorAll<HTMLElement>('[data-refresh-scroll-top]')]) {
          node.scrollTop = Number(node.dataset.refreshScrollTop ?? 0);
          node.scrollLeft = Number(node.dataset.refreshScrollLeft ?? 0);
        }
      }
    }
    if (this.props.ready && (changed || !previous.ready)) {
      this.presentedKey = this.props.contentKey;
      if (this.ghost.current?.childElementCount && !this.motion?.matches) this.reveal();
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

  private clearMask = () => {
    if (this.current.current) this.current.current.style.maskImage = this.current.current.style.webkitMaskImage = 'none';
  };

  private finish = () => {
    this.cancel();
    this.clearMask();
    // A motion-preference/resize event while loading must retain the old view.
    if (!this.props.ready) return;
    this.ghost.current?.replaceChildren();
    if (this.stage.current) this.stage.current.dataset.refreshState = 'ready';
  };

  private reveal() {
    this.cancel();
    const stage = this.stage.current!, current = this.current.current!, edge = this.edge.current!;
    stage.dataset.refreshState = 'revealing';
    const width = stage.clientWidth;
    const paint = (front: number) => {
      const mask = `linear-gradient(to right, #000 ${front - 160}px, transparent ${front}px)`;
      current.style.maskImage = current.style.webkitMaskImage = mask;
      edge.style.left = `${front - 160}px`;
    };
    paint(0);
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 320);
      paint((width + 160) * (1 - (1 - progress) ** 2));
      if (progress < 1) this.frame = requestAnimationFrame(tick);
      else this.finish();
    };
    this.frame = requestAnimationFrame(tick);
    // Cleanup is independent of animation events and throttled background frames.
    this.cleanupTimer = setTimeout(this.finish, 370);
  }

  render() {
    const { contentKey, ready, label, pendingLabel, className = '', children } = this.props;
    const waiting = !ready && this.presentedKey !== null;
    return <div className={`soft-refresh ${className}`} ref={this.stage} data-content-key={contentKey}>
      <div className="soft-refresh-ghost" ref={this.ghost} aria-hidden="true" inert />
      <div className="soft-refresh-current" ref={this.current} inert={waiting} aria-hidden={waiting || undefined} style={{ visibility: waiting ? 'hidden' : undefined }}>{children}</div>
      <div className="soft-refresh-edge" ref={this.edge} aria-hidden="true" />
      {waiting && <p className="lookup-pending" role="status">{label} · {pendingLabel}</p>}
    </div>;
  }
}
