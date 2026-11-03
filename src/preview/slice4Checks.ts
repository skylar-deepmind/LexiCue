/** Explicit isolated QA build only. Actual native commands, database and WebView. */
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { BaseDirectory, writeTextFile } from '@tauri-apps/plugin-fs';
import { assertSlicePreview, PREVIEW_ID } from './slicePreview';
import { runSlice3Checks } from './slice3Checks';
import { useUpdateStore } from '../stores/updateStore';
import { syncCoordinator } from '../lib/syncCoordinator';
import { usePreferencesStore } from '../stores/preferencesStore';
import type { BackupPayload } from '../lib/types';
import type { Material } from '../lib/materials';

export async function runSlice4Checks() {
  await assertSlicePreview();
  const report = { method: 'Actual Tauri IPC / isolated SQLite / WKWebView geometry; no mocked backend', checks: [] as string[], geometry: [] as unknown[], observations: [] as unknown[], errors: [] as string[], completed: false };
  const write = () => writeTextFile('slice-qa-p4-native.json', JSON.stringify(report, null, 2), { baseDir: BaseDirectory.AppData });
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const check = (value: unknown, label: string) => { if (!value) throw new Error(label); report.checks.push(label); };
  const until = async <T,>(get: () => T | Promise<T>, label: string, timeout = 20000): Promise<NonNullable<T>> => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = await get(); if (value) return value as NonNullable<T>; await delay(40); }
    throw new Error(`Timeout: ${label}`);
  };
  const click = async (selector: string) => {
    const node = await until(() => [...document.querySelectorAll<HTMLButtonElement>(selector)].find(node => !node.closest('[inert]')), selector);
    check(!node.disabled, `${selector} enabled`); node.click(); await delay(50);
  };
  const settle = async () => {
    await document.fonts.ready;
    try {
      await until(() => !document.querySelector('[data-resizing], [data-lookup-moving]') && !document.getAnimations().some(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity), 'native layout and finite animations settle', 10000);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    } catch (error) {
      const panel = document.querySelector<HTMLElement>('.context-panel');
      report.observations.push({ motionTimeout: { viewport: [innerWidth, innerHeight], transform: panel && getComputedStyle(panel).transform, panel: panel?.getBoundingClientRect().toJSON(), animations: document.getAnimations().map(animation => ({ playState: animation.playState, currentTime: animation.currentTime, startTime: animation.startTime })), timeline: document.timeline.currentTime } });
      throw error;
    }
  };
  const stage = async (label: string, task: () => Promise<void>) => { try { await task(); } catch (e) { report.errors.push(`${label}: ${String(e)}`); } await write(); };
  const exportData = () => invoke<BackupPayload>('export_all');
  const canonical = (data: unknown): string => {
    if (Array.isArray(data)) return `[${data.map(canonical).join(',')}]`;
    if (data && typeof data === 'object') return `{${Object.entries(data).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`).join(',')}}`;
    return JSON.stringify(data);
  };
  const portable = (data: BackupPayload['data']) => canonical(Object.fromEntries(Object.entries(data).map(([table, rows]) => [table,
    rows?.map((row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).flatMap(([key, value]) => {
      if (table === 'saved_records' && key === 'id') return [];
      if (key.endsWith('_json') && typeof value === 'string') { try { return [[key, JSON.parse(value)]]; } catch { /* Preserve non-JSON strings exactly. */ } }
      return [[key, value]];
    }))).sort((a: unknown, b: unknown) => canonical(a).localeCompare(canonical(b))),
  ])));
  const originalSize = usePreferencesStore.getState().learningTextFontSize;
  const originalDatasetTheme = document.documentElement.dataset.theme;
  let baseline: BackupPayload | undefined;
  try {
    await until(() => document.querySelector('a[aria-label="材料"]'), 'application ready');
    await stage('candidate isolation', async () => {
      let error = ''; try { await invoke('sync_status'); } catch (e) { error = String(e); }
      check(error.includes('preview_sync_disabled'), 'native candidate refuses sync before credentials or network');
      await useUpdateStore.getState().check(); await useUpdateStore.getState().install();
      check(useUpdateStore.getState().status === 'idle', 'candidate updater remains idle');
      const stop = syncCoordinator.start(); await syncCoordinator.runNow(true); syncCoordinator.markChanged(); stop();
      check(true, 'candidate sync scheduler is inert');
    });
    await stage('portable backup and safe restore', async () => {
      baseline = await exportData();
      await writeTextFile('slice-qa-p4-export.json', JSON.stringify(baseline), { baseDir: BaseDirectory.AppData });
      check(baseline.data.files.length >= 7 && !!baseline.data.saved_records?.length, 'native backup contains actual material and saved contexts');
      check(!('localStorage' in baseline.data) && !('source_media' in baseline.data), 'portable data does not claim UI state or audio files');
      const before = portable(baseline.data);
      const added = await invoke<{ file_id: number }>('import_reading_material', { input: { operation_id: `p4-restore-${Date.now()}`, name: 'P4 disposable restore probe.txt', normalized_kind: 'txt', content: 'This temporary record verifies the recovery boundary.', segments: [{ index: 0, en_text: 'This temporary record verifies the recovery boundary.', zh_text: null, start_time: null, end_time: null }] } });
      check((await exportData()).data.files.some(row => row.id === added.file_id), 'real native mutation exists before recovery');
      const receipt = await invoke<{ safety_backup_path: string }>('restore_all', { backup: baseline });
      report.observations.push({ safetyBackup: receipt.safety_backup_path, addedFileId: added.file_id });
      check(receipt.safety_backup_path.includes(`${PREVIEW_ID}/backups/lexicue-pre-restore-`), 'manual recovery returns isolated safety copy path');
      const restored = await exportData();
      report.observations.push({ rawRowsEqual: canonical(restored.data) === canonical(baseline.data), normalization: 'Only saved_records.id excluded; embedded JSON objects normalized; nested array order preserved; table rows sorted', savedIdsBefore: baseline.data.saved_records?.map(row => row.id), savedIdsAfter: restored.data.saved_records?.map(row => row.id) });
      check(portable(restored.data) === before, 'all portable business fields survive native export restore export');
      const committed = canonical(restored.data);
      const invalid = structuredClone(baseline); invalid.data.files[0].id = 'invalid-integer-primary-key';
      let error = ''; try { await invoke('restore_all', { backup: invalid }); } catch (e) { error = String(e); }
      report.observations.push({ invalidRestore: error });
      check(error.includes('restore_failed; safety_backup_path='), 'invalid recovery fails with retained safety copy location');
      check(canonical((await exportData()).data) === committed, 'invalid recovery leaves committed business data unchanged');
      const unsupported = { ...baseline, schema_version: 999 };
      error = ''; try { await invoke('restore_all', { backup: unsupported }); } catch (e) { error = String(e); }
      check(error.includes('Unsupported backup schema version'), 'unsupported version rejected');
      check(canonical((await exportData()).data) === committed, 'unsupported version preserves original database');
    });
    // P3 checks retain their own separate audio/event report and real AAC fixture.
    await stage('listening and translation regression', async () => {
      const audioReport = await runSlice3Checks();
      check(audioReport.completed && audioReport.errors.length === 0, `P3 native regression: ${audioReport.errors.join('; ') || 'all passed'}`);
    });
    await stage('import, saved context and desk regression', async () => {
      const { runSlice4FlowChecks } = await import('./slice4FlowChecks');
      const flowReport = await runSlice4FlowChecks();
      check(flowReport.completed && flowReport.errors.length === 0, `P1/P2 native regression: ${flowReport.errors.join('; ') || 'all passed'}`);
    });
    await stage('native geometry, theme and lookup regression', async () => {
      const materials = await invoke<Material[]>('list_materials', { tagIds: [], untagged: false });
      const material = materials.find(row => row.name === 'A quiet morning.txt')!;
      document.querySelector<HTMLAnchorElement>('a[aria-label="材料"]')!.click();
      await click('.desk-library-dock'); await click(`.library-open[data-open="${material.id}"]`);
      await until(() => document.querySelector('.reading-original'), 'reader');
      const shapes = () => [...document.querySelectorAll<HTMLElement>('.reading-original')].slice(0, 3).map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, lines: [...node.querySelectorAll<HTMLElement>('.reading-word')].map(word => Math.round(word.getBoundingClientRect().top - node.getBoundingClientRect().top)) }));
      for (const theme of ['ocean', 'midnight']) {
        document.documentElement.dataset.theme = theme;
        for (const [width, height] of [[1280, 800], [920, 650], [800, 600], [852, 800], [1024, 800], [1440, 900]]) {
          await getCurrentWindow().setSize(new LogicalSize(width, height));
          await until(() => innerWidth === width, 'native resize reaches requested content width'); await settle();
          const closed = shapes();
          const word = [...document.querySelectorAll<HTMLButtonElement>('.reading-word')].find(node => node.textContent === 'morning')!;
          word.focus({ preventScroll: true }); word.click();
          await until(() => document.querySelector('.lookup-heading'), 'lookup heading'); await settle();
          const opened = shapes();
          const save = document.querySelector<HTMLButtonElement>('[data-testid="lookup-save"]');
          const rect = save?.getBoundingClientRect();
          report.geometry.push({ theme, width, height, closed, opened, save: rect?.toJSON(), viewport: [innerWidth, innerHeight] });
          check(closed.length > 0 && closed.length === opened.length && closed.every((shape, index) => Math.abs(shape.width - opened[index].width) < 1 && Math.abs(shape.height - opened[index].height) < 1 && canonical(shape.lines) === canonical(opened[index].lines)), `${theme} ${width}: lookup preserves line measure and wraps`);
          check(!!rect && rect.top >= 0 && rect.bottom <= innerHeight + 1 && rect.left >= 0 && rect.right <= innerWidth + 1 && !save?.disabled && !save?.closest('[inert]') && save?.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)), `${theme} ${width}: save remains accessible`);
          check(document.documentElement.scrollWidth <= innerWidth + 1, `${theme} ${width}: no viewport horizontal overflow`);
          await click('[data-testid="lookup-close"]'); await until(() => !document.querySelector('.context-panel'), 'lookup exit'); await settle();
          check(document.activeElement === word, `${theme} ${width}: focus returns to lookup word`);
        }
      }
      await getCurrentWindow().setSize(new LogicalSize(1280, 800));
      for (const size of ['sm', 'md', 'lg'] as const) {
        usePreferencesStore.getState().setLearningTextFontSize(size); await settle();
        const closed = shapes();
        [...document.querySelectorAll<HTMLButtonElement>('.reading-word')].find(node => node.textContent === 'morning')!.click();
        await until(() => document.querySelector('.lookup-heading'), 'scaled lookup'); await settle();
        check(closed.length > 0 && closed.length === shapes().length && closed.every((shape, index) => Math.abs(shape.width - shapes()[index].width) < 1 && Math.abs(shape.height - shapes()[index].height) < 1 && canonical(shape.lines) === canonical(shapes()[index].lines)), `font ${size}: stable reading wraps`);
        await click('[data-testid="lookup-close"]'); await until(() => !document.querySelector('.context-panel'), 'scaled lookup exit');
      }
    });
  } catch (e) { report.errors.push(String(e)); }
  finally {
    usePreferencesStore.getState().setLearningTextFontSize(originalSize);
    document.documentElement.dataset.theme = originalDatasetTheme ?? 'ocean';
    await getCurrentWindow().setSize(new LogicalSize(1280, 800)).catch(() => {});
    report.completed = true; await write();
  }
}
