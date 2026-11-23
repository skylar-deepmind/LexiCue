/** Keep the date reset presentation independent of the shape of the chart. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createReadingHarness } from './ui-reading-support.mjs';

const output = process.env.LEXICUE_TIMELINE_RESET_UI_OUTPUT || '/tmp/lexicue-timeline-reset';
const h = await createReadingHarness(output);
const checks = [];
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks.push(label); };
let page;
try {
  await h.call('test_reset');
  const records = Array.from({ length: 28 }, (_, i) => ({
    expression: 'air',
    sentence: `The air smelled of salt near the pier on day ${i + 1}.`,
    saved_at: Date.UTC(2026, 9, 1 + i, 12),
  }));
  await h.call('test_seed_recall', { count: records.length, records });
  for (const theme of ['sage', 'midnight']) for (const width of [1360, 375]) {
    const context = await h.browser.newContext({ viewport: { width, height: 880 }, hasTouch: width < 768, timezoneId: 'UTC' });
    page = await context.newPage();
    await h.fixture(page, theme);
    await page.goto(`${h.url}/saved`);

    const start = page.locator('[data-range-handle=start]');
    const reset = page.locator('.saved-timeline-reset');
    const selection = page.locator('.saved-timeline-selection');
    const background = () => reset.evaluate(node => getComputedStyle(node).backgroundColor);
    const selected = async () => {
      await start.press('ArrowRight');
      await selection.waitFor();
      await page.waitForFunction(() => window.__uiCalls.some(call =>
        call.command === 'list_saved_groups' && call.args.startMs === Date.UTC(2026, 9, 2)));
    };
    await selected();
    eq(await background(), 'rgba(0, 0, 0, 0)', 'reset is transparent while idle');
    await reset.hover();
    eq(await background(), 'rgba(0, 0, 0, 0)', 'reset is transparent while hovered');
    await page.mouse.down();
    eq(await background(), 'rgba(0, 0, 0, 0)', 'reset is transparent while pressed');
    await page.screenshot({ path: `${output}/${theme}-${width}-range.png` });
    await page.mouse.up();
    await reset.waitFor({ state: 'detached' });
    eq(await selection.count(), 0, 'pointer reset clears the selection');

    await selected();
    await page.keyboard.press('Tab');
    await reset.focus();
    eq(await reset.evaluate(node => {
      const style = getComputedStyle(node);
      return node.matches(':focus-visible') && (style.outlineStyle !== 'none' || style.boxShadow !== 'none');
    }), true, 'keyboard focus remains visible');
    await reset.press('Enter');
    await reset.waitFor({ state: 'detached' });
    eq(await selection.count(), 0, 'keyboard reset restores all dates');
    await context.close();
  }
  eq(h.errors, [], 'no application errors');
  await writeFile(`${output}/evidence.json`, JSON.stringify({ passed: true, checks }, null, 2));
  console.log(`Timeline reset: ${checks.length} checks passed`);
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await h.dispose();
}
