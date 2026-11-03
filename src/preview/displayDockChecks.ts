import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { assertSlicePreview } from './slicePreview';
import { useMaterialStore } from '../stores/materialStore';
import { useReadingDeskStore } from '../stores/readingDeskStore';

export async function runDisplayDockChecks() {
  await assertSlicePreview(); if (import.meta.env.VITE_SLICE_QA !== '1') throw Error('QA only');
  const report = { checks: [] as string[], errors: [] as string[], geometry: [] as unknown[], completed: false };
  const check = (ok: unknown, label: string) => (ok ? report.checks : report.errors).push(label);
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const live = <T extends HTMLElement = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)].find(n => n.getClientRects().length && !n.closest('[inert],[aria-hidden="true"]'));
  const until = async <T,>(fn: () => T, label: string) => { const end = performance.now() + 10000; while (performance.now() < end) { const v = fn(); if (v) return v; await wait(25); } throw Error(`Timeout ${label}`); };
  const nav = async (path: string) => { live<HTMLAnchorElement>(`.b-dock a[href="${path}"]`)!.click(); await wait(600); };
  const originalTheme = document.documentElement.dataset.theme;
  try {
    await nav('/files'); await useMaterialStore.getState().load();
    const file = useMaterialStore.getState().files.find(f => f.name === 'A quiet morning.txt')!; useReadingDeskStore.getState().keep(file); await wait(80);
    for (const theme of ['ocean', 'midnight']) {
      document.documentElement.dataset.theme = theme;
      check(!live('.display-settings-trigger'), `${theme}: materials page has no reading display button`);
      live<HTMLButtonElement>('.desk-primary')!.click(); await until(() => live('.reading-word'), 'reader'); await wait(600);
      const trigger = live<HTMLButtonElement>('.b-dock .dock-reading-tools .display-settings-trigger')!;
      const dock = live('.b-dock')!.getBoundingClientRect(), button = trigger.getBoundingClientRect();
      check(!!trigger && [...document.querySelectorAll('.display-settings-trigger')].filter(n => n.getClientRects().length && !n.closest('[inert]')).length === 1, `${theme}: reader has exactly one Aa entry in its floating dock`);
      check(!document.querySelector('.reading-breadcrumb .display-settings'), `${theme}: former upper-right entry is removed`);
      check(button.left >= dock.left && button.right <= dock.right && dock.top >= 0 && dock.bottom <= innerHeight, `${theme}: added button fits the centered floating toolbar`);
      trigger.click(); const panel = await until(() => live('.display-font-popover'), 'font menu'); await wait(240);
      const rect = panel.getBoundingClientRect(); report.geometry.push({ theme, dock: dock.toJSON(), button: button.toJSON(), panel: rect.toJSON() });
      check(rect.left >= dock.right && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, `${theme}: display controls open beside the dock within the window`);
      check(panel.querySelectorAll('input[type="range"]').length === 3 && !!panel.querySelector('input[type="checkbox"]'), `${theme}: all existing font and recall controls remain available`);
      const input = panel.querySelector<HTMLInputElement>('input')!; input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(60);
      check(!live('.display-font-popover') && document.activeElement === trigger, `${theme}: Escape closes settings and restores focus to Aa`);
      const style = getComputedStyle(trigger); check(style.outlineStyle === 'none' && !style.boxShadow.split(/,(?![^()]*\))/).some(s => s.trim() !== 'none' && !s.includes('inset')), `${theme}: keyboard focus has no surrounding outer frame`);
      trigger.click(); await until(() => live('.display-font-popover'), 'reopened font menu'); await nav('/saved');
      check(!live('.display-settings-trigger') && !live('.display-font-popover'), `${theme}: leaving reading removes the toolbar button and open panel`);
      await nav('/settings'); check(!live('.display-settings-trigger'), `${theme}: settings page has no reading Aa button`);
      await nav('/files');
    }
  } catch (error) { report.errors.push(String(error)); }
  finally {
    document.documentElement.dataset.theme = originalTheme ?? 'ocean'; report.completed = true;
    await writeTextFile('mac-release-display-dock.json', JSON.stringify(report, null, 2), { baseDir: BaseDirectory.AppData });
    const status = document.createElement('p'); status.textContent = `Aa验收：${report.checks.length} 通过，${report.errors.length} 问题`; status.style.cssText = 'position:fixed;top:40px;right:24px;z-index:9999;padding:16px;background:var(--surface);color:var(--text-strong)'; document.body.append(status);
  }
  return report;
}
