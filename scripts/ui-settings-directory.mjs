// Browser-level coverage for the shared directory. Only the native IPC is stubbed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const {chromium} = await import(process.env.LEXICUE_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({channel:process.env.LEXICUE_UI_BROWSER_CHANNEL || 'chrome'});
const url = process.env.LEXICUE_UI_URL;
const output = process.env.LEXICUE_SETTINGS_OUTPUT;
if (output) await mkdir(output, {recursive:true});
try {
  for (const phone of [false, true]) {
    const page = await browser.newPage({
      viewport:phone ? {width:375,height:812} : {width:1140,height:714},
      reducedMotion:'reduce', ...(phone ? {userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile',isMobile:true,hasTouch:true} : {}),
    });
    await page.addInitScript(phone => {
      localStorage.setItem('lexicue-preferences', JSON.stringify({state:{uiLanguage:'zh'},version:0}));
      localStorage.setItem('lexicue-onboarding-v1', JSON.stringify({version:1,status:'skipped'}));
      window.isTauri = true;
      window.calls = [];
      window.requestGates = new Map();
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener(){}};
      window.__TAURI_INTERNALS__ = {transformCallback:()=>1,unregisterCallback(){},convertFileSrc:s=>s,
        invoke:async command => {
          window.calls.push(command);
          if (window.requestGates.has(command)) await window.requestGates.get(command).promise;
          if (command === 'longman_dictionary_status') return {state:'ready',audio_available:true};
          if (command === 'device_sync') return {role:phone?'iphone':'mac',state:'waiting',paired:true,peerName:'Test'};
          if (command === 'plugin:app|version') return '0.4.6';
          if (command === 'plugin:app|identifier') return 'com.lexicue.dev.lansyncqa';
          if (command === 'dictionary_init_status') return {state:'ready',sources:[]};
          if (command.startsWith('list_')) return [];
          return null;
        }};
    },phone);
    async function checkPending(command, action, indicator) {
      await page.evaluate(cmd => { window.requestGates.set(cmd, Promise.withResolvers()); }, command);
      await action();
      await indicator.waitFor({state:'visible'});
      assert.equal(await indicator.evaluate(n => getComputedStyle(n).animationName), 'none');
      await page.evaluate(cmd => {
        window.requestGates.get(cmd).resolve();
        window.requestGates.delete(cmd);
      }, command);
      await indicator.waitFor({state:'detached'});
    }
    await page.goto(new URL('/settings',url).href);
    await page.locator('.mobile-startup').waitFor({state:'detached'});
    for (const [theme,name] of [['ocean','海湾蓝'],['midnight','深夜墨色']]) {
      await page.getByRole('button',{name,exact:true}).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
      const groups=page.locator('.settings-groups > section');
      assert.deepEqual(await groups.locator('h2').allTextContents(),['偏好','资料与设备','工具','应用']);
      assert.deepEqual(await groups.locator('.settings-row-label').allTextContents(),['界面语言','英语朗读','实操引导','设备同步','备份与旧记录','离线词典','YouTube 字幕','软件更新']);
      const first=await groups.nth(0).boundingBox(), second=await groups.nth(1).boundingBox();
      assert.equal(first.y===second.y,!phone);
      assert.equal(await page.locator('.theme-choice').count(),5);
      assert.ok(await groups.locator('.settings-row').evaluateAll(rows=>rows.every(r=>r.clientHeight>=44 && r.scrollWidth<=r.clientWidth+1)));
      if(output) await page.screenshot({path:output+'/'+(phone?'iphone':'mac')+'-'+theme+'.png'});
      await checkPending('longman_dictionary_status', () => page.locator('[data-entry=dictionary]').click(), page.locator('[role=status] .busy-ring'));
      await page.getByRole('button',{name:'返回',exact:true}).click();
      await page.locator('[data-entry=speech]').click();
      await page.locator('.speech-settings details > summary').click();
      const clearSpeech=page.getByRole('button', {name:'清除朗读缓存', exact:true});
      await checkPending('clear_tts_cache', () => clearSpeech.click(), page.locator('button[aria-busy=true] .busy-ring'));
      await page.getByRole('button',{name:'返回',exact:true}).click();
      const updates=page.locator('[data-entry=updates]');
      await updates.focus();
      await page.keyboard.press('Enter');
      await page.getByText('0.4.6',{exact:true}).waitFor();
      if (phone) {
        await page.getByText('本地安装',{exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:'检查更新'}).count(),0);
        assert.ok(!(await page.evaluate(()=>window.calls)).some(cmd=>cmd.startsWith('plugin:updater|')));
      } else await page.getByRole('button',{name:'检查更新'}).waitFor();
      await page.getByRole('button',{name:'返回',exact:true}).click();
      assert.equal(await updates.evaluate(r=>document.activeElement===r),true);
    }
    await page.locator('[data-entry=language]').click();
    await page.getByRole('button',{name:'English',exact:true}).click();
    await page.getByRole('button',{name:'Back',exact:true}).click();
    await page.getByRole('link',{name:'Software update',exact:true}).waitFor();
    await page.close();
    console.log('PASS settings directory, theme, updates, focus and language on '+(phone?'iPhone':'Mac'));
  }
} finally { await browser.close(); }
