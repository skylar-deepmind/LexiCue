import { describe, expect, it, vi } from 'vitest';
import { rememberImportFocus, takeImportFocus } from './importFocus';

describe('import focus owner', () => {
  it('focuses and returns the activated button once', () => {
    const element = {isConnected: true, focus: vi.fn()} as unknown as HTMLElement;
    rememberImportFocus(element);
    expect(element.focus).toHaveBeenCalledWith({preventScroll:true});
    expect(takeImportFocus()).toBe(element);
    expect(takeImportFocus()).toBeNull();
  });
  it('does not restore focus to an unmounted entry', () => {
    const element = {isConnected: false, focus: vi.fn()} as unknown as HTMLElement;
    rememberImportFocus(element);
    expect(takeImportFocus()).toBeNull();
  });
});
