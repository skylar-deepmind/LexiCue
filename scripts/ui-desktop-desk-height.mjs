/** Desktop layout regression with synthetic material metadata and no user storage. */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.LEXICUE_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({channel: process.env.LEXICUE_UI_BROWSER_CHANNEL || 'chrome'});
const url = process.env.LEXICUE_UI_URL || 'http://127.0.0.1:5173';
const sizes = [[1440,900], [1280,720], [1100,722], [1024,640], [900,560], [768,480], [800,400]];
const scroll = '.reading-stage-page > .materials-scroll';
const active = '.desk-paper[data-desk-active="true"]';
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }

async function fixture(page, state, theme) {
  await page.addInitScript(({ state, theme }) => {
    const long = state === 'long';
    const files = state === 'empty' ? [] : Array.from({length:2}, (_, index) => ({
      id: index + 1,
      name: long ? 'Observing the park on a quiet morning '.repeat(6) + 'UnbrokenWord'.repeat(8) : ['Quiet Afternoon.pdf', 'How To Learn To Code In 2026.srt'][index],
      content_hash: 'sample-' + index,
      segment_count: 3,
      imported_at: 1,
      preview: 'A Quiet Afternoon We opened the window and listened to the birds.',
      tags: Array.from({length: long ? 19 : 2}, (_, id) => ({
        id, name: long && id === 0 ? 'UnbrokenTag'.repeat(14) : 'Tag ' + id, tone:'blue',
      })),
    }));
    const items = state === 'stored' ? [] : files.map(f => ({id:f.id, identity:'content:' + f.content_hash, hash:f.content_hash}));
    // Use the store's canonical serialization, rather than its recovery state.
    localStorage.setItem('lexicue-reading-desk:v2', JSON.stringify({version:2, initialized:true, items, selected:items[0] ?? null, opened:[]}));
    localStorage.setItem('lexicue-onboarding-v1', JSON.stringify({version:1, status:'skipped'}));
    localStorage.setItem('lexicue-theme', theme);
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener() {}};
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1, unregisterCallback() {}, convertFileSrc: value => value,
      invoke: async command => command === 'list_materials' ? files : command === 'list_tags' ? [] : null,
    };
  }, {state, theme});
}

try {
  for (const theme of ['ocean', 'midnight']) {
    for (const state of ['empty','stored','simple','long']) {
      const page = await browser.newPage({reducedMotion:'reduce'});
      await fixture(page, state, theme);
      await page.goto(url + '/files');
      await page.locator(state === 'empty' || state === 'stored' ? '.desk-empty h2' : active + ' h2').waitFor();
      await page.evaluate(() => document.fonts.ready);
      for (const [width, height] of sizes) {
        await page.setViewportSize({width,height});
        await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
        const metrics = await page.locator(scroll).evaluate(el => ({
          overflowX: el.scrollWidth - el.clientWidth, overflowY: el.scrollHeight - el.clientHeight,
        }));
        const label = theme + '/' + state + '/' + width + '×' + height;
        check(metrics.overflowX <= 1, label + ' horizontal overflow');
        if (state !== 'long') check(metrics.overflowY <= 1, label + ' extra vertical scroll: ' + metrics.overflowY);
        if (state === 'simple') {
          const geometry = await page.evaluate(() => {
            const card = document.querySelector('.desk-paper[data-desk-active="true"]').getBoundingClientRect();
            const pager = document.querySelector('.desk-pager').getBoundingClientRect();
            const shelf = document.querySelector('.desk-library-dock').getBoundingClientRect();
            const heading = document.querySelector('.materials-heading').getBoundingClientRect();
            const content = document.querySelector('.reading-stage-content').getBoundingClientRect();
            const dock = document.querySelector('.desk-dock-wrap').getBoundingClientRect();
            return { height: card.height, gap: shelf.top - pager.bottom,
              bottomBlank: content.bottom - dock.bottom,
              above: card.top - heading.bottom, below: pager.top - card.bottom };
          });
          // Fractional browser scaling can round a 32px margin just above 32.
          check(geometry.gap >= -.5 && geometry.gap <= 32.5, label + ' shelf follows pagination');
          check(geometry.bottomBlank <= 32, label + ' shelf uses the bottom of the workspace');
          check(Math.abs(geometry.above - geometry.below) <= 48, label + ' card has balanced vertical space');
          if (height >= 720) check(geometry.height >= 320, label + ' full-size card');
        }
        if (state === 'long') {
          const clipping = await page.locator(active + ' :is(h2,.file-tag)').evaluateAll(nodes =>
            nodes.some(el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1));
          check(!clipping, label + ' clipped title or tag');
        }
      }
      if (state === 'long') {
        // An enlarged page must allow deliberate scrolling, with all live actions
        // in keyboard order even when their initial positions are off screen.
        await page.locator('html').evaluate(el => el.style.zoom = '1.5');
        await page.locator(active + ' .desk-card-menu button').focus();
        for (const target of [active + ' .desk-card-tags button', active + ' .desk-primary', '[data-testid=desk-next]', '.desk-library-dock']) {
          await page.keyboard.press('Tab');
          await page.waitForFunction(selector => document.activeElement?.matches(selector), target);
          const hit = await page.locator(target).evaluate(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && el.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2));
          });
          check(hit, theme + ' enlarged focus hidden at ' + target);
        }
        await page.keyboard.press('Enter');
        await page.locator('.library-overlay-panel').waitFor();
        await page.keyboard.press('Escape');
        await page.locator('.library-overlay-panel').waitFor({state:'detached'});
        await page.waitForFunction(() => document.activeElement?.matches('.desk-library-dock'));
        check(true, theme + ' Escape restores the library button');
      }
      await page.close();
    }
  }
  console.log('PASS: ' + checks + ' desktop height and keyboard checks');
} finally { await browser.close(); }
