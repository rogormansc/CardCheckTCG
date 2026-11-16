/**
 * CardCheck's small, local reference recognizer.
 *
 * This is a feature index, not a pretrained neural network. FAST corners,
 * intensity-centroid orientation and rotated binary descriptors are computed
 * from the registered reference images. A scan must also pass a geometric
 * verification step before it can produce a match. No image leaves the device.
 * Original implementation; no third-party runtime dependencies.
 */

const MODEL_VERSION = 1;
const MAX_SIDE = 720;
const SCALES = [1, 0.8, 0.64, 0.512];
const MAX_PER_LEVEL = 235;
const PATCH = 15;
const CIRCLE = [[0,-3],[1,-3],[2,-2],[3,-1],[3,0],[3,1],[2,2],[1,3],[0,3],[-1,3],[-2,2],[-3,1],[-3,0],[-3,-1],[-2,-2],[-1,-3]];
const POPCOUNT = new Uint8Array(256);
for (let i = 1; i < 256; i++) POPCOUNT[i] = POPCOUNT[i >> 1] + (i & 1);

// The fixed seed makes a saved reference index reproducible.
let patternSeed = 0x27d4eb2d;
function random() {
  patternSeed ^= patternSeed << 13;
  patternSeed ^= patternSeed >>> 17;
  patternSeed ^= patternSeed << 5;
  return (patternSeed >>> 0) / 4294967296;
}
function patchPoint() {
  let x, y;
  do {
    x = Math.round((random() + random() + random() - 1.5) * 10);
    y = Math.round((random() + random() + random() - 1.5) * 10);
  } while (x * x + y * y > 169);
  return [x, y];
}
const PATTERN = Array.from({length: 256}, () => [...patchPoint(), ...patchPoint()]);

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function canvasOf(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  return result;
}

function grayImage(source) {
  const width = source.width || source.videoWidth || source.naturalWidth;
  const height = source.height || source.videoHeight || source.naturalHeight;
  if (!width || !height) throw new Error('The image is empty. Please take another photo.');
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = canvasOf(w, h);
  const context = canvas.getContext('2d', {willReadFrequently: true});
  context.drawImage(source, 0, 0, w, h);
  const rgba = context.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = (77 * rgba[4*i] + 150 * rgba[4*i+1] + 29 * rgba[4*i+2]) >> 8;
  return {data, width: w, height: h};
}

function resizeGray(image, scale) {
  if (scale === 1) return image;
  const width = Math.round(image.width * scale), height = Math.round(image.height * scale);
  const data = new Uint8Array(width * height);
  const sx = image.width / width, sy = image.height / height;
  for (let y = 0; y < height; y++) {
    const yy = Math.min(image.height - 2, y * sy), iy = Math.floor(yy), fy = yy - iy;
    for (let x = 0; x < width; x++) {
      const xx = Math.min(image.width - 2, x * sx), ix = Math.floor(xx), fx = xx - ix;
      const p = iy * image.width + ix;
      data[y*width+x] = Math.round((1-fy)*((1-fx)*image.data[p]+fx*image.data[p+1])+fy*((1-fx)*image.data[p+image.width]+fx*image.data[p+image.width+1]));
    }
  }
  return {data, width, height};
}

function blur(image) {
  const {data, width: w, height: h} = image;
  const result = new Uint8Array(data.length);
  const temp = new Uint16Array(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 1; x < w-1; x++) temp[y*w+x] = data[y*w+x-1] + 2*data[y*w+x] + data[y*w+x+1];
  }
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) result[y*w+x] = (temp[(y-1)*w+x] + 2*temp[y*w+x] + temp[(y+1)*w+x]) >> 4;
  }
  return result;
}

