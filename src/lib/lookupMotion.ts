interface Port {scrollTop:number;scrollHeight:number;clientHeight:number}
interface Clock {request:(callback:FrameRequestCallback)=>number;cancel:(id:number)=>void;now:()=>number}

/** Retarget from the visible position, then decelerate without a terminal jump. */
export function createLookupScrollMotion(port:Port,clock:Clock={request:callback=>requestAnimationFrame(callback),cancel:id=>cancelAnimationFrame(id),now:()=>performance.now()}) {
  let frame=0;
  const cancel=()=>{if(frame)clock.cancel(frame);frame=0;};
  return {cancel,move(destination:number,reduced=false){
    cancel();const from=port.scrollTop,to=Math.max(0,Math.min(destination,Math.max(0,port.scrollHeight-port.clientHeight)));
    if(reduced||Math.abs(to-from)<1){port.scrollTop=to;return;}
    const start=clock.now();
    const step=(time:number)=>{frame=0;const t=Math.min(1,Math.max(0,(time-start)/360));port.scrollTop=from+(to-from)*(1-(1-t)**4);if(t<1)frame=clock.request(step);};
    frame=clock.request(step);
  }};
}
