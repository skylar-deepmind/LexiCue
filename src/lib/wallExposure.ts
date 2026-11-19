import type { Box, Entrance, Piece } from './readingMotion';

const ease=(a:number,b:number,t:number)=>{const v=Math.max(0,Math.min(1,(t-a)/(b-a)));return v*v*(3-2*v);};
function texture(data:Entrance){
 const source=data.cover,image=source?.image;if(!source||!image?.naturalWidth)return null;
 const r=data.card,canvas=document.createElement('canvas'),scale=Math.min(2,640/r.width);canvas.width=Math.max(1,Math.round(r.width*scale));canvas.height=Math.max(1,Math.round(r.height*scale));
 const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return null;
 try{
  ctx.scale(scale,scale);ctx.fillStyle='#fff9e6';ctx.fillRect(0,0,r.width,r.height);
  const imageBox=source.box,k=(source.fit==='contain'?Math.min:Math.max)(imageBox.width/image.naturalWidth,imageBox.height/image.naturalHeight);
  ctx.save();ctx.beginPath();ctx.rect(imageBox.x-r.x,imageBox.y-r.y,imageBox.width,imageBox.height);ctx.clip();ctx.drawImage(image,imageBox.x-r.x+(imageBox.width-image.naturalWidth*k)/2,imageBox.y-r.y+(imageBox.height-image.naturalHeight*k)/2,image.naturalWidth*k,image.naturalHeight*k);ctx.restore();
  if(data.plate){ctx.fillStyle=data.plate.color;const p=data.plate.box;ctx.fillRect(p.x-r.x,p.y-r.y,p.width,p.height);}
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height),v=pixels.data,luma=new Uint8Array(canvas.width*canvas.height),w=canvas.width,h=canvas.height;
  for(let i=0;i<luma.length;i++)luma[i]=.23*v[4*i]+.64*v[4*i+1]+.13*v[4*i+2];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=y*w+x,dx=luma[y*w+Math.min(w-1,x+1)]-luma[y*w+Math.max(0,x-1)],dy=luma[Math.min(h-1,y+1)*w+x]-luma[Math.max(0,y-1)*w+x],edge=Math.min(1,(Math.abs(dx)+Math.abs(dy))/76),tone=(255-luma[p])/255;v[4*p]=240-42*tone-122*edge;v[4*p+1]=225-44*tone-113*edge;v[4*p+2]=192-44*tone-92*edge;}
  ctx.putImageData(pixels,0,0);return canvas;
 }catch{return null;}
}

