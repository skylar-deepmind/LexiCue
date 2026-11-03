/** Isolated macOS QA only. DOM-dispatched input is not trusted keyboard, mouse,
 * VoiceOver, or an OS reduced-motion setting. Caller must restore the QA backup. */
import { invoke } from '@tauri-apps/api/core';
import { BaseDirectory, writeTextFile } from '@tauri-apps/plugin-fs';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { assertSlicePreview } from './slicePreview';
import { useMaterialStore } from '../stores/materialStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import type { MaterialImportResult } from '../lib/materials';

type Rect = { width: number; height: number; lines: number[] };
export async function runMacReleaseChecks() {
  await assertSlicePreview();
  if (import.meta.env.VITE_SLICE_QA !== '1' || import.meta.env.VITE_SLICE_P4 !== '1') throw Error('macOS checks require isolated P4 QA');
  const report = {
    method: 'Production React DOM and native SQLite IPC in isolated WKWebView; DOM clicks/focus/keys are synthetic',
    limits: ['No real system setting, VoiceOver, trusted keyboard or mouse hover is simulated.', 'Results cover named fixtures and endpoints, not frame rate or all documents.', 'Caller must restore exported QA database and UI state.'],
    checks: [] as string[], observations: [] as unknown[], errors: [] as string[], completed: false,
  };
  const write = () => writeTextFile('mac-release-ui-native.json', JSON.stringify(report, null, 2), { baseDir: BaseDirectory.AppData });
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const check = (ok: unknown, label: string) => { if (!ok) throw Error(label); report.checks.push(label); };
  const until = async <T,>(fn: () => T, label: string, timeout = 15000): Promise<NonNullable<T>> => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = fn(); if (value) return value as NonNullable<T>; await delay(35); }
    throw Error(`Timeout: ${label}`);
  };
  const live = <T extends HTMLElement = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)].find(node => !node.closest('[inert],[aria-hidden="true"]') && node.getClientRects().length > 0);
  const click = async (selector: string) => { const button = await until(() => live<HTMLButtonElement>(selector), selector); if (button.disabled) throw Error(`Disabled: ${selector}`); button.click(); };
  const settled = async () => {
    await document.fonts.ready;
    await until(() => !document.querySelector('[data-resizing], [data-lookup-moving], [data-page-moving]') && !document.getAnimations().some(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity), 'finite UI motion');
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  };
  const stage = async (name: string, run: () => Promise<void>) => { try { await run(); } catch (error) { report.errors.push(`${name}: ${String(error)}`); } await write(); };
  const navigate = async (path: '/files' | '/saved') => { await click(`.b-dock a[href="${path}"]`); await until(() => location.pathname === path, `route ${path}`); await settled(); };
  const shape = (index: number): Rect => {
    const node = live<HTMLElement>(`[data-sentence="${index}"] .reading-original`);
    if (!node) throw Error(`Sentence ${index} is not rendered`);
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, lines: [...node.querySelectorAll<HTMLElement>('.reading-word')].map(word => Math.round(word.getBoundingClientRect().top - rect.top)) };
  };
  const sameShape = (a: Rect, b: Rect) => Math.abs(a.width-b.width)<1 && Math.abs(a.height-b.height)<1 && a.lines.length>0 && JSON.stringify(a.lines)===JSON.stringify(b.lines);
  const word = (index: number, text: string) => [...document.querySelectorAll<HTMLButtonElement>(`[data-sentence="${index}"] .reading-word`)].find(node => node.textContent === text && !node.closest('[inert]'));
  const color = (raw: string): number[] => {
    const values = raw.match(/[\d.]+/g)?.map(Number) ?? [];
    if (values.length < 3) throw Error(`Unsupported computed color: ${raw}`);
    return [values[0], values[1], values[2], values[3] ?? 1];
  };
  const measure = (node: HTMLElement) => {
    const colors: number[][] = [];
    for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) colors.push(color(getComputedStyle(parent).backgroundColor));
    let background = [255, 255, 255];
    for (const [r,g,b,a] of colors.reverse()) background = [r*a+background[0]*(1-a),g*a+background[1]*(1-a),b*a+background[2]*(1-a)];
    const [r,g,b,alpha] = color(getComputedStyle(node).color);
    const foreground = [r*alpha+background[0]*(1-alpha),g*alpha+background[1]*(1-alpha),b*alpha+background[2]*(1-alpha)];
    const luminance = (rgb: number[]) => rgb.map(x => { const n=x/255; return n<=.04045?n/12.92:((n+.055)/1.055)**2.4; }).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const a=luminance(foreground), bgl=luminance(background), style=getComputedStyle(node);
    return {ratio:(Math.max(a,bgl)+.05)/(Math.min(a,bgl)+.05), color:style.color, background, outline:style.outline, focusVisible:node.matches(':focus-visible'), disabled:node.matches(':disabled')};
  };
  const original = { theme: document.documentElement.dataset.theme, font: usePreferencesStore.getState().learningTextFontSize, width: innerWidth, height: innerHeight };
  const nonce = crypto.randomUUID();
  try {
    const sentences = Array.from({length: 120}, (_, index) => `The quiet garden holds a small lantern while the morning light crosses the old stone path near the open window number ${index + 1}, in session ${nonce}.`);
    const material = await invoke<MaterialImportResult>('import_reading_material', { input: { operation_id: `mac-release-long-${nonce}`, name: `macOS QA long ${nonce}.txt`, normalized_kind: 'txt', content: sentences.join('\n'), segments: sentences.map((en_text, index) => ({ index, en_text, zh_text: null, start_time: null, end_time: null })) } });
    check(material.outcome === 'created', 'labelled long material created in isolated SQLite');
    report.observations.push({fixture: {id: material.file_id, paragraphs: sentences.length, name: `macOS QA long ${nonce}.txt`}, reducedMotionAtStart: matchMedia('(prefers-reduced-motion: reduce)').matches});
    useMaterialStore.getState().changed();
    await navigate('/files');
    await stage('theme contrast and focus observations', async () => {
      for (const theme of ['ocean', 'midnight']) {
        document.documentElement.dataset.theme = theme;
        await settled();
        const primary = await until(() => live<HTMLButtonElement>('.desk-primary'), 'desk primary');
        const normal = measure(primary);
        check(normal.ratio >= 4.5, `${theme}: primary text contrast >= 4.5`);
        primary.focus(); const focus = measure(primary);
        for (let i=0; i<5 && !live<HTMLButtonElement>('[data-testid="desk-prev"]')?.disabled; i++) { await click('[data-testid="desk-prev"]'); await settled(); }
        const disabled = live<HTMLButtonElement>('.desk-pager button:disabled');
        check(!!disabled && !!disabled.getAttribute('aria-label'), `${theme}: disabled pager has an accessible name`);
        const disabledMeasure = measure(disabled!);
        await click('.desk-library-dock');
        await until(() => live('.library-overlay-panel'), 'contrast library');
        const selected = await until(() => live<HTMLButtonElement>('.library-ranges button[aria-pressed="true"]'), 'selected library filter');
        const selection = measure(selected);
        check(selection.ratio >= 4.5, `${theme}: selected library filter text contrast >= 4.5`);
        report.observations.push({theme, normal, focus, disabled:disabledMeasure, selected:selection, hover:'requires actual pointer; not simulated'});
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));
        await until(() => !document.querySelector('.library-overlay-panel'), 'close contrast library'); await settled();
      }
    });
    await click('.desk-library-dock'); await until(() => live('.library-overlay-panel'), 'library');
    const search = await until(() => live<HTMLInputElement>('.library-search input'), 'library search');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, nonce);
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await until(() => live(`.library-open[data-open="${material.file_id}"]`), 'long fixture in library');
    await click(`.library-open[data-open="${material.file_id}"]`);
    await until(() => location.pathname === `/files/${material.file_id}` && live('[data-sentence="0"] .reading-original'), 'long reader');
    await settled();
    await stage('long material geometry and query reversal', async () => {
      usePreferencesStore.getState().setLearningTextFontSize('lg');
      for (const theme of ['ocean', 'midnight']) {
        document.documentElement.dataset.theme = theme;
        for (const width of [920, 800]) {
          await getCurrentWindow().setSize(new LogicalSize(width, 650));
          await until(() => innerWidth === width, `width ${width}`); await settled();
          const scroll = await until(() => live<HTMLElement>('.reader-scroll'), 'reader scroll');
          for (const index of [0, 40, 119]) {
            if (!live(`[data-sentence="${index}"]`)) {
              // The production reader extends its render window when the bottom is reached.
              for (let attempt=0; attempt<6 && !live(`[data-sentence="${index}"]`); attempt++) { scroll.scrollTop = scroll.scrollHeight; scroll.dispatchEvent(new Event('scroll')); await delay(120); }
            }
            const sentence = await until(() => live<HTMLElement>(`[data-sentence="${index}"]`), `long sentence ${index}`);
            sentence.scrollIntoView({block:'center'}); await settled();
            const before = shape(index);
            const trigger = await until(() => word(index, 'garden'), 'garden word'); trigger.focus({preventScroll:true}); trigger.click();
            await until(() => live('.lookup-heading h2')?.textContent === 'garden', 'garden lookup'); await settled();
            const after = shape(index), save = live<HTMLButtonElement>('[data-testid="lookup-save"]');
            check(sameShape(before, after), `${theme} ${width} paragraph ${index}: query keeps width, height and ordered word lines`);
            check(!!save && !save.disabled && !!save.getAttribute('data-testid') && !save.closest('[inert]'), `${theme} ${width} paragraph ${index}: save is enabled in live query`);
            await click('[data-testid="lookup-close"]');
            await until(() => !document.querySelector('.context-panel'), 'query close'); await settled();
            check(document.activeElement === trigger, `${theme} ${width} paragraph ${index}: programmatic focus returns to trigger`);
          }
        }
      }
      // Start a close, reverse before it settles, then switch words again.
      const target = await until(() => word(119, 'garden'), 'reversal word'); target.click();
      await until(() => live('.lookup-heading h2')?.textContent === 'garden', 'first reversal lookup');
      await click('[data-testid="lookup-close"]'); await delay(60);
      (await until(() => word(119, 'morning'), 'next reversal word')).click();
      await until(() => live('.lookup-heading h2')?.textContent === 'morning', 'reverse to morning');
      (await until(() => word(119, 'garden'), 'last reversal word')).click();
      await until(() => live('.lookup-heading h2')?.textContent === 'garden', 'reverse to garden'); await settled();
      check(document.querySelectorAll('.context-panel:not([inert])').length === 1 && !document.querySelector('.soft-refresh-snapshot, [data-lookup-moving]'), 'rapid query reversal ends with one live panel and no stale refresh or motion');
      await click('[data-testid="lookup-close"]'); await until(() => !document.querySelector('.context-panel'), 'reversal cleanup'); await settled();
    });
    await stage('library accessibility and interrupted navigation', async () => {
      await navigate('/files');
      const dock = await until(() => live<HTMLButtonElement>('.desk-library-dock'), 'library dock'); dock.focus(); dock.click();
      const dialog = await until(() => live<HTMLElement>('.library-overlay-panel'), 'library dialog');
      check(dialog.getAttribute('role') === 'dialog' && dialog.getAttribute('aria-modal') === 'true' && !!dialog.getAttribute('aria-label'), 'library dialog exposes role, modal state and name');
      check(!!document.getElementById('root')?.inert && document.activeElement === live('.library-search input'), 'library isolates background and focuses search');
      const closedPreview = dialog.querySelector<HTMLElement>('.library-preview[aria-hidden="true"]');
      check(!!closedPreview && closedPreview.inert, 'collapsed library preview is inert and hidden from accessibility tree');
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));
      await until(() => !document.querySelector('.library-overlay-panel'), 'synthetic Escape closes library'); await settled();
      check(!document.getElementById('root')?.inert && document.activeElement === dock, 'synthetic Escape returns focus and releases inert');
      const saved = await until(() => live<HTMLAnchorElement>('.b-dock a[href="/saved"]'), 'saved link'); saved.click();
      await until(() => location.pathname === '/saved', 'saved route');
      const files = await until(() => live<HTMLAnchorElement>('.b-dock a[href="/files"]'), 'files link'); files.click();
      await until(() => location.pathname === '/files', 'reversed route'); await settled();
      check(!document.querySelector('.page-ghost > *, [data-page-moving]') && document.querySelectorAll('.page-live').length === 1, 'interrupted navigation leaves one live page without a ghost');
    });
    report.observations.push({reducedMotionAtEnd: matchMedia('(prefers-reduced-motion: reduce)').matches, manualRequired: 'Use real system setting mid-animation; record matchMedia change, WAAPI states, data-lookup-moving, refresh snapshot and inline sizing cleanup. Test real keyboard focus/hover and VoiceOver separately.'});
  } catch (error) { report.errors.push(`setup: ${String(error)}`); }
  finally {
    usePreferencesStore.getState().setLearningTextFontSize(original.font);
    document.documentElement.dataset.theme = original.theme ?? 'ocean';
    // The native window height includes titlebar; avoid pretending innerHeight is outer height.
    await getCurrentWindow().setSize(new LogicalSize(original.width, original.height + 28)).catch(() => {});
    report.completed = true; await write();
  }
  return report;
}

