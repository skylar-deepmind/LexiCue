// Sample the two actual chapter images. A fixed field makes the same scroll position
// produce the same grain pattern when the reader reverses direction.
export function createDissolve(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  const samples = new Map<string, Uint16Array>();
  const shades: string[][] = Array.from({length:5}, () => []);
  const cols = 126;
  let rows = 0;
  let drift: {x:number; y:number; size:number}[] = [];

  function resize(width:number, height:number) {
    const ratio = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
    if (canvas.width === w && canvas.height === h && rows) return;
    canvas.width = w;
    canvas.height = h;
    rows = Math.max(2, Math.round(cols*h/w));
    samples.clear();
    let seed = 74081;
    const random = () => ((seed = Math.imul(seed,1664525) + 1013904223 | 0) >>> 0) / 4294967296;
    drift = Array.from({length:cols*rows}, () => ({
      x:(random()-.5)*.21, y:(random()-.55)*.49, size:.16+random()*.43
    }));
  }
  function colors(still: HTMLImageElement) {
    const key = still.src;
    if (samples.has(key)) return samples.get(key);
    if (!still.complete || !still.naturalWidth) return;
    const sample = document.createElement('canvas');
    sample.width = cols; sample.height = rows;
    const ctx = sample.getContext('2d', {willReadFrequently:true});
    if (!ctx) return;
    ctx.drawImage(still, 0, 0, cols, rows);
    const pixels = ctx.getImageData(0,0,cols,rows).data;
    // Quantized colors share their five lighting levels across grains and chapters.
    const result = new Uint16Array(cols*rows);
    for(let i=0;i<result.length;i++){
      const r=pixels[i*4]>>3, g=pixels[i*4+1]>>3, b=pixels[i*4+2]>>3;
      const color = r<<10 | g<<5 | b;
      result[i]=color;
      if(shades[0][color]) continue;
      for(let level=0;level<shades.length;level++){
        const light=level*.055;
        shades[level][color]='rgb('+Math.round(r*8.22*(1-light)+190*light)+','+
          Math.round(g*8.22*(1-light)+220*light)+','+Math.round(b*8.22*(1-light)+243*light)+')';
      }
    }
    samples.set(key,result);
    return result;
  }
  function paint(from: HTMLImageElement, to: HTMLImageElement, t:number) {
    if (!context) return false;
    const box = canvas.getBoundingClientRect();
    resize(box.width,box.height);
    const a = colors(from), b = colors(to);
    if (!a || !b) return false;
    const w = canvas.width, h = canvas.height;
    const scatter = Math.sin(Math.PI*t);
    const step = w/cols;
    const lighting = Math.round(scatter*4);
    context.clearRect(0,0,w,h);
    for (let i=0;i<drift.length;i++) {
      const col = i%cols, row = Math.floor(i/cols), grain = drift[i];
      const curl = Math.sin(row/rows*5+col/cols*3+t*2);
      const x = (col+.5)*step + (grain.x+.06*curl)*w*scatter;
      const y = (row+.5)*h/rows + (grain.y+.05*Math.sin(col/cols*8))*h*scatter;
      const side = step*(1-scatter + scatter*grain.size);
      context.fillStyle = shades[lighting][t < .3+grain.size*.62 ? a[i] : b[i]];
      context.fillRect(x-side/2,y-side/2,side,side);
    }
    return true;
  }
  return {paint};
}
