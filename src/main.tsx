import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { initI18n } from './i18n'
import App from './App'
import './reading-drawer.css'

async function start() {
  if (import.meta.env.VITE_SLICE_PREVIEW === '1') {
    const { prepareSlicePreview } = await import('./preview/slicePreview');
    await prepareSlicePreview();
  }
  initI18n();
  createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
  );
  if (import.meta.env.VITE_SLICE_QA === '1' && import.meta.env.VITE_SLICE_MAC_REFINEMENT === '1') {
    const { runMacRefinementChecks } = await import('./preview/macRefinementChecks');
    const buttons: HTMLButtonElement[] = [];
    const add = (label: string, top: number, run: () => Promise<unknown>) => {
      const button = document.createElement('button'); button.textContent = label; button.className = 'ui-button';
      button.style.cssText = `position:fixed;right:24px;top:${top}px;z-index:9999`;
      button.onclick = () => { buttons.forEach(item => item.remove()); void run().catch(error => { const status=document.createElement('p');status.textContent=String(error);status.style.cssText='position:fixed;top:40px;right:24px;z-index:9999;background:var(--surface);color:var(--text-strong);padding:16px';document.body.append(status); }); };
      buttons.push(button); document.body.append(button);
    };
    add('运行翻译位置验收', 516, async () => { const { runTranslationAnchorChecks } = await import('./preview/translationAnchorChecks'); return runTranslationAnchorChecks(); });
    add('运行横向展卡验收', 464, async () => { const { runHorizontalDeskChecks } = await import('./preview/horizontalDeskChecks'); return runHorizontalDeskChecks(); });
    add('运行Aa位置验收', 412, async () => { const { runDisplayDockChecks } = await import('./preview/displayDockChecks'); return runDisplayDockChecks(); });
    add('运行收藏简化验收', 360, async () => { const { runSavedSimplicityChecks } = await import('./preview/savedSimplicityChecks'); return runSavedSimplicityChecks(); });
    add('运行朗读跟随验收', 308, async () => { const { runReadingFollowChecks } = await import('./preview/readingFollowChecks'); return runReadingFollowChecks(); });
    add('运行词组匹配验收', 256, async () => { const { runPhrasalObjectChecks } = await import('./preview/phrasalObjectChecks'); return runPhrasalObjectChecks(); });
    add('运行查词平滑验收', 204, async () => { const { runLookupMotionChecks } = await import('./preview/lookupMotionChecks'); return runLookupMotionChecks(); });
    add('运行本轮修整验收', 152, async () => { const { runFocusMotionSpeechChecks } = await import('./preview/focusMotionSpeechChecks'); return runFocusMotionSpeechChecks(); });
    add('运行修订验收', 48, runMacRefinementChecks);
    add('运行核心回归', 100, async () => { const { runSlice4Checks } = await import('./preview/slice4Checks'); await runSlice4Checks(); });
    return;
  }
  if (import.meta.env.VITE_SLICE_QA === '1') {
    if (import.meta.env.VITE_SLICE_P4 === '1') {
      const { runSlice4Checks } = await import('./preview/slice4Checks');
      const macChecks = import.meta.env.VITE_SLICE_MAC_RELEASE === '1' ? await import('./preview/macReleaseChecks') : null;
      if (macChecks) await macChecks.installMacReleaseMotionObserver();
      // Native launch occurs in the background. Require a real foreground
      // gesture so visibility-driven audio pause is not mistaken for a fault.
      const start = document.createElement('button');
      start.textContent = macChecks ? '运行 macOS 发布验收' : '运行 P4 原生验收';
      start.className = 'ui-button';
      start.style.cssText = 'position:fixed;right:24px;top:48px;z-index:9999';
      start.addEventListener('click', () => { start.remove(); void (async () => { await runSlice4Checks(); if (macChecks) { await macChecks.runMacReleaseChecks(); const { runMacReleaseFlowGaps } = await import('./preview/macReleaseFlowGaps'); await runMacReleaseFlowGaps(); } })(); }, { once: true });
      document.body.append(start);
    } else if (import.meta.env.VITE_SLICE_P3 === '1') {
      const { runSlice3Checks } = await import('./preview/slice3Checks');
      void runSlice3Checks();
    } else {
      const { runSliceChecks } = await import('./preview/sliceChecks');
      void runSliceChecks();
    }
  }
}
void start().catch(error => {
  console.error('Application startup failed', error);
  const root = document.getElementById('root');
  if (root) root.textContent = import.meta.env.VITE_SLICE_PREVIEW === '1'
    ? `体验版初始化失败：${String(error)}` : '启动失败，请关闭后重试。';
});
