/**
 * Browser interaction regression checks using a deterministic, in-memory Tauri fixture.
 * Start `npm run dev`, then run `node scripts/ui-smoke.mjs` with Playwright installed.
 * LEXICUE_PLAYWRIGHT_MODULE may point to an existing Playwright module; no production mocks are shipped.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.LEXICUE_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: process.env.LEXICUE_UI_BROWSER_CHANNEL || 'chrome', headless: true });
const url = process.env.LEXICUE_UI_URL || 'http://127.0.0.1:5173';
const output = process.env.LEXICUE_UI_OUTPUT || '/tmp/lexicue-ui-check';
await mkdir(output, { recursive: true });
let checks = 0;
const errors = [];
async function fixture(page, theme = 'ocean', language = 'zh', hasDueCards = false) {
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ theme, language, hasDueCards }) => {
    localStorage.setItem('lexicue-theme', theme);
    localStorage.setItem('lexicue-frequency-baseline-intro-seen', 'true');
    if (!localStorage.getItem('lexicue-preferences')) localStorage.setItem('lexicue-preferences', JSON.stringify({ state: { uiLanguage: language, annotationModes: { word: 'batch', phrase: 'batch' } }, version: 0 }));
    const progress = { total: 10, unprocessed: 4, learning: 3, known: 3, ignored: 0 };
    const files = Array.from({ length: 26 }, (_, n) => ({ id: n + 1, name: `Reading ${n + 1} — a story about language`, type: n % 2 ? 'srt' : 'txt', imported_at: Date.now(), segment_count: 24, phrase_analyzed: n % 3 === 1, phrase_analysis_at: null, phrase_skipped_items: 0, language: 'en', folder_id: null, word_progress: progress, phrase_progress: { ...progress, total: 0, unprocessed: 0, learning: 0, known: 0 } }));
    const word = { id: 1, lemma: 'curiosity', status: 'unprocessed', definition: 'A desire to learn.', frequency: 12, language: 'en', reading: null, part_of_speech: 'noun', word_kind: 'common', search_aliases: [] };
    const phrase = { id: 1, text: 'make sense', status: 'unprocessed', definition: 'Be understandable.', frequency: 6, language: 'en', category: 'fixed_expression' };
    const folders = [{ id: 1, name: 'Stories', parent_id: null, created_at: 1, file_count: 1 }, { id: 2, name: 'Short stories', parent_id: 1, created_at: 1, file_count: 1 }];
    window.__uiCalls = [];
    window.__uiFailSave = false;
    window.__uiHasDueCards = hasDueCards;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1, unregisterCallback() {}, convertFileSrc: path => path,
      invoke: async (command, args = {}) => {
        window.__uiCalls.push({ command, args });
        if (command === 'dictionary_status') return true;
        if (command === 'plugin:event|listen') return 1;
        if (command === 'plugin:app|version') return '0.4.1';
        if (command === 'plugin:dialog|ask') return true;
        if (command === 'list_files') return args.folderId == null ? files : [{ ...files[0], id: 100 + args.folderId, folder_id: args.folderId }];
        if (command === 'list_folders') return folders;
        if (command === 'list_words') return [{ ...word }];
        if (command === 'list_phrases') return [{ ...phrase }];
        if (command === 'word_detail') return { word: { ...word }, occurrences: [] };
        if (command === 'phrase_detail') return { phrase: { ...phrase }, occurrences: [] };
        if ((command === 'create_folder' || command === 'rename_folder') && window.__uiFailSave) throw new Error('fixture folder save failed');
        if (command === 'update_word_definition' || command === 'update_phrase_definition') {
          await new Promise(resolve => setTimeout(resolve, 80));
          if (window.__uiFailSave) throw new Error('fixture save failed');
          (command === 'update_word_definition' ? word : phrase).definition = args.definition;
          return null;
        }
        if (command === 'lookup_dictionary' || command === 'lookup_phrase_dictionary' || command === 'lookup_online_dictionary') throw new Error('fixture dictionary unavailable');
        if (command === 'get_file_info') return args.fileId > 100 ? { ...files[0], id: args.fileId, folder_id: args.fileId - 100 } : files.find(file => file.id === args.fileId) || files[0];
        if (command === 'get_file_segments') return Array.from({ length: 24 }, (_, index) => ({ id: index + 1, index_num: index, en_text: 'Curiosity makes learning a joyful daily habit.', zh_text: '好奇心让学习成为快乐的日常习惯。', start_time: null, end_time: null }));
        if (command === 'get_due_cards') return window.__uiHasDueCards ? [{ word_id: 1, lemma: 'curiosity', definition: 'A desire to learn.', language: 'en', reading: null, part_of_speech: 'noun', stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, reps: 1, lapses: 0, state: 2, baseline_pending: false, occurrences: [] }] : [];
        if (command === 'get_due_phrase_cards') return [];
        if (command === 'get_learning_stats') return { total_words: 10, unprocessed: 4, learning: 3, known: 3, ignored: 0, due_cards: 0, total_reviews: 0, total_phrases: 0, phrases_unprocessed: 0, phrases_learning: 0, phrases_known: 0, phrases_ignored: 0, due_phrase_cards: 0, total_phrase_reviews: 0, daily_reviews: [], files: [] };
        if (command === 'get_local_ollama_activity') return { generations: 0, pulling: false, deleting: false, sequence: 0 };
        if (command === 'get_frequency_baseline') return { tier: null, enabled: false, pending: 0, total: 0 };
        if (command === 'get_storage_usage') return { total_bytes: 0, categories: [] };
        if (command === 'youtube_ytdlp_status') return { available: false, version: null, path: null };
        if (command.startsWith('list_') || command.startsWith('get_file_') || command === 'ai_models') return [];
        return null;
      },
    };
  }, { theme, language, hasDueCards });
}
async function noOverflow(page, label) {
  const issues = await page.evaluate(() => {
    const width = innerWidth;
    return Array.from(document.querySelectorAll('.app-layout *, [data-overlay-layer] *')).filter(element => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || getComputedStyle(element).position === 'absolute') return false;
      return rect.right > width + 1 || rect.left < -1;
    }).slice(0, 8).map(element => ({ tag: element.tagName, class: element.className, width: element.getBoundingClientRect().width }));
  });
  assert.deepEqual(issues, [], `${label}: elements overflow viewport`); checks++;
}
try {
  for (const theme of ['ocean', 'midnight']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage(); await fixture(page, theme); await page.goto(`${url}/files`);
    await page.locator('.file-card').first().waitFor();
    for (const width of [360, 390, 430, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      for (const route of ['/files', '/words', '/phrases', '/review', '/insights', '/settings']) {
        await page.goto(`${url}${route}`); await page.locator('.app-layout').waitFor();
        await page.waitForTimeout(120);
        await noOverflow(page, `${theme} ${width} ${route}`);
      }
      const sidebar = await page.locator('.app-sidebar').isVisible();
      assert.equal(sidebar, width >= 768); checks++;
      if (width === 390 || width === 1440) await page.screenshot({ path: `${output}/${theme}-${width}-settings.png` });
    }
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${url}/files`);
    const file = page.locator('.file-card').first();
    for (const button of await file.locator('button').all()) {
      const size = await button.boundingBox();
      assert.ok(size.width >= 48 && size.height >= 48, `${theme} file button must have a 48px touch target`); checks++;
    }
    const footer = await file.locator('.file-card__footer').evaluate(node => ({ height: node.getBoundingClientRect().height,
      ring: node.querySelector('.learning-ring').getBoundingClientRect().top,
      actions: node.querySelector('.file-card__actions').getBoundingClientRect().top }));
    assert.ok(footer.height <= 62 && Math.abs(footer.ring - footer.actions) < 1); checks++;
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${output}/${theme}-390-files.png` });
    await file.screenshot({ path: `${output}/${theme}-mobile-file-card.png` });
    await file.getByRole('button', { name: /^移动 / }).click();
    await page.getByRole('dialog').waitFor();
    assert.ok(page.url().endsWith('/files'), 'Moving a file must not open the reader'); checks++;
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await file.getByRole('button', { name: /^移动 / }).evaluate(node => node === document.activeElement), true); checks++;
    await page.locator('.compact-folders-trigger').click();
    assert.equal(await page.locator('#root').evaluate(node => node.inert), true); checks++;
    await page.locator('.folder-drawer .touch-actions button').first().click();
    assert.equal(await page.locator('[role="dialog"]').count(), 2); checks++;
    assert.equal(await page.evaluate(() => window.__lexicueBack()), true);
    await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 1); checks++;
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[role="dialog"]').count(), 0); checks++;
    assert.equal(await page.locator('.compact-folders-trigger').evaluate(node => node === document.activeElement), true); checks++;
    assert.equal(await page.locator('#root').evaluate(node => node.inert), false); checks++;
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 320 });
    assert.ok(await page.getByRole('dialog').getByRole('button', { name: '创建', exact: true }).evaluate(node => node.getBoundingClientRect().bottom <= innerHeight)); checks++;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('dialog').getByRole('textbox').fill('Keep this folder name');
    await page.evaluate(() => { window.__uiFailSave = true; });
    await page.getByRole('dialog').getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.equal(await page.getByRole('dialog').getByRole('textbox').inputValue(), 'Keep this folder name'); checks++;
    await page.evaluate(() => { window.__uiFailSave = false; });
    await page.getByRole('dialog').getByRole('button', { name: '创建', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' }); checks++;
    await page.locator('.mobile-language-bar [role="combobox"]').click();
    await page.getByRole('option', { name: 'English', exact: true }).click();
    assert.equal(await page.locator('.mobile-language-bar [role="combobox"]').innerText(), 'English'); checks++;
    await page.goto(`${url}/words`); await page.getByRole('button', { name: 'curiosity', exact: true }).click();
    await page.locator('.detail-panel textarea').waitFor();
    const half = await page.locator('.detail-panel').evaluate(node => node.getBoundingClientRect().height);
    assert.ok(half < 600 && half > 350); checks++;
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${output}/${theme}-phone-detail.png` });
    for (let index = 0; index < 15; index++) { await page.keyboard.press('Tab'); assert.equal(await page.locator('.detail-panel').evaluate(node => node.contains(document.activeElement)), true); } checks++;
    await page.locator('.detail-sheet-control button').click();
    assert.ok(await page.locator('.detail-panel').evaluate(node => node.getBoundingClientRect().height) > 800); checks++;
    await page.locator('.detail-panel textarea').fill('Unsaved note');
    await page.evaluate(() => { window.__uiFailSave = true; });
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    assert.equal(await page.locator('.detail-panel textarea').inputValue(), 'Unsaved note');
    assert.equal(await page.locator('.detail-panel [role="alert"]').count(), 1); checks++;
    await page.evaluate(() => { window.__uiFailSave = false; });
    await page.keyboard.press('Escape'); await page.locator('.detail-panel').waitFor({ state: 'detached' }); checks++;
    await page.locator('.vocabulary-tabs a[href="/phrases"]').click();
    await page.locator('.mobile-nav a[href="/files"]').click(); await page.waitForURL('**/files');
    await page.waitForFunction(() => document.querySelector('.mobile-nav a[aria-current="page"]')?.textContent === '文件'); checks++;
    await page.locator('.mobile-nav a[href="/phrases"]').click(); await page.waitForURL('**/phrases');
    assert.ok(page.url().endsWith('/phrases')); checks++;
    await page.goto(`${url}/files`); await page.locator('.file-card').first().waitFor();
    await page.locator('.file-list-container').evaluate(node => { node.scrollTop = 420; });
    await page.waitForTimeout(50); const saved = await page.locator('.file-list-container').evaluate(node => node.scrollTop);
    await page.locator('.file-card__open').nth(2).click();
    await page.locator('.app-page header button').waitFor();
    assert.equal(await page.locator('.mobile-nav').count(), 0); checks++;
    assert.equal(await page.evaluate(() => window.__lexicueBack()), true);
    await page.locator('.file-list-container').waitFor();
    assert.ok(Math.abs(await page.locator('.file-list-container').evaluate(node => node.scrollTop) - saved) < 2); checks++;
    await page.locator('.folder-card__open', { hasText: 'Stories' }).click();
    await page.locator('.file-card__open').first().click();
    await page.locator('.app-page header button').waitFor();
    await page.locator('.app-page header button').click();
    await page.locator('.file-list-container').waitFor();
    assert.ok((await page.locator('.file-breadcrumb').innerText()).includes('Stories')); checks++;
    assert.equal(await page.evaluate(() => window.__lexicueBack()), true); checks++;
    await page.waitForFunction(() => !document.querySelector('.file-breadcrumb')?.textContent.includes('Stories'));
    // Dismissing a running import view must preserve the store-owned job.
    await page.evaluate(async () => {
      const { useFileStore } = await import('/src/stores/fileStore.ts');
      useFileStore.setState({ importingYouTube: true, youtubePhase: 'downloading' });
    });
    await page.getByRole('button', { name: /YouTube/ }).click();
    await page.locator('#youtube-cancel').waitFor();
    await page.locator('.youtube-dialog__header button').click();
    assert.equal(await page.evaluate(async () => (await import('/src/stores/fileStore.ts')).useFileStore.getState().importingYouTube), true); checks++;
    await page.getByRole('button', { name: /YouTube/ }).click();
    await page.evaluate(async () => { (await import('/src/stores/fileStore.ts')).useFileStore.setState({ importingYouTube: false }); });
    await page.locator('#youtube-url').waitFor(); checks++;
    await page.locator('.youtube-dialog__header button').click();
    await page.locator('.mobile-nav a[href="/phrases"]').click(); await page.waitForURL('**/phrases');
    await page.locator('.mobile-nav a[href="/files"]').click(); await page.waitForURL('**/files');
    assert.equal(await page.locator('.youtube-dialog').count(), 0); checks++;
    await page.goto(`${url}/files/`); await page.locator('.mobile-nav').waitFor(); checks++;
    await page.goto(`${url}/phrases/`); await page.locator('.vocabulary-tabs').waitFor();
    assert.equal(await page.locator('.mobile-nav a[aria-current="page"]').innerText(), '词库'); checks++;
    await page.goto(`${url}/files`);
    await page.setViewportSize({ width: 844, height: 390 }); await noOverflow(page, `${theme} landscape`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${url}/words`); await page.getByRole('button', { name: 'curiosity', exact: true }).click();
    const duration = await page.locator('.detail-panel').evaluate(node => getComputedStyle(node).animationDuration);
    assert.ok(parseFloat(duration) < 0.01); checks++;
    await page.keyboard.press('Escape'); await page.locator('.detail-panel').waitFor({ state: 'detached' });
    await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page, `${theme} enlarged text`);
    await context.close();
  }
  // Fine-pointer desktop behavior: popovers, focus restoration, and theme state contrast.
  for (const theme of ['ocean', 'midnight']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(); await fixture(page, theme, 'zh', true);
    await page.goto(`${url}/files`); await page.locator('.folder-card__open').waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${output}/${theme}-1440-files.png` });
    assert.equal(await page.locator('.analysis-model-picker').count(), 0); checks++;
    await page.evaluate(async () => { (await import('/src/stores/aiStore.ts')).useAiStore.getState().setEnabled(true); });
    await page.locator('.analysis-model-picker').waitFor(); checks++;
    assert.equal(await page.locator('.file-card').first().locator('.file-analysis-button').count(), 1); checks++;
    await page.evaluate(async () => {
      const { useFileStore } = await import('/src/stores/fileStore.ts');
      useFileStore.setState({ files: useFileStore.getState().files.map((file, index) => index === 0 ? { ...file, name: 'VeryLongFileNameWithoutAnySpaces'.repeat(8) + '.txt' } : file) });
      const { useOllamaStore } = await import('/src/stores/ollamaStore.ts');
      useOllamaStore.setState({ progress: {
        1: { status: 'processing', processedSegments: 10, totalSegments: 24, percent: 42, phase: 'extraction' },
        2: { status: 'error', processedSegments: 0, totalSegments: 24, percent: 0, error: 'FailedRequestDetailsWithoutSpaces'.repeat(8) },
        3: { status: 'completed', processedSegments: 24, totalSegments: 24, percent: 100 },
      } });
    });
    await page.locator('.file-card').nth(1).getByRole('alert').waitFor();
    for (const width of [360, 390, 430, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page, `${theme} ${width} file analysis states and long names`);
    }
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${output}/${theme}-1440-files-ai.png` });
    await page.evaluate(async () => { (await import('/src/stores/aiStore.ts')).useAiStore.getState().setEnabled(false); });
    await page.locator('.analysis-model-picker').waitFor({ state: 'detached' }); checks++;
    const runningFile = page.locator('.file-card').first();
    assert.equal(await runningFile.getByRole('button', { name: '中断 AI 词组分析' }).count(), 1); checks++;
    assert.equal(await runningFile.locator('.file-analysis-button').count(), 0); checks++;
    await page.evaluate(async () => { (await import('/src/stores/ollamaStore.ts')).useOllamaStore.setState({ progress: {} }); });
    for (const state of ['default', 'hover', 'focus', 'pressed', 'disabled']) {
      const action = page.locator('.file-card').first().locator('.file-card__actions button').last();
      if (state === 'hover') await action.hover();
      if (state === 'focus') { await action.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); }
      if (state === 'pressed') { await action.hover(); await page.mouse.down(); }
      if (state === 'disabled') await action.evaluate(node => { node.disabled = true; });
      await page.waitForTimeout(160);
      const value = await action.evaluate(node => {
        const css = getComputedStyle(node);
        const background = css.backgroundColor.endsWith(', 0)') ? getComputedStyle(node.closest('.file-card')).backgroundColor : css.backgroundColor;
        const lum = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => { const c = n / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
        const a = lum(css.color), b = lum(background);
        return { contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), outline: css.outlineStyle };
      });
      assert.ok(value.contrast >= 3, `${theme} file icon ${state} contrast ${value.contrast}`); checks++;
      if (state === 'focus') { assert.equal(value.outline, 'solid'); checks++; }
      if (state === 'pressed') { await page.mouse.move(1439, 899); await page.mouse.up(); }
    }
    const actions = page.locator('.file-list-container .touch-actions').first();
    assert.equal(await actions.evaluate(node => getComputedStyle(node).opacity), '0'); checks++;
    await actions.locator('button').focus(); await page.waitForTimeout(200);
    assert.equal(await actions.evaluate(node => getComputedStyle(node).opacity), '1'); checks++;
    await actions.locator('button').click(); await page.locator('.adaptive-menu--popover').waitFor();
    assert.equal(await page.locator('.overlay-layer--sheet').count(), 0); checks++;
    await page.keyboard.press('Escape'); await page.locator('.adaptive-menu--popover').waitFor({ state: 'detached' });
    assert.equal(await actions.locator('button').evaluate(node => node === document.activeElement), true); checks++;
    const contrast = await page.evaluate(() => {
      const parse = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = rgb => rgb.map(n => { const c = n / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const current = document.querySelector('.app-sidebar [aria-current="page"]');
      const styles = getComputedStyle(current);
      return ratio(luminance(parse(styles.color)), luminance(parse(styles.backgroundColor)));
    });
    assert.ok(contrast >= 4.5, `${theme} selected navigation text contrast ${contrast}`); checks++;
    await page.goto(`${url}/review`);
    await page.getByText('curiosity', { exact: true }).waitFor();
    await page.getByRole('button', { name: /显示/ }).click();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('button.rating-good').count(), 0); checks++;
    await page.keyboard.press('Escape');
    await page.locator('.adaptive-menu--popover').waitFor({ state: 'detached' });
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Space'); await page.locator('button.rating-good').waitFor();
    for (const kind of ['again', 'hard', 'good', 'easy']) {
      const button = page.locator(`button.rating-${kind}`);
      for (const state of ['default', 'hover', 'focus', 'disabled']) {
        if (state === 'hover') await button.hover();
        if (state === 'focus') await button.focus();
        if (state === 'disabled') await button.evaluate(node => { node.disabled = true; });
        const value = await button.evaluate(node => {
          const parse = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
          const lum = value => parse(value).map(n => { const c = n / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
          const css = getComputedStyle(node), a = lum(css.color), b = lum(css.backgroundColor);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
        assert.ok(value >= 4.5, `${theme} rating ${kind} ${state} contrast ${value}`); checks++;
      }
    }
    await context.close();
  }
  for (const theme of ['ocean', 'midnight']) {
    for (const [language, onlyWords, wordsAndPhrases] of [['en', 'Words only', 'Words + phrases'], ['ja', '単語のみ', '単語 + フレーズ'], ['de', 'Nur Wörter', 'Wörter + Ausdrücke']]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      const page = await context.newPage(); await fixture(page, theme, language); await page.goto(`${url}/files`);
      await page.waitForFunction(text => document.querySelector('.file-card__progress-copy small')?.textContent === text, onlyWords);
      assert.equal(await page.locator('.file-card').nth(1).locator('.file-card__progress-copy small').innerText(), wordsAndPhrases); checks++;
      await noOverflow(page, `${theme} ${language} file cards`);
      await context.close();
    }
  }
  assert.deepEqual(errors, [], 'Unexpected application errors');
  console.log(`PASS: ${checks} layout and interaction checks; screenshots: ${output}`);
} finally { await browser.close(); }
