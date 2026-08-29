/* Streetview Journey v0.1.27 Travel Axis Worker */
'use strict';

self.window=self;
try{
  importScripts('https://cdnjs.cloudflare.com/ajax/libs/jsfeat/0.0.8/jsfeat-min.js');
}catch(firstError){
  try{importScripts('https://cdn.jsdelivr.net/npm/jsfeat@0.0.8/build/jsfeat-min.js');}
  catch(secondError){self.postMessage({type:'axis-boot-error',error:'jsfeat load failed'});throw secondError;}
}

const MAX_CORNERS=112;
const MIN_TRACKS=12;
const FLOW_MIN=.55;
const FLOW_MAX=28;
const RANSAC_ITERS=170;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length&1?s[m]:(s[m-1]+s[m])*.5;};
const mad=(a,m=median(a))=>median(a.map(v=>Math.abs(v-m)));

let pool=[];
function ensurePool(size){while(pool.length<size)pool.push(new jsfeat.keypoint_t(0,0,0,0));return pool;}
function rng(seed){let x=((seed+17)*2654435761)>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}

function selectCorners(gray,w,h){
  const img=new jsfeat.matrix_t(w,h,jsfeat.U8C1_t);img.data.set(gray);
  const kp=ensurePool(w*h);
  jsfeat.yape06.laplacian_threshold=22;
  jsfeat.yape06.min_eigen_value_threshold=18;
  const detected=jsfeat.yape06.detect(img,kp,5);
  const candidates=kp.slice(0,Math.min(detected,kp.length)).map(k=>({x:k.x,y:k.y,score:k.score})).sort((a,b)=>b.score-a.score);
  const gx=4,gy=4,quota=8,buckets=Array.from({length:gx*gy},()=>[]);
  for(const c of candidates){
    if(c.x<5||c.x>=w-5||c.y<6||c.y>=h-8)continue;
    const bx=clamp(Math.floor(c.x/(w/gx)),0,gx-1),by=clamp(Math.floor(c.y/(h/gy)),0,gy-1);
    if(buckets[by*gx+bx].length<quota)buckets[by*gx+bx].push(c);
  }
  const out=[];
  for(let round=0;round<quota&&out.length<MAX_CORNERS;round++){
    for(const b of buckets){if(b[round])out.push(b[round]);if(out.length>=MAX_CORNERS)break;}
  }
  return{img,corners:out,detected};
}
function pyramid(img,w,h){const p=new jsfeat.pyramid_t(3);p.allocate(w,h,jsfeat.U8C1_t);p.build(img,false);return p;}

function lineIntersection(a,b){
  const det=a.dx*b.dy-a.dy*b.dx;
  const amag=Math.hypot(a.dx,a.dy),bmag=Math.hypot(b.dx,b.dy);
  if(amag<FLOW_MIN||bmag<FLOW_MIN||Math.abs(det)/(amag*bmag)<.13)return null;
  const qx=b.x-a.x,qy=b.y-a.y;
  const t=(qx*b.dy-qy*b.dx)/det;
  return{x:a.x+t*a.dx,y:a.y+t*a.dy};
}
function lineDistance(p,c){
  const m=Math.hypot(p.dx,p.dy)||1;
  return Math.abs(p.dx*(c.y-p.y)-p.dy*(c.x-p.x))/m;
}
function directionSign(p,c){return Math.sign(p.dx*(p.x-c.x)+p.dy*(p.y-c.y));}

function refineCenter(inliers){
  let a00=0,a01=0,a11=0,b0=0,b1=0;
  for(const p of inliers){
    const mag=Math.hypot(p.dx,p.dy)||1,nx=-p.dy/mag,ny=p.dx/mag;
    const rhs=nx*p.x+ny*p.y;
    const wt=1/(1+.07*mag*mag);
    a00+=wt*nx*nx;a01+=wt*nx*ny;a11+=wt*ny*ny;b0+=wt*nx*rhs;b1+=wt*ny*rhs;
  }
  const det=a00*a11-a01*a01;
  if(Math.abs(det)<1e-5)return null;
  return{x:(b0*a11-b1*a01)/det,y:(a00*b1-a01*b0)/det};
}

function estimateFOE(tracks,w,h,seed){
  if(tracks.length<MIN_TRACKS)return null;
  const random=rng(seed);let best=null;
  for(let k=0;k<RANSAC_ITERS;k++){
    const a=tracks[Math.floor(random()*tracks.length)],b=tracks[Math.floor(random()*tracks.length)];
    if(a===b)continue;
    const c=lineIntersection(a,b);if(!c)continue;
    if(c.x<-1.35*w||c.x>2.35*w||c.y<-1.0*h||c.y>2.1*h)continue;
    const ds=tracks.map(p=>lineDistance(p,c));
    const gate=clamp(median(ds)+2.8*1.4826*mad(ds),2.0,5.4);
    const ins=tracks.filter((p,i)=>ds[i]<=gate);
    if(ins.length<MIN_TRACKS)continue;
    const signs=ins.map(p=>directionSign(p,c)).filter(Boolean),pos=signs.filter(s=>s>0).length,neg=signs.length-pos;
    const signRatio=signs.length?Math.max(pos,neg)/signs.length:0;
    const medErr=median(ins.map(p=>lineDistance(p,c)));
    const score=ins.length+signRatio*7-medErr*1.2;
    if(!best||score>best.score)best={c,ins,signRatio,medErr,score};
  }
  if(!best)return null;
  const refined=refineCenter(best.ins)||best.c;
  const errors=best.ins.map(p=>lineDistance(p,refined)),medErr=median(errors);
  const inlierRatio=best.ins.length/tracks.length;
  const angles=best.ins.map(p=>Math.atan2(p.dy,p.dx));
  let cx=0,cy=0;for(const a of angles){cx+=Math.cos(2*a);cy+=Math.sin(2*a);}const parallel=Math.hypot(cx,cy)/Math.max(1,angles.length);
  const spread=1-parallel;
  const confidence=clamp(inlierRatio*.48+best.signRatio*.22+spread*.20+clamp(1-medErr/4,0,1)*.10,0,1);
  return{x:refined.x,y:refined.y,confidence,inlierRatio,signRatio,spread,medErr,kind:'foe'};
}

