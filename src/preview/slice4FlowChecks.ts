/** QA build only: production DOM/Workers/native IPC, with no command replacement.
 * Creates labelled disposable fixtures; caller restores its exported QA baseline.
 * OS clipboard/picker, real URL fetch, and trusted keyboard input remain separate native QA.
 * Text fixtures enter through the production import store, without changing the OS clipboard.
 */
import { invoke } from '@tauri-apps/api/core';
import { BaseDirectory, writeTextFile } from '@tauri-apps/plugin-fs';
import { assertSlicePreview } from './slicePreview';
import { useImportStore } from '../stores/importStore';
import { inspectClipboardContent } from '../lib/clipboardContent';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import type { Material, ReadingMaterial } from '../lib/materials';
import type { SavedGroupPage, SavedMutationResult, SavedRecord } from '../lib/savedRecords';

export async function runSlice4FlowChecks() {
  await assertSlicePreview();
  if (import.meta.env.VITE_SLICE_QA !== '1' || import.meta.env.VITE_SLICE_P4 !== '1') throw Error('P4 flow checks require explicit isolated QA build');
  const report = { method: 'Production React DOM events + controlled text via import store + document Worker + real Tauri SQLite IPC in WKWebView; OS clipboard separately verified', checks: [] as string[], fixtures: [] as unknown[], observations: [] as unknown[], errors: [] as string[], completed: false, cleanup: 'Labelled P4 QA flow materials/records retained for evidence; caller must restore its exported QA baseline. No source-media fixtures modified.' };
  const originalTheme = document.documentElement.dataset.theme;
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const check = (value: unknown, label: string) => { if (!value) throw Error(label); report.checks.push(label); };
  const until = async <T,>(read: () => T | Promise<T>, label: string, timeout = 20000): Promise<NonNullable<T>> => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = await read(); if (value) return value as NonNullable<T>; await delay(40); }
    throw Error(`Timeout: ${label}`);
  };
  const live = <T extends HTMLElement = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)].find(node => !node.closest('[inert]') && node.getClientRects().length > 0);
  const click = async (selector: string) => {
    const node = await until(() => live<HTMLButtonElement>(selector), selector);
    check(!node.disabled, `${selector} enabled`); node.click(); await delay(60);
  };
  const fill = async (selector: string, value: string) => {
    const node = await until(() => live<HTMLInputElement | HTMLTextAreaElement>(selector), selector);
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true })); await delay(80);
  };
  const settle = async () => { await document.fonts.ready; await delay(650); };
  const escape = async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle(); };
  const files = () => invoke<Material[]>('list_materials', { tagIds: [], untagged: false });
  const groups = (query: string) => invoke<SavedGroupPage>('list_saved_groups', { query, limit: 50, offset: 0 });
  const desk = () => structuredClone(useReadingDeskStore.getState().desk);
  const openImport = async () => { await click('.dock-import-slot button'); await until(() => live('.lc-import-sources'), 'compact import entry'); };
  const preview = async (text: string) => {
    await useImportStore.getState().fromContent('clipboard', text);
    await until(() => useImportStore.getState().phase === 'preview' && useImportStore.getState().items[0]?.draft, 'real Worker preview');
  };
  const word = async (text: string) => {
    const node = await until(() => [...document.querySelectorAll<HTMLButtonElement>('.reading-word')].find(node => node.textContent === text && !node.closest('[inert]')), text);
    node.click(); await until(() => live('.lookup-heading h2')?.textContent === text, `lookup ${text}`); await settle();
  };
  const nav = async (path: '/files' | '/saved') => { await click(`.b-dock a[href="${path}"]`); await settle(); };
  const onError = (event: ErrorEvent) => report.errors.push(event.message);
  const onReject = (event: PromiseRejectionEvent) => report.errors.push(String(event.reason));
  window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onReject);
  try {
    for (const [theme, expression] of [['ocean', 'lantern'], ['midnight', 'candle']] as const) {
      document.documentElement.dataset.theme = theme;
      await nav('/files');
      await until(() => live('.desk-library-dock'), 'material desk');
      const countBefore = (await files()).length;
      const nonce = crypto.randomUUID();
      const text = `P4 QA flow ${theme} ${nonce}\nThe ${expression} glows beside a quiet window.\nI keep https://example.com/qa-${nonce} inside this English note.`;
      await openImport();
      check(!live('textarea') && document.querySelectorAll('.lc-import-source').length === 2, `${theme}: compact entry has only clipboard and file choices`);
      const multiple = inspectClipboardContent('https://example.com/one https://example.com/two');
      check(multiple.kind === 'error' && multiple.error === 'multipleLinks', `${theme}: multiple URLs fail local classification`);
      await preview(text);
      const draft = useImportStore.getState().items[0].draft!;
      check(draft.content.includes(`https://example.com/qa-${nonce}`) && draft.document?.origin?.kind === 'clipboard', `${theme}: mixed link remains text in a real document preview`);
      check((await files()).length === countBefore, `${theme}: preview does not commit`);
      await escape(); await until(() => !document.querySelector('.lc-import-modal'), 'preview cancellation');
      check((await files()).length === countBefore, `${theme}: cancel preview preserves database`);
      await openImport();
      check(!!live('.lc-import-sources') && !live('textarea'), `${theme}: cancelled preview returns to compact source choices`);
      await preview(text);
      await click('.lc-import-footer .lc-import-primary');
      await until(() => document.querySelector('.reading-title')?.textContent?.includes(`P4 QA flow ${theme}`), 'confirmed native import opens reader');
      await settle();
      const material = (await files()).find(row => row.name.includes(nonce));
      check(!!material && (await files()).length === countBefore + 1, `${theme}: confirmed import writes exactly one material`);
      report.fixtures.push({ theme, fileId: material!.id, contentHash: material!.content_hash, name: material!.name });
      const data = await invoke<ReadingMaterial>('open_reading_material', { fileId: material!.id });
      const segment = data.segments.find(row => row.en_text.includes(expression))!;
      const start = segment.en_text.indexOf(expression);
      const input = { segment_id: segment.id, expression, start_offset: start, end_offset: start + expression.length, explanation: null, explanation_source: 'unknown' };
      const baseline = (await groups(expression)).total_records;
      await word(expression); await click('[data-testid="lookup-save"]');
      await until(async () => (await groups(expression)).total_records === baseline + 1, 'save committed');
      const saved = await invoke<SavedRecord | null>('saved_for_selection', { input });
      check(!!saved && saved.source?.content_hash === material!.content_hash && saved.sentence === segment.en_text, `${theme}: UI save preserves original sentence and real source identity`);
      const repeat = await invoke<SavedMutationResult>('mutate_saved_record', { operationId: `p4-flow-repeat-${nonce}`, mutation: { kind: 'save', input } });
      check(!repeat.changed && repeat.record.record_id === saved!.record_id && (await groups(expression)).total_records === baseline + 1, `${theme}: native repeat save is an identity-preserving no-op`);
      await word('window'); await word(expression);
      check((await groups(expression)).total_records === baseline + 1, `${theme}: query switching/re-encounter does not append a saved record`);
      await click('[data-testid="lookup-close"]'); await until(() => !document.querySelector('.context-panel'), 'query closes');
      await nav('/saved'); await fill('.saved-search input', expression);
      await until(() => live('.saved-record-term')?.textContent === expression, 'matching saved group');
      await click('.saved-record-open');
      const rowSelector = `[data-record="${saved!.record_id}"]`;
      await until(() => live(rowSelector), 'saved original row'); await settle();
      await click(`${rowSelector} .saved-record-actions button:nth-child(2)`);
      const note = `P4 QA personal note ${theme} ${nonce}`;
      await fill(`${rowSelector} textarea`, note);
      // A real pointer event outside the row dismisses editing without saving.
      live('.saved-heading')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await until(() => !live(`${rowSelector} textarea`), 'outside dismisses editor');
      check((await invoke<SavedRecord | null>('saved_for_selection', { input }))?.explanation !== note, `${theme}: dismissed draft is not persisted as a note`);
      await click(`${rowSelector} .saved-record-actions button:nth-child(2)`);
      check(live<HTMLTextAreaElement>(`${rowSelector} textarea`)?.value === note, `${theme}: outside-dismissed note draft reopens unchanged`);
      const search = live<HTMLInputElement>('.saved-search input')!.value;
      await click(`${rowSelector} .saved-record-actions button:first-child`);
      await until(() => live('[data-testid="source-return"]') && live('[data-source-highlight="true"]'), 'source return target'); await settle();
      check(document.querySelector('.reading-title')?.textContent === material!.name && live('[data-source-highlight="true"] .reading-original')?.textContent === segment.en_text, `${theme}: saved source opens exact material and highlights exact original sentence`);
      await click('[data-testid="source-return"]');
      await until(() => live<HTMLTextAreaElement>(`${rowSelector} textarea`), 'source return restores editor'); await settle();
      check(live<HTMLInputElement>('.saved-search input')?.value === search && live<HTMLTextAreaElement>(`${rowSelector} textarea`)?.value === note && live(`${rowSelector}`)?.closest('[data-expanded="true"]'), `${theme}: source round trip restores search, expanded group and note draft`);
      await click(`${rowSelector} .saved-primary`);
      await until(async () => (await invoke<SavedRecord | null>('saved_for_selection', { input }))?.explanation === note, 'note edit committed');
      check((await invoke<SavedRecord | null>('saved_for_selection', { input }))?.explanation_source === 'personal', `${theme}: explicit note save preserves personal provenance`);
      await click(`${rowSelector} .saved-record-actions button:nth-child(3)`);
      await until(async () => (await groups(expression)).total_records === baseline, 'remove original');
      await click('.toast-card .toast-action');
      await until(async () => (await groups(expression)).total_records === baseline + 1, 'undo original removal');
      const restored = await invoke<SavedRecord | null>('saved_for_selection', { input });
      check(restored?.record_id === saved!.record_id && restored.explanation === note && restored.sentence === segment.en_text, `${theme}: delete/undo restores the same original and personal note`);
      await nav('/files');
      const before = desk();
      check(before.items.length === 5, `${theme}: desk contains five real materials`);
      const direction = live<HTMLButtonElement>('[data-testid="desk-next"]')?.disabled ? 'desk-prev' : 'desk-next';
      await click(`[data-testid="${direction}"]`); await settle();
      const afterTurn = desk();
      check(JSON.stringify(before.items) === JSON.stringify(afterTurn.items) && JSON.stringify(before.opened) === JSON.stringify(afterTurn.opened), `${theme}: page turn changes selection without changing display membership or recency`);
      const dock = live<HTMLButtonElement>('.desk-library-dock')!; dock.focus();
      await click('.desk-library-dock'); await settle();
      check(document.getElementById('root')?.inert && document.activeElement === live('.library-search input'), `${theme}: library makes background inert and focuses search`);
      await fill('.library-search input', ''); await click('.library-ranges button:first-child');
      const current = desk();
      const outsider = (await files()).find(row => !current.items.some(ref => ref.id === row.id) && row.segment_count > 0)!;
      check(!!outsider, `${theme}: real sixth material exists in library`);
      await click(`[data-material="${outsider.id}"] .library-menu > button`);
      await click(`[data-material="${outsider.id}"] .material-actions button:last-child`);
      const kept = desk();
      check(kept.items.length === 5 && kept.items.some(ref => ref.id === outsider.id) && current.items.filter(ref => !kept.items.some(next => next.id === ref.id)).length === 1, `${theme}: keeping sixth replaces exactly one desk item`);
      await click('.notification-host .toast-action');
      check(JSON.stringify(desk()) === JSON.stringify(current), `${theme}: replacement undo restores exact desk order, selection and recency`);
      await escape(); await until(() => !document.querySelector('.library-overlay-panel'), 'library exits');
      check(!document.getElementById('root')?.inert && document.activeElement === dock, `${theme}: library Escape restores background and trigger focus`);
      report.observations.push({ theme, materialId: material!.id, recordId: restored!.record_id, savedCount: (await groups(expression)).total_records, desk: desk() });
    }
  } catch (error) { report.errors.push(String(error)); }
  finally {
    document.documentElement.dataset.theme = originalTheme ?? 'ocean';
    if (useImportStore.getState().open) useImportStore.getState().hide();
    // Leave a predictable closed material desk. Data remains labelled until the
    // root harness restores its saved baseline; avoid direct test-only deletion.
    for (let i = 0; i < 3 && live('.library-overlay-panel, .context-panel'); i++) await escape();
    const materialsLink = live<HTMLAnchorElement>('.b-dock a[href="/files"]'); materialsLink?.click(); await settle();
    window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onReject);
    report.completed = true;
    await writeTextFile('slice-qa-p4-flow-native.json', JSON.stringify(report, null, 2), { baseDir: BaseDirectory.AppData });
  }
  return report;
}
