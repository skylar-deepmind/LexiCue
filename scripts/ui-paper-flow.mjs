import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createReadingHarness } from './ui-reading-support.mjs';

const output = process.env.LEXICUE_PAPER_OUTPUT || '/tmp/lexicue-paper-flow';
const harness = await createReadingHarness(output);
const sentence = 'A quiet morning is a good time to read.';
async function center(locator) {
  const box = await locator.boundingBox();
  assert.ok(box);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function choose(page, host, name) {
  const edge = host.locator('.gesture-bottom-edge'),
    start = await center(edge);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y - 38, { steps: 9 });
  await host.locator('.edge-choice[data-phase=open]').waitFor();
  const choice = host.locator('.draw-track [data-choice]').filter({ hasText: name });
  await choice.scrollIntoViewIfNeeded();
  const end = await center(choice);
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}
try {
  for (const [theme, width, height] of [
    ['ocean', 1152, 800],
    ['midnight', 390, 844],
  ]) {
    await harness.call('test_reset');
    for (const name of ['阅读', '访谈']) await harness.call('create_tag', { name });
    await mkdir(output, { recursive: true });
    const record = !!process.env.LEXICUE_PAPER_VIDEO && width > 700;
    const context = await harness.browser.newContext({
      viewport: { width, height },
      hasTouch: width < 700,
      ...(record ? { recordVideo: { dir: output, size: { width, height } } } : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6500);
    try {
      await harness.fixture(page, theme);
      await page.goto(harness.url + '/files');
      await page.evaluate((text) => {
        localStorage.setItem('lexicue-onboarding-v1', JSON.stringify({ version: 1, status: 'skipped' }));
        const original = window.__TAURI_INTERNALS__.invoke;
        window.__TAURI_INTERNALS__.invoke = (command, args) =>
          command === 'plugin:clipboard-manager|read_text' ? Promise.resolve(text) : original(command, args);
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { readText: async () => text },
        });
      }, sentence + '\n\nThere is still time to listen.');
      await page.waitForTimeout(record ? 1000 : 250);
      await page.locator('[data-guide=import]').click();
      const preview = page.locator('.import-card-stage');
      await preview.locator('[data-ready=true]').waitFor();
      await page.screenshot({ path: output + '/' + theme + '-1.png' });
      if (record) await page.waitForTimeout(900);
      await choose(page, preview, '阅读');
      const desk = page.locator('.approved-desk'),
        card = desk.locator('[data-desk-active=true]');
      await page.waitForFunction(
        () =>
          !document.querySelector('.import-material-card') &&
          document.querySelector('[data-desk-active=true] .approved-tag-edit')?.textContent === '阅读',
      );
      await page.screenshot({ path: output + '/' + theme + '-2.png' });
      if (record) await page.waitForTimeout(1100);
      await choose(page, desk, '访谈');
      await page.waitForFunction(
        () => document.querySelector('[data-desk-active=true] .approved-tag-edit')?.textContent === '访谈',
      );
      if (record) await page.waitForTimeout(850);
      await card.locator('.approved-card-open').click();
      const word = page
        .locator('.reading-word')
        .filter({ hasText: /^time$/ })
        .first();
      if (record) await page.waitForTimeout(1000);
      await word.click();
      await page.locator('.quiet-pocket').waitFor();
      await page.waitForTimeout(500);
      const start = await center(word),
        end = await center(page.locator('.quiet-pocket'));
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 12, start.y, { steps: 3 });
      await page.locator('.sentence-sheet[data-floating=true]').waitFor();
      if (record) await page.waitForTimeout(450);
      await page.mouse.move(end.x, end.y, { steps: record ? 44 : 20 });
      await page.mouse.up();
      await page.locator('.sheet-seat[data-collected=true] .collected-bookmark').waitFor();
      await page.waitForTimeout(760);
      await page.screenshot({ path: output + '/' + theme + '-3.png' });
      await page.locator('.quiet-pocket').click();
      await page.locator('.recall-history .saved-sentence-original').filter({ hasText: sentence }).waitFor();
      await page.waitForTimeout(450);
      await page.screenshot({ path: output + '/' + theme + '-4.png' });
      if (record) await page.waitForTimeout(1000);
      await page.keyboard.press('Escape');
      await page.reload();
      await page.locator('.collected-bookmark').waitFor();
      assert.equal(await page.locator('.collected-bookmark').count(), 1);
      const items = await harness.call('list_materials');
      assert.equal(items.length, 1);
      assert.equal(items[0].tags[0].name, '访谈');
      const records = await harness.call('saved_recall_contexts', { expression: 'time' });
      assert.equal(records.total, 1);
      assert.equal(records.records[0].sentence, sentence);
      console.log(theme, width, 'import → label → home → retag → lookup → pocket → reopen passed');
    } catch (error) {
      console.error(
        await page.locator('body').innerText(),
        harness.errors,
        await page.evaluate(async () => [
          window.__uiCalls?.slice(-7).map((x) => x.command),
          (await window.__uiStoreModule('importStore')).useImportStore.getState().phase,
        ]),
      );
      await page.screenshot({ path: output + '/failure.png' });
      throw error;
    } finally {
      await context.close();
      if (record) await page.video().saveAs(output + '/walkthrough.webm');
    }
  }
} finally {
  await harness.dispose();
}
