/** Isolated component state/action checks plus the real saved-record screen. */
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import SourceAudioControls from '../components/SourceAudioControls';
import { useSpeechStore } from '../stores/speechStore';
import { useSourceMediaStore } from '../stores/sourceMediaStore';
import { assertSlicePreview } from './slicePreview';
import type { MediaRef, MediaStatus } from '../lib/sourceMedia';
import type { SavedGroupPage, SavedContextPage } from '../lib/savedRecords';

export async function runSavedSimplicityChecks() {
  await assertSlicePreview(); if (import.meta.env.VITE_SLICE_QA !== '1') throw Error('QA only');
  const report = { checks: [] as string[], errors: [] as string[], states: [] as unknown[], completed: false };
  const check = (ok: unknown, label: string) => (ok ? report.checks : report.errors).push(label);
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const until = async <T,>(fn: () => T, label: string) => { const end = performance.now() + 10000; while (performance.now() < end) { const v = fn(); if (v) return v; await wait(25); } throw Error(`Timeout ${label}`); };
  const live = <T extends HTMLElement = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)].find(n => n.getClientRects().length && !n.closest('[inert],[aria-hidden="true"]'));
  const themeBefore = document.documentElement.dataset.theme;
  const speech = useSpeechStore.getState(), media = useSourceMediaStore.getState(); speech.stop();
  const spoken: { key: string; media: unknown }[] = []; let prepared = 0, cancelled = 0;
  const reference = { source: { key: 'saved-simplicity-qa', audio: { language: 'en' } }, start_ms: 1000, end_ms: 2000, cue_ids: [0], precision: 'cue', padding_before_ms: 0, padding_after_ms: 0 } as unknown as MediaRef;
  const setMedia = (status: MediaStatus['status'], error?: string) => useSourceMediaStore.setState(state => ({ entries: { ...state.entries, [reference.source.key]: { status, error } } }));
  useSourceMediaStore.setState({ refresh: async () => {}, prepare: async () => { prepared++; setMedia('preparing'); }, cancel: () => { cancelled++; setMedia('missing'); } });
  useSpeechStore.setState({ speak: async (_text, key, options) => { spoken.push({ key, media: options?.media }); useSpeechStore.setState({ key, owner: options?.owner, status: 'playing', loading: false, error: false, errorKey: null }); }, stopOwned: owner => { if (useSpeechStore.getState().owner === owner) useSpeechStore.setState({ key: null, owner: null, status: 'idle' }); } });
  const host = document.createElement('div'); host.className = 'b-shell'; host.style.cssText = 'position:fixed;inset:80px 80px auto;z-index:10000;background:var(--surface);color:var(--text-body);padding:32px'; document.body.append(host);
  const root = createRoot(host);
  const render = (statusOnly = false, hasSource = true) => root.render(<div className="saved-record-actions"><SourceAudioControls reference={hasSource ? reference : undefined} target={{ record_id: 'qa-record' }} text="A respectable job, a happy family, and a stable life." speechKey="saved-simplicity-qa" statusOnly={statusOnly}/></div>);
  const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')];
  try {
    for (const theme of ['ocean', 'midnight']) {
      document.documentElement.dataset.theme = theme; setMedia('ready'); render(); await until(() => buttons().length === 2, 'two voices');
      check(buttons().map(b => b.textContent).join('|') === '原音|朗读', `${theme}: exactly two compact voice labels`);
      check(!host.textContent?.includes('已保存在本机') && !host.textContent?.includes('合成朗读'), `${theme}: no ready-state banner or long label`);
      check(buttons()[0].title.includes('原视频') && buttons()[1].title.includes('合成语音'), `${theme}: full voice descriptions remain accessible`);
      buttons()[0].click(); await wait(60);
      check(spoken.at(-1)?.key === 'saved-simplicity-qa' && (spoken.at(-1)?.media as { source_key: string })?.source_key === reference.source.key, `${theme}: original audio uses the bound original segment`);
      check(buttons()[0].textContent === '原音' && buttons()[0].dataset.speechState === 'playing' && !!buttons()[0].querySelector('.speech-playing'), `${theme}: original playback changes the icon in place`);
      buttons()[0].click(); await wait(40); buttons()[1].click(); await wait(60);
      check(spoken.at(-1)?.key.endsWith(':synthetic') && !spoken.at(-1)?.media && buttons()[1].textContent === '朗读', `${theme}: synthetic reading remains a distinct action`);
      buttons()[1].click(); await wait(40); buttons()[0].focus({ preventScroll: true });
      const style = getComputedStyle(buttons()[0]);
      check(style.outlineStyle === 'none' && !style.boxShadow.split(/,(?![^()]*\))/).some(s => s.trim() !== 'none' && !s.includes('inset')), `${theme}: focus adds no outer frame`);
      report.states.push({ theme, color: style.color, background: style.backgroundColor, focus: style.boxShadow });
      setMedia('missing'); await wait(60); const before = spoken.length; buttons()[0].click(); await wait(60);
      check(prepared > 0 && spoken.length === before && !!buttons()[0].querySelector('.speech-spinner'), `${theme}: uncached original prepares without accidentally reading synthetic audio`);
      buttons()[0].click(); await wait(60); check(cancelled > 0 && buttons().length === 2, `${theme}: preparation cancels in the same button`);
      setMedia('failed', 'missing_ffmpeg'); await wait(60);
      check(buttons().length === 2 && !!host.querySelector('[role="status"]') && buttons()[0].title.includes('重试'), `${theme}: errors keep useful feedback and one retry entry`);
      setMedia('ready'); render(true); await wait(60); check(!host.textContent?.trim(), `${theme}: reader status-only mode stays silent when ready`);
      render(false, false); await wait(60); check(buttons().length === 1 && buttons()[0].textContent === '朗读', `${theme}: material without original audio has one clear reading action`);
    }
    root.unmount(); host.remove();
    useSpeechStore.setState({ speak: speech.speak, stopOwned: speech.stopOwned }); useSourceMediaStore.setState({ refresh: media.refresh, prepare: media.prepare, cancel: media.cancel, entries: media.entries });
    live<HTMLAnchorElement>('.b-dock a[href="/saved"]')!.click(); await until(() => live('.saved-record-open'), 'saved page'); await wait(600);
    const groups = await invoke<SavedGroupPage>('list_saved_groups', { query: '', limit: 50, offset: 0 });
    const group = groups.groups.find(g => g.preview.dictionary_reference || g.preview.dictionary_snapshot) ?? groups.groups[0];
    for (const theme of ['ocean', 'midnight']) {
      document.documentElement.dataset.theme = theme;
      const open = [...document.querySelectorAll<HTMLButtonElement>('.saved-record-open')].find(b => b.textContent?.includes(group.expression))!;
      if (open.getAttribute('aria-expanded') !== 'true') open.click();
      await until(() => live('.saved-context-entry'), 'saved context'); await wait(450);
      const page = await invoke<SavedContextPage>('saved_group_contexts', { groupId: group.group_id, limit: 20, offset: 0 });
      check(page.records.some(r => !!r.dictionary_reference || !!r.dictionary_snapshot), `${theme}: archive test includes preserved dictionary data`);
      check(!live('.saved-legacy,.saved-reference,.longman-saved-snapshot'), `${theme}: removed record/reference disclosures have no visible entry`);
      check(page.records.some(r => r.sentence && live('.saved-context-entry')?.textContent?.includes(r.sentence)), `${theme}: saved original context remains readable`);
      check(live('.saved-record-actions .speech-button')?.textContent?.trim() === '朗读', `${theme}: saved screen uses the compact reading action`);
    }
  } catch (error) { report.errors.push(String(error)); }
  finally {
    if (host.isConnected) { root.unmount(); host.remove(); }
    useSpeechStore.setState({ speak: speech.speak, stopOwned: speech.stopOwned }); useSpeechStore.getState().stop();
    useSourceMediaStore.setState({ refresh: media.refresh, prepare: media.prepare, cancel: media.cancel, entries: media.entries }); document.documentElement.dataset.theme = themeBefore ?? 'ocean';
    report.completed = true; await writeTextFile('mac-release-saved-simplicity.json', JSON.stringify(report, null, 2), { baseDir: BaseDirectory.AppData });
    const status = document.createElement('p'); status.textContent = `简化验收：${report.checks.length} 通过，${report.errors.length} 问题`; status.style.cssText = 'position:fixed;top:40px;right:24px;z-index:9999;padding:16px;background:var(--surface);color:var(--text-strong)'; document.body.append(status);
  }
  return report;
}
