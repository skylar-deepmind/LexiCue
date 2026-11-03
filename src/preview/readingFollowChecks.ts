/** Deterministic playback-index integration in an isolated native WebView.
 * Audio is replaced only for this harness; real playback is checked separately. */
import { invoke } from '@tauri-apps/api/core';
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { assertSlicePreview } from './slicePreview';
import { useSpeechStore, type ReadingSessionSnapshot, type SpeechQueueItem } from '../stores/speechStore';
import { useMaterialStore } from '../stores/materialStore';
import { useReadingDeskStore } from '../stores/readingDeskStore';
import type { MaterialImportResult } from '../lib/materials';

export async function runReadingFollowChecks() {
  await assertSlicePreview(); if (import.meta.env.VITE_SLICE_QA !== '1') throw Error('QA only');
  const report = { method: 'Native WKWebView; controlled TTS/source progress snapshots, no generated audio', checks: [] as string[], errors: [] as string[], samples: [] as unknown[], completed: false };
  const check = (yes: unknown, label: string) => (yes ? report.checks : report.errors).push(label);
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const until = async <T,>(fn: () => T, label: string) => { const end = performance.now() + 15000; while (performance.now() < end) { const value = fn(); if (value) return value; await wait(25); } throw Error(`Timeout: ${label}`); };
  const live = <T extends HTMLElement = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)].find(node => node.getClientRects().length && !node.closest('[inert],[aria-hidden="true"]'));
  const originalTheme = document.documentElement.dataset.theme;
  const original = useSpeechStore.getState(); original.stop();
  const nativeMatch = window.matchMedia;
  let reduced = false;
  const preference = new EventTarget() as MediaQueryList;
  Object.defineProperty(preference, 'matches', { get: () => reduced });
  window.matchMedia = query => query === '(prefers-reduced-motion: reduce)' ? preference : nativeMatch.call(window, query);
  let items: readonly SpeechQueueItem[] = [], resumeCalls = 0;
  const progress = (index: number, mode: ReadingSessionSnapshot['mode'] = 'tts-queue', status: ReadingSessionSnapshot['status'] = 'playing', reason: ReadingSessionSnapshot['pauseReason'] = 'user') => {
    const key = items[index].key;
    useSpeechStore.setState({ reading: { key, index, mode, status, rate: 1, pauseReason: status === 'paused' ? reason : null, resumeMode: 'continue', errorCode: null }, status: status === 'paused' ? 'paused' : status === 'loading' ? 'loading' : 'playing', queueIndex: index, playbackMode: mode, key, loading: status === 'loading' });
  };
  useSpeechStore.setState({
    startQueue: async (next, index = 0) => { items = next; progress(index); },
    pause: (reason = 'user') => { const state = useSpeechStore.getState().reading; if (state) progress(state.index, state.mode, 'paused', reason); },
    resume: async () => { resumeCalls++; const state = useSpeechStore.getState().reading; if (state) progress(state.index, state.mode); },
    replayCurrent: async () => { const state = useSpeechStore.getState().reading; if (state) progress(state.index, state.mode); },
    exitReading: () => useSpeechStore.setState({ reading: null, status: 'idle', queueIndex: null, playbackMode: null }),
  });
  try {
    const lines = Array.from({ length: 140 }, (_, i) => i === 24 ? Array(35).fill('The morning light fell softly across the kitchen table.').join(' ') : 'The quiet morning gives us time to notice the world around us.');
    const imported = await invoke<MaterialImportResult>('import_reading_material', { input: { operation_id: 'reading-follow-qa-v1', name: 'Reading follow QA.txt', normalized_kind: 'txt', content: lines.join('\n'), segments: lines.map((text, index) => ({ index, en_text: text, zh_text: null, start_time: null, end_time: null })) } });
    (await until(() => live<HTMLAnchorElement>('.b-dock a[href="/files"]'), 'files')).click(); await wait(550);
    await useMaterialStore.getState().load(); const file = useMaterialStore.getState().files.find(item => item.id === imported.file_id)!; localStorage.removeItem(`lexicue-reader-state:${file.content_hash}`); useReadingDeskStore.getState().keep(file); useReadingDeskStore.getState().select(file); await wait(80);
    (await until(() => live<HTMLButtonElement>('.desk-primary'), 'reader')).click(); await until(() => live('.reading-word'), 'reader mount'); await document.fonts.ready; await wait(700);
    const viewport = live('.reader-scroll')!;
    const blankClose = () => {
      const rect = viewport.getBoundingClientRect(), point = { bubbles: true, button: 0, clientX: rect.left + 12, clientY: rect.top + 30 };
      viewport.dispatchEvent(new PointerEvent('pointerdown', point)); viewport.dispatchEvent(new PointerEvent('pointerup', point)); viewport.dispatchEvent(new MouseEvent('click', { ...point, detail: 1 }));
    };
    const lookupWord = (index: number, word: number) => {
      const button = viewport.querySelector<HTMLButtonElement>(`[data-sentence="${index}"] .reading-word[data-word-index="${word}"]`)!;
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); button.click();
    };
    viewport.scrollTop = 0;
    (await until(() => live<HTMLButtonElement>('.dock-reading-tools button'), 'listen')).click(); await until(() => live('.reading-playback'), 'controls');
    const position = (index: number) => {
      const target = viewport.querySelector<HTMLElement>(`[data-sentence="${index}"] .reading-original`)!;
      const rect = target.getBoundingClientRect(), outer = viewport.getBoundingClientRect();
      const bottom = Math.min(outer.bottom, live('.reading-playback')!.getBoundingClientRect().top - 20);
      return { index, scroll: viewport.scrollTop, centerError: rect.top + rect.height / 2 - (outer.top + bottom) / 2, top: rect.top - outer.top, height: rect.height, available: bottom - outer.top };
    };
    const sample = async (index: number, mode: ReadingSessionSnapshot['mode'] = 'tts-queue') => {
      const frames: { t: number; scroll: number }[] = [], start = performance.now();
      const sampling = new Promise<void>(resolve => { const tick = () => { frames.push({ t: performance.now() - start, scroll: viewport.scrollTop }); if (performance.now() - start < 1200) requestAnimationFrame(tick); else resolve(); }; requestAnimationFrame(tick); });
      progress(index, mode); await sampling; const result = position(index); report.samples.push({ theme: document.documentElement.dataset.theme, mode, ...result, frames }); return { frames, result };
    };
    for (const theme of ['ocean', 'midnight']) {
      document.documentElement.dataset.theme = theme;
      progress(0); await wait(1100); check(viewport.scrollTop < 1, `${theme}: first sentence clamps to the natural top`);
      const focus = document.activeElement;
      const middle = await sample(8);
      check(Math.abs(middle.result.centerError) < 3, `${theme}: spoken sentence centers before leaving the viewport`);
      const movement = middle.frames.filter((f, i, all) => i && Math.abs(f.scroll - all[i - 1].scroll) > .2);
      check(movement.length > 12 && middle.frames[0].scroll < middle.result.scroll - 20, `${theme}: movement spans many frames without an immediate jump`);
      check(middle.frames.every((f, i, all) => !i || f.scroll >= all[i - 1].scroll - 1), `${theme}: scroll settles monotonically without bouncing`);
      check(document.activeElement === focus, `${theme}: automatic follow never moves keyboard focus`);
      const source = await sample(12, 'source-continuous'); check(Math.abs(source.result.centerError) < 3, `${theme}: original audio progress uses the same center`);
      const beforeGap = viewport.scrollTop; useSpeechStore.setState({ queueIndex: null }); await wait(100); check(Math.abs(viewport.scrollTop - beforeGap) < 1, `${theme}: source timing gap does not reset position`);
      progress(13); await wait(90); progress(14); await wait(90); progress(15); await wait(1100);
      check(Math.abs(position(15).centerError) < 3, `${theme}: rapid progress settles on the latest sentence`);
      progress(18); await wait(100); live<HTMLButtonElement>('.reading-playback button:nth-child(2)')!.click(); await wait(50);
      const paused = viewport.scrollTop; await wait(350); check(Math.abs(viewport.scrollTop - paused) < 1, `${theme}: pause cancels scrolling immediately`);
      live<HTMLButtonElement>('.reading-playback button:nth-child(2)')!.click(); await wait(1100); check(Math.abs(position(18).centerError) < 3, `${theme}: resume restores centered follow`);
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })); viewport.scrollTop -= 100;
      const manual = viewport.scrollTop; progress(19); await wait(700); check(Math.abs(viewport.scrollTop - manual) < 1, `${theme}: deliberate scroll takes priority through subsequent sentences`);
      // Momentum scroll without a new wheel event must extend the deadline.
      viewport.scrollTop += 50; const momentum = viewport.scrollTop; await wait(1000);
      progress(19, 'tts-queue', 'loading'); await wait(300);
      check(Math.abs(viewport.scrollTop - momentum) < 1, `${theme}: buffering during manual browsing does not move the reader`);
      progress(19); await wait(1400);
      check(Math.abs(viewport.scrollTop - momentum) < 1, `${theme}: momentum restarts the three-second idle deadline`);
      await wait(1200); check(Math.abs(position(19).centerError) < 3, `${theme}: idle recovery catches up without another sentence change`);
      const beforeDistant = viewport.querySelectorAll('[data-sentence]').length;
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })); viewport.scrollTop -= 100; progress(100); await wait(700);
      check(viewport.querySelectorAll('[data-sentence]').length === beforeDistant, `${theme}: manual browsing does not prematurely load a distant playing sentence`);
      await wait(3500); check(Math.abs(position(100).centerError) < 3, `${theme}: timed recovery materializes a distant playing sentence`);
      check(!!viewport.querySelector('[data-sentence="0"]'), `${theme}: distant forward recovery preserves visible prose while appending its target`);
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })); viewport.scrollTop -= 100;
      live<HTMLButtonElement>('.reading-playback button:nth-child(2)')!.click(); await wait(50); const manualPause = viewport.scrollTop; await wait(3200);
      check(Math.abs(viewport.scrollTop - manualPause) < 1 && useSpeechStore.getState().reading?.status === 'paused', `${theme}: the scroll timer cannot override user pause`);
      live<HTMLButtonElement>('.reading-playback button:nth-child(2)')!.click(); await wait(1100);
      progress(19); await wait(1200);
      const beforeLookup = resumeCalls;
      lookupWord(19, 2); await until(() => live('.context-panel'), 'lookup pause');
      check(useSpeechStore.getState().reading?.pauseReason === 'selection', `${theme}: pointer lookup remembers its selection pause`);
      lookupWord(19, 1); await wait(500); check(resumeCalls === beforeLookup && useSpeechStore.getState().reading?.status === 'paused', `${theme}: switching lookup words never resumes between cards`);
      blankClose(); await until(() => !live('.context-panel') && useSpeechStore.getState().reading?.status === 'playing', 'blank dismissal resumes'); await wait(850);
      check(resumeCalls === beforeLookup + 1 && useSpeechStore.getState().reading?.index === 19, `${theme}: blank dismissal resumes the interrupted reading exactly once`);
      viewport.querySelector<HTMLButtonElement>('[data-sentence="19"] .reading-word')!.focus({ preventScroll: true });
      progress(20); await wait(950); check(Math.abs(position(20).centerError) < 3, `${theme}: late programmatic focus restoration does not disable follow at the next sentence`);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); const keyboard = viewport.scrollTop; progress(21); await wait(700);
      check(Math.abs(viewport.scrollTop - keyboard) < 1, `${theme}: deliberate Tab navigation keeps its focused reading position`);
      live<HTMLButtonElement>('.reading-playback button:nth-child(2)')!.click(); await wait(50);
      const userPaused = resumeCalls; lookupWord(19, 2); await until(() => live('.context-panel'), 'user-paused lookup');
      check(useSpeechStore.getState().reading?.pauseReason === 'user', `${theme}: lookup preserves a pre-existing user pause`);
      blankClose(); await wait(800); check(resumeCalls === userPaused && useSpeechStore.getState().reading?.status === 'paused', `${theme}: closing a lookup cannot start user-paused playback`);
      live<HTMLButtonElement>('.reading-playback button:nth-child(2)')!.click(); await wait(700);
      const beforeInterruptedClose = resumeCalls; lookupWord(19, 2); await until(() => live('.context-panel'), 'interrupted close lookup');
      blankClose(); await wait(120); lookupWord(19, 1); await wait(600);
      check(!!live('.context-panel') && resumeCalls === beforeInterruptedClose, `${theme}: a new lookup cancels an in-progress dismissal without resuming`);
      blankClose(); await until(() => !live('.context-panel') && useSpeechStore.getState().reading?.status === 'playing', 'final close resumes');
      check(resumeCalls === beforeInterruptedClose + 1, `${theme}: final dismissal after interruption resumes only once`);
      const tall = await sample(24); check(Math.abs(tall.result.top - 24) < 3 && tall.result.height > tall.result.available, `${theme}: long paragraphs keep their beginning visible`);
      const paged = await sample(100); check(Math.abs(paged.result.centerError) < 3, `${theme}: follow materializes an off-window sentence and centers it`);
      const end = await sample(139); check(Math.abs(end.result.centerError) < 3, `${theme}: final sentence has enough trailing space to remain centered`);
      reduced = true; preference.dispatchEvent(new Event('change')); progress(135); await wait(80);
      check(Math.abs(position(135).centerError) < 3, `${theme}: reduced motion aligns immediately without animated travel`);
      reduced = false; preference.dispatchEvent(new Event('change'));
      // Return to the start for the next theme using the same existing controls.
      progress(0); await wait(1200);
    }
    progress(8); await wait(60); live<HTMLButtonElement>('.reading-playback button:last-of-type')!.click(); await wait(40);
    const stopped = viewport.scrollTop; await wait(600); check(!live('.reading-playback') && Math.abs(viewport.scrollTop - stopped) < 1, 'exit cancels remaining frames and removes controls');
  } catch (error) { report.errors.push(String(error)); }
  finally {
    useSpeechStore.setState({ startQueue: original.startQueue, pause: original.pause, resume: original.resume, replayCurrent: original.replayCurrent, exitReading: original.exitReading });
    useSpeechStore.getState().stop(); window.matchMedia = nativeMatch; preference.dispatchEvent(new Event('change'));
    document.documentElement.dataset.theme = originalTheme ?? 'ocean'; report.completed = true;
    await writeTextFile('mac-release-reading-resume.json', JSON.stringify(report, null, 2), { baseDir: BaseDirectory.AppData });
    const status = document.createElement('p'); status.textContent = `续播验收：${report.checks.length} 通过，${report.errors.length} 问题`; status.style.cssText = 'position:fixed;right:24px;top:40px;z-index:9999;padding:16px;background:var(--surface);color:var(--text-strong)'; document.body.append(status);
  }
  return report;
}
