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
        if (command === 'dictionary_init_status') return { runId:1, sequence:1, state:'ready', currentSource:null, sources:[] };
        if (command === 'plugin:event|listen') return 1;
        if (command === 'plugin:app|version') return '0.4.2';
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
        if (command === 'get_local_gemma_activity') return { generations: 0, pulling: false, deleting: false, sequence: 0 };
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
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage(); await fixture(page, theme);
    await page.addInitScript(() => {
      const model = 'gemma4-e2b-litert-181938105e0e';
      localStorage.setItem('lexicue-ai', JSON.stringify({ version: 2, state: { enabled: true, provider: 'gemma', profiles: { gemma: { model }, openai: { baseUrl: 'https://cloud.test/v1', model: 'cloud-model', apiKey: 'fixture-key' } } } }));
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === 'get_local_gemma_environment') return { os: 'android', architecture: 'aarch64', cpu: null, memoryBytes: 8 * 2 ** 30, unifiedMemory: false, freeStorageBytes: 12e9, availableMemoryBytes: 4e9, runtimeStatus: { state: 'ready', backend: 'gpu', model }, models: [
          { model, label: 'E2B', format: 'litertlm', quantization: 'int4', estimatedBytes: 2588147712, preferred: true, recommended: true, compatible: true, resumable: false },
          { model: 'gemma4-e4b-litert-0b2a8980ce15', label: 'E4B', format: 'litertlm', quantization: 'int4', estimatedBytes: 3659530240, preferred: false, recommended: false, compatible: true, resumable: true }] };
        if (command === 'ai_models') return [{ name: model, size: 2588147712 }];
        return original(command, args);
      };
    });
    await page.goto(`${url}/settings#ai-models`);
    await page.locator('.gemma-model-card').nth(1).waitFor();
    await page.waitForFunction(() => document.querySelector('.gemma-model-card--selected'));
    assert.equal(await page.locator('.gemma-model-card').count(), 2); checks++;
    assert.equal(await page.getByRole('textbox', { name: /Ollama/ }).count(), 0); checks++;
    assert.equal(await page.locator('.gemma-model-card').first().getByRole('button', { name: '当前使用' }).isDisabled(), true); checks++;
    const resume = page.locator('.gemma-model-card').nth(1).getByRole('button', { name: '继续下载' });
    await resume.hover();
    await resume.focus();
    assert.notEqual(await resume.evaluate(node => getComputedStyle(node).outlineStyle), 'none'); checks++;
    for (const [width, height] of [[375,812],[812,375],[1440,900]]) {
      await page.setViewportSize({ width, height });
      await noOverflow(page, `${theme} Gemma ${width}`);
      await page.locator('#ai-models').screenshot({ path: `${output}/gemma-${theme}-${width}.png` });
    }
    const contrast = await page.locator('#ai-models').evaluate(section => {
      const rgb = color => color.match(/[\d.]+/g).map(Number);
      const luminance = values => values.slice(0,3).map(x => x/255).map(x => x <= .04045 ? x/12.92 : ((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
      return [...section.querySelectorAll('p,h3,h4,small,button,span')].filter(node => node.getBoundingClientRect().height && node.textContent.trim()).map(node => {
        let parent = node; let background;
        while (parent) { const value = rgb(getComputedStyle(parent).backgroundColor); if (value.length === 3 || value[3] === 1) { background = value; break; } parent = parent.parentElement; }
        const a = luminance(rgb(getComputedStyle(node).color)), b = luminance(background || [255,255,255]);
        return { text: node.textContent.trim().slice(0,30), contrast: (Math.max(a,b)+.05)/(Math.min(a,b)+.05) };
      });
    });
    assert.ok(contrast.every(item => item.contrast >= 4.5), JSON.stringify({ theme, contrast: contrast.filter(item => item.contrast < 4.5) })); checks++;
    await page.locator('.installed-model').getByRole('button', { name: /^删除模型/ }).click();
    await page.getByRole('dialog').waitFor();
    assert.ok((await page.getByRole('dialog').innerText()).includes('仅删除 LexiCue')); checks++;
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
    await context.close();
  }
  assert.deepEqual(errors, [], 'Unexpected application errors');
  console.log(`PASS: ${checks} Gemma layout, contrast, state and interaction checks; screenshots: ${output}`);
} finally { await browser.close(); }
