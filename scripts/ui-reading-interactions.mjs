/** User-reported reading regressions: trusted pointer input, delayed real-core
 * queries and an isolated SQLite database. No user profile is opened. */
export async function checkReadingInteractions({page,theme,take,call,ok,eq,settle,output}) {
 const term=text=>page.locator('.reading-word').filter({hasText:new RegExp(`^${text}$`)}).first();
 const ready=async text=>{await page.locator('.lookup-heading h2').filter({hasText:new RegExp(`^${text}$`)}).waitFor();await page.locator('.lookup-stage[data-lookup-state="ready"]').waitFor();};
 const close=async()=>{await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});};
 const blank=async point=>{await take.click();await ready('take');await settle(page);await page.evaluate(()=>Promise.allSettled(document.querySelector('.workspace-paper').getAnimations().map(a=>a.finished)));const p=await point();ok(await page.evaluate(({x,y})=>!document.elementFromPoint(x,y)?.closest('button,a,input,label,summary,textarea,.context-panel'),p),`${theme}: dismissal point is genuinely unused space`);await page.mouse.click(p.x,p.y);await page.locator('.context-panel').waitFor({state:'detached'});};
 eq(await page.locator('.b-dock .b-dock-control').allTextContents(),['','','',''],`${theme}: dock has no permanent text`);
 eq(await page.locator('.b-dock .b-dock-control').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))),['材料','已保存','导入','设置'],`${theme}: icon tasks retain accessible names`);
 ok(await page.locator('.b-dock .b-dock-control').evaluateAll(nodes=>nodes.every(n=>{const r=n.getBoundingClientRect();return r.width>=44&&r.height>=44;})),`${theme}: icon targets remain large enough`);
 await close();const initial=await take.boundingBox();await page.mouse.click(initial.x+initial.width/2,initial.y+initial.height/2,{clickCount:3,delay:35});await page.locator('.context-panel').waitFor();await settle(page);
 eq(await page.locator('.reading-word[aria-pressed="true"]').count(),1,`${theme}: triple-click opening never selects an entire sentence`);
 eq(await page.evaluate(()=>getSelection()?.toString()),'',`${theme}: triple-click opening has no native selection`);
 await take.click();await ready('take');
 for(const clickCount of [2,3,4]){
  await take.click({clickCount,delay:30});await ready('take');
  eq(await page.evaluate(()=>getSelection()?.toString()),'',`${theme}: ${clickCount} clicks leave no browser selection`);
  eq(await page.locator('.reading-word[aria-pressed="true"]').count(),1,`${theme}: ${clickCount} clicks select only the intended word`);
 }
 // Genuine text dragging still looks up the complete continuous phrase.
 const edges=await page.evaluate(()=>{const words=[...document.querySelectorAll('[data-sentence="0"] .reading-word')];const a=words.find(n=>n.textContent==='take'),b=words.find(n=>n.textContent==='off');const ra=new Range(),rb=new Range();ra.selectNodeContents(a);rb.selectNodeContents(b);const x=ra.getBoundingClientRect(),y=rb.getBoundingClientRect();return{from:{x:x.left+.1,y:x.top+x.height/2},to:{x:y.right-.1,y:y.top+y.height/2}};});
 await page.mouse.move(edges.from.x,edges.from.y);await page.mouse.down();await page.mouse.move(edges.to.x,edges.to.y,{steps:12});await page.mouse.up();await ready('take off');
 eq(await page.locator('.reading-word[aria-pressed="true"]').count(),2,`${theme}: drag keeps both words in the continuous phrase`);
 eq(await page.evaluate(()=>getSelection()?.toString()),'',`${theme}: drag result uses the app highlight without a second browser highlight`);
 await page.mouse.move(edges.to.x,edges.to.y);await page.mouse.down();await page.mouse.move(edges.from.x,edges.from.y,{steps:12});await page.mouse.up();await ready('take off');
 eq(await page.locator('.reading-word[aria-pressed="true"]').count(),2,`${theme}: reverse dragging keeps the same complete phrase`);
 await take.evaluate(n=>n.addEventListener('pointerdown',event=>n.setPointerCapture(event.pointerId),{once:true}));
 await page.mouse.move(edges.from.x,edges.from.y);await page.mouse.down();await page.mouse.move(edges.to.x,edges.to.y,{steps:12});await page.mouse.up();await ready('take off');
 eq(await page.locator('.reading-word[aria-pressed="true"]').count(),2,`${theme}: captured pointer still resolves the word under the cursor`);
 const next=await term('noon').boundingBox();await page.mouse.move(edges.from.x,edges.from.y);await page.mouse.down();await page.mouse.move(next.x+next.width/2,next.y+next.height/2,{steps:12});await page.mouse.up();
 eq(await page.locator('.lookup-heading h2').innerText(),'take off',`${theme}: dragging across source sentences does not invent a phrase`);
 await close();
 // A broad set of blanks, including the header and gaps inside the paper.
 for(const point of [()=>({x:12,y:110}),()=>({x:110,y:400}),()=>({x:900,y:35}),()=>page.locator('.reading-sentence').first().evaluate(n=>{const r=n.getBoundingClientRect();return{x:r.left+70,y:r.bottom+10};}),()=>page.locator('.sentence-side small').first().evaluate(n=>{const r=n.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})])await blank(point);
 await take.click();await ready('take');await settle(page);
 await page.locator('.reader-tools input').click();eq(await page.locator('.context-panel').count(),1,`${theme}: translation control is not treated as blank`);await page.locator('.reader-tools input').click();
 await page.getByRole('button',{name:'调整学习内容显示',exact:true}).click();await page.locator('.adaptive-menu--popover p').last().click();eq(await page.locator('.context-panel').count(),1,`${theme}: explanatory space inside a functional menu keeps the card open`);await page.keyboard.press('Escape');
 await page.locator('.lookup-heading > small').click();eq(await page.locator('.context-panel').count(),1,`${theme}: internal card whitespace does not dismiss`);
 // Keep the same frame and old readable page until a slow query is ready.
 await term('noon').click();await ready('noon');
 await page.evaluate(()=>{window.__readingFrame=document.querySelector('.context-panel');window.__readingFrameStarts=0;window.__readingFrame.addEventListener('animationstart',event=>{if(event.target===window.__readingFrame)window.__readingFrameStarts++;});});
 const bounds=await page.locator('.context-panel').boundingBox();
 const oldMeaning=await page.locator('.lookup-meaning').innerText();const beforeSave=(await call('list_saved_records',{query:'',limit:100,offset:0})).length;
 await page.evaluate(()=>window.__uiDelayLookup=true);await take.click();await page.locator('.lookup-stage[data-lookup-state="pending"]').waitFor();
 eq(await page.locator('.lookup-heading h2').innerText(),'noon',`${theme}: pending lookup keeps the previous labeled page`);
 eq(await page.locator('.lookup-meaning').innerText(),oldMeaning,`${theme}: pending lookup does not flash empty meaning`);
 eq(await page.locator('.lookup-content').evaluate(n=>n.inert),true,`${theme}: stale page cannot be edited or saved while waiting`);
 const footer=await page.locator('.lookup-footer').boundingBox();await page.mouse.click(footer.x+footer.width/2,footer.y+footer.height/2);
 eq((await call('list_saved_records',{query:'',limit:100,offset:0})).length,beforeSave,`${theme}: clicking a stale footer creates no save`);
 await term('plane').click();await ready('plane');await page.waitForTimeout(430);
 eq(await page.locator('.lookup-heading h2').innerText(),'plane',`${theme}: late slow result never replaces the latest word`);
 ok(await page.locator('.context-panel').evaluate(n=>n===window.__readingFrame),`${theme}: consecutive words reuse the same card frame`);
 eq(await page.locator('.context-panel').boundingBox(),bounds,`${theme}: switching words preserves card geometry`);
 eq(await page.evaluate(()=>window.__readingFrameStarts),0,`${theme}: switching words never replays frame entry`);
 await take.click();await ready('take');eq(await page.locator('.lookup-content').evaluate(n=>n.inert),false,`${theme}: ready page becomes interactive`);
 await page.evaluate(()=>window.__uiDelayLookup=false);
 // Starting a fresh query also cancels a close already in progress.
 await page.evaluate(()=>window.__lexicueBack());const current=await take.boundingBox();await page.mouse.click(current.x+current.width/2,current.y+current.height/2);await page.waitForTimeout(380);
 eq(await page.locator('.context-panel').count(),1,`${theme}: reactivating the word cancels an in-flight close`);
 eq(await page.locator('.context-layer--closing').count(),0,`${theme}: cancelled close does not leave a closing layer`);
 await close();
 await take.click();await ready('take');await take.focus();await page.keyboard.down('Shift');await page.keyboard.press('ArrowRight');await page.keyboard.press('Escape');await page.locator('.context-panel').waitFor({state:'detached'});await page.keyboard.up('Shift');
 eq(await page.locator('.reading-word[aria-pressed="true"]').count(),0,`${theme}: dismissal also clears an unfinished keyboard range`);
 eq(await page.locator('.context-panel').count(),0,`${theme}: late modifier release does not reopen the dismissed query`);
 await page.emulateMedia({reducedMotion:'reduce'});await take.click();await ready('take');await term('plane').click();await ready('plane');
 eq(await page.locator('.lookup-content').evaluate(n=>n.getAnimations().length),0,`${theme}: reduced motion disables content handoff`);await close();await page.emulateMedia({reducedMotion:'no-preference'});
 // Match the user's 1100px desktop as well as the existing responsive suite.
 await page.setViewportSize({width:1100,height:720});await take.click();await ready('take');await settle(page);await page.screenshot({path:`${output}/${theme}-1100-interactions.png`});await close();await page.setViewportSize({width:1440,height:900});
 await take.click();await ready('take');await settle(page);
 console.log(`Reading interaction regressions passed: ${theme}`);
}
