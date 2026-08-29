/* Streetview Journey v0.1.21 Motion Worker - jsfeat */
'use strict';
self.window = self; // jsfeat browser build exports to window; alias it inside Worker.
try {
  importScripts('https://cdnjs.cloudflare.com/ajax/libs/jsfeat/0.0.8/jsfeat-min.js');
} catch (firstError) {
  try { importScripts('https://cdn.jsdelivr.net/npm/jsfeat@0.0.8/build/jsfeat-min.js'); }
  catch (secondError) { self.postMessage({type:'boot-error',error:'jsfeat load failed'}); throw secondError; }
}

const MIN_TRACKS = 8;
const TARGET_TRACKS = 22;
const MAX_CORNERS = 140;
const FB_THRESHOLD = 1.55;
const RANSAC_THRESHOLD = 1.75;
const RANSAC_ITERATIONS = 160;
const MAX_STEP_X = 5.2;
const MAX_STEP_Y = 4.0;
const MAX_STEP_ROLL = 1.25;
const MAX_STEP_LOG_SCALE = 0.022;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const deg = r => r * 180 / Math.PI;
const median = a => {
  if (!a.length) return 0;
  const s = [...a].sort((x,y)=>x-y), m = s.length >> 1;
  return s.length & 1 ? s[m] : (s[m-1] + s[m]) * 0.5;
};
function coverage(points,w,h){
  const cells = new Set();
  for (const p of points) cells.add(`${clamp(Math.floor(p.x0/(w/4)),0,3)}:${clamp(Math.floor(p.y0/(h/4)),0,3)}`);
  return clamp(cells.size / 10, 0, 1);
}
function createRng(seed){
  let x=((seed+1)*2654435761)>>>0;
  return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};
}
function similarityFromTwo(p,q){
  const sx=q.x0-p.x0, sy=q.y0-p.y0, tx=q.x1-p.x1, ty=q.y1-p.y1, den=sx*sx+sy*sy;
  if (den < 100) return null;
  const a=(sx*tx+sy*ty)/den, b=(sx*ty-sy*tx)/den, scale=Math.hypot(a,b), rotation=deg(Math.atan2(b,a));
  if (!Number.isFinite(scale) || scale<.94 || scale>1.06 || Math.abs(rotation)>4.5) return null;
  return {a,b,tx:p.x1-a*p.x0+b*p.y0,ty:p.y1-b*p.x0-a*p.y0,scale,rotation};
}
function fitSimilarity(points){
  if (points.length < 2) return null;
  let ax=0,ay=0,bx=0,by=0;
  for(const p of points){ax+=p.x0;ay+=p.y0;bx+=p.x1;by+=p.y1;}
  ax/=points.length; ay/=points.length; bx/=points.length; by/=points.length;
  let den=0,A=0,B=0;
  for(const p of points){const ux=p.x0-ax,uy=p.y0-ay,vx=p.x1-bx,vy=p.y1-by;den+=ux*ux+uy*uy;A+=ux*vx+uy*vy;B+=ux*vy-uy*vx;}
  if (den < 1e-5) return null;
  const a=A/den,b=B/den,scale=Math.hypot(a,b),rotation=deg(Math.atan2(b,a));
  if (!Number.isFinite(scale) || scale<.94 || scale>1.06 || Math.abs(rotation)>4.5) return null;
  return {a,b,tx:bx-a*ax+b*ay,ty:by-b*ax-a*ay,scale,rotation};
}
function reproj(m,p){
  const x=m.a*p.x0-m.b*p.y0+m.tx, y=m.b*p.x0+m.a*p.y0+m.ty;
  return Math.hypot(x-p.x1,y-p.y1);
}
function ransacSimilarity(tracks,w,h,seed){
  if (tracks.length < MIN_TRACKS) return null;
  const rng=createRng(seed); let best=null;
  for(let k=0;k<RANSAC_ITERATIONS;k++){
    const ai=Math.floor(rng()*tracks.length); let bi=Math.floor(rng()*tracks.length); if(ai===bi) bi=(bi+1)%tracks.length;
    const m=similarityFromTwo(tracks[ai],tracks[bi]); if(!m) continue;
    const ins=[],errs=[];
    for(const p of tracks){const e=reproj(m,p);if(e<=RANSAC_THRESHOLD){ins.push(p);errs.push(e);}}
    if(ins.length<MIN_TRACKS) continue;
    const cov=coverage(ins,w,h), med=median(errs), score=ins.length+cov*3-med*.45;
    if(!best||score>best.score) best={inliers:ins,score};
  }
  if(!best) return null;
  const refined=fitSimilarity(best.inliers); if(!refined) return null;
  const ins=[],errs=[];
  for(const p of tracks){const e=reproj(refined,p);if(e<=RANSAC_THRESHOLD*1.08){ins.push(p);errs.push(e);}}
  if(ins.length<MIN_TRACKS) return null;
  return {model:fitSimilarity(ins)||refined,inliers:ins,medianError:median(errs),coverage:coverage(ins,w,h)};
}
function selectCorners(gray,w,h){
  const img=new jsfeat.matrix_t(w,h,jsfeat.U8C1_t);
  img.data.set(gray);
  const corners=Array.from({length:MAX_CORNERS*2},()=>new jsfeat.keypoint_t(0,0,0,0));
  jsfeat.yape06.laplacian_threshold=22;
  jsfeat.yape06.min_eigen_value_threshold=18;
  const count=jsfeat.yape06.detect(img,corners,5);
  corners.length=count;
  corners.sort((a,b)=>b.score-a.score);
  const chosen=[];
  for(const c of corners){
    if(c.x<4||c.x>=w-4||c.y<5||c.y>=h-16) continue;
    let near=false; for(const p of chosen){const dx=p.x-c.x,dy=p.y-c.y;if(dx*dx+dy*dy<10){near=true;break;}}
    if(!near) chosen.push(c);
    if(chosen.length>=MAX_CORNERS) break;
  }
  return {img, chosen, detected:count};
}
function makePyramid(img,w,h){
  const p=new jsfeat.pyramid_t(3); p.allocate(w,h,jsfeat.U8C1_t); p.build(img,true); return p;
}
function analyze(msg){
  const {width:w,height:h,grayA,grayB,seed=1}=msg;
  const aData=new Uint8Array(grayA), bData=new Uint8Array(grayB);
  const a=selectCorners(aData,w,h), bImg=new jsfeat.matrix_t(w,h,jsfeat.U8C1_t); bImg.data.set(bData);
  const corners=a.chosen, n=corners.length;
  const base={detected:a.detected,corners:n,lk:0,fb:0,lkRatio:0,fbRatio:0,inliers:0,inlierRatio:0,coverage:0,reprojection:0,fbMedian:0,upperFlow:0,lowerFlow:0,depthRatio:1};
  if(n<MIN_TRACKS) return {...base,source:'fallback',confidence:0,dx:0,dy:0,roll:0,logScale:0,reason:'features'};
  const pa=makePyramid(a.img,w,h), pb=makePyramid(bImg,w,h);
  const prev=new Float32Array(n*2), curr=new Float32Array(n*2), back=new Float32Array(n*2);
  for(let i=0;i<n;i++){prev[i*2]=curr[i*2]=corners[i].x;prev[i*2+1]=curr[i*2+1]=corners[i].y;}
  const st=new Uint8Array(n), stBack=new Uint8Array(n);
  jsfeat.optical_flow_lk.track(pa,pb,prev,curr,n,19,20,st,0.01,0.0001);
  jsfeat.optical_flow_lk.track(pb,pa,curr,back,n,19,20,stBack,0.01,0.0001);
  const tracks=[];
  for(let i=0;i<n;i++){
    if(!st[i]) continue; base.lk++;
    if(!stBack[i]) continue;
    const x0=prev[i*2],y0=prev[i*2+1],x1=curr[i*2],y1=curr[i*2+1],xb=back[i*2],yb=back[i*2+1];
    if(![x0,y0,x1,y1,xb,yb].every(Number.isFinite)||x1<1||x1>=w-1||y1<1||y1>=h-1) continue;
    const fb=Math.hypot(xb-x0,yb-y0), flow=Math.hypot(x1-x0,y1-y0);
    if(fb>FB_THRESHOLD||flow>14) continue;
    tracks.push({x0,y0,x1,y1,dx:x1-x0,dy:y1-y0,fb,flow});
  }
  base.fb=tracks.length;base.lkRatio=base.lk/n;base.fbRatio=base.fb/Math.max(1,base.lk);base.fbMedian=median(tracks.map(p=>p.fb));
  const up=tracks.filter(p=>p.y0<h*.5).map(p=>p.flow), lo=tracks.filter(p=>p.y0>=h*.5).map(p=>p.flow);
  base.upperFlow=median(up);base.lowerFlow=median(lo);base.depthRatio=base.upperFlow>.25?base.lowerFlow/base.upperFlow:(base.lowerFlow>.7?2:1);
  if(tracks.length<MIN_TRACKS) return {...base,source:'fallback',confidence:0,dx:0,dy:0,roll:0,logScale:0,reason:'fb'};
  const robust=ransacSimilarity(tracks,w,h,seed);
  if(!robust){
    return {...base,source:'worker-low',confidence:.08,tracks:tracks.length,dx:clamp(median(tracks.map(p=>p.dx)),-MAX_STEP_X,MAX_STEP_X),dy:clamp(median(tracks.map(p=>p.dy)),-MAX_STEP_Y,MAX_STEP_Y),roll:0,logScale:0,reason:'ransac'};
  }
  const {model,inliers,medianError,coverage:cov}=robust, cx=w/2,cy=h/2,xx=model.a*cx-model.b*cy+model.tx,yy=model.b*cx+model.a*cy+model.ty;
  const ir=inliers.length/Math.max(1,tracks.length), countScore=clamp((inliers.length-MIN_TRACKS+2)/TARGET_TRACKS,0,1), rp=clamp(1-medianError/2.2,0,1), fbm=median(inliers.map(p=>p.fb)), fbs=clamp(1-fbm/FB_THRESHOLD,0,1);
  const confidence=clamp(.30*ir+.22*countScore+.20*cov+.18*rp+.10*fbs,0,1);
  return {...base,source:'ransac',confidence,tracks:inliers.length,rawTracks:tracks.length,inliers:inliers.length,inlierRatio:ir,coverage:cov,reprojection:medianError,fbMedian:fbm,dx:clamp(xx-cx,-MAX_STEP_X,MAX_STEP_X),dy:clamp(yy-cy,-MAX_STEP_Y,MAX_STEP_Y),roll:clamp(model.rotation,-MAX_STEP_ROLL,MAX_STEP_ROLL),logScale:clamp(Math.log(model.scale),-MAX_STEP_LOG_SCALE,MAX_STEP_LOG_SCALE),reason:'ok'};
}

self.postMessage({type:'ready',engine:'jsfeat'});
self.onmessage=(event)=>{
  const msg=event.data||{};
  if(msg.type!=='analyze') return;
  const started=performance.now();
  try{const result=analyze(msg);self.postMessage({type:'result',id:msg.id,result:{...result,ms:performance.now()-started}});}
  catch(error){self.postMessage({type:'error',id:msg.id,error:String(error?.message||error)});}
};
