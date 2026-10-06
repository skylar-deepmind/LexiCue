import { describe, expect, it, vi } from 'vitest';
import { BackNavigation } from '../backNavigation';

describe('Back ownership', () => {
  it('closes only the top layer, then the parent, then the page', () => {
    const back = new BackNavigation();
    const page = vi.fn(() => true), parent = vi.fn(), child = vi.fn();
    back.setPage(page);
    const releaseParent = back.register(parent);
    const releaseChild = back.register(child);
    expect(back.back()).toBe(true);
    expect(child).toHaveBeenCalledOnce(); expect(parent).not.toHaveBeenCalled(); expect(page).not.toHaveBeenCalled();
    releaseChild(); back.back(); expect(parent).toHaveBeenCalledOnce();
    releaseParent(); back.back(); expect(page).toHaveBeenCalledOnce();
  });
  it('consumes repeated Back while a save is pending, including failed saves', async () => {
    const back = new BackNavigation();
    let reject!: (error: Error) => void;
    const save = vi.fn(() => new Promise<boolean>((_resolve, fail) => { reject = fail; }));
    const page = vi.fn(() => true);
    back.setPage(page); back.register(save);
    back.back(); back.back(); expect(save).toHaveBeenCalledOnce();
    reject(new Error('offline'));
    await new Promise(resolve => setTimeout(resolve, 0));
    back.back(); expect(save).toHaveBeenCalledTimes(2); expect(page).not.toHaveBeenCalled();
    reject(new Error('offline'));
  });
  it('retains an editor when closing is refused or throws', () => {
    const back = new BackNavigation();
    const page = vi.fn(() => true);
    back.setPage(page);
    const release = back.register(() => false);
    expect(back.back()).toBe(true); expect(back.hasLayers()).toBe(true);
    release(); back.register(() => { throw new Error('save failed'); });
    expect(back.back()).toBe(true); expect(page).not.toHaveBeenCalled();
  });
  it('lets the page own reader Back, independent of parent effect order', () => {
    const back = new BackNavigation();
    const file = vi.fn(() => true), shell = vi.fn(() => false);
    const releaseFile = back.setPage(file, 10);
    back.setPage(shell);
    back.back(); expect(file).toHaveBeenCalledOnce(); expect(shell).not.toHaveBeenCalled();
    releaseFile(); expect(back.back()).toBe(false);
  });
  it('returns control to the system at a root page and cleans up ownership', () => {
    const back = new BackNavigation();
    expect(back.back()).toBe(false);
    const release = back.setPage(() => true);
    expect(back.back()).toBe(true); release(); expect(back.back()).toBe(false);
    expect(back.dismiss()).toBe(false);
  });
});
