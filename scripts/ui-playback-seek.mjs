/** Browse, return to current playback on idle, or explicitly play the first-line guide. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createReadingHarness } from './ui-reading-support.mjs';

const out = process.env.LEXICUE_PLAY_SEEK_OUTPUT || '/tmp/lexicue-playback-seek';
const h = await createReadingHarness(out), checks = [];
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); };
let page;
try {
  const lines = Array.from({ length: 45 }, (_, index) => `The train reached the station just before noon. Scene ${index + 1}.`);
  for (const theme of ['sage', 'midnight']) for (const touch of [true, false]) {
    await h.call('test_reset');
    const material = await h.call('import_reading_material', { input: {
      operation_id: crypto.randomUUID(), name: 'Playback selection.txt', content: lines.join('\n'),
      segments: lines.map((en_text, index) => ({ index, en_text, start_time: null, end_time: null })),
    } });
    const label = `${theme}/${touch ? 'touch' : 'mouse'}`;
    const context = await h.browser.newContext({
      viewport: touch ? { width: 390, height: 844 } : { width: 1240, height: 900 },
      hasTouch: touch, isMobile: touch,
    });
    page = await context.newPage();
    await h.fixture(page, theme);
    await page.goto(`${h.url}/files/${material.file_id}`);
    const start = page.locator('.mobile-headphone-mode[data-active=true] button');
    const playback = page.locator('.mobile-playback-mode[data-active=true] button').first();
    const exit = page.locator('.mobile-playback-mode[data-active=true] button').last();
    const guide = page.locator('.reader-playback-guide');
    const viewport = page.locator('.reader-scroll');
    const row = index => page.locator(`[data-sentence="${index}"] .reading-original`);
    await row(3).waitFor();
    await start.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async () => {
      const { useSpeechStore } = await window.__uiStoreModule('speechStore');
      window.playbackCommits = [];
      window.browsePauses = [];
      window.advanceReading = index => useSpeechStore.setState(state => ({
        reading: { ...state.reading, index }, queueIndex: index,
      }));
      useSpeechStore.setState({
        pause: reason => { window.browsePauses.push(reason); },
        startQueue: async (items, index) => {
          const key = items[index].key;
          window.playbackCommits.push({ index, text: items[index].text });
          useSpeechStore.setState({ key, status: 'playing', queueIndex: index,
            reading: { key, index, status: 'playing', mode: 'queue' } });
        },
      });
    });
    const commits = () => page.evaluate(() => window.playbackCommits);
    const scrollTop = () => viewport.evaluate(node => node.scrollTop);
    const chosen = () => guide.evaluate(node => Number(node.closest('[data-sentence]').dataset.sentence));
    const cdp = touch ? await context.newCDPSession(page) : null;
    const browse = async (distance = 360) => {
      const bounds = await viewport.boundingBox();
      const x = bounds.x + bounds.width - 30;
      const y = bounds.y + Math.min(bounds.height - 150, 490);
      const before = await scrollTop();
      if (!cdp) {
        await page.mouse.move(x, y);
        await page.mouse.wheel(0, distance);
      } else {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{x,y}] });
        for (let i = 1; i <= 8; i++) {
          await cdp.send('Input.dispatchTouchEvent', { type:'touchMove',touchPoints:[{x,y:y-distance*i/8}] });
          await page.waitForTimeout(22);
        }
        await page.waitForTimeout(180);
        await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd',touchPoints:[] });
      }
      await page.waitForFunction(old => document.querySelector('.reader-scroll').scrollTop > old + 40, before);
      await waitForScrollToSettle();
    };
    const waitForScrollToSettle = () => viewport.evaluate(async node => {
      let previous = node.scrollTop, stable = 0;
      while (stable < 4) {
        await new Promise(requestAnimationFrame);
        const current = node.scrollTop;
        stable = Math.abs(current - previous) < .1 ? stable + 1 : 0;
        previous = current;
      }
    });

    check(await guide.count() === 0, `${label} reader entry has no guide or autoplay`);
    await browse();
    const unplayed = await scrollTop();
    await page.waitForTimeout(2250);
    check(await guide.count() === 0 && (await commits()).length === 0 && Math.abs((await scrollTop()) - unplayed) < 2,
      `${label} normal browsing shows no guide, starts no audio, and keeps the scroll position`);
    if (touch) await start.tap(); else await start.click();
    await playback.waitFor();
    await waitForScrollToSettle();
    check(await guide.count() === 0 && (await commits()).length === 1, `${label} headphones enter listening mode without immediately showing a guide`);
    await browse();
    await guide.waitFor();
    check(await guide.count() === 1 && (await commits()).length === 1, `${label} browsing in listening mode exposes one guide without starting another sentence`);
    const geometry = await guide.evaluate(node => {
      const p = node.closest('p');
      const line = getComputedStyle(p,'::before');
      const center = node.getBoundingClientRect().top + node.getBoundingClientRect().height/2;
      return { line:line.height, top:parseFloat(line.top), lineHeight:parseFloat(getComputedStyle(p).lineHeight),
        center:center-p.getBoundingClientRect().top, fill:getComputedStyle(node).backgroundColor };
    });
    check(geometry.line === '1px' && Math.abs(geometry.top - (geometry.lineHeight/2 + 2)) < 2
      && Math.abs(geometry.top-geometry.center) < 1 && geometry.fill === 'rgba(0, 0, 0, 0)', `${label} one thin first-line guide with a circle-free control`);
    await page.screenshot({ path: `${out}/${theme}-${touch ? 'touch' : 'desktop'}-guide.png` });
    const first = await chosen();
    if (touch) await guide.tap({ position: { x: 155, y: 22 } });
    else await guide.click({ position: { x: 155, y: 22 } });
    await page.waitForFunction(() => window.playbackCommits.length === 2);
    assert.deepEqual((await commits()).at(-1), { index: first, text: lines[first] });
    check(true, `${label} tapping across the line plays exactly its sentence`);
    await guide.waitFor({ state:'detached' });
    await playback.waitFor();
    await page.waitForTimeout(900);

    await browse();
    await guide.waitFor();
    const whileBrowsing = await scrollTop();
    check((await commits()).length === 2 && await page.evaluate(() => window.browsePauses.length === 0),
      `${label} browsing touches neither pause the spoken sentence nor start another one`);
    await page.evaluate(index => window.advanceReading(index), first + 1);
    await page.waitForTimeout(700);
    check(Math.abs((await scrollTop())-whileBrowsing) < 35, `${label} playback advance does not interrupt browsing before the idle deadline`);
    await guide.waitFor({ state:'detached', timeout:3400 });
    await page.waitForFunction(old => Math.abs(document.querySelector('.reader-scroll').scrollTop-old)>40, whileBrowsing);
    check((await commits()).length === 2, `${label} idle recovery follows the still-running queue without restarting it`);
    await page.waitForFunction(index => {
      const node = document.querySelector(`[data-sentence="${index}"] .reading-original`);
      const inside = document.querySelector('.reader-scroll').getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      return node.closest('section').dataset.current === 'true' && rect.top >= inside.top && rect.bottom < inside.bottom - 90;
    }, first + 1);
    check(await guide.count() === 0, `${label} programmatic follow never exposes its own guide`);

    await waitForScrollToSettle();
    await browse();
    await guide.waitFor();
    await exit.click();
    await start.waitFor();
    await guide.waitFor({ state:'detached' });
    await browse();
    check(await guide.count() === 0 && (await commits()).length === 2 && await page.locator('.sentence-listen').count() === 0,
      `${label} leaving listening mode removes the guide and further scrolling shows no inline playback controls`);
    if (!touch) {
      await viewport.evaluate(node => { node.scrollTop = 0; node.focus({ preventScroll:true }); });
      await page.keyboard.press('PageDown');
      await page.waitForFunction(() => document.querySelector('.reader-scroll').scrollTop > 40);
      await waitForScrollToSettle();
      check(await guide.count() === 0, `${label} normal keyboard scrolling also hides the guide`);
      await start.click();
      await playback.waitFor();
      await waitForScrollToSettle();
      await viewport.focus();
      await page.keyboard.press('PageDown');
      await guide.waitFor();
      await waitForScrollToSettle();
      const selected = await chosen();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.playbackCommits.length === 4);
      check((await commits()).at(-1).index === selected, `${label} Enter plays the preview after scrolling by keyboard`);
    }
    await context.close();
  }
  assert.deepEqual(h.errors, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ checks, scope:'Trusted touch and mouse browsing with controlled speech transport' }, null, 2));
  console.log(`Playback selection: ${checks.length} checks passed`);
} catch (error) {
  await page?.screenshot({ path:`${out}/failure.png` }).catch(() => {});
  throw error;
} finally { await h.dispose(); }
