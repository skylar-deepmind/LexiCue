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
      const page = await browser.newPage({viewport:{width, height: 844}});
      await page.addInitScript(({theme, role}) => {
        localStorage.setItem('lexicue-theme', theme);
        localStorage.setItem('lexicue-preferences', JSON.stringify({state:{uiLanguage:'zh'},version:0}));
        window.isTauri = true;
        window.qaStatus = {role, state:'unpaired', paired:false};
        window.qaActions = [];
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener() {}};
        window.__TAURI_INTERNALS__ = {transformCallback:() => 1, unregisterCallback() {}, convertFileSrc: s => s,
          invoke: async (command, args) => {
            if (command === 'device_sync') {
              const s = window.qaStatus;
              if (args.action === 'backups') return [];
              if (args.action !== 'status') window.qaActions.push(args);
              if (args.action === 'offer' || args.action === 'scan') s.state = 'confirming';
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
      const section = page.locator('.device-sync');
      const start = section.getByRole('button', {name:role === 'mac' ? '显示配对码' : '扫描 Mac 配对码'});
      await start.waitFor();
      await verifyContrast(start, `${theme} default action`);
      await start.hover();
      await verifyContrast(start, `${theme} hover action`);
      await start.focus();
      await page.keyboard.press('Enter');
      await section.getByText('123456').waitFor();
      const confirm = section.getByRole('button',{name:'验证码一致，配对'});
      await confirm.focus();
      assert.equal(await confirm.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
      await page.keyboard.press('Space');
      await section.getByRole('button',{name:'等待另一端确认',disabled:true}).waitFor();
      await verifyContrast(section.getByRole('button',{name:'等待另一端确认'}), `${theme} disabled action`);
      assert.equal(await page.evaluate(() => window.qaActions.at(-1).confirmationId), 'fixture-candidate');
      for (const [state, label] of [['waiting','等待设备上线'], ['syncing','同步中'], ['synced','已同步'], ['update','需要更新另一台设备'], ['pending','有更改待处理'], ['permission','需要访问权限']]) {
        await page.evaluate(state => Object.assign(window.qaStatus,{state,paired:true,issue:state === 'permission' ? 'localNetwork' : undefined}),state);
        await section.getByRole('status').filter({hasText:label}).waitFor();
      }
      await section.getByText('需要允许局域网访问。', {exact:false}).waitFor();
      assert.ok(await section.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
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
