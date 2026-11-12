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
let currentPage;
async function fixture(page, theme) {
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(theme => {
    window.__uiWindowErrors=[];
    window.addEventListener('error',event=>window.__uiWindowErrors.push(event.message));
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
    records.push({ ...structuredClone(records[0]), record_id: 'saved-fixture-3', source_key: 'source-3', sentence: 'Please take off your coat.', explanation: '脱下', saved_at: 1600000000000, revision: 'revision-3', source: { ...records[0].source, content_hash: 'hash-3', segment_index: 3 } });
    const receipts = new Map();
    window.__uiCalls = []; window.__uiFailSave = false;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1, unregisterCallback() {}, convertFileSrc: path => path,
      invoke: async (command, args = {}) => {
        window.__uiCalls.push({ command, args: structuredClone(args) });
        const activeGroups = () => [...new Set(records.filter(record => record.deleted_at === null).map(record => record.expression))].map(expression => {
          const contexts = records.filter(record => record.deleted_at === null && record.expression === expression).sort((a, b) => (b.saved_at ?? -1) - (a.saved_at ?? -1) || a.record_id.localeCompare(b.record_id));
          return { group_id: `group:${expression}`, expression, context_count: contexts.length, latest_saved_at: contexts[0].saved_at, preview: contexts[0], summary: contexts[0].explanation_source==='dictionary' ? contexts[0].explanation : null, records: contexts };
        }).sort((a, b) => (b.latest_saved_at ?? -1) - (a.latest_saved_at ?? -1) || a.expression.localeCompare(b.expression));
        if (command === 'list_saved_groups') {
          const query = (args.query || '').toLowerCase();
          const groups = activeGroups().filter(group => JSON.stringify(group).toLowerCase().includes(query));
          if (query === 'take') await new Promise(resolve => setTimeout(resolve, 120));
          return structuredClone({ groups: groups.slice(args.offset, args.offset + args.limit).map(({ records: _records, ...group }) => group), total_groups: groups.length, total_records: groups.reduce((count, group) => count + group.context_count, 0) });
        }
        if (command === 'saved_group_contexts') {
          const group = activeGroups().find(group => group.group_id === args.groupId);
          return structuredClone({ records: group?.records.slice(args.offset, args.offset + args.limit) ?? [], total: group?.context_count ?? 0 });
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
const details = page => page.locator('.saved-disclosure[data-open=true]');
const settle = async page => { await details(page).locator('.saved-context-entry').first().waitFor(); await details(page).evaluate(node => Promise.allSettled(node.getAnimations().map(animation => animation.finished))); };
const collapse = async page => { const control = page.locator('.saved-record-open[aria-expanded=true]'); await control.click(); await page.waitForFunction(()=> document.querySelectorAll('.saved-disclosure[data-open=true]').length===0 && [...document.querySelectorAll('.saved-disclosure')].every(node=>node.getBoundingClientRect().height<1)); };
async function noOverflow(page, label) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label);
  const outside = await page.locator('.saved-workspace,.saved-disclosure[data-open=true]').evaluateAll(nodes => nodes.filter(node => {
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
    const page = await context.newPage(); currentPage=page; await fixture(page, theme); await page.goto(`${url}/saved`);
    await page.waitForFunction(() => document.querySelectorAll('.saved-record-row').length === 3);
    const search = page.getByRole('searchbox');
    await search.fill('take'); await page.waitForFunction(() => document.querySelectorAll('.saved-record-row').length === 1);
    assert.equal(await page.locator('.saved-record-term').innerText(), 'take off'); checks++;
    await search.fill(''); await search.fill('take'); await search.fill('curiosity'); await page.waitForFunction(() => document.querySelector('.saved-record-term')?.textContent === 'curiosity');
    await page.waitForTimeout(160); assert.equal(await page.locator('.saved-record-term').innerText(), 'curiosity'); checks++;
    await search.fill(''); await page.waitForFunction(() => document.querySelectorAll('.saved-record-row').length === 3);
    const first = page.locator('.saved-record-open').first();
    const closedBox = await first.boundingBox();
    await first.focus(); await page.keyboard.press('Enter'); await details(page).waitFor(); await settle(page);
    const openBox = await first.boundingBox(); assert.equal(Math.round(closedBox.width), Math.round(openBox.width)); checks++;
    assert.equal(await details(page).getByLabel(/^(关闭|Close)$/).count(), 0); checks++;
    assert.ok(await details(page).getByText('The plane will take off soon.', { exact: true }).isVisible()); checks++;
    assert.ok(await contrast(first) >= 4.5); checks++;
    await collapse(page);
    assert.ok(await first.evaluate(node => node === document.activeElement)); checks++;
    // A failed edit keeps the draft; the retry uses the same operation receipt.
    await first.click(); await settle(page); await details(page).locator('.saved-context-entry').first().getByRole('button', { name: '补充个人解释', exact: true }).click();
    await page.getByRole('textbox', { name: '个人解释' }).fill('我的个人修正');
    await page.evaluate(() => { window.__uiFailSave = true; }); await page.getByRole('button', { name: '保存解释' }).click();
    await page.getByRole('dialog', { name: '个人解释', exact: true }).getByRole('alert').waitFor(); assert.equal(await page.getByRole('textbox', { name: '个人解释' }).inputValue(), '我的个人修正'); checks++;
    await page.getByRole('dialog', { name: '个人解释', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
    await collapse(page);
    await first.click(); await settle(page); await details(page).locator('.saved-context-entry').first().getByRole('button', { name: '补充个人解释', exact: true }).click(); assert.equal(await page.getByRole('textbox', { name: '个人解释' }).inputValue(), '我的个人修正'); checks++;
    await page.evaluate(() => { window.__uiFailSave = false; }); await page.getByRole('button', { name: '保存解释' }).click();
    await details(page).getByText('我的个人修正', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => { const calls = window.__uiCalls.filter(call => call.command === 'mutate_saved_record' && call.args.mutation.kind === 'edit'); return calls.at(-1).args.operationId === calls.at(-2).args.operationId; })); checks++;
    await collapse(page);
    // One word card contains two independent contexts; removing one leaves its sibling.
    assert.match(await first.innerText(), /2 句/); checks++;
    await first.click(); await settle(page); await page.getByRole('button', { name: '还有 1 句', exact: true }).click(); await details(page).locator('.saved-context-entry').nth(1).waitFor();
    assert.equal(await details(page).locator('.saved-context-entry').count(), 2); checks++;
    assert.ok(await details(page).getByText('Please take off your coat.', { exact: true }).isVisible()); checks++;
    const removeButton = details(page).locator('.saved-context-entry').first().getByRole('button', { name: '移除这句', exact: true });
    for (const state of ['default', 'hover', 'focus']) {
      if (state === 'hover') await removeButton.hover();
      if (state === 'focus') await removeButton.focus();
      assert.ok(await contrast(removeButton) >= 4.5, `${theme} remove ${state}`); checks++;
    }
    await removeButton.click();
    await page.waitForFunction(() => document.querySelectorAll('.saved-context-entry').length === 1); checks++;
    assert.equal(await page.locator('.saved-record-row').count(), 3); checks++;
    assert.match(await first.innerText(), /1 句/); checks++;
    assert.ok(await details(page).getByText('Please take off your coat.', { exact: true }).isVisible()); checks++;
    assert.ok(await page.getByRole('button', { name: '撤销', exact: true }).evaluate(node => node === document.activeElement)); checks++;
    assert.ok(await contrast(page.locator('.saved-undo > span')) >= 4.5); checks++;
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.saved-context-entry').length === 2);
    assert.equal(await details(page).locator('.saved-sentence-note').first().innerText(), '我的个人修正'); checks++;
    assert.match(await first.innerText(), /2 句/); checks++;
    await collapse(page);
    await page.locator('.saved-record-open').filter({ has: page.locator('.saved-record-term', { hasText: /^curiosity$/ }) }).click(); await settle(page); await page.getByRole('button', { name: '返回原文', exact: true }).click();
    await page.getByText('原材料已不存在或已变更，仍可阅读此副本。', { exact: true }).waitFor();
    assert.ok(await details(page).getByText('Curiosity helps us learn.', { exact: true }).isVisible()); checks++;
    assert.ok(await page.getByRole('button', { name: '返回原文', exact: true }).isDisabled()); checks++;
    const disabledButton = page.getByRole('button', { name: '返回原文', exact: true });
    const disabledContrast = await contrast(disabledButton);
    assert.ok(disabledContrast >= 4.5, JSON.stringify({ theme, disabledContrast, colors: await disabledButton.evaluate(node => { const s = getComputedStyle(node); return { fg: s.color, bg: s.backgroundColor, opacity: s.opacity }; }) })); checks++;
    await collapse(page);
    for (const width of [360, 390, 430, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await first.click(); await settle(page);
      await noOverflow(page, `${theme} ${width}`);
      assert.ok(await contrast(first.locator('.saved-context-count')) >= 4.5, `${theme} selected source contrast`); checks++;
      const primary = details(page).getByRole('button', { name: '返回原文', exact: true }).first();
      for (const state of ['default', 'hover', 'focus']) {
        if (state === 'hover') await primary.hover();
        if (state === 'focus') await primary.focus();
        assert.ok(await contrast(primary) >= 4.5, `${theme} ${state} primary contrast`); checks++;
      }
      if (width === 1440 || width === 390) await page.screenshot({ animations: 'disabled', path: `${output}/${theme}-${width}-saved.png` });
      await collapse(page);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' }); await first.click();
    const animations = await details(page).evaluate(node => node.getAnimations().map(animation => ({type:animation.constructor.name,duration:animation.effect.getTiming().duration,frames:animation.effect.getKeyframes(),reduced:matchMedia('(prefers-reduced-motion: reduce)').matches})));
    assert.ok(animations.every(animation=>Number(animation.duration)<=1), JSON.stringify(animations)); checks++;
    await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; }); await noOverflow(page, `${theme} enlarged text`);
    await collapse(page);
    assert.ok(await page.evaluate(() => !window.__uiCalls.some(call => ['update_word_status', 'create_review_card', 'create_phrase_review_card', 'delete_file'].includes(call.command)))); checks++;
    assert.deepEqual(await page.evaluate(()=>window.__uiWindowErrors),[],'no browser-reported layout errors'); checks++;
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = { checks, errors, themes: ['ocean', 'midnight'], widths: [360, 390, 430, 768, 1024, 1280, 1440], data: 'isolated in-memory UI fixture with native archive API shape; real persistence is covered by separate Rust bridge tests' };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(`PASS: ${checks} saved-context UI checks; screenshots: ${output}`);
} catch (error) {
  if(currentPage && !currentPage.isClosed()) await writeFile(`${output}/failure.json`,JSON.stringify(await currentPage.evaluate(()=>({url:location.href,width:innerWidth,expanded:[...document.querySelectorAll('.saved-record-open')].map(button=>[button.innerText,button.getAttribute('aria-expanded')]),text:document.body.innerText,calls:window.__uiCalls.slice(-8)})),null,2));
  throw error;
} finally { await browser.close(); }