/** Install before manual native QA. It observes actual MediaQueryList changes;
 * it never modifies the system preference or injects synthetic change events. */
export async function installMacReleaseMotionObserver() {
  await assertSlicePreview();
  if (import.meta.env.VITE_SLICE_QA !== '1' || import.meta.env.VITE_SLICE_P4 !== '1') throw Error('motion observer requires isolated P4 QA');
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const report = {
    method: 'Observed real WKWebView matchMedia change and DOM/WAAPI states; no system setting or event is injected',
    startedAt: new Date().toISOString(), initial: media.matches, events: [] as {reason: string; at: string; monotonicMs: number; state: unknown}[],
    limitations: 'Observation is not a frame-rate benchmark; real System Settings and native input are controlled separately.',
  };
  let queue = Promise.resolve(), stopped = false, debounce: ReturnType<typeof setTimeout> | undefined;
  let lastSignature = '';
  const pending = new Set<ReturnType<typeof setTimeout>>();
  const tracked = new WeakSet<Animation>();
  const write = () => {
    const contents = JSON.stringify(report, null, 2);
    queue = queue.then(() => writeTextFile('slice-qa-mac-motion-native.json', contents, {baseDir:BaseDirectory.AppData})).catch(error => { console.error('Motion report write failed:', error); });
    return queue;
  };
  const snapshot = () => {
    const layout = document.querySelector<HTMLElement>('.reading-layout');
    const panel = document.querySelector<HTMLElement>('.context-panel');
    const refresh = document.querySelector<HTMLElement>('.soft-refresh');
    const animations = document.getAnimations().map(animation => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      return {target: target instanceof Element ? `${target.tagName.toLowerCase()}.${[...target.classList].join('.')}` : null,
        playState: animation.playState, currentTime: String(animation.currentTime), startTime: String(animation.startTime),
        duration: animation.effect?.getComputedTiming().duration, iterations: animation.effect?.getComputedTiming().iterations};
    });
    return { matches: media.matches, viewport: [innerWidth, innerHeight], visibility: document.visibilityState,
      layout: layout ? {...layout.dataset} : null,
      panel: panel ? {closing: panel.dataset.closing ?? null, transform: getComputedStyle(panel).transform, inlineHeight: panel.style.height, rect: panel.getBoundingClientRect().toJSON()} : null,
      refresh: refresh ? {...refresh.dataset} : null, refreshSnapshots: document.querySelectorAll('.soft-refresh-snapshot').length,
      pageGhosts: document.querySelectorAll('.page-ghost > *').length, animations };
  };
  const record = (reason: string, force = false) => {
    if (stopped) return;
    const state = snapshot();
    // Timeline changes are useful on finish, but do not make every mutation a new state.
    const signature = JSON.stringify({matches:state.matches,layout:state.layout,closing:state.panel?.closing,refresh:state.refresh,snapshots:state.refreshSnapshots,ghosts:state.pageGhosts,animations:state.animations.map(a=>[a.target,a.playState])});
    if (force || signature !== lastSignature) {
      lastSignature = signature;
      report.events.push({reason, at:new Date().toISOString(), monotonicMs:performance.now(), state});
      if (report.events.length > 400) {
        const disposable = report.events.findIndex(event => ['dom-motion','animation-finished','animation-cancelled'].includes(event.reason));
        if (disposable >= 0) report.events.splice(disposable, 1);
      }
      void write();
    }
    for (const animation of document.getAnimations()) {
      if (tracked.has(animation) || animation.effect?.getComputedTiming().iterations === Infinity) continue;
      tracked.add(animation);
      void animation.finished.then(() => record('animation-finished', true), () => record('animation-cancelled', true));
    }
  };
  const schedule = () => { clearTimeout(debounce); debounce = setTimeout(() => record('dom-motion'), 40); };
  const onChange = () => {
    record('system-motion-change', true);
    const timer = setTimeout(() => { pending.delete(timer); record('system-motion-change+1s', true); }, 1000);
    pending.add(timer);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['data-lookup-moving','data-resizing','data-page-moving','data-refresh-state','data-closing','data-refresh-sizing']});
  media.addEventListener('change', onChange);
  record('observer-installed', true);
  await write();
  return {
    sample(label: string) { record(`manual-observation:${label}`, true); return write(); },
    async dispose() {
      record('observer-disposed', true);
      stopped = true; media.removeEventListener('change', onChange); observer.disconnect(); clearTimeout(debounce);
      pending.forEach(timer => clearTimeout(timer));
      await queue;
    },
  };
}
