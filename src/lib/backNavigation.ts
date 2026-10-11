export type CloseAction = () => void | boolean | Promise<void | boolean>;

/** One owner handles each Back/Escape, including while an asynchronous save is pending. */
export class BackNavigation {
  private layers: { token: symbol; close: CloseAction }[] = [];
  private pending = new Set<symbol>();
  private pages: { handler: () => boolean; priority: number }[] = [];

  register(close: CloseAction) {
    const token = Symbol();
    this.layers.push({ token, close });
    return () => { this.layers = this.layers.filter(layer => layer.token !== token); };
  }
  setPage(handler: () => boolean, priority = 0) {
    const page = { handler, priority };
    this.pages.push(page);
    return () => { this.pages = this.pages.filter(item => item !== page); };
  }
  hasLayers() { return this.layers.length > 0; }
  dismiss() {
    const layer = this.layers.at(-1);
    if (!layer) return false;
    if (this.pending.has(layer.token)) return true;
    this.pending.add(layer.token);
    try {
      const result = layer.close();
      if (result instanceof Promise) void result.catch(() => {}).finally(() => this.pending.delete(layer.token));
      else this.pending.delete(layer.token);
    } catch { this.pending.delete(layer.token); }
    return true;
  }
  back() {
    if (this.dismiss()) return true;
    const page = this.pages.reduce<typeof this.pages[number] | undefined>((top, next) =>
      !top || next.priority >= top.priority ? next : top, undefined);
    return page?.handler() ?? false;
  }
}

export const backNavigation = new BackNavigation();

/** In Android, UI Back takes the same IME-first path as the system gesture. */
export function requestBackNavigation() {
  const native = (window as Window & { LexiCueSystemUi?: { requestBack?: () => void } }).LexiCueSystemUi;
  if (native?.requestBack) native.requestBack();
  else backNavigation.back();
}

export function blocksPageShortcut(event: KeyboardEvent) {
  const target = event.target;
  return backNavigation.hasLayers() || target instanceof HTMLElement &&
    (target.isContentEditable || !!target.closest('input, textarea, select, [role="combobox"]') ||
      [' ', 'Enter'].includes(event.key) && !!target.closest('button, a, [role="button"]'));
}
