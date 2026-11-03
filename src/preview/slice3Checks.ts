/** Explicit QA build only: production DOM, native IPC and actual WKWebView audio. */
import { invoke } from '@tauri-apps/api/core';
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { assertSlicePreview } from './slicePreview';
import { useSpeechStore } from '../stores/speechStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import type { Material, ReadingMaterial } from '../lib/materials';

export async function runSlice3Checks() {
  await assertSlicePreview();
  const report = { runtime: navigator.userAgent, method: 'native Tauri IPC + real WKWebView Audio; controlled local AAC fixture separately identified', checks: [] as string[], observations: [] as unknown[], media: [] as unknown[], errors: [] as string[], completed: false };
  const write = () => writeTextFile('slice-qa-p3-native.json', JSON.stringify(report, null, 2), { baseDir: BaseDirectory.AppData });
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const check = (value: unknown, label: string) => { if (!value) throw new Error(label); report.checks.push(label); };
  const until = async <T,>(fn: () => T, label: string, timeout = 20000): Promise<NonNullable<T>> => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = fn(); if (value) return value as NonNullable<T>; await delay(40); }
    throw new Error(`Timeout: ${label}; speech=${JSON.stringify(useSpeechStore.getState().reading)}`);
  };
  const audio: HTMLAudioElement[] = [];
  const OriginalAudio = window.Audio;
  window.Audio = new Proxy(OriginalAudio, { construct(target, args) {
    const player = Reflect.construct(target, args) as HTMLAudioElement;
    audio.push(player);
    for (const event of ['playing', 'pause', 'ended', 'ratechange', 'error']) player.addEventListener(event, () => {
      report.media.push({ id: audio.indexOf(player), event, time: player.currentTime, paused: player.paused, rate: player.playbackRate, error: player.error?.code, localAsset: !player.src.startsWith('data:') });
    });
    return player;
  } });
  const currentAudio = () => audio.findLast(player => !!player.src && !player.paused);
  const get = () => useSpeechStore.getState();
  const click = async (selector: string) => {
    const node = await until(() => [...document.querySelectorAll<HTMLButtonElement>(selector)].find(node => !node.closest('[inert]')), selector);
    check(!node.disabled, `${selector} enabled`); node.click();
  };
  const toolbar = (index: number) => `.reading-playback button:nth-of-type(${index})`;
  const nav = async (fileId: number) => {
    const link = document.querySelector<HTMLAnchorElement>('a[aria-label="材料"]');
    if (!link) throw new Error('material navigation missing'); link.click();
    await click('.desk-library-dock');
    await click(`.library-open[data-open="${fileId}"]`);
    await until(() => location.pathname === `/files/${fileId}` && document.querySelector('.reading-original'), 'reader route');
    await delay(650);
  };
  const run = async (label: string, task: () => Promise<void>) => {
    try { await task(); } catch (error) { report.errors.push(`${label}: ${String(error)}`); get().stop(); }
    await write();
  };
  const originalPreferences = usePreferencesStore.getState().speech;
  const originalTheme = document.documentElement.dataset.theme;
  try {
    await until(() => document.querySelector('a[aria-label="材料"]'), 'preview seed and React startup');
    document.querySelector<HTMLAnchorElement>('a[aria-label="材料"]')!.click();
    await until(() => document.querySelector('.desk-library-dock'), 'reading desk');
    const materials = await invoke<Material[]>('list_materials', { tagIds: [], untagged: false });
    const source = materials.find(item => item.name === 'Controlled local audio fixture.srt')!;
    const text = materials.find(item => item.name === 'A quiet morning.txt')!;
    check(source && text, 'controlled audio and bilingual native materials available');
    await run('native source audio and query ownership', async () => {
      await nav(source.id);
      await click('.dock-reading-tools > button:first-of-type');
      await until(() => get().reading?.status === 'playing' && currentAudio(), 'native AAC starts');
      const player = currentAudio()!;
      await until(() => player.currentTime > 1, 'source media clock advances');
      await click(toolbar(2));
      const paused = player.currentTime;
      await delay(300);
      check(get().reading?.status === 'paused' && player.paused && Math.abs(player.currentTime - paused) < .08, 'source pause preserves actual currentTime');
      await click(toolbar(3));
      check(get().reading?.rate === 1.25 && player.playbackRate === 1.25, 'source rate changes independently while paused');
      await click(toolbar(2));
      await until(() => !player.paused && player.currentTime > paused + .15, 'same source player resumes');
      const selected = [...document.querySelectorAll<HTMLButtonElement>('.reading-word')].find(node => node.textContent === 'morning')!;
      selected.click();
      await until(() => document.querySelector('.lookup-heading'), 'lookup opens');
      check(get().reading?.status === 'paused' && player.paused, 'query pauses native sound and keeps reading cursor');
      const immediateQueryPause = player.currentTime;
      await delay(150);
      const held = player.currentTime;
      report.observations.push({ sourceQueryPause: { immediate: immediateQueryPause, settled: held, paused: player.paused } });
      await click('[data-speech-key="lookup:term"]');
      await until(() => get().status === 'playing' || get().status === 'error', 'real pronunciation result', 30000);
      report.observations.push({ pronunciation: { source: get().source, status: get().status, error: get().errorCode } });
      check(get().reading?.status === 'paused', 'pronunciation never changes retained reading to playing');
      await click('[data-speech-key="lookup:term"]');
      check(get().reading?.status === 'paused' && get().status === 'paused' && get().playbackMode !== 'single' && player.paused, 'pronunciation stop button retains paused reading session');
      await click('[data-speech-key="lookup:term"]');
      await until(() => get().status === 'playing' || get().status === 'error', 'pronunciation can restart independently', 30000);
      check(get().reading?.status === 'paused', 'repeated pronunciation leaves reading retained');
      await click('[data-testid="lookup-close"]');
      await until(() => !document.querySelector('.context-panel'), 'lookup removed');
      await delay(250);
      report.observations.push({ sourceClose: { held, after: player.currentTime, paused: player.paused, reading: get().reading, audioCount: audio.length } });
      check(player.paused && Math.abs(player.currentTime - held) < .08, 'closing query does not resume reading');
      await click(toolbar(2));
      await until(() => !player.paused && player.currentTime > held + .1, 'explicit resume reacquires same source player');
      report.observations.push({ sourceResume: { held, resumed: player.currentTime, samePlayer: currentAudio() === player } });
      check(currentAudio() === player, 'source resume does not resolve another audio element');
      await click(toolbar(1));
      await until(() => player.currentTime < .4, 'replay seeks current source sentence');
      await click(toolbar(2));
      await click('[aria-label="从第 2 句开始朗读"]');
      await until(() => get().reading?.index === 1 && !player.paused && player.currentTime >= 5.8, 'paused source jumps to next cue and resumes');
      check(currentAudio() === player, 'source cue jump retains original decoded audio');
      await click(toolbar(2));
      for (const rate of [1.5, .75, 1, 1.25]) {
        await click(toolbar(3));
        check(get().reading?.rate === rate && player.playbackRate === rate && player.paused, `source paused rate ${rate} preserves pause`);
      }
      await click(toolbar(1));
      await until(() => !player.paused && player.currentTime >= 5.8 && player.currentTime < 6.4, 'second source cue replay starts at its anchor');
      await click(toolbar(4));
      await until(() => !document.querySelector('.reading-playback'), 'normal reading restored');
      check(get().reading === null && player.paused, 'exit disposes reading and native audio');
    });
    await run('translation disclosure and native TTS', async () => {
      await nav(text.id);
      check(!document.querySelector('.reading-page')?.getAttribute('data-translation'), 'normal reader initial state');
      const translation = document.querySelector('.reading-translation') as HTMLElement;
      check(!!translation && translation.getBoundingClientRect().height === 0 || !!translation?.closest('[aria-hidden="true"]'), 'cached translations initially collapsed');
      for (const theme of ['ocean', 'midnight']) {
        document.documentElement.dataset.theme = theme;
        await click('.dock-reading-tools > button:nth-of-type(2)');
        await delay(450);
        check(translation.getBoundingClientRect().height > 0 && !!translation.textContent?.includes('晨光'), `${theme}: cached Chinese expands without fake text`);
        await click('.dock-reading-tools > button:nth-of-type(2)'); await delay(450);
        check(translation.closest('[aria-hidden="true"]'), `${theme}: translation collapses and remains mounted`);
      }
      usePreferencesStore.getState().setSpeech({ onlineEnabled: true, allowDeviceFallback: false, speed: 'slow' });
      await click('.dock-reading-tools > button:first-of-type');
      await until(() => get().reading?.status === 'playing' || get().reading?.status === 'error', 'native TTS result', 30000);
      report.observations.push({ tts: { source: get().source, status: get().reading?.status, error: get().reading?.errorCode } });
      check(get().reading?.status === 'playing', 'real Edge TTS decodes in native WebView');
      const player = currentAudio()!;
      await until(() => player.currentTime > 1, 'TTS media clock');
      await click(toolbar(2));
      const immediate = player.currentTime; await delay(120);
      const at = player.currentTime; await delay(300);
      report.observations.push({ ttsPause: { immediate, at, after: player.currentTime, paused: player.paused, reading: get().reading, audioCount: audio.length } });
      check(player.paused && Math.abs(player.currentTime - at) < .08, 'TTS queue paused media clock remains stable after WebKit settles');
      const rate = get().reading!.rate;
      check(player.playbackRate === rate, 'reading TTS uses independent playback rate despite slow pronunciation preference');
      const resumeEventsFrom = report.media.length;
      await click(toolbar(2));
      await until(() => !player.paused && player.currentTime > at + .1, 'TTS resumes');
      const resumeEvent = report.media.slice(resumeEventsFrom).find(event => {
        const item = event as { id: number; event: string };
        return item.id === audio.indexOf(player) && item.event === 'playing';
      }) as { time: number } | undefined;
      report.observations.push({ ttsResume: { pausedAt: at, playingEventTime: resumeEvent?.time, polledTime: player.currentTime, samePlayer: currentAudio() === player } });
      check(currentAudio() === player && !!resumeEvent && resumeEvent.time >= at - .08 && resumeEvent.time < at + .5, 'TTS resumes same audio from settled cursor');
      await click(toolbar(1));
      await until(() => get().reading?.status === 'playing', 'TTS replay current');
      await click(toolbar(4));
    });
    await run('native on-demand translation and persistence', async () => {
      const journey = materials.find(item => item.name === 'A new journey.txt')!;
      await nav(journey.id);
      const before = await invoke<ReadingMaterial>('open_reading_material', { fileId: journey.id });
      report.observations.push({ translationBefore: before.segments.filter(row => row.zh_text?.trim()).length });
      await click('.dock-reading-tools > button:nth-of-type(2)');
      await until(() => {
        const button = document.querySelector<HTMLButtonElement>('.reading-translation-status button');
        return !button || !button.disabled;
      }, 'real translation service settles', 60000);
      await delay(450);
      const after = await invoke<ReadingMaterial>('open_reading_material', { fileId: journey.id });
      const completed = after.segments.filter(row => row.zh_text?.trim());
      report.observations.push({ translationAfter: completed.map(row => ({ id: row.id, zh: row.zh_text })), status: document.querySelector('.reading-translation-status')?.textContent });
      check(completed.length > 0 && completed.length <= 8, 'on-demand service produces Chinese persisted by native guarded fill');
      check([...document.querySelectorAll('.reading-translation-disclosure')].some(node => node.getAttribute('aria-hidden') === 'false'), 'generated translations visible');
      await click('.dock-reading-tools > button:nth-of-type(2)');
      await delay(450);
      check([...document.querySelectorAll('.reading-translation-disclosure')].every(node => node.getAttribute('aria-hidden') === 'true'), 'generated translations collapse without data loss');
    });
    await run('unavailable source never substitutes synthetic voice', async () => {
      const count = audio.length;
      await get().startSourceContinuous({ fileId: -999, sourceKey: 'missing-native-fixture', segmentId: -999, index: 0, key: 'reader:p3-missing:continuous' });
      await until(() => get().reading?.status === 'error', 'native source refusal');
      check(audio.length === count && get().source !== 'device' && get().source !== 'edge-network', 'native source failure never creates fallback TTS audio');
      report.observations.push({ sourceFailure: get().reading });
      get().exitReading();
    });
    await run('offline device fallback compatibility', async () => {
      usePreferencesStore.getState().setSpeech({ onlineEnabled: false, allowDeviceFallback: true, speed: 'normal' });
      await get().startQueue([{ key: 'reader:p3-device:0', text: 'This unique offline sentence checks the local device voice and its deliberate restart behavior.' }]);
      await until(() => get().reading?.status === 'playing' || get().reading?.status === 'error', 'device starts', 10000);
      report.observations.push({ device: { source: get().source, error: get().errorCode, voices: window.speechSynthesis.getVoices().filter(voice => voice.lang.startsWith('en')).map(voice => ({ name: voice.name, lang: voice.lang, local: voice.localService })) } });
      check(get().source === 'device' && get().reading?.status === 'playing', 'offline device voice starts in WKWebView');
      get().pause('user');
      check(get().reading?.resumeMode === 'restart-sentence' && get().reading?.status === 'paused', 'device pause exposes honest restart-sentence compatibility');
      await get().resume();
      await until(() => get().reading?.status === 'playing', 'device resumes by restart');
      get().exitReading();
      check(get().reading === null, 'device reading exits without stale restart');
    });
  } catch (error) { report.errors.push(String(error)); }
  finally {
    get().stop();
    usePreferencesStore.getState().setSpeech(originalPreferences);
    document.documentElement.dataset.theme = originalTheme;
    window.Audio = OriginalAudio;
    report.completed = true;
    await write();
  }
  return report;
}
