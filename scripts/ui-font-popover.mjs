/** Actual reading UI regression for the stable Aa popover and native range input. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createReadingHarness, root } from './ui-reading-support.mjs';
const output = `${root}/docs/implementation/evidence/ui-approved-20261027/fonts`;
const h = await createReadingHarness(output);
const checks = [];
const observations = [];
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); };
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
const popover = page => page.locator('.display-font-popover:visible');
const readScale = page => page.evaluate(() => JSON.parse(localStorage.getItem('lexicue-preferences')).state.contentFontScale);
async function drag(page, category, value, label) {
  const input = popover(page).locator(`[data-font-category='${category}']`);
  const bounds = await input.boundingBox();
  const old = Number(await input.inputValue());
  const x = scale => bounds.x + 7 + (bounds.width - 14) * (scale - 80) / 60;
  await page.mouse.move(x(old), bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(x(value), bounds.y + bounds.height / 2, { steps: 12 });
  const during = Number(await input.inputValue());
  check(during !== old, `${label}: ${category} changes while dragging`);
  await page.mouse.up();
  // Release plus dwell exceeds the 200ms close delay. No input/change/persist cycle may close it.
  await settle(450);
  check(await popover(page).count() === 1, `${label}: ${category} remains open after release and dwell`);
  check(await page.evaluate(() => window.__fontPanel === document.querySelector('.display-font-popover:not([hidden])') && window.__fontInputs.every((node, index) => node === window.__fontPanel.querySelectorAll('input[type=range]')[index])), `${label}: ${category} retains the same panel and input nodes`);
  return during;
}
try {
  const unique = `font-${Date.now()}`;
  const text = `Take time to understand the world. Font controls remain stable ${unique}.`;
  const imported = await h.call('import_reading_material', { input: {
    operation_id: unique, name: `${unique}.srt`, content: `1\n00:00:01,000 --> 00:00:03,000\n${text}\n`,
    segments: [{ index: 0, en_text: text, zh_text: '好奇心帮助我们理解世界。', start_time: '00:00:01.000', end_time: '00:00:03.000' }],
  } });
  for (const theme of ['ocean', 'midnight']) {
    const context = await h.browser.newContext({ viewport: { width: 1100, height: 800 } });
    const page = await context.newPage();
    await h.fixture(page, theme);
    await page.goto(`${h.url}/files/${imported.file_id}`);
    await page.locator('.reading-word').first().waitFor();
    const trigger = page.locator('.b-dock .display-settings-trigger');
    await page.locator('.reading-word').first().click();
    await page.locator('.lookup-body').waitFor();
    const meaning = page.locator('.longman-meaning').first();
    await meaning.waitFor();
    const meaningBefore = await meaning.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    const originalBefore = await page.locator('.reading-original').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    const translationBefore = await page.locator('.reading-translation').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    await trigger.hover();
    await popover(page).waitFor();
    await settle(240);
    await page.evaluate(() => { window.__fontPanel = document.querySelector('.display-font-popover:not([hidden])'); window.__fontInputs = [...window.__fontPanel.querySelectorAll('input[type=range]')]; window.__fontEvents = []; for(const event of ['gotpointercapture','lostpointercapture','input','change']) window.__fontPanel.addEventListener(event, () => window.__fontEvents.push(event), true); });
    const learning = await drag(page, 'learning', 122, theme);
    check(await page.locator('.reading-original').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize)) > originalBefore, `${theme}: body visibly updates immediately`);
    const definition = await drag(page, 'definition', 117, theme);
    check(await meaning.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) > meaningBefore, `${theme}: live dictionary definition visibly resizes`);
    const auxiliary = await drag(page, 'auxiliary', 111, theme);
    await popover(page).locator('output').first().click(); await settle(450);
    check(await page.locator('.lookup-body').count() === 1 && await popover(page).count() === 1, `${theme}: panel output/padding clicks preserve the live dictionary and Aa panel`);
    const nativeEvents = await page.evaluate(() => window.__fontEvents);
    check(nativeEvents.filter(event => event === 'input').length >= 3 && nativeEvents.filter(event => event === 'change').length >= 3, `${theme}: actual native input/change cycles observed`);
    check(nativeEvents.includes('gotpointercapture') && nativeEvents.includes('lostpointercapture'), `${theme}: native pointer capture and release observed`);
    observations.push({ theme, nativeEvents });
    check(await page.locator('.reading-translation').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize)) > translationBefore, `${theme}: translation visibly updates immediately`);
    const saved = await readScale(page);
    check(saved.learning === learning && saved.definition === definition && saved.auxiliary === auxiliary, `${theme}: all three completed adjustments persist independently`);
    const rect = await popover(page).boundingBox();
    const anchor = await trigger.boundingBox();
    check(rect.x > anchor.x && rect.x + rect.width <= 1100 && rect.y >= 0 && rect.y + rect.height <= 800, `${theme}: panel stays beside actual dock and in viewport`);
    await page.screenshot({ path: `${output}/${theme}-three-sliders.png` });
    // Mouse focus from range dragging must not keep the panel pinned after leaving.
    await page.mouse.move(1000, 100);
    await settle(350);
    check(await popover(page).count() === 0, `${theme}: leaving the panel closes after delay`);
    await page.reload();
    await page.locator('.reading-word').first().waitFor();
    await trigger.hover();
    await popover(page).waitFor();
    check((await readScale(page)).learning === learning && Number(await popover(page).locator('[data-font-category=definition]').inputValue()) === definition && Number(await popover(page).locator('[data-font-category=auxiliary]').inputValue()) === auxiliary, `${theme}: reload restores all three adjustments`);
    // Keyboard focus opens Aa; Tab then uses the logical order despite the body portal.
    await page.mouse.move(1000, 100); await settle(350);
    await page.keyboard.press('Tab'); await trigger.focus();
    await popover(page).waitFor();
    await page.keyboard.press('Tab');
    check(await popover(page).locator('[data-font-category=learning]').evaluate(node => node === document.activeElement), `${theme}: Tab enters first slider`);
    const keyBefore = Number(await popover(page).locator('[data-font-category=learning]').inputValue());
    await page.keyboard.press('ArrowRight');
    check(Number(await popover(page).locator('[data-font-category=learning]').inputValue()) === keyBefore + 1, `${theme}: native arrow-key adjustment`);
    await page.keyboard.press('Tab');
    check(await popover(page).locator('[data-font-category=definition]').evaluate(node => node === document.activeElement), `${theme}: Tab directly reaches definition slider`);
    await page.keyboard.press('Tab');
    check(await popover(page).locator('[data-font-category=auxiliary]').evaluate(node => node === document.activeElement), `${theme}: Tab directly reaches auxiliary slider`);
    await page.keyboard.press('Escape');
    check(await popover(page).count() === 0 && await trigger.evaluate(node => node === document.activeElement), `${theme}: Escape closes once and returns focus without reopening`);
    await page.keyboard.press('Tab'); await trigger.focus(); await popover(page).waitFor();
    await page.keyboard.press('Tab'); await page.keyboard.press('ArrowLeft');
    await page.mouse.move(990, 110); await settle(350);
    check(await popover(page).count() === 0, `${theme}: switching from keyboard to mouse still closes after leaving`);
    await page.emulateMedia({ reducedMotion: 'reduce' }); await trigger.hover(); await popover(page).waitFor();
    check(await popover(page).evaluate(node => getComputedStyle(node).animationName === 'none'), `${theme}: reduced motion disables animation`);
    await page.locator('.b-dock a[href="/files"]').click();
    await page.locator('.materials-paper').waitFor();
    check(await popover(page).count() === 0, `${theme}: leaving reading dismisses the portalled panel`);
    await context.close();

    const mobile = await h.browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
    const touch = await mobile.newPage(); await h.fixture(touch, theme);
    await touch.goto(`${h.url}/files/${imported.file_id}`); await touch.locator('.reading-word').first().waitFor();
    const mobileTrigger = touch.locator('.mobile-reading-tools .display-settings-trigger');
    await mobileTrigger.tap(); await popover(touch).waitFor();
    const mobileRect = await popover(touch).boundingBox();
    check(mobileRect.x >= 0 && mobileRect.x + mobileRect.width <= 375 && mobileRect.y >= 0 && mobileRect.y + mobileRect.height <= 812, `${theme}: touch panel fits narrow viewport`);
    const mobileInput = popover(touch).locator('[data-font-category=definition]');
    const inputBounds = await mobileInput.boundingBox(); await touch.touchscreen.tap(inputBounds.x + inputBounds.width * .8, inputBounds.y + inputBounds.height / 2);
    await settle(450); check(await popover(touch).count() === 1, `${theme}: touch range adjustment leaves panel open`);
    await touch.screenshot({ path: `${output}/${theme}-touch-375.png` });
    await touch.touchscreen.tap(360, 100); await settle(80);
    check(await popover(touch).count() === 0, `${theme}: outside touch dismisses panel`);
    await mobile.close();
  }
  check(h.errors.length === 0, 'no browser runtime errors');
  await writeFile(`${output}/results.json`, JSON.stringify({ checks, observations }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, output }));
} finally { await h.dispose(); }