function featuresAtLevel(image, scale, threshold) {
  const {data, width: w, height: h} = image;
  const scores = new Float32Array(w*h);
  const offsets = CIRCLE.map(([x,y]) => y*w+x);
  const candidates = [];
  for (let y = PATCH+2; y < h-PATCH-2; y++) {
    for (let x = PATCH+2; x < w-PATCH-2; x++) {
      const p = y*w+x, c = data[p];
      let bright = 0, dark = 0;
      for (let k = 0; k < 16; k += 4) {
        const d = data[p+offsets[k]]-c;
        if (d > threshold) bright++;
        if (d < -threshold) dark++;
      }
      if (bright < 2 && dark < 2) continue;
      let maxBright = 0, maxDark = 0, nb = 0, nd = 0, total = 0;
      for (let k = 0; k < 24; k++) {
        const d = data[p+offsets[k&15]]-c;
        nb = d > threshold ? nb+1 : 0;
        nd = d < -threshold ? nd+1 : 0;
        maxBright = Math.max(maxBright, nb);
        maxDark = Math.max(maxDark, nd);
        if (k < 16) total += Math.abs(d);
      }
      if (maxBright >= 9 || maxDark >= 9) scores[p] = total;
    }
  }
  for (let y = PATCH+2; y < h-PATCH-2; y++) {
    for (let x = PATCH+2; x < w-PATCH-2; x++) {
      const p = y*w+x, score = scores[p];
      if (!score) continue;
      if (score < scores[p-1] || score <= scores[p+1] || score < scores[p-w] || score <= scores[p+w] || score < scores[p-w-1] || score < scores[p-w+1] || score < scores[p+w-1] || score < scores[p+w+1]) continue;
      candidates.push({x,y,score});
    }
  }
  candidates.sort((a,b) => b.score-a.score);
  // Per-cell limits keep the printed text from monopolizing all features.
  const cells = new Uint8Array(8*12), selected = [], occupied = new Uint8Array(w*h);
  const softened = blur(image);
  for (const point of candidates) {
    const {x,y} = point;
    const cell = Math.min(11,Math.floor(y/h*12))*8+Math.min(7,Math.floor(x/w*8));
    if (cells[cell] >= 5 || occupied[y*w+x]) continue;
    cells[cell]++;
    for (let dy=-4;dy<=4;dy++) for (let dx=-4;dx<=4;dx++) occupied[(y+dy)*w+x+dx]=1;
    let m10=0, m01=0;
    for (let dy=-11;dy<=11;dy++) {
      const radius = Math.floor(Math.sqrt(121-dy*dy));
      for (let dx=-radius;dx<=radius;dx++) {
        const intensity = softened[(y+dy)*w+x+dx];
        m10 += dx*intensity;
        m01 += dy*intensity;
      }
    }
    const angle = Math.atan2(m01,m10), cs=Math.cos(angle), sn=Math.sin(angle);
    const descriptor = new Uint32Array(8);
    for (let bit=0;bit<256;bit++) {
      const [ax,ay,bx,by] = PATTERN[bit];
      const a = (y+Math.round(ax*sn+ay*cs))*w+x+Math.round(ax*cs-ay*sn);
      const b = (y+Math.round(bx*sn+by*cs))*w+x+Math.round(bx*cs-by*sn);
      if (softened[a] < softened[b]) descriptor[bit>>>5] |= (1 << (bit&31));
    }
    selected.push({x:x/scale,y:y/scale,angle,scale,descriptor});
    if (selected.length >= MAX_PER_LEVEL) break;
  }
  return selected;
}

export function extractFeatures(source) {
  const image = grayImage(source);
  let points = [];
  for (const scale of SCALES) points.push(...featuresAtLevel(resizeGray(image,scale),scale,17));
  return {width:image.width,height:image.height,points};
}

function hamming(a,b) {
  let n=0;
  for (let k=0;k<8;k++) {
    const x=(a[k]^b[k])>>>0;
    n+=POPCOUNT[x&255]+POPCOUNT[(x>>>8)&255]+POPCOUNT[(x>>>16)&255]+POPCOUNT[x>>>24];
  }
  return n;
}

