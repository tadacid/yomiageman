import { findDialoguePanel, mainTextBands, isColoredInk } from './reader-core.js?v=5';
import { toModelInput } from './ocr-codec.js?v=5';

// Estimate a small camera rotation by finding the strongest horizontal text rows.
export function textAngle({ data, width, height }) {
  const points = [];
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const i = (y * width + x) * 4;
    if (x > width*.025 && x < width*.91 && y > height*.08 && y < height*.92 && Math.max(data[i], data[i+1], data[i+2]) < 140) points.push([x - width / 2, y - height / 2]);
  }
  if (points.length < 40) return 0;
  const extent = Math.ceil(height + width * .2), scores = [];
  for (let angle = -7; angle <= 7; angle += .5) {
    const a = angle * Math.PI / 180, rows = new Uint32Array(extent * 2);
    for (const [x,y] of points) rows[Math.round((y * Math.cos(a) - x * Math.sin(a)) / 2) + extent]++;
    scores.push({ angle, score: rows.reduce((sum,n) => sum+n*n, 0) });
  }
  const best = scores.reduce((a,b) => a.score > b.score ? a : b);
  const zero = scores.find(s => s.angle === 0);
  return best.score > zero.score * 1.08 ? best.angle : 0;
}
// Pale colours (balloon outline, sky, the orange "next" arrow) are not text.
// Dark coloured words are: keep them as ink with the coverage of black text.
export function inkGray(r, g, b) {
  if (Math.max(r,g,b)-Math.min(r,g,b)<=45) return Math.round((r+g+b)/3);
  return isColoredInk(r,g,b) ? Math.min(r,g,b) : 255;
}
// Judge the ratio among letters only. Punctuation, "ー" and ellipses ("……"
// becomes "......" after NFKC) are common in short lines and are not noise.
export function isJapaneseText(text) {
  const japanese=(text.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]/gu)??[]).length;
  const letters=(text.match(/[\p{L}\p{N}]/gu)??[]).length;
  return japanese>=2 && japanese/letters>.55;
}
// Landscape fragments that touch the crop edge are not dialogue glyphs.
export function removeEdgeInk(image) {
  const {data,width:w,height:h}=image, seen=new Uint8Array(w*h), queue=new Int32Array(w*h);
  const dark=p=>data[p*4]<185;
  for(let seed=0;seed<w*h;seed++) {
    if(seen[seed] || !dark(seed))continue;
    let head=0,tail=1,minX=w,maxX=0,minY=h,maxY=0;
    queue[0]=seed;seen[seed]=1;
    while(head<tail) {
      const p=queue[head++],x=p%w,y=Math.floor(p/w);
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const n of [x>0?p-1:-1,x<w-1?p+1:-1,y>0?p-w:-1,y<h-1?p+w:-1]) {
        if(n>=0&&!seen[n]&&dark(n)){seen[n]=1;queue[tail++]=n;}
      }
    }
    if(minX===0||minY===0||maxX===w-1||maxY===h-1||maxX-minX>w*.15||maxY-minY>h*.45) {
      for(let k=0;k<tail;k++){const i=queue[k]*4;data[i]=data[i+1]=data[i+2]=255;}
    }
  }
  return image;
}
export class LocalReader {
  constructor(onProgress = () => {}) {
    this.onProgress = onProgress;
    for (const name of ['small','crop','cleaned','rotated','line']) this[name] = document.createElement('canvas');
    this.pending = new Map(); this.serial = 0;
  }
  async ready() {
    if (!this.loading) this.loading = this.initialize().catch(error => {
      this.worker?.terminate(); this.worker = null; this.loading = null; throw error;
    });
    return this.loading;
  }
  async initialize() {
    this.onProgress({ status: 'loading language traineddata', progress: 0 });
    this.worker = new Worker(new URL('./ocr-worker.js?v=5', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id); clearTimeout(pending.timeout);
      data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.result);
    };
    this.worker.onerror = () => this.fail(new Error('文字認識エンジンを開始できませんでした。'));
    await this.request({ type: 'init' });
    this.onProgress({ status: 'initializing api', progress: 1 });
  }
  fail(error) {
    for (const p of this.pending.values()) { clearTimeout(p.timeout); p.reject(error); }
    this.pending.clear(); this.worker?.terminate(); this.worker = null; this.loading = null;
  }
  request(message, transfers = []) {
    const id = ++this.serial;
    return new Promise((resolve,reject) => {
      const timeout = setTimeout(() => this.fail(new Error('文字認識が時間内に完了しませんでした。')), 120000);
      this.pending.set(id, { resolve,reject,timeout });
      this.worker.postMessage({ ...message,id }, transfers);
    });
  }
  detect(frame) {
    const scale = Math.min(1, 640 / frame.width);
    this.small.width = Math.round(frame.width * scale); this.small.height = Math.round(frame.height * scale);
    const ctx = this.small.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(frame, 0, 0, this.small.width, this.small.height);
    return findDialoguePanel(ctx.getImageData(0, 0, this.small.width, this.small.height));
  }
  prepare(frame, panel) {
    const box = { x: Math.round((panel.x + panel.width * .045) * frame.width),
      y: Math.round((panel.y + panel.height * .025) * frame.height),
      width: Math.round(panel.width * .87 * frame.width), height: Math.round(panel.height * .965 * frame.height) };
    const scale = Math.min(2, 1100 / box.width);
    this.crop.width = Math.round(box.width * scale); this.crop.height = Math.round(box.height * scale);
    const ctx = this.crop.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(frame, box.x, box.y, box.width, box.height, 0, 0, this.crop.width, this.crop.height);
    const pixels = ctx.getImageData(0, 0, this.crop.width, this.crop.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = inkGray(pixels.data[i],pixels.data[i+1],pixels.data[i+2]);
      pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=gray;
    }
    removeEdgeInk(pixels);
    ctx.putImageData(pixels,0,0);
    const angle = textAngle(pixels);
    this.rotated.width=this.crop.width; this.rotated.height=this.crop.height+Math.ceil(this.crop.width*.14);
    const rot=this.rotated.getContext('2d',{willReadFrequently:true});
    rot.fillStyle='#fff';rot.fillRect(0,0,this.rotated.width,this.rotated.height);
    rot.translate(this.rotated.width/2,this.rotated.height/2);rot.rotate(-angle*Math.PI/180);
    rot.drawImage(this.crop,-this.crop.width/2,-this.crop.height/2);rot.setTransform(1,0,0,1,0,0);
    const corrected=rot.getImageData(0,0,this.rotated.width,this.rotated.height);
    const bands=mainTextBands(corrected);
    this.diagnostics={box,scale,bands,angle};
    const lines=[];
    this.cleaned.width=1100;this.cleaned.height=Math.max(1,bands.length*100);
    const preview=this.cleaned.getContext('2d');preview.fillStyle='#fff';preview.fillRect(0,0,1100,this.cleaned.height);
    for(const band of bands){
      let left=corrected.width,right=0;
      for(let y=band.y;y<band.y+band.height;y++) for(let x=0;x<corrected.width;x++) {
        if(corrected.data[(y*corrected.width+x)*4]<140){left=Math.min(left,x);right=Math.max(right,x);}
      }
      if(right<=left) continue;
      // Keep anti-aliased glyph edges outside the dark row mask. The mask
      // locates ink; it must not become a hard clipping rectangle for OCR.
      const padding=Math.max(2,Math.round(band.height*.16));
      const top=Math.max(0,band.y-padding), bottom=Math.min(corrected.height,band.y+band.height+padding);
      const x=Math.max(0,left-padding), rightEdge=Math.min(corrected.width,right+1+padding);
      const variants=[];
      // Keep both small-kana proportions and fine strokes. The worker checks
      // two scales, using the middle scale only when their readings differ.
      for (const inkHeight of [14,18,16]) {
        const ratio=inkHeight/band.height;
        const width=Math.min(1600,Math.max(32,Math.ceil((rightEdge-x)*ratio)+16));
        this.line.width=width;this.line.height=48;
        const out=this.line.getContext('2d',{willReadFrequently:true});
        out.imageSmoothingQuality='high';
        out.fillStyle='#fff';out.fillRect(0,0,width,48);
        const lineHeight=(bottom-top)*ratio;
        out.drawImage(this.rotated,x,top,rightEdge-x,bottom-top,8,(48-lineHeight)/2,width-16,lineHeight);
        if (!variants.length) preview.drawImage(this.line,0,lines.length*100,this.line.width,this.line.height);
        variants.push({width,data:toModelInput(out.getImageData(0,0,width,48))});
      }
      lines.push({variants});
    }
    return lines;
  }
  async recognize(frame) {
    const panel=this.detect(frame);
    if(!panel) return {panel:null,text:'',confidence:0};
    const lines=this.prepare(frame,panel);
    if(!lines.length) return {panel,text:'',confidence:0};
    await this.ready();
    const results=await this.request({type:'recognize',lines},lines.flatMap(l=>l.variants.map(v=>v.data.buffer)));
    const confidence=Math.min(...results.map(r=>r.confidence));
    const rawText=results.map(r=>r.text).join('\n');
    const text=rawText;
    const accepted=confidence>=80 && isJapaneseText(text);
    return {panel,text:accepted?text:'',rawText:accepted?rawText:'',confidence};
  }
}
