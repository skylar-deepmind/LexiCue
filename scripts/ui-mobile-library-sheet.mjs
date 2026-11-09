/** The sheet belongs to the visual viewport even when a short shelf sits near the header. */
import assert from 'node:assert/strict';

export async function checkMobileLibrarySheet(h, browser = h.browser) {
  const viewport = {width:390,height:844};
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await h.call('test_reset');
    const page = await browser.newPage({viewport, isMobile:true, hasTouch:true, reducedMotion,
      userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'});
    try {
      await page.routeWebSocket('**', socket=>socket.close());
      await h.fixture(page,'ocean');
      await page.addInitScript(() => {
        localStorage.setItem('lexicue-onboarding-v1','{"version":1,"status":"skipped"}');
        document.addEventListener('DOMContentLoaded',()=>{
          document.documentElement.style.setProperty('--safe-top','47px');
          document.documentElement.style.setProperty('--safe-bottom','34px');
        }, {once:true});
        sessionStorage.setItem('lexicue-library-view:v1',JSON.stringify({placement:{width:390,height:844,bottomGap:450}}));
      });
      const panel = page.locator('.library-overlay-panel');
      const assertAnchored = async () => {
        await panel.waitFor();
        await panel.evaluate(async node => {
          await Promise.all(node.getAnimations().map(a=>a.finished.catch(()=>{})));
          const bounds=node.getBoundingClientRect(), layer=node.closest('.library-overlay-layer').getBoundingClientRect();
          if (Math.abs(bounds.bottom-(layer.bottom-34))>1 || bounds.top < layer.top+47-1) {
            throw Error(`sheet top/bottom ${bounds.top}/${bounds.bottom}, viewport ${layer.top}/${layer.bottom}, layer ${node.parentElement.className}, safe bottom ${getComputedStyle(node).getPropertyValue('--safe-bottom')}`);
          }
        });
        assert.equal(await page.evaluate(()=>window.scrollY),0);
      };
      await page.goto(h.url+'/files?view=library');
      await page.locator('.mobile-startup').waitFor({state:'detached'});
      await assertAnchored();
      await page.keyboard.press('Escape');
      await panel.waitFor({state:'detached'});
      await page.waitForFunction(()=>document.activeElement?.matches('button[data-guide="import"]'));

      // A successful batch takes the user to the library after they dismiss the result.
      await page.getByRole('button',{name:'导入',exact:true}).click();
      await page.evaluate(()=>{window.__uiFiles={
        '/fixture/first.srt':'1\n00:00:01,000 --> 00:00:02,000\nFirst material.\n',
        '/fixture/second.srt':'1\n00:00:02,000 --> 00:00:03,000\nSecond material.\n',
      };});
      await page.getByRole('button',{name:'选择文件',exact:true}).click();
      await page.getByRole('button',{name:/^确认导入/}).click();
      await page.getByText('已导入 2 份材料',{exact:true}).waitFor();
      await page.keyboard.press('Escape');
      await page.locator('.lc-import-modal').waitFor({state:'detached'});
      await assertAnchored();
      assert.equal(await panel.evaluate(n=>n.contains(document.activeElement)),true);
      const background = page.locator('.reading-stage-page > .materials-scroll');
      const previousScroll = await background.evaluate(n=>n.scrollTop);

      await page.getByRole('searchbox').focus();
      await page.evaluate(()=>{
        // Playwright's mobile viewport does not open an OS keyboard. Exercise
        // the resize + pan signal supplied by WKWebView with an active editor.
        Object.defineProperty(visualViewport,'height',{configurable:true,value:440});
        Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:22});
        visualViewport.dispatchEvent(new Event('resize'));
      });
      await page.waitForFunction(()=>document.documentElement.dataset.keyboardOpen==='true');
      await assertAnchored();
      await page.evaluate(()=>{
        delete visualViewport.height; delete visualViewport.offsetTop;
        visualViewport.dispatchEvent(new Event('resize'));
      });
      await page.waitForFunction(()=>document.documentElement.dataset.keyboardOpen==='false');
      await assertAnchored();
      // During dismissal, including a reduced-motion instant dismissal,
      // the sheet must never travel upward from its resting edge.
      const frames = page.evaluate(() => new Promise(resolve => {
        const sheet = document.querySelector('.library-overlay-panel');
        const top = sheet.getBoundingClientRect().top;
        const positions = [];
        function sample() {
          if (!sheet.isConnected) { resolve({top,positions}); return; }
          positions.push(sheet.getBoundingClientRect().top);
          requestAnimationFrame(sample);
        }
        sample();
      }));
      await page.keyboard.press('Escape');
      await panel.waitFor({state:'detached'});
      const exit = await frames;
      assert.ok(exit.positions.every(y=>y >= exit.top-1), 'closing sheet moved above its original position');
      await page.waitForFunction(()=>document.activeElement?.matches('.desk-library-dock'));
      assert.equal(await background.evaluate(n=>n.scrollTop),previousScroll);
      await page.locator('.desk-library-dock').click();
      await assertAnchored();
      for (const size of [{width:667,height:375},{width:844,height:390},{width:932,height:430}]) {
        await page.setViewportSize(size);
        await assertAnchored();
      }
      await page.keyboard.press('Escape');
      await panel.waitFor({state:'detached'});
      console.log(`PASS mobile library viewport, batch import, keyboard geometry and focus (${browser.browserType().name()}, ${reducedMotion})`);
    } finally { await page.close(); }
  }

  // A mouse-driven desktop at the identical landscape width retains dock alignment.
  const desktop = await browser.newPage({viewport:{width:844,height:390},isMobile:false,hasTouch:false});
  try {
    await h.fixture(desktop,'ocean');
    await desktop.addInitScript(()=>localStorage.setItem('lexicue-onboarding-v1','{"version":1,"status":"skipped"}'));
    await desktop.goto(h.url+'/files');
    await desktop.locator('.desk-library-dock').click();
    const layer = desktop.locator('.library-overlay-layer');
    await layer.waitFor();
    assert.equal(await layer.evaluate(n=>n.classList.contains('is-mobile-sheet')),false);
    await desktop.waitForFunction(()=>document.querySelector('.library-overlay-layer')?.style.getPropertyValue('--library-bottom-gap'));
    await desktop.setViewportSize({width:700,height:500});
    await desktop.locator('.library-overlay-layer.is-mobile-sheet').waitFor();
    assert.equal(await layer.evaluate(n=>n.style.paddingBottom),'');
  } finally { await desktop.close(); }
}
