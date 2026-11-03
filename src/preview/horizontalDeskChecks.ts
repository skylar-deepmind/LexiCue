/** Measure the horizontal material deck in the native WKWebView. The stage,
 * pager and library stay still while actual neighbouring papers exchange places. */
import { invoke } from '@tauri-apps/api/core';
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { assertSlicePreview } from './slicePreview';
import { useMaterialStore } from '../stores/materialStore';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import { DESK_KEY, materialRef } from '../lib/readingDesk';
import type { MaterialImportResult } from '../lib/materials';

export async function runHorizontalDeskChecks() {
  await assertSlicePreview(); if (import.meta.env.VITE_SLICE_QA !== '1') throw Error('QA only');
  const report = { checks: [] as string[], errors: [] as string[], turns: [] as unknown[], completed: false };
  const check = (ok: unknown, label: string) => (ok ? report.checks : report.errors).push(label);
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const live = <T extends HTMLElement = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)].find(n => n.getClientRects().length && !n.closest('[inert],[aria-hidden="true"]') && getComputedStyle(n).visibility !== 'hidden');
  const until = async <T,>(fn: () => T, label: string) => { const end = performance.now() + 12000; while (performance.now() < end) { const v = fn(); if (v) return v; await wait(20); } throw Error(`Timeout ${label}`); };
  const oldTheme = document.documentElement.dataset.theme, oldDesk = localStorage.getItem(DESK_KEY), nativeMatch = window.matchMedia;
  let reduced = false; const preference = new EventTarget() as MediaQueryList; Object.defineProperty(preference, 'matches', { get: () => reduced });
  window.matchMedia = query => query === '(prefers-reduced-motion: reduce)' ? preference : nativeMatch.call(window, query);
  let content: HTMLElement | undefined, viewport: HTMLElement | undefined;
  const names = ['The unusually long title about a quiet morning, a changing city, and a fresh beginning.txt', 'Short.txt', 'A material with several wrapped labels.txt', 'An unexpectedly long continuous title'.repeat(3) + '.txt', 'The final material.txt'];
  try {
    live<HTMLAnchorElement>('.b-dock a[href="/files"]')!.click(); await wait(550);
    const ids: number[] = [];
    for (const [i, name] of names.entries()) {
      const lines = [`A short line from material ${i + 1}.`, i % 2 ? 'We took a walk.' : 'We walked across the quiet city and noticed many small details that made this morning feel like a fresh beginning.'];
      const imported = await invoke<MaterialImportResult>('import_reading_material', { input: { operation_id: `horizontal-desk-qa-v1-${i}`, name, normalized_kind: 'txt', content: lines.join('\n'), segments: lines.map((text, index) => ({ index, en_text: text, zh_text: null, start_time: null, end_time: null })) } }); ids.push(imported.file_id);
    }
    await useMaterialStore.getState().load(); await wait(300);
    // Tag metadata is a controlled UI fixture; it never writes tags to SQLite.
    const files = useMaterialStore.getState().files.map(f => f.id === ids[2] ? { ...f, tags: Array.from({ length: 8 }, (_, i) => ({ id: 100000 + i, name: `Long label number ${i + 1}`, created_at: 0 })) } : f);
    useMaterialStore.setState({ files }); useReadingDeskStore.getState().reconcile(files);
    const fixtures = ids.map(id => files.find(f => f.id === id)!);
    for (const file of fixtures) localStorage.setItem(`lexicue-reader-state:${file.content_hash}`, JSON.stringify({ segment: 1, offset: 0, hash: file.content_hash }));
    const desk = { version: 2, initialized: true, items: fixtures.map(materialRef), selected: materialRef(fixtures[0]), opened: [] };
    localStorage.setItem(DESK_KEY, JSON.stringify(desk)); useReadingDeskStore.getState().acceptExternal(JSON.stringify(desk));
    await until(() => live('.desk-stack > .desk-paper[data-desk-active="true"] h2')?.textContent === names[0], 'fixture desk'); await document.fonts.ready; await wait(350);
    content = live('.reading-stage-content')!; viewport = live('.materials-scroll')!;
    const active = () => live<HTMLElement>('.desk-stack > .desk-paper[data-desk-active="true"]')!;
    const snap = () => {
      const frame = live('.desk-stack')!.getBoundingClientRect(), pager = live('.desk-pager')!.getBoundingClientRect(), dock = live('.desk-library-dock')!.getBoundingClientRect();
      const matrix = new DOMMatrixReadOnly(getComputedStyle(active()).transform);
      return { frameY: frame.y, height: frame.height, pagerY: pager.y, dockY: dock.y, scroll: viewport!.scrollTop, contentY: matrix.m42 };
    };
    const sample = async (step: number, label: string) => {
      const before = snap(), frames: ReturnType<typeof snap>[] = [];
      const button = live<HTMLButtonElement>(step > 0 ? '[data-testid="desk-next"]' : '[data-testid="desk-prev"]')!;
      const start = performance.now(); const sampling = new Promise<void>(resolve => { const tick = () => { frames.push(snap()); if (performance.now() - start < 760) requestAnimationFrame(tick); else resolve(); }; requestAnimationFrame(tick); });
      button.click(); await sampling;
      const deviations = Object.fromEntries(Object.keys(before).map(key => [key, Math.max(...frames.map(f => Math.abs(f[key as keyof typeof f] - before[key as keyof typeof before])))]));
      report.turns.push({ label, before, deviations, frames: frames.length });
      check(Object.values(deviations).every(delta => delta < .75), `${label}: stage, pager, library and scroll stay fixed throughout every frame`);
      check(!document.querySelector('.turning-paper') && !live('.desk-stack')?.hasAttribute('data-turning'), `${label}: transition leaves no ghost or unfinished state`);
      check(document.querySelectorAll('.desk-stack > .desk-paper:not([inert])').length === 1, `${label}: only the current material can receive input`);
    };
    for (const theme of ['ocean', 'midnight']) for (const profile of ['normal', 'compact']) {
      document.documentElement.dataset.theme = theme;
      content.style.maxWidth = profile === 'compact' ? '680px' : ''; viewport.style.height = profile === 'compact' ? '540px' : '';
      await wait(180); viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight; await wait(100);
      check(!document.querySelector('.stack-layer'), `${theme}/${profile}: real material papers without decorative stacked layers`);
      check(live<HTMLButtonElement>('[data-testid="desk-prev"]')!.disabled, `${theme}/${profile}: previous boundary remains disabled`);
      for (let i = 1; i < 5; i++) { await sample(1, `${theme}/${profile}/next-${i}`); check(active().querySelector('h2')!.textContent === names[i], `${theme}/${profile}: forward order ${i}`); }
      check(live<HTMLButtonElement>('[data-testid="desk-next"]')!.disabled, `${theme}/${profile}: next boundary remains disabled`);
      for (let i = 3; i >= 0; i--) { await sample(-1, `${theme}/${profile}/previous-${i}`); check(active().querySelector('h2')!.textContent === names[i], `${theme}/${profile}: backward order ${i}`); }
      check(!document.querySelector('.desk-scene-label') && !live('.materials-heading')?.textContent?.includes('最近阅读'), `${theme}/${profile}: no redundant recent-reading caption`);
      const neighbours = [...document.querySelectorAll<HTMLElement>('.desk-stack > .desk-paper[data-desk-active="false"]')].filter(p => getComputedStyle(p).visibility !== 'hidden');
      check(neighbours.length === 1 && neighbours.every(p => p.inert && p.getAttribute('aria-hidden') === 'true' && Math.abs(Number(p.dataset.deskPosition)) === 1), `${theme}/${profile}: only the actual adjacent material peeks through and remains inert`);
      const frame = live('.desk-stack')!.getBoundingClientRect();
      check(active().getBoundingClientRect().bottom <= frame.bottom + 1, `${theme}/${profile}: content fits its shared frame without clipping the action`);
    }
    content.style.maxWidth = ''; viewport.style.height = ''; await wait(150);
    const next = live<HTMLButtonElement>('[data-testid="desk-next"]')!; next.focus({ preventScroll: true }); next.click(); await wait(70); next.click(); next.click(); await wait(1400);
    check(active().querySelector('h2')!.textContent === names[2] && !document.querySelector('.turning-paper'), 'rapid clicks keep one bounded queued turn and the correct final material');
    next.click(); await wait(60); live<HTMLButtonElement>('[data-testid="desk-prev"]')!.click(); await wait(1400);
    check(active().querySelector('h2')!.textContent === names[2], 'reversing while turning settles on the final requested direction');
    reduced = true; preference.dispatchEvent(new Event('change')); const beforeReduced = snap(); next.click(); await wait(90);
    check(active().querySelector('h2')!.textContent === names[3] && !document.querySelector('.turning-paper') && Math.abs(snap().pagerY - beforeReduced.pagerY) < .75, 'reduced motion changes material immediately without changing page geometry');
    reduced = false; preference.dispatchEvent(new Event('change')); live<HTMLButtonElement>('[data-testid="desk-prev"]')!.click(); await wait(80); window.dispatchEvent(new Event('resize')); await wait(100);
    check(!document.querySelector('.turning-paper'), 'resize finishes the current content transition without leftover layers');
    next.click(); await wait(60); live<HTMLButtonElement>('.desk-library-dock')!.click(); await until(() => live('.library-overlay-panel'), 'library'); await wait(100);
    check(!document.querySelector('.turning-paper'), 'opening the library cancels a page turn cleanly');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(550);
    const selected = useReadingDeskStore.getState().desk.selected!.id;
    active().querySelector<HTMLButtonElement>('.desk-primary')!.click(); await until(() => live('.reading-title'), 'read selected');
    check(location.pathname === `/files/${selected}`, 'continue reading opens the selected material, never a reserved inactive paper');
    live<HTMLAnchorElement>('.b-dock a[href="/files"]')!.click(); await wait(500);
  } catch (error) { report.errors.push(String(error)); }
  finally {
    if (content?.isConnected) content.style.removeProperty('max-width'); if (viewport?.isConnected) viewport.style.removeProperty('height');
    window.matchMedia = nativeMatch; reduced = false; preference.dispatchEvent(new Event('change')); document.documentElement.dataset.theme = oldTheme ?? 'ocean';
    await useMaterialStore.getState().load(); if (oldDesk === null) localStorage.removeItem(DESK_KEY); else localStorage.setItem(DESK_KEY, oldDesk); useReadingDeskStore.getState().acceptExternal(oldDesk);
    report.completed = true; await writeTextFile('mac-release-horizontal-desk.json', JSON.stringify(report, null, 2), { baseDir: BaseDirectory.AppData });
    const status = document.createElement('p'); status.textContent = `展卡验收：${report.checks.length} 通过，${report.errors.length} 问题`; status.style.cssText = 'position:fixed;top:40px;right:24px;z-index:9999;padding:16px;background:var(--surface);color:var(--text-strong)'; document.body.append(status);
  }
  return report;
}
