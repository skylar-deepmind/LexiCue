import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReadingFollowRecovery, createReadingScrollMotion, readingFollowDestination } from '../readingFollow';

function setup(integer = false) {
  let time = 0, id = 0, position = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const port = { get scrollTop() { return position; }, set scrollTop(value: number) { position = integer ? Math.round(value) : value; }, scrollHeight: 5000, clientHeight: 700 };
  const motion = createReadingScrollMotion(port, { request: callback => { frames.set(++id, callback); return id; }, cancel: key => { frames.delete(key); }, now: () => time });
  const tick = () => { time += 16; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); };
  const settle = () => { for (let i = 0; i < 100 && frames.size; i++) tick(); expect(frames.size).toBe(0); };
  return { port, motion, tick, settle, frames };
}

describe('reading follows the spoken sentence', () => {
  it('keeps the opening at the top, centers later sentences, and bounds the end', () => {
    expect(readingFollowDestination(0, 30, 40, 600, 3000)).toBe(0);
    expect(readingFollowDestination(200, 420, 40, 600, 3000)).toBe(340);
    expect(readingFollowDestination(2600, 680, 40, 600, 2800)).toBe(2800);
  });
  it('keeps the beginning of a tall spoken paragraph visible', () => {
    expect(readingFollowDestination(300, 200, 900, 600, 4000)).toBe(476);
  });
  it('accelerates softly and settles without jumping or overshooting', () => {
    const s = setup(); s.motion.move(600);
    expect(s.port.scrollTop).toBe(0);
    s.tick(); const first = s.port.scrollTop;
    expect(first).toBeGreaterThan(0); expect(first).toBeLessThan(20);
    s.tick(); expect(s.port.scrollTop - first).toBeGreaterThan(first);
    let previous = s.port.scrollTop;
    for (let i = 0; i < 65; i++) { s.tick(); expect(s.port.scrollTop).toBeGreaterThanOrEqual(previous); expect(s.port.scrollTop).toBeLessThanOrEqual(600); previous = s.port.scrollTop; }
    s.settle(); expect(s.port.scrollTop).toBe(600);
  });
  it('retargets rapid sentence changes from the current position', () => {
    const s = setup(); s.motion.move(400); for (let i = 0; i < 8; i++) s.tick();
    const current = s.port.scrollTop; s.motion.move(800);
    expect(s.port.scrollTop).toBe(current); expect(s.frames.size).toBe(1);
    s.tick(); expect(s.port.scrollTop).toBeGreaterThan(current); expect(s.port.scrollTop).toBeLessThan(800);
    s.settle(); expect(s.port.scrollTop).toBe(800);
  });
  it('settles without overshooting when reflow brings the target closer', () => {
    const s = setup(); s.motion.move(900); for (let i = 0; i < 5; i++) s.tick();
    const target = s.port.scrollTop + 25; s.motion.move(target);
    for (let i = 0; i < 80; i++) { s.tick(); expect(s.port.scrollTop).toBeLessThanOrEqual(target); }
    s.settle(); expect(s.port.scrollTop).toBe(target);
  });
  it('cancels immediately for deliberate scrolling, pause, lookup, or exit', () => {
    const s = setup(); s.motion.move(600); s.tick(); s.motion.cancel(); s.port.scrollTop = 123;
    for (let i = 0; i < 20; i++) s.tick(); expect(s.port.scrollTop).toBe(123); expect(s.frames.size).toBe(0);
  });
  it('uses an immediate bounded position for reduced motion, including mid-animation', () => {
    const s = setup(); s.motion.move(600); s.tick(); s.motion.move(10000, true);
    expect(s.port.scrollTop).toBe(4300); expect(s.frames.size).toBe(0);
  });
  it('settles in integer-scroll WebViews and clamps to a shorter document', () => {
    const s = setup(true); s.motion.move(600.4); s.settle(); expect(s.port.scrollTop).toBe(600);
    s.motion.move(1000); s.port.scrollHeight = 1200; s.settle(); expect(s.port.scrollTop).toBe(500);
  });
});

describe('temporary manual scrolling', () => {
  afterEach(() => vi.useRealTimers());
  it('recovers three seconds after the last scroll, including momentum', () => {
    vi.useFakeTimers(); const recover = vi.fn(), idle = createReadingFollowRecovery(recover);
    idle.intent(); vi.advanceTimersByTime(2400); idle.scroll(); vi.advanceTimersByTime(2999); expect(recover).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(recover).toHaveBeenCalledTimes(1);
  });
  it('does not count auto-follow scroll frames as new manual activity', () => {
    vi.useFakeTimers(); const recover = vi.fn(), idle = createReadingFollowRecovery(recover);
    idle.scroll(); vi.advanceTimersByTime(4000); expect(recover).not.toHaveBeenCalled();
    idle.intent(); vi.advanceTimersByTime(3000); idle.scroll(); vi.advanceTimersByTime(4000); expect(recover).toHaveBeenCalledTimes(1);
  });
  it('waits until the scrollbar is released, then counts from its last movement', () => {
    vi.useFakeTimers(); const recover = vi.fn(), idle = createReadingFollowRecovery(recover);
    idle.hold(); vi.advanceTimersByTime(6000); idle.scroll(); expect(recover).not.toHaveBeenCalled();
    idle.release(); vi.advanceTimersByTime(2000); idle.scroll(); vi.advanceTimersByTime(2999); expect(recover).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(recover).toHaveBeenCalledTimes(1);
  });
  it('cancels recovery on pause, lookup, exit, or unmount', () => {
    vi.useFakeTimers(); const recover = vi.fn(), idle = createReadingFollowRecovery(recover);
    idle.intent(); vi.advanceTimersByTime(2000); idle.cancel(); idle.scroll(); vi.advanceTimersByTime(5000); expect(recover).not.toHaveBeenCalled();
    idle.intent(); vi.advanceTimersByTime(3000); expect(recover).toHaveBeenCalledTimes(1);
  });
});