function findMatches(reference, query) {
  const found=[];
  const distances=new Uint16Array(reference.points.length);
  for (let qi=0;qi<query.points.length;qi++) {
    const q=query.points[qi];
    let best=257, second=257, index=-1;
    for (let ri=0;ri<reference.points.length;ri++) {
      const d=hamming(q.descriptor,reference.points[ri].descriptor);
      distances[ri]=d;
      if (d<best) {best=d;index=ri;}
    }
    if(index<0) continue;
    // Nearby pyramid copies are the same location, not a meaningful
    // second-best visual alternative. Suppress them for the ratio test.
    const b=reference.points[index];
    for(let ri=0;ri<reference.points.length;ri++) {
      if(distances[ri]>=second) continue;
      const r=reference.points[ri];
      const dx=r.x-b.x,dy=r.y-b.y;
      if(dx*dx+dy*dy>81) second=distances[ri];
    }
    if (index>=0 && best<=68 && best < second*0.8) found.push({r:reference.points[index],q,distance:best,ri:index,qi});
  }
  found.sort((a,b)=>a.distance-b.distance);
  const unique=[];
  for (const match of found) {
    if (unique.some(m=>Math.hypot(m.r.x-match.r.x,m.r.y-match.r.y)<7 || Math.hypot(m.q.x-match.q.x,m.q.y-match.q.y)<7)) continue;
    unique.push(match);
  }
  return unique;
}

function solve(matrix, rhs) {
  const n=rhs.length, a=matrix.map((row,i)=>[...row,rhs[i]]);
  for(let c=0;c<n;c++) {
    let pivot=c;
    for(let r=c+1;r<n;r++) if(Math.abs(a[r][c])>Math.abs(a[pivot][c])) pivot=r;
    if(Math.abs(a[pivot][c])<1e-9) return null;
    [a[c],a[pivot]]=[a[pivot],a[c]];
    const divisor=a[c][c];
    for(let j=c;j<=n;j++) a[c][j]/=divisor;
    for(let r=0;r<n;r++) if(r!==c) {
      const f=a[r][c];
      for(let j=c;j<=n;j++) a[r][j]-=f*a[c][j];
    }
  }
  return a.map(row=>row[n]);
}

function fitHomography(matches) {
  const ata=Array.from({length:8},()=>Array(8).fill(0)), atb=Array(8).fill(0);
  for(const {r,q} of matches) {
    // Normalizing coordinates avoids unstable normal equations.
    const x=r.x/MAX_SIDE,y=r.y/MAX_SIDE,u=q.x/MAX_SIDE,v=q.y/MAX_SIDE;
    const rows=[[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]];
    for(let k=0;k<2;k++) for(let i=0;i<8;i++) {
      atb[i]+=rows[k][i]*(k?v:u);
      for(let j=0;j<8;j++) ata[i][j]+=rows[k][i]*rows[k][j];
    }
  }
  return solve(ata,atb);
}

function project(h,x,y) {
  x/=MAX_SIDE;y/=MAX_SIDE;
  const den=h[6]*x+h[7]*y+1;
  return [(h[0]*x+h[1]*y+h[2])/den*MAX_SIDE,(h[3]*x+h[4]*y+h[5])/den*MAX_SIDE];
}

