/** An incoming reading position is used on the next open, including on a narrow screen. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createReadingHarness } from './ui-reading-support.mjs';

const harness = await createReadingHarness(process.env.LEXICUE_READING_UI_OUTPUT || '/tmp/lexicue-device-reading');
const { browser, call, fixture, url } = harness;
try {
  for (const width of [375, 1280]) {
    const segments = Array.from({length: 100}, (_, index) => ({
      index, en_text: `Reading position fixture sentence number ${index}.`, zh_text: '已有译文。',
    }));
    const {file_id: fileId} = await call('import_reading_material', {input: {
      operation_id: randomUUID(), name: `Anchors ${width}.txt`,
      content: segments.map(s => s.en_text).join('\n'), segments,
    }});
    const {material} = await call('open_reading_material', {fileId});
    const move = (segment, parent) => call('remember_reading_position', {
      fileId, segment, contentHash: material.content_hash, parent, back: false, legacy: false,
    });
    const revision = await move(12, null);
    const context = await browser.newContext({viewport:{width,height:812}, ...(width===375 ? {isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'} : {})});
    const page = await context.newPage();
    await fixture(page, width === 375 ? 'ocean' : 'midnight');
    // Shrinking the reading viewport during its first scroll reproduces the
    // order in which mobile chrome and the reader's ResizeObserver can settle.
    await page.addInitScript(() => {
      document.addEventListener('scroll', event => {
        const viewport = event.target;
        if (!(viewport instanceof HTMLElement) || !viewport.matches('.reader-scroll') || !viewport.scrollTop) return;
        const pane = viewport.closest('.material-reading');
        if (!pane || pane.dataset.fixtureResize) return;
        pane.dataset.fixtureResize = 'true';
        pane.style.height = `${pane.clientHeight - 18}px`;
      }, true);
    });
    const at = async segment => page.waitForFunction(idx => {
      const scroll = document.querySelector('.reader-scroll');
      const row = scroll?.querySelector(`[data-sentence="${idx}"]`);
      return row && Math.abs(row.getBoundingClientRect().top - scroll.getBoundingClientRect().top) <= 8;
    }, segment, {timeout:8000});
    await page.goto(`${url}/files`);
    await page.locator('.desk-library-dock').click();
    await page.getByRole('dialog').locator(`.library-open[data-open="${fileId}"]`).click();
    await at(12);
    const top = () => page.locator('.reader-scroll').evaluate(n => n.scrollTop);
    const settleViewport = async () => {
      await page.locator('.material-reading[data-fixture-resize]').waitFor();
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    };
    await settleViewport();
    await at(12);
    const old = await top();
    await move(40, revision);
    await page.evaluate(() => window.dispatchEvent(new Event('lexicue-sync-applied')));
    await page.waitForTimeout(400);
    assert.ok(Math.abs(await top() - old) < 2, 'remote updates preserve the open page');
    await page.reload();
    await settleViewport();
    await at(40);
    await context.close();
    console.log(`Reading anchor opens, stays put, and resumes at the new sentence at ${width}px`);
  }
} finally {
  await harness.dispose();
}
