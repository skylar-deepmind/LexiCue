// One quiet replacement timeline for the lookup card and its pinned footer.
import React, { Component, createRef, type ReactNode } from 'react';
import './soft-content-refresh.css';

interface Props {
  contentKey: string;
  ready: boolean;
  label: string;
  pendingLabel: string;
  className?: string;
  resizeContainer?: string;
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
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private changedAt = 0;
  private cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  private motion: MediaQueryList | undefined;
  private previousHeight: number | null = null;
  private previousIndicator: { left: number; width: number } | null = null;
  private indicatorMotion: { nodes: HTMLElement[]; from: { left: number; width: number }; to: { left: number; width: number } } | null = null;
  private sizing: { panel: HTMLElement; from: number; to: number } | null = null;

  componentDidMount() {
    this.motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener('change', this.finish);
    window.addEventListener('resize', this.finish);
    if (this.props.ready) this.presentedKey = this.props.contentKey;
  }

  getSnapshotBeforeUpdate(previous: Props): HTMLElement | null {
    if (previous.contentKey === this.props.contentKey || this.presentedKey === null) return null;
    const current = this.current.current, stage = this.stage.current;
    if (!current || !stage) return null;
    const panel = this.props.resizeContainer ? stage.closest<HTMLElement>(this.props.resizeContainer) : null;
    this.previousHeight = panel?.getBoundingClientRect().height ?? null;
    if (panel && !panel.hasAttribute('data-refresh-transition')) {
      const body = current.querySelector<HTMLElement>('.lookup-body');
      if (body) {
        panel.style.setProperty('--lookup-scrollbar-width', `${body.offsetWidth - body.clientWidth}px`);
        panel.style.setProperty('--lookup-body-padding', getComputedStyle(body).paddingRight);
      }
      const reader = [...document.querySelectorAll<HTMLElement>('.reader-scroll')].find(n=>!n.closest('[inert],[aria-hidden="true"]'));
      if (reader) reader.style.setProperty('--lookup-reader-padding', `${parseFloat(getComputedStyle(reader).paddingRight) + reader.offsetWidth - reader.clientWidth}px`);
    }
    const indicator = current.querySelector<HTMLElement>('.lookup-tab-indicator');
    this.previousIndicator = indicator ? { left: indicator.offsetLeft, width: indicator.getBoundingClientRect().width } : null;
    const frame = document.createElement('div');
    frame.className = 'soft-refresh-frame';
    frame.style.height = `${stage.getBoundingClientRect().height}px`;
    const copy = (source: HTMLElement, opacity?: string) => {
      const clone = source.cloneNode(true) as HTMLElement;
      const sources = [source, ...source.querySelectorAll<HTMLElement>('*')];
      const targets = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
      sources.forEach((node, index) => {
        const target = targets[index];
        target.classList.replace('soft-refresh-current', 'soft-refresh-snapshot');
        target.removeAttribute('id'); target.removeAttribute('autofocus');
        target.removeAttribute('data-user-scrolling');
        target.removeAttribute('data-refresh-scroll-top'); target.removeAttribute('data-refresh-scroll-left');
        target.style.animation = 'none'; target.style.transition = 'none';
        if (node.scrollTop || node.scrollLeft) {
          target.dataset.refreshScrollTop = String(node.scrollTop);
          target.dataset.refreshScrollLeft = String(node.scrollLeft);
        }
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
      this.changedAt = performance.now();
      this.finishIndicator();
      if (snapshot) {
        this.holdSize();
        this.ghost.current?.replaceChildren(snapshot);
        for (const node of [snapshot, ...snapshot.querySelectorAll<HTMLElement>('[data-refresh-scroll-top]')]) {
          node.scrollTop = Number(node.dataset.refreshScrollTop ?? 0);
          node.scrollLeft = Number(node.dataset.refreshScrollLeft ?? 0);
        }
      }
      if (this.ghost.current?.childElementCount) this.stage.current!.dataset.refreshState = 'waiting';
    }
    if (this.props.ready && (changed || !previous.ready)) {
      if (this.ghost.current?.childElementCount && !this.motion?.matches) {
        this.settleTimer = setTimeout(() => {
          if (!this.props.ready) return;
          this.presentedKey = this.props.contentKey;
          this.prepareSize(); this.prepareIndicator(); this.reveal();
        }, Math.max(0, 140 - (performance.now() - this.changedAt)));
      }
      else this.finish();
    } else if (changed && this.ghost.current?.childElementCount) {
      this.stage.current!.dataset.refreshState = 'waiting';
    }
  }

  componentWillUnmount() {
    this.cancel();
    this.finishSize();
    this.finishIndicator();
    this.motion?.removeEventListener('change', this.finish);
    window.removeEventListener('resize', this.finish);
  }

  private cancel = () => {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.cleanupTimer);
    clearTimeout(this.settleTimer);
  };

  private prepareIndicator = () => {
    this.finishIndicator();
    const target = this.current.current?.querySelector<HTMLElement>('.lookup-tabs button.active');
    const indicator = this.current.current?.querySelector<HTMLElement>('.lookup-tab-indicator');
    if (!target || !indicator || !this.previousIndicator) return;
    // The incoming header owns its pill; snapshots never receive live styles.
    this.indicatorMotion = { nodes: [indicator], from: this.previousIndicator, to: { left: target.getBoundingClientRect().left - target.parentElement!.getBoundingClientRect().left, width: target.getBoundingClientRect().width } };
  };

  private finishIndicator = () => {
    this.indicatorMotion?.nodes.forEach(node => { node.style.removeProperty('left'); node.style.removeProperty('width'); });
    this.indicatorMotion = null;
  };

  private holdSize = () => {
    const panel = this.props.resizeContainer ? this.stage.current?.closest<HTMLElement>(this.props.resizeContainer) : null;
    if (!panel || this.previousHeight === null) return;
    this.finishSize();
    this.sizing = { panel, from: this.previousHeight, to: this.previousHeight };
    panel.dataset.refreshSizing = 'true';
    panel.dataset.refreshTransition = 'true';
    panel.style.height = `${this.previousHeight}px`;
  };

  private prepareSize = () => {
    const panel = this.props.resizeContainer ? this.stage.current?.closest<HTMLElement>(this.props.resizeContainer) : null;
    if (!panel || this.previousHeight === null) return;
    panel.style.removeProperty('height');
    delete panel.dataset.refreshSizing;
    // Measure the real new content and the existing viewport height cap.
    const to = panel.getBoundingClientRect().height;
    const from = this.previousHeight;
    this.sizing = { panel, from, to };
    panel.dataset.refreshSizing = 'true';
    panel.dataset.refreshTransition = 'true';
    panel.style.height = `${from}px`;
  };

  private finishSize = () => {
    if (!this.sizing) return;
    this.sizing.panel.style.removeProperty('height');
    delete this.sizing.panel.dataset.refreshSizing;
    delete this.sizing.panel.dataset.refreshTransition;
    this.sizing = null;
  };

  private finish = () => {
    this.cancel();
    this.finishIndicator();
    // Keep the old view and its height until the new content is ready.
    if (!this.props.ready) return;
    this.presentedKey = this.props.contentKey;
    this.finishSize();
    this.stage.current?.style.removeProperty('--refresh-opacity');
    this.ghost.current?.replaceChildren();
    if (this.stage.current) this.stage.current.dataset.refreshState = 'ready';
  };

  private reveal() {
    this.cancel();
    const stage = this.stage.current!;
    stage.dataset.refreshState = 'revealing';
    const shrinking = !!this.sizing && this.sizing.to < this.sizing.from;
    const paint = (progress: number, sizeProgress: number) => {
      stage.style.setProperty('--refresh-opacity', String(progress * progress * (3 - 2 * progress)));
      if (this.indicatorMotion) {
        const { nodes, from, to } = this.indicatorMotion;
        nodes.forEach(node => {
          node.style.left = `${from.left + (to.left - from.left) * progress}px`;
          node.style.width = `${from.width + (to.width - from.width) * progress}px`;
        });
      }
      if (this.sizing) {
        const { panel, from, to } = this.sizing;
        panel.style.height = `${from + (to - from) * sizeProgress}px`;
      }
    };
    paint(0, 0);
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - started) / 300));
      const sizeProgress = Math.max(0, Math.min(1, (now - started) / (shrinking ? 220 : 300)));
      paint(progress, 1 - (1 - sizeProgress) ** 3);
      if (progress < 1) this.frame = requestAnimationFrame(tick);
      else this.finish();
    };
    this.frame = requestAnimationFrame(tick);
    // Cleanup is independent of animation events and throttled background frames.
    this.cleanupTimer = setTimeout(this.finish, 350);
  }

  render() {
    const { contentKey, ready, label, pendingLabel, className = '', children } = this.props;
    const waiting = !ready && this.presentedKey !== null;
    return <div className={`soft-refresh ${className}`} ref={this.stage} data-content-key={contentKey}>
      <div className="soft-refresh-ghost" ref={this.ghost} aria-hidden="true" inert />
      <div className="soft-refresh-current" ref={this.current} inert={waiting} aria-hidden={waiting || undefined} style={{ visibility: waiting ? 'hidden' : undefined }}>{children}</div>
      {waiting && <p className="lookup-pending" role="status">{label} · {pendingLabel}</p>}
    </div>;
  }
}
