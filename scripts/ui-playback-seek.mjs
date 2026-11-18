/** The playback control previews a sentence and commits only on release. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createReadingHarness } from './ui-reading-support.mjs';

const out = process.env.LEXICUE_PLAY_SEEK_OUTPUT || '/tmp/lexicue-playback-seek';
const h = await createReadingHarness(out), checks = [];
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); };
let page;
try {
  const lines = Array.from({ length: 20 }, (_, index) => `The train reached the station just before noon. Scene ${index + 1}.`);
  const material = await h.call('import_reading_material', { input: {
    operation_id: crypto.randomUUID(), name: 'Playback selection.txt', content: lines.join('\n'),
    segments: lines.map((en_text, index) => ({ index, en_text, start_time: null, end_time: null })),
  } });
  for (const theme of ['sage', 'midnight']) for (const touch of [true, false]) {
    const label = `${theme}/${touch ? 'touch' : 'mouse'}`;
    const context = await h.browser.newContext({
      viewport: touch ? { width: 390, height: 844 } : { width: 1240, height: 900 },
      hasTouch: touch, isMobile: touch,
    });
    page = await context.newPage();
    await h.fixture(page, theme);
    await page.goto(`${h.url}/files/${material.file_id}`);
    const start = page.locator('.mobile-headphone-mode .playback-seek-control');
    const playback = page.locator('.mobile-playback-mode .playback-seek-control');
    const candidate = page.locator('[data-playback-target="true"]');
    const row = index => page.locator(`[data-sentence="${index}"] .reading-original`);
    await row(3).waitFor();
    await start.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async () => {
      const { useSpeechStore } = await window.__uiStoreModule('speechStore');
      window.playbackCommits = [];
      useSpeechStore.setState({
        startQueue: async (items, index) => {
          const key = items[index].key;
          window.playbackCommits.push({ index, text: items[index].text });
          useSpeechStore.setState({ key, status: 'playing', queueIndex: index,
            reading: { key, index, status: 'playing', mode: 'queue' } });
        },
      });
    });
    const commits = () => page.evaluate(() => window.playbackCommits);
    const center = async locator => {
      const r = await locator.boundingBox();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    const cdp = touch ? await context.newCDPSession(page) : null;
    const pointer = async (phase, point) => {
      if (cdp) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd', cancel: 'touchCancel' }[phase],
          touchPoints: phase === 'up' || phase === 'cancel' ? [] : [point],
        });
      } else if (phase === 'down') {
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
      } else if (phase === 'move') {
        await page.mouse.move(point.x, point.y, { steps: 5 });
      } else if (phase === 'up') {
        await page.mouse.up();
      }
    };

    const from = await center(start), to = await center(row(3));
    await pointer('down', from);
    await pointer('move', { x: from.x, y: to.y });
    await page.locator('[data-sentence="3"][data-playback-target="true"]').waitFor();
    check((await commits()).length === 0, `${label} preview does not play before release`);
    check(await row(3).evaluate(n => getComputedStyle(n, '::before').borderTopWidth === '1px'), `${label} selected sentence has a guide line`);
    await page.screenshot({ path: `${out}/${theme}-${touch ? 'touch' : 'desktop'}-guide.png` });
    await pointer('up');
    await page.waitForFunction(() => window.playbackCommits.length > 0);
    check(JSON.stringify(await commits()) === JSON.stringify([{ index: 3, text: lines[3] }]), `${label} release starts exactly the selected sentence`);
    check(await candidate.count() === 0, `${label} guide clears on release`);
    await playback.waitFor();
    await page.waitForFunction(() => Math.round(document.querySelector('.mobile-reading-bar').getBoundingClientRect().width) === 194);
    check(await page.locator('.sentence-listen').count() === 0, `${label} no repeated play buttons in listening mode`);
    check(await row(3).evaluate(n => Math.abs(n.getBoundingClientRect().width - n.closest('.reading-sentence').getBoundingClientRect().width) < 1), `${label} listening mode leaves the reading column full width`);

    if (touch) {
      const next = await center(playback), above = await center(row(5));
      await pointer('down', next);
      await pointer('move', { x: next.x, y: above.y });
      await candidate.waitFor();
      await pointer('cancel');
      await candidate.waitFor({ state: 'detached' });
      check((await commits()).length === 1, `${label} a cancelled touch never starts a different sentence`);
    } else {
      await playback.focus();
      await page.keyboard.press('ArrowUp');
      await candidate.waitFor();
      const selected = Number(await candidate.getAttribute('data-sentence'));
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.playbackCommits.length === 2);
      check((await commits()).at(-1).index === selected, `${label} keyboard preview commits the highlighted sentence`);
    }
    await page.locator('.mobile-playback-mode button').last().click();
    await start.waitFor();
    await page.waitForFunction(() => Math.round(document.querySelector('.mobile-reading-bar').getBoundingClientRect().width) === 106);
    const beforeTap = (await commits()).length;
    if (touch) await start.tap();
    else await start.click();
    await page.waitForFunction(count => window.playbackCommits.length === count + 1, beforeTap);
    await playback.waitFor();
    check((await commits()).length === beforeTap + 1 && await candidate.count() === 0, `${label} a normal tap starts playback once`);
    await context.close();
  }
  assert.deepEqual(h.errors, []);
  await writeFile(`${out}/report.json`, JSON.stringify({ checks, scope: 'Trusted Chromium touch and mouse events; controlled speech queue boundary' }, null, 2));
  console.log(`Playback selection: ${checks.length} checks passed`);
} catch (error) {
  await page?.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw error;
} finally { await h.dispose(); }
