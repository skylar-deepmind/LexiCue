/** UI-only, isolated in-memory Tauri fixture. Real migration/transactions/encryption
 * are tested separately against Rust/SQLite; this script never opens a user DB. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.LEXICUE_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: process.env.LEXICUE_UI_BROWSER_CHANNEL || 'chrome', headless: true });
const url = process.env.LEXICUE_UI_URL || 'http://127.0.0.1:5173';
const output = process.env.LEXICUE_SAVED_UI_OUTPUT || process.env.LEXICUE_UI_OUTPUT || '/tmp/lexicue-ui-saved';
await mkdir(output, { recursive: true });
const errors = [];
let checks = 0;
async function fixture(page, theme) {
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(theme => {
    localStorage.setItem('lexicue-theme', theme);
    localStorage.setItem('lexicue-preferences', JSON.stringify({ state: { uiLanguage: 'zh' }, version: 0 }));
    const records = ['take off', 'curiosity', 'make sense'].map((expression, index) => ({
      record_id: `saved-fixture-${index}`, expression, normalized_expression: expression, source_key: `source-${index}`,
      sentence: ['The plane will take off soon.', 'Curiosity helps us learn.', 'This makes sense.'][index], sentence_translation: null,
      source: { content_hash: `hash-${index}`, file_name: 'flight.srt', segment_index: index, start_offset: 0, end_offset: 5, start_time: null, end_time: null },
      explanation: ['起飞', '好奇心', '有道理'][index], explanation_source: 'dictionary', origin: index ? 'legacy' : 'reader',
      legacy: index === 1 ? { definition: '个人注释', occurrence: { meaning_en: 'My earlier English note' } } : null,
      saved_at: index ? null : 1700000000000, updated_at: 1, revision: `revision-${index}`, generation: 0, deleted_at: null,
    }));
    const receipts = new Map();
    window.__uiCalls = []; window.__uiFailSave = false;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1, unregisterCallback() {}, convertFileSrc: path => path,
      invoke: async (command, args = {}) => {
        window.__uiCalls.push({ command, args: structuredClone(args) });
        if (command === 'list_saved_records') {
          const query = (args.query || '').toLowerCase();
          const result = records.filter(record => record.deleted_at === null && JSON.stringify(record).toLowerCase().includes(query)).slice(args.offset, args.offset + args.limit);
          if (query === 'take') await new Promise(resolve => setTimeout(resolve, 120));
          return structuredClone(result);
        }
        if (command === 'saved_migration_report') return { eligible_words: 1, eligible_phrases: 1, saved_contexts: 2, missing_sources: 1, merged_duplicate_positions: 0, history_only: [] };
        if (command === 'saved_record_conflicts') return [];
        if (command === 'saved_record_source') return args.recordId === 'saved-fixture-1' ? null : { file_id: 1, segment_index: 0 };
        if (command === 'mutate_saved_record') {
          if (window.__uiFailSave) throw new Error('fixture disk failure');
          if (receipts.has(args.operationId)) return structuredClone(receipts.get(args.operationId).result);
          const mutation = args.mutation;
          const record = records.find(record => record.record_id === mutation.record_id);
          if (record.revision !== mutation.expected_revision) throw new Error('saved_conflict');
          const before = structuredClone(record);
          if (mutation.kind === 'remove') record.deleted_at = 2;
          if (mutation.kind === 'edit') { record.explanation = mutation.explanation; record.explanation_source = 'personal'; }
          record.revision += '-next'; record.updated_at++;
          const result = { record: structuredClone(record), changed: true, operation_id: args.operationId };
          receipts.set(args.operationId, { before, result }); return result;
        }
        if (command === 'undo_saved_mutation') {
          const receipt = receipts.get(args.operationId); const index = records.findIndex(record => record.record_id === receipt.before.record_id);
          records[index] = structuredClone(receipt.before); return structuredClone(records[index]);
        }
        if (command === 'dictionary_init_status') return { runId: 1, sequence: 1, state: 'ready', currentSource: null, sources: [] };
        if (command === 'dictionary_status') return true;
        if (command === 'get_local_gemma_activity') return { generations: 0, pulling: false, deleting: false, sequence: 0 };
        if (command === 'youtube_ytdlp_status') return { available: false, version: null, path: null };
        if (command === 'plugin:app|version') return '0.4.5';
        if (command === 'plugin:event|listen') return 1;
        if (command === 'get_file_info') return { id: 1, name: 'flight.srt', type: 'srt', language: 'en', segment_count: 1, tags: [] };
        if (command === 'get_file_segments') return [{ id: 1, index_num: 0, en_text: 'The plane will take off soon.', zh_text: null, start_time: null, end_time: null }];
        if (command.startsWith('list_') || command.startsWith('get_file_')) return [];
        return null;
      },
    };
  }, theme);
}
const settle = page => page.locator('.context-panel').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
async function noOverflow(page, label) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label);
  const outside = await page.locator('.saved-workspace,.context-panel').evaluateAll(nodes => nodes.filter(node => {
    const r = node.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1;
  }).map(node => node.className));
  assert.deepEqual(outside, [], label); checks += 2;
}
async function contrast(locator) {
  return locator.evaluate(node => {
    const rgb = value => value.match(/[\d.]+/g).map(Number);
    const lum = values => values.slice(0, 3).map(n => { const c = n / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    const fg = rgb(getComputedStyle(node).color); let target = node, bg;
    do { bg = rgb(getComputedStyle(target).backgroundColor); target = target.parentElement; } while (target && (bg[3] ?? 1) === 0);
    const a = lum(fg), b = lum(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
}
try {
  for (const theme of ['ocean', 'midnight']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(); await fixture(page, theme); await page.goto(`${url}/saved`);
    await page.waitForFunction(() => document.querySelectorAll('.saved-record-row').length === 3);
    const search = page.getByRole('searchbox');
    await search.fill('take'); await page.waitForFunction(() => document.querySelectorAll('.saved-record-row').length === 1);
    assert.equal(await page.locator('.saved-record-term').innerText(), 'take off'); checks++;
    await search.fill(''); await search.fill('take'); await search.fill('curiosity'); await page.waitForFunction(() => document.querySelector('.saved-record-term')?.textContent === 'curiosity');
    await page.waitForTimeout(160); assert.equal(await page.locator('.saved-record-term').innerText(), 'curiosity'); checks++;
    await search.fill(''); await page.waitForFunction(() => document.querySelectorAll('.saved-record-row').length === 3);
    const first = page.locator('.saved-record-open').first();
    const closedBox = await first.boundingBox();
    await first.focus(); await page.keyboard.press('Enter'); await page.getByRole('dialog').waitFor(); await settle(page);
    const openBox = await first.boundingBox(); assert.equal(Math.round(closedBox.width), Math.round(openBox.width)); checks++;
    assert.equal(await page.getByRole('dialog').getByLabel(/^(关闭|Close)$/).count(), 0); checks++;
    assert.ok(await page.getByRole('dialog').getByText('The plane will take off soon.', { exact: true }).isVisible()); checks++;
    assert.ok(await contrast(first) >= 4.5); checks++;
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.ok(await first.evaluate(node => node === document.activeElement)); checks++;
    // A failed edit keeps the draft; the retry uses the same operation receipt.
    await first.click(); await settle(page); await page.getByRole('button', { name: '修改解释', exact: true }).click();
    await page.getByRole('textbox', { name: '个人解释' }).fill('我的个人修正');
    await page.evaluate(() => { window.__uiFailSave = true; }); await page.getByRole('button', { name: '保存修改' }).click();
    await page.getByRole('dialog').getByRole('alert').waitFor(); assert.equal(await page.getByRole('textbox', { name: '个人解释' }).inputValue(), '我的个人修正'); checks++;
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
    await first.click(); await settle(page); assert.equal(await page.getByRole('textbox', { name: '个人解释' }).inputValue(), '我的个人修正'); checks++;
    await page.evaluate(() => { window.__uiFailSave = false; }); await page.getByRole('button', { name: '保存修改' }).click();
    await page.getByRole('dialog').getByText('我的个人修正', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => { const calls = window.__uiCalls.filter(call => call.command === 'mutate_saved_record' && call.args.mutation.kind === 'edit'); return calls.at(-1).args.operationId === calls.at(-2).args.operationId; })); checks++;
    await page.evaluate(() => window.__lexicueBack()); await page.getByRole('dialog').waitFor({ state: 'detached' });
    // Remove affects only that saved context and undo restores its personal edit.
    await page.getByRole('button', { name: 'take off 的更多操作' }).click();
    const removeButton = page.getByRole('button', { name: '移除', exact: true });
    for (const state of ['default', 'hover', 'focus']) {
      if (state === 'hover') await removeButton.hover();
      if (state === 'focus') await removeButton.focus();
      assert.ok(await contrast(removeButton) >= 4.5, `${theme} remove ${state}`); checks++;
    }
    await removeButton.click();
    await page.waitForFunction(() => document.querySelectorAll('.saved-record-row').length === 2); checks++;
    assert.ok(await page.getByRole('button', { name: '撤销', exact: true }).evaluate(node => node === document.activeElement)); checks++;
    assert.ok(await contrast(page.locator('.saved-undo > span')) >= 4.5); checks++;
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.saved-record-row').length === 3);
    assert.match(await first.innerText(), /我的个人修正/); checks++;
    await page.locator('.saved-record-open').nth(1).click(); await settle(page); await page.getByRole('button', { name: '返回原文', exact: true }).click();
    await page.getByText('原材料已不存在或已变更，仍可阅读此副本。', { exact: true }).waitFor();
    assert.ok(await page.getByRole('dialog').getByText('Curiosity helps us learn.', { exact: true }).isVisible()); checks++;
    assert.ok(await page.getByRole('button', { name: '返回原文', exact: true }).isDisabled()); checks++;
    const disabledButton = page.getByRole('button', { name: '返回原文', exact: true });
    const disabledContrast = await contrast(disabledButton);
    assert.ok(disabledContrast >= 4.5, JSON.stringify({ theme, disabledContrast, colors: await disabledButton.evaluate(node => { const s = getComputedStyle(node); return { fg: s.color, bg: s.backgroundColor, opacity: s.opacity }; }) })); checks++;
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
    for (const width of [360, 390, 430, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await first.click(); await settle(page);
      await noOverflow(page, `${theme} ${width}`);
      assert.ok(await contrast(first.locator('small')) >= 4.5, `${theme} selected source contrast`); checks++;
      const primary = page.getByRole('button', { name: '返回原文', exact: true });
      for (const state of ['default', 'hover', 'focus']) {
        if (state === 'hover') await primary.hover();
        if (state === 'focus') await primary.focus();
        assert.ok(await contrast(primary) >= 4.5, `${theme} ${state} primary contrast`); checks++;
      }
      if (width === 1440 || width === 390) await page.screenshot({ animations: 'disabled', path: `${output}/${theme}-${width}-saved.png` });
      if (width >= 1024) await page.mouse.click(110,200);
      else await page.getByRole('button', { name: '收起，继续', exact: true }).last().click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' }); await first.click();
    assert.equal(await page.locator('.context-panel').evaluate(node => getComputedStyle(node).animationName), 'none'); checks++;
    await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; }); await noOverflow(page, `${theme} enlarged text`);
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.ok(await page.evaluate(() => !window.__uiCalls.some(call => ['update_word_status', 'create_review_card', 'create_phrase_review_card', 'delete_file'].includes(call.command)))); checks++;
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = { checks, errors, themes: ['ocean', 'midnight'], widths: [360, 390, 430, 768, 1024, 1280, 1440], data: 'isolated in-memory UI fixture' };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(`PASS: ${checks} saved-context UI checks; screenshots: ${output}`);
} finally { await browser.close(); }
