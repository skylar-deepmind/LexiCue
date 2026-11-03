/** Desktop lookup must enter from the right without covering its source text. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createReadingHarness } from './ui-reading-support.mjs';

const output = process.env.LEXICUE_DRAWER_OUTPUT || '/tmp/lexicue-reading-drawer';
await mkdir(output, { recursive: true });
const h = await createReadingHarness(output);
const report = { checks: [], measurements: [], errors: h.errors };
const check = (condition, name) => { assert.ok(condition, name); report.checks.push(name); };
let page;
const textLayout = () => page.evaluate(() => {
    const paper = document.querySelector('.reading-paper');
    return { width: paper.clientWidth, height: paper.clientHeight,
        words: [...paper.querySelectorAll('.reading-word')].map(n => [n.offsetLeft, n.offsetTop]) };
});
const geometry = () => page.evaluate(() => {
    const paper = document.querySelector('.reading-paper').getBoundingClientRect();
    const panel = document.querySelector('.context-panel');
    const rect = panel.getBoundingClientRect(), style = getComputedStyle(panel);
    return { mode: document.querySelector('.reading-layout').dataset.layout,
        paperRight: paper.right, panelLeft: rect.left, panelRight: rect.right,
        animation: style.animationName, transform: style.transform,
        overflow: document.querySelector('.reader-scroll').scrollWidth > document.querySelector('.reader-scroll').clientWidth };
});
try {
    const text = 'We take a closer look at the world and remember the original sentence while reading its explanation.';
    const material = await h.call('import_reading_material', { input: {
        operation_id: randomUUID(), name: 'Drawer regression.srt', content: `1\n00:00:01,000 --> 00:00:05,000\n${text}\n`,
        segments: [{ index: 0, en_text: text, zh_text: null, start_time: '00:00:01,000', end_time: '00:00:05,000' }],
    } });
    for (const theme of ['ocean', 'midnight', 'amber']) {
        page = await h.browser.newPage({ viewport: { width: 1100, height: 750 } });
        await h.fixture(page, theme); await page.routeWebSocket('**', socket => socket.close());
        await page.goto(`${h.url}/files/${material.file_id}`);
        await page.locator('.reading-word').first().waitFor();
        for (const width of [800, 1024, 1100, 1440, 1920]) for (const scale of [100, 140]) {
            const label = `${theme} ${width}px ${scale}%`;
            await page.setViewportSize({ width, height: 750 });
            await page.evaluate(async scale => {
                const { usePreferencesStore } = await window.__uiStoreModule('preferencesStore');
                usePreferencesStore.getState().setContentFontScale('learning', scale);
            }, scale);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const before = await textLayout();
            const centeredLeft = await page.locator('.reading-paper').evaluate(n => n.getBoundingClientRect().left);
            await page.locator('.reading-word').filter({ hasText: /^take$/ }).click();
            await page.locator('.context-panel').waitFor();
            const frames = await page.locator('.context-panel').evaluate(async panel => {
                const animation = panel.getAnimations().find(a => a.animationName === 'reading-card-open');
                if (!animation) return null;
                const paperNode = document.querySelector('.reading-paper');
                const motion = paperNode.getAnimations().find(a => a.transitionProperty === 'transform');
                motion?.pause();
                animation.pause(); const frames = [];
                for (const time of [0, 100, 210, 419]) {
                    animation.currentTime = time;
                    if (motion) motion.currentTime = time;
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    const r = panel.getBoundingClientRect(), paper = document.querySelector('.reading-paper').getBoundingClientRect();
                    const matrix = new DOMMatrix(getComputedStyle(panel).transform);
                    frames.push({ time, gap: r.left - paper.right, x: matrix.m41, y: matrix.m42,
                        paperX: paper.left, width: paperNode.clientWidth, height: paperNode.clientHeight,
                        words: [...paperNode.querySelectorAll('.reading-word')].map(n => [n.offsetLeft, n.offsetTop]) });
                }
                animation.finish(); motion?.finish(); return frames;
            });
            check(frames?.every(f => f.gap >= 23 && Math.abs(f.y) < .1) && frames[0].x > 0, `${label} enters horizontally without overlap throughout animation`);
            check(frames.every(f => f.width === before.width && f.height === before.height && JSON.stringify(f.words) === JSON.stringify(before.words)), `${label} opening preserves every word's line and position within paper`);
            check(frames[0].paperX - frames.at(-1).paperX > 100, `${label} paper translates smoothly to the left`);
            const measured = await geometry(); report.measurements.push({ label, frames, ...measured });
            check(measured.mode === 'columns' && measured.panelLeft - measured.paperRight >= 23, `${label} article reserves panel space`);
            check(!measured.overflow && measured.panelRight <= width, `${label} fits viewport`);
            await page.locator('.lookup-stage[data-lookup-state="ready"]').waitFor();
            if (width === 1920 && scale === 100) {
                const action = page.locator('.lookup-footer > .saved-primary');
                check(await action.evaluate(n => n.getBoundingClientRect().width < n.closest('.context-panel').getBoundingClientRect().width / 2 && n.getBoundingClientRect().height >= 44), `${theme} save action is compact and remains reachable`);
                for (const state of ['default', 'hover', 'disabled']) {
                    if (state === 'hover') await action.hover();
                    if (state === 'disabled') await action.evaluate(n => n.disabled = true);
                    await page.waitForTimeout(180);
                    const ratio = await action.evaluate(n => {
                        const rgb = s => s.match(/[\d.]+/g).map(Number);
                        const luminance = c => c.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
                        const style = getComputedStyle(n), a = luminance(rgb(style.color)), b = luminance(rgb(style.backgroundColor));
                        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
                    });
                    check(ratio >= 4.5, `${theme} ${state} compact action contrast ${ratio.toFixed(2)}`);
                }
                await action.evaluate(n => n.disabled = false); await action.focus();
                await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
                check(await action.evaluate(n => getComputedStyle(n).boxShadow.includes('inset')), `${theme} compact action keeps visible keyboard focus`);
                await page.mouse.move(20, 100); await action.evaluate(n => n.blur());
            }
            await page.screenshot({ path: `${output}/${theme}-${width}-${scale}.png` });
            await page.keyboard.press('Escape');
            const closing = await geometry();
            check(closing.mode === 'columns' && closing.animation === 'reading-card-close' && closing.panelLeft >= closing.paperRight, `${label} close keeps column until panel exits`);
            const closeFrames = await page.locator('.context-panel').evaluate(async panel => {
                const animation = panel.getAnimations().find(a => a.animationName === 'reading-card-close');
                const paper = document.querySelector('.reading-paper');
                const motion = paper.getAnimations().find(a => a.transitionProperty === 'transform');
                if (!animation) return null;
                animation.pause(); motion?.pause(); const frames = [];
                for (const time of [0, 100, 339]) {
                    animation.currentTime = time; if (motion) motion.currentTime = time;
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    frames.push({ gap: panel.getBoundingClientRect().left - paper.getBoundingClientRect().right,
                        paperX: paper.getBoundingClientRect().left, width: paper.clientWidth, height: paper.clientHeight,
                        words: [...paper.querySelectorAll('.reading-word')].map(n => [n.offsetLeft, n.offsetTop]) });
                }
                animation.finish(); motion?.finish(); return frames;
            });
            check(closeFrames?.every(f => f.gap >= 23 && f.width === before.width && f.height === before.height && JSON.stringify(f.words) === JSON.stringify(before.words)), `${label} closing preserves every word and never overlaps`);
            check(closeFrames.at(-1).paperX - closeFrames[0].paperX > 100, `${label} paper returns while drawer closes`);
            report.measurements.at(-1).closeFrames = closeFrames;
            await page.locator('.context-panel').waitFor({ state: 'detached' });
            check(await page.locator('.reading-layout').getAttribute('data-layout') === 'single', `${label} close restores single column`);
            check(JSON.stringify(await textLayout()) === JSON.stringify(before) && Math.abs(await page.locator('.reading-paper').evaluate(n => n.getBoundingClientRect().left) - centeredLeft) < 1, `${label} closed paper has identical wrapping and is centered again`);
        }
        const widths = report.measurements.filter(m => m.label.startsWith(theme));
        check(widths.find(m => m.label === `${theme} 1440px 100%`).frames[0].width > widths.find(m => m.label === `${theme} 800px 100%`).frames[0].width, `${theme} window resizing still adapts text width`);
        check(widths.find(m => m.label === `${theme} 1440px 140%`).frames[0].width !== widths.find(m => m.label === `${theme} 1440px 100%`).frames[0].width, `${theme} font scaling still recalculates column allocation`);
        await page.locator('.reading-word').filter({ hasText: /^take$/ }).click();
        await page.locator('.context-panel').evaluate(async panel => {
            await Promise.allSettled(panel.getAnimations().map(a => a.finished));
            window.__stableDrawer = panel;
        });
        const beforeInterrupt = await textLayout();
        await page.keyboard.press('Escape');
        await page.locator('.reading-word').filter({ hasText: /^closer$/ }).evaluate(n => n.click());
        await page.waitForTimeout(450);
        check(await page.locator('.context-panel').evaluate(n => n === window.__stableDrawer) && await page.locator('.context-layer--closing').count() === 0, `${theme} new selection cancels close without remounting`);
        check(JSON.stringify(await textLayout()) === JSON.stringify(beforeInterrupt) && (await geometry()).panelLeft >= (await geometry()).paperRight, `${theme} interrupted close does not reflow or overlap`);
        await page.keyboard.press('Escape'); await page.locator('.context-panel').waitFor({ state: 'detached' });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.locator('.reading-word').filter({ hasText: /^take$/ }).click();
        check((await geometry()).animation === 'none', `${theme} reduced motion respected`);
        await page.keyboard.press('Escape'); await page.locator('.context-panel').waitFor({ state: 'detached' });
        // Let in-flight dictionary RPCs finish before closing their browser
        // connection; this keeps the shared temporary bridge alive for themes.
        await page.waitForLoadState('networkidle', { timeout: 45000 });
        await page.close();
    }
    check(!h.errors.length, 'no browser exceptions');
} catch (error) {
    report.error = String(error);
    if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure.png` });
    throw error;
} finally {
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); await h.dispose();
}
console.log(`${report.checks.length} drawer checks passed.`);