function verify(matches,reference,query) {
  if(matches.length<6) return {inliers:[],homography:null,coverage:0,artInliers:0,spatialCells:0};
  let best=[],bestH=null;
  let state=0x12345678;
  const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};
  const trials=Math.min(650,80+matches.length*6);
  for(let trial=0;trial<trials;trial++) {
    // PROSAC-like early sampling gives clean, low-distance correspondences
    // priority; later iterations examine the complete match set.
    const pool=Math.min(matches.length,Math.max(8,Math.floor(8+trial/3)));
    const indices=new Set();
    while(indices.size<4) indices.add(Math.floor(next()*pool));
    const sample=[...indices].map(i=>matches[i]);
    const h=fitHomography(sample);
    if(!h) continue;
    const inliers=matches.filter(m=>{
      const [x,y]=project(h,m.r.x,m.r.y);
      return Number.isFinite(x)&&Number.isFinite(y)&&Math.hypot(x-m.q.x,y-m.q.y)<6.5;
    });
    if(inliers.length>best.length) {best=inliers;bestH=h;}
  }
  if(best.length>=6) {
    const refined=fitHomography(best);
    if(refined) {
      bestH=refined;
      best=matches.filter(m=>{
        const [x,y]=project(refined,m.r.x,m.r.y);
        return Math.hypot(x-m.q.x,y-m.q.y)<6.5;
      });
    }
  }
  const cells=new Set();
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,artInliers=0;
  for(const {r} of best) {
    const x=r.x/reference.width,y=r.y/reference.height;
    cells.add(`${Math.min(3,Math.floor(x*4))}:${Math.min(5,Math.floor(y*6))}`);
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    if(x>0.13&&x<0.87&&y>0.18&&y<0.73) artInliers++;
  }
  const coverage=best.length ? (maxX-minX)*(maxY-minY) : 0;
  // Disallow a folded or implausibly tiny/huge projected card.
  if(bestH) {
    const corners=[[0,0],[reference.width,0],[reference.width,reference.height],[0,reference.height]].map(([x,y])=>project(bestH,x,y));
    let area=0,sign=0,convex=true;
    for(let i=0;i<4;i++) {
      const a=corners[i],b=corners[(i+1)%4],c=corners[(i+2)%4];
      area+=a[0]*b[1]-b[0]*a[1];
      const cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
      if(!Number.isFinite(cross)||Math.abs(cross)<1 || (sign&&Math.sign(cross)!==sign)) convex=false;
      sign=Math.sign(cross);
    }
    const fraction=Math.abs(area/2)/(query.width*query.height);
    if(!convex||fraction<0.025||fraction>4) return {inliers:[],homography:null,coverage:0,artInliers:0,spatialCells:0};
  }
  return {inliers:best,homography:bestH,coverage,artInliers,spatialCells:cells.size};
}

function loadImage(url) {
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.crossOrigin='anonymous';
    const timer=setTimeout(()=>reject(new Error('Reference image timed out. Check your connection or upload a reference photo.')),12000);
    img.onload=()=>{clearTimeout(timer);resolve(img);};
    img.onerror=()=>{clearTimeout(timer);reject(new Error('Reference image could not be loaded. Run the setup download or upload a reference photo.'));};
    img.src=url;
  });
}

function pack(features) {
  return {width:features.width,height:features.height,points:features.points.map(p=>({x:p.x,y:p.y,angle:p.angle,scale:p.scale,descriptor:Array.from(p.descriptor)}))};
}
function unpack(features) {
  if(!features||!Number.isFinite(features.width)||!Number.isFinite(features.height)||!Array.isArray(features.points)||features.points.length>2000) throw new Error('Invalid reference model.');
  return {...features,points:features.points.map(p=>{
    if(!Array.isArray(p.descriptor)||p.descriptor.length!==8||!Number.isFinite(p.x)||!Number.isFinite(p.y)) throw new Error('Invalid reference descriptor.');
    return {...p,descriptor:new Uint32Array(p.descriptor)};
  })};
}

export class CardRecognizer {
  constructor() {this.references=[];this.failures=[];}

  async load(cards) {
    this.references=[];this.failures=[];
    const warnings=[],imageSources={};
    for(const card of cards) {
      if(card.enabled===false) continue;
      let loaded=0;
      const sources=Array.isArray(card.references)?card.references.filter(s=>typeof s==='string'&&s):[];
      const attempts=card.image?[{primary:card.image,fallback:card.sourceUrl}]:card.sourceUrl?[{primary:card.sourceUrl}]:[];
      attempts.push(...sources.map(primary=>({primary})));
      if(!attempts.length) continue;
      let lastError='No usable reference images.';
      for(let i=0;i<attempts.length;i++) {
        const attempt=attempts[i];
        let image=null,usedUrl=attempt.primary;
        try {image=await loadImage(attempt.primary);}
        catch(error) {
          lastError=error.message;
          if(attempt.fallback&&attempt.fallback!==attempt.primary) {
            try {image=await loadImage(attempt.fallback);usedUrl=attempt.fallback;}
            catch(fallbackError) {lastError=fallbackError.message;}
          }
        }
        if(!image) {warnings.push({id:card.id,error:lastError});continue;}
        try {
          const features=extractFeatures(image);
          if(features.points.length<30) throw new Error('Not enough detail in reference image.');
          this.references.push({card,features,referenceIndex:i});
          loaded++;
          if(!imageSources[card.id]) imageSources[card.id]=usedUrl;
        } catch(error) {lastError=error.message;warnings.push({id:card.id,error:lastError});}
        await tick();
      }
      if(!loaded) this.failures.push({id:card.id,error:lastError});
      await tick();
    }
    return {loaded:[...new Set(this.references.map(r=>r.card.id))],failed:this.failures,warnings,imageSources};
  }

