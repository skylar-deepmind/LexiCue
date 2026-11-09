// Settings interaction coverage. The native pairing protocol is exercised
// separately on Apple devices. This fixture makes each UI transition repeatable.
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.LEXICUE_PLAYWRIGHT_MODULE || 'playwright');

async function verifyContrast(locator, name) {
  const ratio = await locator.evaluate(node => {
    const rgb = value => value.match(/[\d.]+/g).map(Number);
    const luminance = color => rgb(color).slice(0,3).map(n => n/255)
      .map(n => n <= .04045 ? n/12.92 : ((n+.055)/1.055)**2.4)
      .reduce((s,n,i) => s+n*[.2126,.7152,.0722][i],0);
    let parent = node;
    let bg;
    do { bg = getComputedStyle(parent).backgroundColor; parent = parent.parentElement; }
    while (parent && rgb(bg)[3] === 0);
    const foreground = luminance(getComputedStyle(node).color);
    const background = luminance(bg);
    return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);
  });
  assert.ok(ratio >= 4.5, `${name} contrast ${ratio}`);
}

const browser = await chromium.launch({channel: process.env.LEXICUE_UI_BROWSER_CHANNEL || 'chrome'});
try {
  for (const [role, width] of [['mac', 1280], ['iphone', 390]]) {
    for (const theme of ['ocean', 'midnight']) {
      const page = await browser.newPage({viewport:{width, height: 844}, ...(role === 'iphone' ? {isMobile:true, hasTouch:true, userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'} : {})});
      await page.addInitScript(({theme, role}) => {
        localStorage.setItem('lexicue-theme', theme);
        localStorage.setItem('lexicue-onboarding-v1', JSON.stringify({version:1,status:'skipped'}));
        localStorage.setItem('lexicue-preferences', JSON.stringify({state:{uiLanguage:'zh'},version:0}));
        window.isTauri = true;
        window.qaStatus = {role, state:'unpaired', paired:false};
        window.qaActions = [];
        window.statusReads = 0;
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener() {}};
        window.__TAURI_INTERNALS__ = {transformCallback:() => 1, unregisterCallback() {}, convertFileSrc: s => s,
          invoke: async (command, args) => {
            if (command === 'device_sync') {
              const s = window.qaStatus;
              if (args.action === 'status') window.statusReads++;
              if (args.action === 'backups') return new Promise((resolve, reject) => {
                window.finishBackupRead = ok => ok ? resolve([]) : reject(new Error('backup list unavailable'));
              });
              if (args.action.startsWith('receiveClosed')) s.receiveClosed=args.action==='receiveClosedOn';
              if (args.action !== 'status') window.qaActions.push(args);
              if (args.action === 'offer') Object.assign(s,{state:'offering',qr:'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22/%3E'});
              if (args.action === 'scan') s.state = 'scanning';
              if (args.action === 'cancel') Object.assign(s,{state:'unpaired',qr:undefined});
              if (s.state === 'confirming') Object.assign(s, {confirmationId:'fixture-candidate',code:'123456',peerName:role === 'mac' ? '测试 iPhone' : '测试 Mac'});
              if (args.action === 'confirm') s.confirmed = true;
              if (args.action === 'revoke') Object.assign(s,{state:'unpaired',paired:false,peerName:undefined});
              return {...s};
            }
            if (command === 'plugin:event|listen') return 1;
            if (command === 'plugin:app|version') return 'test';
            if (command === 'list_device_conflicts' || command === 'list_materials' || command === 'list_tags') return [];
            if (command === 'dictionary_init_status') return {state:'ready',sources:[]};
            return null;
          }
        };
      }, {role, theme});
      await page.goto(new URL('/settings', process.env.LEXICUE_UI_URL).href);
      await page.locator('.mobile-startup').waitFor({state:'detached'});
      const section = page.locator('.device-sync');
      const start = section.getByRole('button', {name:role === 'mac' ? '显示配对码' : '扫描 Mac 配对码'});
      const entry = page.locator('[data-entry=sync]');
      await entry.getByText('尚未配对').waitFor();
      assert.equal(await section.count(),0);
      const summaryReads = await page.evaluate(() => window.statusReads);
      await page.waitForTimeout(1150);
      assert.equal(await page.evaluate(() => window.statusReads), summaryReads, 'summary only reads on demand');
      await page.evaluate(() => {
        Object.assign(window.qaStatus,{paired:true,state:'syncing',phase:'exchanging'});
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await entry.getByText('交换更改').waitFor();
      await page.evaluate(() => Object.assign(window.qaStatus,{state:'synced'}));
      await entry.getByText('已同步').waitFor();
      await page.evaluate(() => {
        Object.assign(window.qaStatus,{paired:false,state:'unpaired',phase:undefined});
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await entry.getByText('尚未配对').waitFor();
      await entry.focus();
      await page.keyboard.press('Enter');
      await start.waitFor();
      await verifyContrast(start, `${theme} default action`);
      await start.hover();
      await verifyContrast(start, `${theme} hover action`);
      await start.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => window.qaActions.at(-1).action),role==='mac'?'offer':'scan');
      if (role==='mac') {
        await section.getByRole('img',{name:'用 iPhone 上的 LexiCue 扫描此一次性配对码'}).waitFor();
      } else {
        await section.getByText('正在连接 Mac').waitFor();
        assert.equal(await section.getByRole('img').count(),0);
      }
      await section.getByRole('button',{name:'取消'}).click();
      await start.click();
      await page.evaluate(()=>Object.assign(window.qaStatus,{state:'confirming',qr:undefined}));
      await section.getByText('123456').waitFor();
      const confirm = section.getByRole('button',{name:'验证码一致，配对'});
      await page.keyboard.press('Tab');
      await confirm.focus();
      assert.equal(await confirm.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
      await page.keyboard.press('Space');
      await section.getByRole('button',{name:'等待另一端确认',disabled:true}).waitFor();
      await verifyContrast(section.getByRole('button',{name:'等待另一端确认'}), `${theme} disabled action`);
      assert.equal(await page.evaluate(() => window.qaActions.at(-1).confirmationId), 'fixture-candidate');
      for (const [state, label] of [['waiting','等待设备上线'], ['syncing','同步中'], ['synced','已同步'], ['update','需要更新另一台设备'], ['pending','有更改待处理'], ['permission','需要访问权限']]) {
        await page.evaluate(state => Object.assign(window.qaStatus,{state,paired:true,issue:state === 'permission' ? 'localNetwork' : undefined}),state);
        await section.getByRole('status').filter({hasText:label}).waitFor();
        if (state === 'syncing') {
          const status = section.locator('.sync-state');
          const track = status.locator('.activity-track[aria-hidden=true]');
          await track.waitFor();
          for (const [phase, name] of [['preparing','准备合并'], ['exchanging','交换更改'], ['awaitingAck','等待对方确认']]) {
            await page.evaluate(phase => { window.qaStatus.phase = phase; }, phase);
            await status.getByText(name, {exact:true}).waitFor();
            assert.equal(await status.getByText('已同步').count(),0);
          }
          await verifyContrast(status, `${theme} syncing text`);
          await page.screenshot({path:`/tmp/lexicue-device-sync-${role}-${theme}-awaiting-ack.png`});
          await page.emulateMedia({reducedMotion:'reduce'});
          await track.waitFor({state:'hidden'});
          await status.locator('.sync-static-activity[aria-hidden=true]').waitFor();
          await page.emulateMedia({reducedMotion:'no-preference'});
        } else {
          assert.equal(await section.locator('.activity-track').count(),0);
        }
        if (state==='synced') {
          const peer = section.locator(role==='mac'?'.sync-peer-row':'.sync-peer-card');
          assert.equal(await peer.locator('strong').innerText(),role==='mac'?'测试 iPhone':'测试 Mac');
          await page.screenshot({path:`/tmp/lexicue-device-sync-${role}-${theme}.png`});
        }
      }
      await section.getByText('需要允许局域网访问。', {exact:false}).waitFor();
      assert.ok(await section.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      if (role === 'mac') {
        const receiver=section.getByRole('switch');
        await receiver.focus();await page.keyboard.press('Space');
        await page.waitForFunction(()=>window.qaActions.at(-1)?.action==='receiveClosedOn');
        assert.equal(await receiver.isChecked(),true);
      }
      const backups=section.locator('summary').filter({hasText:'合并前的本机备份'});
      await backups.click();
      const listStatus = section.getByRole('status').filter({hasText:'正在读取备份列表'});
      await listStatus.waitFor();
      assert.equal(await section.getByText('本机尚未创建合并前备份。').count(),0);
      await page.evaluate(() => window.finishBackupRead(false));
      const disclosure = backups.locator('..');
      await disclosure.getByRole('alert').filter({hasText:'无法读取本机备份列表。'}).waitFor();
      await disclosure.getByRole('button', {name:'重试'}).click();
      await listStatus.waitFor();
      await page.evaluate(() => window.finishBackupRead(true));
      await disclosure.getByText('本机尚未创建合并前备份。').waitFor();
      await section.locator('summary').filter({hasText:'管理已配对设备'}).click();
      await section.getByRole('button',{name:'移除设备',exact:true}).click();
      assert.ok(await section.getByText('移除后停止交换资料', {exact:false}).isVisible());
      await section.getByRole('button',{name:'确认移除'}).click();
      await start.waitFor();
      await page.close();
      console.log(`PASS device sync settings: ${role}, ${theme}`);
    }
  }
} finally { await browser.close(); }