/** Prototype exposure: contours stay on the selected print; only one short line travels. */
export function playWallExposure(data:Entrance,paper:HTMLElement,layer:HTMLElement,reverse:boolean,words:Piece[],wordNodes:HTMLElement[],paperBox:Box,liveReader:HTMLElement|null){
 const r=data.card,art=data.cover?.box??r,wall=data.wall??{x:0,y:0,width:innerWidth,height:innerHeight};
 const left=Math.max(r.x,wall.x),right=Math.min(r.x+r.width,wall.x+wall.width),cx=Math.max(left+2,Math.min(right-2,art.x+art.width*.5)),cy=art.y+art.height*.5;
 const jobs:Animation[]=[],options:KeyframeAnimationOptions={duration:1320,fill:'both',easing:'linear',direction:reverse?'reverse':'normal'},samples=Array.from({length:81},(_,i)=>i/80);
 const animate=(node:Element,frames:Keyframe[])=>{const job=node.animate(frames,options);jobs.push(job);};
 // The wall and reader share one moving back arrow throughout the exposure.
 // Their snapshots must not paint two different arrows through the light mask.
 const backRestores:(()=>void)[]=[];
 const paperBack=paper.querySelector<HTMLElement>('.reading-breadcrumb .page-back');
 const wallBack=document.querySelector<HTMLElement>('.app-layout .approved-wall > header > button');
 const from=reverse&&wallBack?wallBack.getBoundingClientRect():data.back?.box;
 const to=paperBack?.getBoundingClientRect();
 layer.querySelectorAll<HTMLElement>('.approved-wall > header > button').forEach(node=>{node.style.visibility='hidden';});
 if(paperBack)paperBack.style.visibility='hidden';
 if(wallBack){const visibility=wallBack.style.visibility;wallBack.style.visibility='hidden';backRestores.push(()=>{wallBack.style.visibility=visibility;});}
 if(data.back&&from&&to){
  const arrow=data.back.node.cloneNode(true) as HTMLElement;arrow.dataset.motionPiece='shared-back';
  Object.assign(arrow.style,{position:'absolute',left:`${from.x}px`,top:`${from.y}px`,width:`${from.width}px`,height:`${from.height}px`,margin:'0',translate:'none',transform:'none',zIndex:'6',visibility:'visible'});layer.append(arrow);
  arrow.querySelectorAll<SVGElement>('svg,svg *').forEach(node=>{node.style.color='inherit';node.style.stroke='currentColor';});
  const rgb=(value:string)=>(value.match(/[\d.]+/g)??['0','0','0']).slice(0,3).map(Number),a=rgb(data.back.node.style.color),b=rgb(getComputedStyle(paperBack!).color);
  animate(arrow,samples.map(t=>{const p=ease(.6,.94,t);return {offset:t,color:`rgb(${a.map((v,i)=>Math.round(v+(b[i]-v)*p)).join(',')})`,transform:`translate(${(to.x-from.x)*p}px,${(to.y-from.y)*p}px)`};}));
 }
 const ink=texture(data);if(ink){ink.dataset.motionPiece='contours';Object.assign(ink.style,{position:'absolute',left:`${r.x}px`,top:`${r.y}px`,width:`${r.width}px`,height:`${r.height}px`,zIndex:'1',clipPath:`inset(${Math.max(0,wall.y-r.y)}px ${Math.max(0,r.x+r.width-wall.x-wall.width)}px ${Math.max(0,r.y+r.height-wall.y-wall.height)}px ${Math.max(0,wall.x-r.x)}px)`});layer.append(ink);
  animate(ink,samples.map(t=>{const radius=32+85*ease(0,.36,t);return {offset:t,opacity:ease(0,.22,t)*(1-ease(.51,.88,t)),maskImage:`radial-gradient(ellipse ${.64*r.width}px ${.68*r.height}px at ${cx-r.x}px ${cy-r.y}px,black 0%,rgba(0,0,0,.94) ${radius*.28}%,rgba(0,0,0,.68) ${radius*.64}%,transparent ${radius*1.30}%)`};}));
 }
 paper.dataset.motionPiece='exposed-paper';paper.style.zIndex='2';
 animate(paper,samples.map(t=>{const p=ease(.19,.65,t),spread=ease(.44,1,t),rx=.64*r.width,ry=.68*r.height,x=rx*(.53+.45*p)+spread*1900*innerWidth/1360,y=Math.min(ry,(cy-r.y)*.95)*(.50+.52*p)+spread*1400*innerHeight/880;let mask=t>=.995?'none':`radial-gradient(ellipse ${x}px ${y}px at ${cx-paperBox.x}px ${cy-paperBox.y}px,black 0%,rgba(0,0,0,.98) 31%,rgba(0,0,0,.79) 55%,rgba(0,0,0,.30) 81%,transparent 100%)`;if(t>.8&&t<.995){const tail=ease(.8,.995,t);mask+=`,linear-gradient(rgba(0,0,0,${tail}),rgba(0,0,0,${tail}))`;}return {offset:t,maskImage:mask,opacity:ease(.22,.53,t)};}));
 const first=words[0],last=words.at(-1);
 if(first&&last){
  const dest={...first.box,width:Math.max(first.box.width,last.box.x+last.box.width-first.box.x)},k=Math.min(.86,Math.max(48,right-left)*.82/Math.max(1,dest.width)),startX=cx-dest.width*k*.5,startY=cy-dest.height*k*.5;
  const line=document.createElement('span');line.textContent=words.map(word=>word.node.textContent).join(' ');line.dataset.motionPiece='exposed-line';Object.assign(line.style,{position:'absolute',left:'0',top:'0',width:`${dest.width}px`,height:`${dest.height}px`,font:first.node.style.font,color:first.node.style.color,lineHeight:first.node.style.lineHeight,letterSpacing:first.node.style.letterSpacing,whiteSpace:'nowrap',transformOrigin:'0 0',zIndex:'4'});layer.append(line);
  animate(line,samples.map(t=>{const p=ease(.47,.88,t);return {offset:t,transform:`translate(${startX+(dest.x-startX)*p}px,${startY+(dest.y-startY)*p}px) scale(${k+(1-k)*p})`,opacity:ease(.26,.46,t)*(1-ease(.88,.96,t))};}));
  wordNodes.forEach(node=>animate(node,samples.map(t=>({offset:t,opacity:ease(.88,.96,t)}))));
 }
 const controls=[...document.querySelectorAll<HTMLElement>('.mobile-reading-tools')].map(node=>{const r=node.getBoundingClientRect(),copy=node.cloneNode(true) as HTMLElement;Object.assign(copy.style,{position:'absolute',left:`${r.x}px`,top:`${r.y}px`,width:`${r.width}px`,height:`${r.height}px`,bottom:'auto',transform:'none',zIndex:'5'});layer.append(copy);const visibility=node.style.visibility;node.style.visibility='hidden';return {node,copy,visibility};});
 const secondary=[...paper.querySelectorAll<HTMLElement>('.reading-title,.reading-breadcrumb'),...controls.map(c=>c.copy)];
 secondary.forEach(node=>animate(node,samples.map(t=>({offset:t,opacity:ease(.64,.94,t)}))));
 if (liveReader) {
  animate(liveReader, [{opacity:0},{opacity:0,offset:.90},{opacity:1,offset:.97},{opacity:1}]);
  animate(layer, [{opacity:1},{opacity:1,offset:.92},{opacity:0}]);
 }
 const now=document.timeline.currentTime;if(typeof now==='number')jobs.forEach(job=>job.startTime=now);
 let disposed=false;const dispose=()=>{if(disposed)return;disposed=true;jobs.forEach(job=>job.cancel());delete paper.dataset.motionPiece;controls.forEach(c=>c.node.style.visibility=c.visibility);backRestores.forEach(restore=>restore());layer.remove();window.removeEventListener('resize',dispose);window.removeEventListener('pagehide',dispose);};
 window.addEventListener('resize',dispose,{once:true});window.addEventListener('pagehide',dispose,{once:true});void Promise.allSettled(jobs.map(job=>job.finished)).then(dispose);return dispose;
}
