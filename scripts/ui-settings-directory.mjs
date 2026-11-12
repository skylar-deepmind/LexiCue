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
      localStorage.setItem('lexicue-preferences', JSON.stringify({state:{uiLanguage:'zh',youtube:{browserSession:{enabled:true,browser:'chrome',profile:'Default'}}},version:0}));
      localStorage.setItem('lexicue-onboarding-v1', JSON.stringify({version:1,status:'skipped'}));
      window.isTauri = true;
      window.calls = [];
      window.requestGates = new Map();
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener(){}};
      window.__TAURI_INTERNALS__ = {transformCallback:()=>1,unregisterCallback(){},convertFileSrc:s=>s,
        invoke:async command => {
          window.calls.push(command);
          if (window.requestGates.has(command)) await window.requestGates.get(command).promise;
          if (command === 'youtube_ytdlp_status') return {available:false,path:null,version:null,ejs:'unknown'};
          if (command === 'list_legacy_records') return {rows:[],more:false};
          if (command === 'dictionary_pack_status') return {packs:[{id:'daily',installed:true,bundled_by_default:true,error:null,database:{bytes:60694528},archive:{bytes:41852225},download_url:null}],operation:null,busy:false};
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
      if (phone) {
        const cdp = await page.context().newCDPSession(page);
        const row = page.locator('[data-entry=dictionary]');
        await row.scrollIntoViewIfNeeded();
        const rect = await row.boundingBox();
        const x = rect.x + 60, y = rect.y + rect.height / 2;
        const style = () => row.evaluate(node => ({background:getComputedStyle(node).backgroundColor, outline:getComputedStyle(node).outlineStyle}));
        const before = await style();
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        // Native touch scrolling should cancel the tap, without synthesized sticky hover.
        for(let i=1;i<=8;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:Math.min(780,y+15*i)}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
        assert.equal(new URL(page.url()).search,'','scroll does not open a settings entry');
        assert.equal((await style()).background,before.background,'touch scroll leaves no highlighted row');
        assert.equal(await row.evaluate(node=>getComputedStyle(node).webkitTapHighlightColor),'rgba(0, 0, 0, 0)');
        await cdp.detach();
        await page.locator('.settings-scroll').evaluate(node=>node.scrollTop=0);
      } else {
        const row=page.locator('[data-entry=language]');
        await row.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        assert.equal(await row.evaluate(node=>getComputedStyle(node).outlineStyle),'solid','keyboard focus stays visible');
      }
      if(output) await page.screenshot({path:output+'/'+(phone?'iphone':'mac')+'-'+theme+'.png'});
      await checkPending('dictionary_pack_status', () => page.locator('[data-entry=dictionary]').click(), page.locator('[role=status] .busy-ring'));
      await page.getByRole('button',{name:'返回',exact:true}).click();
      await page.locator('[data-entry=speech]').click();
      await page.locator('.speech-settings details > summary').click();
      const clearSpeech=page.getByRole('button', {name:'清除朗读缓存', exact:true});
      await checkPending('clear_tts_cache', () => clearSpeech.click(), page.locator('button[aria-busy=true] .busy-ring'));
      await page.getByRole('button',{name:'返回',exact:true}).click();
      await page.locator('[data-entry=youtube]').click();
      if (phone) {
        await page.getByText(/公开的英语字幕/).waitFor();
        assert.equal(await page.getByRole('switch').count(), 0);
        assert.ok(!(await page.evaluate(()=>window.calls)).includes('youtube_ytdlp_status'));
        const enabled = await page.evaluate(async () => {
          const {usePreferencesStore} = await import('/src/stores/preferencesStore.ts');
          return usePreferencesStore.getState().youtube.browserSession.enabled;
        });
        assert.equal(enabled, false, 'a historical desktop session cannot block public iOS tracks');
      } else {
        const toggle = page.getByRole('switch');
        await toggle.click();
        assert.equal(await page.locator('#youtube-browser-profile').isDisabled(), true);
        await toggle.click();
        await page.locator('#youtube-browser-profile').fill('wrong:profile');
        assert.equal(await page.locator('#youtube-browser-profile').getAttribute('aria-invalid'), 'true');
        await page.locator('#youtube-browser-profile').fill('Default');
        await page.getByText(/未找到 yt-dlp/).waitFor();
      }
      await page.getByRole('button',{name:'清除字幕缓存'}).click();
      await page.getByRole('status').filter({hasText:'字幕缓存已清除'}).waitFor();
      await page.getByRole('button',{name:'返回',exact:true}).click();

      await page.locator('[data-entry=backup]').click();
      await page.getByRole('button',{name:/^导出/}).click();
      await page.getByRole('button',{name:'恢复备份',exact:true}).click();
      const calls = await page.evaluate(()=>window.calls);
      assert.ok(calls.includes('plugin:dialog|save') && calls.includes('plugin:dialog|open'));
      assert.ok(!calls.includes('restore_all') && !calls.includes('plugin:fs|write_text_file'), 'cancel is side-effect free');
      await page.locator('a[href="/legacy"]').click();
      await page.locator('.legacy-kind select').selectOption('words');
      await page.locator('.legacy-search').fill('example');
      await page.goBack();
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
