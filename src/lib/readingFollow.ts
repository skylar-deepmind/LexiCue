interface ScrollPort { scrollTop: number; scrollHeight: number; clientHeight: number }
interface FrameClock {
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
  now: () => number;
}

/** Only real scroll input arms recovery; ensuing momentum extends the idle
 * deadline. Auto-follow frames never arm or postpone their own recovery. */
export function createReadingFollowRecovery(recover: () => void, delay = 3000) {
  let suspended = false, held = false, timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const schedule = () => {
    clear(); if (!suspended || held) return;
    timer = setTimeout(() => { timer = undefined; suspended = false; recover(); }, delay);
  };
  return {
    intent() { suspended = true; schedule(); },
    scroll() { if (suspended) schedule(); },
    hold() { suspended = true; held = true; clear(); },
    release() { if (held) { held = false; schedule(); } },
    cancel() { clear(); suspended = false; held = false; },
  };
}

/** Clamp at the beginning: early sentences stay at the top without a blank lead-in.
 * Tall sentences show their beginning instead of centering unread lines offscreen. */
export function readingFollowDestination(scrollTop: number, top: number, height: number, availableHeight: number, maxScroll: number): number {
  const inset = height > availableHeight * .8 ? 24 : (availableHeight - height) / 2;
  return Math.max(0, Math.min(maxScroll, scrollTop + top - inset));
}

/** Critically damped motion: smooth acceleration and settling, with no bounce.
 * Retarget from the current position/velocity when short sentences advance fast. */
export function createReadingScrollMotion(port: ScrollPort, clock: FrameClock = {
  request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id), now: () => performance.now(),
}) {
  let frame = 0, position = port.scrollTop, target = port.scrollTop, velocity = 0, last = 0;
  const cancel = () => { if (frame) clock.cancel(frame); frame = 0; velocity = 0; };
  const clamp = (value: number) => Math.max(0, Math.min(Math.max(0, port.scrollHeight - port.clientHeight), value));
  const step = (time: number) => {
    frame = 0;
    target = clamp(target);
    const dt = Math.max(0, Math.min(.064, (time - last) / 1000)); last = time;
    if (Math.abs(port.scrollTop - position) > 2) { position = port.scrollTop; velocity = 0; }
    const offset = position - target, omega = 14;
    const b = velocity + omega * offset, decay = Math.exp(-omega * dt);
    // Keep subpixel progress internally even in WebViews that round scrollTop.
    position = clamp(target + (offset + b * dt) * decay);
    port.scrollTop = position;
    velocity = (velocity - omega * b * dt) * decay;
    if (Math.abs(position - target) < .5 && Math.abs(velocity) < 5) { port.scrollTop = target; velocity = 0; return; }
    frame = clock.request(step);
  };
  return {
    cancel,
    move(destination: number, reducedMotion = false) {
      const next = clamp(destination);
      if (reducedMotion || Math.abs(next - port.scrollTop) < 1) { cancel(); port.scrollTop = next; return; }
      if ((next - port.scrollTop) * velocity < 0) velocity = 0;
      velocity = Math.sign(velocity) * Math.min(Math.abs(velocity), 14 * Math.abs(next - port.scrollTop));
      target = next;
      if (!frame) { position = port.scrollTop; last = clock.now(); frame = clock.request(step); }
    },
  };
}