function sideFlowFallback(tracks,w,h){
  if(tracks.length<MIN_TRACKS)return null;
  const dxs=tracks.map(p=>p.dx),dys=tracks.map(p=>p.dy),mdx=median(dxs),mdy=median(dys),mx=median(tracks.map(p=>Math.abs(p.dx))),my=median(tracks.map(p=>Math.abs(p.dy)));
  if(mx<2.0||mx<my*1.35)return null;
  const sign=mdx<0?1:-1;
  const coherent=tracks.filter(p=>Math.sign(p.dx)===Math.sign(mdx)&&Math.abs(p.dx)>=FLOW_MIN).length/tracks.length;
  if(coherent<.68)return null;
  const strength=clamp((mx-2)/8,0,1),x=sign>0?w*(1.08+.22*strength):w*(-.08-.22*strength);
  return{x,y:h*.48,confidence:clamp(.20+.28*coherent+.18*strength,0,.58),inlierRatio:coherent,signRatio:coherent,spread:.05,medErr:0,kind:'side-flow'};
}

function analyze(msg){
  const {width:w,height:h,grayA,grayB,frame=0,generation=0,seed=1}=msg;
  if(!grayA||!grayB||!w||!h)return{frame,generation,centerX:.5,centerY:.5,confidence:0,tracks:0,kind:'invalid'};
  const ad=new Uint8Array(grayA),bd=new Uint8Array(grayB);
  if(ad.length!==w*h||bd.length!==w*h)return{frame,generation,centerX:.5,centerY:.5,confidence:0,tracks:0,kind:'size'};
  const a=selectCorners(ad,w,h),b=new jsfeat.matrix_t(w,h,jsfeat.U8C1_t);b.data.set(bd);
  const n=a.corners.length;if(n<MIN_TRACKS)return{frame,generation,centerX:.5,centerY:.5,confidence:0,tracks:n,kind:'features'};
  const pa=pyramid(a.img,w,h),pb=pyramid(b,w,h),prev=new Float32Array(n*2),curr=new Float32Array(n*2),st=new Uint8Array(n);
  for(let i=0;i<n;i++){prev[i*2]=curr[i*2]=a.corners[i].x;prev[i*2+1]=curr[i*2+1]=a.corners[i].y;}
  jsfeat.optical_flow_lk.track(pa,pb,prev,curr,n,17,18,st,.01,.0001);
  const tracks=[];
  for(let i=0;i<n;i++){
    if(!st[i])continue;
    const x=prev[i*2],y=prev[i*2+1],x1=curr[i*2],y1=curr[i*2+1],dx=x1-x,dy=y1-y,mag=Math.hypot(dx,dy);
    if(![x,y,x1,y1,mag].every(Number.isFinite)||x1<1||x1>=w-1||y1<1||y1>=h-1||mag<FLOW_MIN||mag>FLOW_MAX)continue;
    tracks.push({x,y,dx,dy,mag});
  }
  let result=estimateFOE(tracks,w,h,seed+frame*97)||sideFlowFallback(tracks,w,h);
  if(!result)return{frame,generation,centerX:.5,centerY:.5,confidence:0,tracks:tracks.length,kind:'none'};
  let centerX=result.x/w,centerY=result.y/h;
  centerX=clamp(centerX,-.45,1.45);centerY=clamp(centerY,-.55,1.55);
  const edgePenalty=centerX<-.30||centerX>1.30?.78:1;
  const confidence=clamp(result.confidence*edgePenalty,0,1);
  return{frame,generation,centerX,centerY,confidence,tracks:tracks.length,kind:result.kind,inlierRatio:result.inlierRatio,signRatio:result.signRatio,spread:result.spread,medErr:result.medErr,medianDx:median(tracks.map(p=>p.dx)),medianDy:median(tracks.map(p=>p.dy))};
}

self.onmessage=e=>{
  const m=e.data||{};
  if(m.type==='reset'){return;}
  if(m.type!=='axis')return;
  const started=performance.now();
  try{const result=analyze(m);result.ms=performance.now()-started;self.postMessage({type:'axis-result',result});}
  catch(error){self.postMessage({type:'axis-error',frame:m.frame,generation:m.generation,error:String(error?.message||error)});}
};
self.postMessage({type:'axis-ready'});
