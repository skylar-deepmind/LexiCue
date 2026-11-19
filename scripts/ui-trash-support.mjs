/** Actual browser pointer/touch input; only the destructive native boundary may be controlled. */
export async function keyboardTrash(page,source,{cancel=false}={}){
 await source.focus();await source.press('Delete');const basket=page.locator('.trash-drop-target');await basket.waitFor();
 if(cancel)await page.keyboard.press('Escape');else await basket.press('Enter');
 await page.locator('.trash-drag-layer').waitFor({state:'detached'});
}
export async function pointerTrash(page,source,{cancel=false,touch=false}={}){
 await source.scrollIntoViewIfNeeded();const point=await source.evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.left+r.width*.5,y:Math.max(100,Math.min(innerHeight-130,r.top+r.height*.5))};});
 const cdp=touch?await page.context().newCDPSession(page):null;
 const send=async(type,x,y)=>cdp?cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id:1}]}):type==='touchStart'?(await page.mouse.move(x,y),page.mouse.down()):type==='touchEnd'?page.mouse.up():page.mouse.move(x,y,{steps:8});
 await send('touchStart',point.x,point.y);const basket=page.locator('.trash-drop-target');await basket.waitFor();
 const r=await basket.boundingBox(),end=cancel?{x:18,y:120}:{x:r.x+r.width/2,y:r.y+r.height/2};
 await send('touchMove',end.x,end.y);
 if(!cancel)await page.waitForFunction(()=>document.querySelector('.trash-drop-target')?.dataset.open==='true');
 await send('touchEnd',end.x,end.y);await page.locator('.trash-drag-layer').waitFor({state:'detached'});await cdp?.detach();
}
