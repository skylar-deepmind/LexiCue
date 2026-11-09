import {expect,it} from 'vitest';
import {createLookupScrollMotion} from '../lookupMotion';
it('decelerates into place, retargets without jumping and cancels on manual input',()=>{
  let time=0,id=0;const callbacks=new Map<number,FrameRequestCallback>();
  const tick=(ms:number)=>{time+=ms;const jobs=[...callbacks.values()];callbacks.clear();jobs.forEach(f=>f(time));};
  const port={scrollTop:0,scrollHeight:2000,clientHeight:500};
  const motion=createLookupScrollMotion(port,{now:()=>time,request:f=>{callbacks.set(++id,f);return id;},cancel:i=>{callbacks.delete(i);}});
  motion.move(400);expect(port.scrollTop).toBe(0);
  tick(90);const first=port.scrollTop;tick(90);const second=port.scrollTop-first;
  expect(first).toBeGreaterThan(second);expect(port.scrollTop).toBeLessThan(400);
  const before=port.scrollTop;motion.move(700);expect(port.scrollTop).toBe(before);
  tick(360);expect(port.scrollTop).toBe(700);
  motion.move(1000);tick(90);const interrupted=port.scrollTop;motion.cancel();tick(360);expect(port.scrollTop).toBe(interrupted);
  motion.move(99999,true);expect(port.scrollTop).toBe(1500);
});