  exportModel() {
    return {version:MODEL_VERSION,algorithm:'cardcheck-fast-rbrief-homography',maxSide:MAX_SIDE,references:this.references.map(r=>({id:r.card.id,referenceIndex:r.referenceIndex||0,features:pack(r.features)}))};
  }

  loadModel(model,cards) {
    if(model.version!==MODEL_VERSION||model.algorithm!=='cardcheck-fast-rbrief-homography'||!Array.isArray(model.references)) throw new Error('Unsupported model version.');
    this.references=[];
    for(const ref of model.references) {
      const card=cards.find(c=>c.id===ref.id&&c.enabled!==false);
      if(card) this.references.push({card,features:unpack(ref.features)});
    }
    return {loaded:[...new Set(this.references.map(r=>r.card.id))],failed:[]};
  }

  async recognize(source) {
    const start=performance.now();
    if(!this.references.length) throw new Error('No reference cards are ready. Open the card library and check the reference images.');
    await tick();
    const query=extractFeatures(source),byCard=new Map();
    for(const {card,features} of this.references) {
      const matches=findMatches(features,query);
      const verified=verify(matches,features,query);
      const inliers=verified.inliers.length;
      const ratio=inliers/Math.max(1,matches.length);
      const score=Math.round(Math.min(99,55*Math.min(1,inliers/35)+25*Math.min(1,verified.coverage/0.5)+20*Math.min(1,ratio/0.65)));
      const accepted=inliers>=14&&ratio>=0.3&&verified.coverage>=0.18&&verified.artInliers>=7&&verified.spatialCells>=7;
      const candidate={card,score,inliers,matches:matches.length,inlierRatio:ratio,coverage:verified.coverage,artInliers:verified.artInliers,spatialCells:verified.spatialCells,accepted,
        corners:verified.homography?[[0,0],[features.width,0],[features.width,features.height],[0,features.height]].map(([x,y])=>project(verified.homography,x,y)):null};
      const previous=byCard.get(card.id);
      if(!previous||Number(candidate.accepted)>Number(previous.accepted)||(candidate.accepted===previous.accepted&&candidate.inliers>previous.inliers)) byCard.set(card.id,candidate);
      await tick();
    }
    const candidates=[...byCard.values()].sort((a,b)=>Number(b.accepted)-Number(a.accepted)||b.inliers-a.inliers||b.score-a.score);
    const top=candidates[0],second=candidates[1];
    const separated=!second||!second.accepted||top.inliers>=second.inliers*1.35;
    const status=top.accepted&&separated?'matched':top.inliers>=8?'uncertain':'no-match';
    return {status,card:status==='matched'?top.card:null,candidates,queryFeatures:query.points.length,elapsedMs:Math.round(performance.now()-start),
      message:status==='matched'?'A reference match was found. Confirm the name and card number.':status==='uncertain'?'No confident match. Flatten the card, reduce glare and try again.':'No confident match. Try a clearer photo of a supported card.'};
  }
}

export const RECOGNIZER_INFO = {version:MODEL_VERSION,algorithm:'FAST corners, rotated BRIEF descriptors, homography verification',maxSide:MAX_SIDE};
