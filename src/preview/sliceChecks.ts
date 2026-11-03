import { assertSlicePreview } from './slicePreview';
import { invoke } from '@tauri-apps/api/core';
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import type { SavedGroupPage } from '../lib/savedRecords';
/** Native checks are implemented with production DOM and IPC, never a mock. */
export async function runSliceChecks() {
  await assertSlicePreview();
  const report: { runtime: string; ipc: string; checks: string[]; geometry: unknown[]; errors: string[]; passed: boolean } = {
    runtime: navigator.userAgent, ipc: 'native Tauri + isolated SQLite', checks: [], geometry: [], errors: [], passed: false,
  };
  const check = (condition: unknown, label: string) => { if (!condition) throw new Error(label); report.checks.push(label); };
  const until = async <T,>(fn: () => T | Promise<T>, label: string, timeout = 15000): Promise<NonNullable<T>> => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = await fn(); if (value) return value as NonNullable<T>; await new Promise(r => setTimeout(r, 40)); }
    throw new Error(`Timeout: ${label}`);
  };
  const button = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  const click = async (id: string) => { const b = await until(() => button(id), id); check(!b.disabled, `${id} enabled`); b.click(); };
  const settle = () => until(() => !document.getAnimations().some(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity), 'motion settles');
  const count = async () => (await invoke<SavedGroupPage>('list_saved_groups', { query: '', limit: 50, offset: 0 })).total_records;
  const word = async (text: string) => {
    const n = await until(() => [...document.querySelectorAll<HTMLButtonElement>('.reading-word')].find(n => n.textContent === text), `word ${text}`);
    n.click(); await until(() => document.querySelector('.lookup-heading h2')?.textContent === text, `lookup ${text}`); await settle();
  };
  const phrase = async () => {
    const p = await until(() => document.querySelector<HTMLElement>('[data-sentence="5"] .reading-original'), 'phrase sentence');
    const from = p.textContent!.indexOf('take off'), to = from + 8;
    check(from >= 0, 'phrase found in original sentence');
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let at = 0, start: [Node, number] | undefined, end: [Node, number] | undefined;
    while (walker.nextNode()) {
      const node = walker.currentNode, length = node.textContent!.length;
      if (!start && at + length > from) start = [node, from - at];
      if (at + length >= to) { end = [node, to - at]; break; } at += length;
    }
    if (!start || !end) throw new Error('phrase DOM range missing');
    const range = document.createRange(); range.setStart(...start); range.setEnd(...end);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await until(() => document.querySelector('.lookup-heading h2')?.textContent === 'take off', 'phrase lookup'); await settle();
  };
  const shapes = () => [...document.querySelectorAll<HTMLElement>('.reading-original')].map(n => {
    const r = n.getBoundingClientRect(); return { width: r.width, height: r.height, y: r.y };
  });
  const onError = (e: ErrorEvent) => report.errors.push(e.message);
  const onRejection = (e: PromiseRejectionEvent) => report.errors.push(String(e.reason));
  window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
  const originalTheme = document.documentElement.dataset.theme;
  try {
    await until(() => button('desk-continue'), 'initial desk');
    const baseline = await count();
    check(baseline === 1, 'one seeded context, no fabricated dictionary records');
    await click('desk-continue');
    await until(() => document.querySelector('.reading-word'), 'real reading material'); await document.fonts.ready; await settle();
    for (const theme of ['ocean', 'midnight']) {
      document.documentElement.dataset.theme = theme;
      const closed = shapes();
      await word('coat');
      const opened = shapes();
      report.geometry.push({ theme, closed, opened });
      check(closed.length === opened.length && closed.every((r, i) => Math.abs(r.width - opened[i].width) < 1 && Math.abs(r.height - opened[i].height) < 1), `${theme}: lookup preserves line width and wraps`);
      await until(() => document.querySelector('[data-lookup-state="ready"]'), 'local dictionary completes');
      check(!button('lookup-records-tab'), `${theme}: no empty records tab`);
      await click('lookup-save'); await until(async () => await count() === baseline + 1, 'saved native context');
      await until(() => button('lookup-records-tab'), 'first save adds records tab'); await settle();
      const heading = document.querySelector('.lookup-heading h2');
      const tabs = document.querySelector('.lookup-tabs');
      await click('lookup-records-tab'); await settle();
      check(document.querySelector('.lookup-heading h2') === heading && document.querySelector('.lookup-tabs') === tabs, `${theme}: heading and tab nodes stable`);
      await click('lookup-undo'); await until(async () => await count() === baseline, 'undo first context');
      await until(() => !button('lookup-undo'), 'undo response rendered');
      check(!button('lookup-undo'), `${theme}: receipt cleared after undo`);
      await until(() => document.querySelector('.longman-result'), 'meaning restored after last record undo');
      check(!button('lookup-records-tab'), `${theme}: last record undo returns to meaning`);
      await phrase(); await until(() => button('lookup-records-tab'), 'prior context shown');
      check(await count() === baseline, `${theme}: recall does not save`);
      await click('lookup-save'); await until(async () => await count() === baseline + 1, 'append current phrase context');
      await word('coat'); await phrase();
      await until(() => button('lookup-undo'), 'receipt survives changing query');
      check(await count() === baseline + 1, `${theme}: re-query does not append`);
      await click('lookup-close'); await until(() => !document.querySelector('.context-panel'), 'lookup exits');
      await phrase(); await until(() => button('lookup-undo'), 'receipt survives close');
      await click('lookup-undo'); await until(async () => await count() === baseline, 'only current context undone');
      await click('lookup-close'); await until(() => !document.querySelector('.context-panel'), 'close after undo'); await settle();
      check(!document.querySelector('.refresh-outgoing > *'), `${theme}: no leftover refresh snapshot`);
    }
    check(report.errors.length === 0, 'no runtime errors or unhandled rejections');
    report.passed = true;
  } catch (error) {
    report.errors.push(String(error));
  } finally {
    document.documentElement.dataset.theme = originalTheme;
    window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection);
    await writeTextFile('slice-qa-native.json', JSON.stringify(report, null, 2), { baseDir: BaseDirectory.AppData });
    console.info('Slice native checks', report);
  }
}
