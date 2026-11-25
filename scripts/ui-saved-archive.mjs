/** Final Saved design, exercised with real material records in disposable SQLite. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createReadingHarness } from './ui-reading-support.mjs';

const output = process.env.LEXICUE_SAVED_ARCHIVE_OUTPUT || '/tmp/lexicue-saved-archive';
const h = await createReadingHarness(output);
const checks = [];
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks.push(label); };
let page;

try {
  await h.call('test_reset');
  const words = ['adapt', 'admit', 'agree', 'allow', 'calm', 'carry', 'chase', 'clear', 'echo',
    'follow', 'gather', 'hold', 'imagine', 'listen', 'look', 'notice', 'offer', 'pause', 'raise',
    'remember', 'share', 'take off', 'unfold', 'wait'];
  const sentences = words.map(word => ({ word, text: `We can ${word} before dawn.` }));
  sentences.push(
    { word: 'take off', text: 'When the weather clears, we can take off before dawn.' },
    { word: 'take off', text: 'The plane will take off as soon as the runway is clear.' },
    { word: 'carry', text: 'We carry the old map with us when we return to the harbor.' },
  );
  const imported = await h.call('import_reading_material', { input: {
    operation_id: crypto.randomUUID(), name: 'A quiet journey.txt', normalized_kind: 'txt',
    content: sentences.map(row => row.text).join('\n'),
    segments: sentences.map(({ text }, index) => ({ index, en_text: text, zh_text: '我们在天亮前出发。' })),
  } });
  const material = await h.call('open_reading_material', { fileId: imported.file_id });
  for (const [index, { word, text }] of sentences.entries()) {
    const start = text.indexOf(word);
    await h.call('mutate_saved_record', { operationId: crypto.randomUUID(), mutation: { kind: 'save', input: {
      segment_id: material.segments[index].id, expression: word, start_offset: start, end_offset: start + word.length,
      explanation: word === 'take off' ? '起飞；离开地面。' : '来自原文的个人释义。',
      explanation_source: 'personal',
    } } });
  }

  for (const theme of ['ocean', 'midnight']) for (const width of [1280, 390]) {
    const phone = width < 768, name = `${theme}-${phone ? 'phone' : 'desktop'}`;
    const context = await h.browser.newContext({ viewport: { width, height: phone ? 844 : 790 },
      isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
    page = await context.newPage();
    await h.fixture(page, theme);
    await page.addInitScript(() => localStorage.setItem('lexicue-onboarding-v1', '{"version":1,"status":"skipped"}'));
    await page.goto(`${h.url}/saved`);
    const index = page.locator('.approved-saved-index');
    const rows = index.locator('.approved-saved-word');
    const slider = page.getByRole('slider');
    const cards = page.locator('.approved-saved-folio');
    const back = page.locator('.approved-saved-header .approved-back');
    await rows.first().waitFor();
    equal(await rows.allTextContents().then(values => values.slice(0, 3)), ['take off', 'carry', 'adapt'], `${name} count and tie order`);
    equal(await index.locator('.saved-count-meter').first().locator('[data-filled=true]').count(), 3, `${name} signal strength reflects actual saved count`);
    equal(await slider.getAttribute('aria-valuenow'), '1', `${name} count is announced`);
    await page.evaluate(() => document.fonts.ready);
    if (!phone) await cards.first().waitFor();
    await page.screenshot({ path: `${output}/${name}-count.png` });

    const bounds = await slider.boundingBox();
    const y = bounds.y + bounds.height / 2, from = bounds.x + 68, to = bounds.x + 24;
    if (phone) {
      const touch = await context.newCDPSession(page);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] });
      for (let i = 1; i <= 5; i++) await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: from + (to - from) * i / 5, y }],
      });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await touch.detach();
    } else {
      await page.mouse.move(from, y);
      await page.mouse.down();
      await page.mouse.move(to, y, { steps: 5 });
      await page.mouse.up();
    }
    await index.getByText('A', { exact: true }).waitFor();
    equal(await rows.allTextContents(), words, `${name} drag activates alphabetical sort`);
    await page.screenshot({ path: `${output}/${name}-alphabet.png` });
    const sticky = await index.evaluate(node => {
      const labels = [...node.querySelectorAll('.saved-letter')];
      const [a, c] = labels;
      const top = node.getBoundingClientRect().top;
      const change = c.getBoundingClientRect().top - top;
      const offset = element => Math.round(element.getBoundingClientRect().top - top);
      node.scrollTop = 51;
      const first = [offset(a), offset(c) > 0];
      node.scrollTop = change;
      return [first, [offset(a) < 0, offset(c)]];
    });
    equal(sticky, [[0, true], [true, 0]], `${name} A stays anchored, then C takes its exact position`);

    if (phone) {
      equal(await cards.count(), 0, `${name} archive opens on directory`);
      const word = index.getByRole('button', { name: 'take off', exact: true });
      await word.scrollIntoViewIfNeeded();
      const previous = await index.evaluate(node => node.scrollTop);
      await word.tap();
      await cards.first().waitFor();
      await page.screenshot({ path: `${output}/${name}-reading.png` });
      await back.tap();
      await index.waitFor();
      equal(await index.evaluate(node => node.scrollTop), previous, `${name} back restores directory scroll`);
      equal(await word.getAttribute('aria-pressed'), 'true', `${name} back keeps selected expression`);
      await word.tap();
    }
    await cards.first().waitFor();
    equal(await cards.count(), 3, `${name} all saved contexts appear together`);
    equal(await cards.first().locator('.approved-folio-sentence strong').textContent(), 'take off', `${name} exact selection is highlighted`);
    equal(await cards.first().locator('.approved-folio-translation').textContent(), '我们在天亮前出发。', `${name} translation survives`);
    equal(await page.locator('.approved-folio-note').textContent(), '起飞；离开地面。', `${name} original Chinese explanation survives`);
    equal(await cards.first().locator('.approved-source-cover img').count(), 1, `${name} cover is present`);
    equal(await cards.first().locator('.approved-source-title').textContent(), 'A quiet journey', `${name} source label is visible`);
    equal(await cards.first().locator('.approved-folio-speech').isEnabled(), true, `${name} sentence has a speech action`);
    await page.evaluate(() => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (command, args) => {
        if (command === 'resolve_tts_audio') {
          window.__archiveSpeech = args.request;
          return Promise.reject('invalid_input');
        }
        return invoke(command, args);
      };
    });
    await cards.first().locator('.approved-folio-speech').click();
    await page.waitForFunction(() => window.__archiveSpeech);
    equal(await page.evaluate(() => [window.__archiveSpeech.kind, window.__archiveSpeech.text]),
      ['sentence', await cards.first().locator('.approved-folio-sentence').textContent()], `${name} pronunciation requests the exact full sentence`);
    const second = await cards.nth(1).getAttribute('data-record');
    await cards.nth(1).locator('.approved-source-title').click();
    await page.locator('[data-source-highlight=true]').waitFor();
    await page.locator('.reading-breadcrumb .page-back').click();
    await page.locator('.approved-saved-folio[data-current=true]').waitFor();
    equal(await page.locator('.approved-saved-folio[data-current=true]').getAttribute('data-record'), second, `${name} source return keeps the exact context`);
    if (phone) await back.tap();
    await slider.press('End');
    await page.waitForFunction(() => document.querySelector('.approved-saved-index .approved-saved-word')?.textContent === 'take off');
    equal(await slider.getAttribute('aria-valuenow'), '1', `${name} keyboard restores count order`);
    equal(await page.evaluate(() => window.__uiCalls.some(call => call.command === 'saved_date_histogram' ||
      (call.command === 'list_saved_groups' && (call.args.startMs != null || call.args.endMs != null)))), false, `${name} no date filters or histogram calls`);
    equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} no horizontal overflow`);
    await context.close();
  }
  equal(h.errors, [], 'no browser exceptions');
  await writeFile(`${output}/evidence.json`, JSON.stringify({ checks }, null, 2));
  console.log(`Saved archive: ${checks.length} checks passed`);
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await h.dispose();
}
