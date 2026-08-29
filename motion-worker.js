/* Streetview Journey v0.1.22 Motion Worker - adaptive background RANSAC */
'use strict';
self.window = self;
try {
  importScripts('https://cdnjs.cloudflare.com/ajax/libs/jsfeat/0.0.8/jsfeat-min.js');
} catch (firstError) {
  try { importScripts('https://cdn.jsdelivr.net/npm/jsfeat@0.0.8/build/jsfeat-min.js'); }
  catch (secondError) { self.postMessage({type:'boot-error',error:'jsfeat load failed'}); throw secondError; }
}

const MIN_TRACKS=8,TARGET_TRACKS=24,MAX_CORNERS=160;
const FB_MIN=1.25,FB_MAX=2.40,FLOW_MIN=14,FLOW_MAX=24;
const RANSAC_BASE=1.60,RANSAC_MAX=2.20,RANSAC_ITERATIONS=220;
const MAX_STEP_X=5.0,MAX_STEP_Y=3.8,MAX_STEP_ROLL=1.00,MAX_STEP_LOG_SCALE=0.016;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v)),deg=r=>r*180/Math.PI;
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length&1?s[m]:(s[m-1]+s[m])*.5;};
const mad=(a,m=median(a))=>median(a.map(v=>Math.abs(v-m)));
let cornerPool=[];
let jobsReceived=0,jobsCompleted=0,jobsErrored=0;
const temporalModels=new Map();
function ensureCornerPool(size){while(cornerPool.length<size)cornerPool.push(new jsfeat.keypoint_t(0,0,0,0));return cornerPool;}
function coverage(points,w,h){const cells=new Set();for(const p of points)cells.add(`${clamp(Math.floor(p.x0/(w/4)),0,3)}:${clamp(Math.floor(p.y0/(h/4)),0,3)}`);return clamp(cells.size/12,0,1);}
function createRng(seed){let x=((seed+1)*2654435761)>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function similarityFromTwo(p,q){const sx=q.x0-p.x0,sy=q.y0-p.y0,tx=q.x1-p.x1,ty=q.y1-p.y1,den=sx*sx+sy*sy;if(den<81)return null;const a=(sx*tx+sy*ty)/den,b=(sx*ty-sy*tx)/den,scale=Math.hypot(a,b),rotation=deg(Math.atan2(b,a));if(!Number.isFinite(scale)||scale<.95||scale>1.05||Math.abs(rotation)>4)return null;return{a,b,tx:p.x1-a*p.x0+b*p.y0,ty:p.y1-b*p.x0-a*p.y0,scale,rotation};}
function fitSimilarity(points){if(points.length<2)return null;let ax=0,ay=0,bx=0,by=0;for(const p of points){ax+=p.x0;ay+=p.y0;bx+=p.x1;by+=p.y1;}ax/=points.length;ay/=points.length;bx/=points.length;by/=points.length;let den=0,A=0,B=0;for(const p of points){const ux=p.x0-ax,uy=p.y0-ay,vx=p.x1-bx,vy=p.y1-by;den+=ux*ux+uy*uy;A+=ux*vx+uy*vy;B+=ux*vy-uy*vx;}if(den<1e-5)return null;const a=A/den,b=B/den,scale=Math.hypot(a,b),rotation=deg(Math.atan2(b,a));if(!Number.isFinite(scale)||scale<.95||scale>1.05||Math.abs(rotation)>4)return null;return{a,b,tx:bx-a*ax+b*ay,ty:by-b*ax-a*ay,scale,rotation};}
function reproj(m,p){const x=m.a*p.x0-m.b*p.y0+m.tx,y=m.b*p.x0+m.a*p.y0+m.ty;return Math.hypot(x-p.x1,y-p.y1);}
function ransacSimilarity(tracks,w,h,seed,threshold){if(tracks.length<MIN_TRACKS)return null;const rng=createRng(seed);let best=null;for(let k=0;k<RANSAC_ITERATIONS;k++){const ai=Math.floor(rng()*tracks.length);let bi=Math.floor(rng()*tracks.length);if(ai===bi)bi=(bi+1)%tracks.length;const m=similarityFromTwo(tracks[ai],tracks[bi]);if(!m)continue;const ins=[],errs=[];for(const p of tracks){const e=reproj(m,p);if(e<=threshold){ins.push(p);errs.push(e);}}if(ins.length<MIN_TRACKS)continue;const cov=coverage(ins,w,h),med=median(errs),score=ins.length+cov*4-med*.55;if(!best||score>best.score)best={inliers:ins,score};}if(!best)return null;const refined=fitSimilarity(best.inliers);if(!refined)return null;const ins=[],errs=[];for(const p of tracks){const e=reproj(refined,p);if(e<=threshold*1.08){ins.push(p);errs.push(e);}}if(ins.length<MIN_TRACKS)return null;return{model:fitSimilarity(ins)||refined,inliers:ins,medianError:median(errs),coverage:coverage(ins,w,h),threshold};}
function selectCorners(gray,w,h){
  const img=new jsfeat.matrix_t(w,h,jsfeat.U8C1_t);img.data.set(gray);
  const pool=ensureCornerPool(w*h);jsfeat.yape06.laplacian_threshold=20;jsfeat.yape06.min_eigen_value_threshold=16;
  const detected=jsfeat.yape06.detect(img,pool,5),candidates=pool.slice(0,Math.min(detected,pool.length)).map(c=>({x:c.x,y:c.y,score:c.score}));
  candidates.sort((a,b)=>b.score-a.score);
  const gx=4,gy=4,quota=8,buckets=Array.from({length:gx*gy},()=>[]);
  for(const c of candidates){if(c.x<4||c.x>=w-4||c.y<5||c.y>=h-8)continue;const bx=clamp(Math.floor(c.x/(w/gx)),0,gx-1),by=clamp(Math.floor(c.y/(h/gy)),0,gy-1);if(buckets[by*gx+bx].length<quota)buckets[by*gx+bx].push(c);}
  const chosen=[];const add=c=>{for(const p of chosen){const dx=p.x-c.x,dy=p.y-c.y;if(dx*dx+dy*dy<9)return false;}chosen.push(c);return true;};
  for(const bucket of buckets)for(const c of bucket){add(c);if(chosen.length>=MAX_CORNERS)break;}
  if(chosen.length<MAX_CORNERS)for(const c of candidates){if(c.x<4||c.x>=w-4||c.y<5||c.y>=h-8)continue;add(c);if(chosen.length>=MAX_CORNERS)break;}
  return{img,chosen,detected};
}
function makePyramid(img,w,h){const p=new jsfeat.pyramid_t(3);p.allocate(w,h,jsfeat.U8C1_t);p.build(img,false);return p;}
function baseResult(extra={}){return{detected:0,corners:0,lk:0,fb:0,lkRatio:0,fbRatio:0,inliers:0,inlierRatio:0,domainTracks:0,domainInliers:0,domainInlierRatio:0,coverage:0,reprojection:0,fbMedian:0,fbThreshold:0,flowMedian:0,flowLimit:0,upperFlow:0,lowerFlow:0,depthRatio:1,confidence:0,dx:0,dy:0,roll:0,logScale:0,modelKind:'none',...extra};}
function modelStats(robust,domain,allTracks,w,h,kind,threshold){
  if(!robust)return null;
  const globalInliers=allTracks.filter(p=>reproj(robust.model,p)<=threshold*1.08),domainRatio=robust.inliers.length/Math.max(1,domain.length),globalRatio=globalInliers.length/Math.max(1,allTracks.length),countScore=clamp((robust.inliers.length-MIN_TRACKS+2)/TARGET_TRACKS,0,1),errScore=clamp(1-robust.medianError/2.2,0,1),score=.42*domainRatio+.20*countScore+.20*robust.coverage+.18*errScore;
  return{kind,robust,domainTracks:domain.length,domainInliers:robust.inliers.length,domainRatio,globalInliers,globalRatio,score};
}

function temporalStabilize(result,frameIndex){
  if(!Number.isFinite(frameIndex)||result.source!=='ransac')return result;
  if(frameIndex===0)temporalModels.clear();
  const prev=temporalModels.get(frameIndex-1);
  let out={...result};
  if(prev&&prev.source==='ransac'){
    const trust=clamp(result.confidence,0,1),parallax=(result.depthRatio||1)>1.35||result.modelKind==='background',mix=parallax?.28:(trust<.45?.20:.10);
    out.roll=prev.roll*mix+result.roll*(1-mix);
    out.logScale=prev.logScale*mix+result.logScale*(1-mix);
    if(parallax||trust<.42){out.dx=prev.dx*.18+result.dx*.82;out.dy=prev.dy*.18+result.dy*.82;}
    out.roll=prev.roll+clamp(out.roll-prev.roll,-.62,.62);
    out.logScale=prev.logScale+clamp(out.logScale-prev.logScale,-.010,.010);
    out.temporalBlend=mix;
  }else out.temporalBlend=0;
  temporalModels.set(frameIndex,{source:out.source,dx:out.dx,dy:out.dy,roll:out.roll,logScale:out.logScale,confidence:out.confidence});
  if(temporalModels.size>20)for(const k of temporalModels.keys())if(k<frameIndex-8)temporalModels.delete(k);
  return out;
}

function analyze(msg){let stage='input';try{
  const{width:w,height:h,grayA,grayB,seed=1}=msg;if(!grayA||!grayB||!w||!h)throw new Error('invalid image payload');
  stage='decode';const aData=new Uint8Array(grayA),bData=new Uint8Array(grayB);if(aData.length!==w*h||bData.length!==w*h)throw new Error(`gray size mismatch ${aData.length}/${bData.length} expected ${w*h}`);
  stage='corners';const a=selectCorners(aData,w,h),bImg=new jsfeat.matrix_t(w,h,jsfeat.U8C1_t);bImg.data.set(bData);const corners=a.chosen,n=corners.length,base=baseResult({detected:a.detected,corners:n});if(n<MIN_TRACKS)return{...base,source:'fallback',reason:'features'};
  stage='pyramid';const pa=makePyramid(a.img,w,h),pb=makePyramid(bImg,w,h),prev=new Float32Array(n*2),curr=new Float32Array(n*2),back=new Float32Array(n*2);for(let i=0;i<n;i++){prev[i*2]=curr[i*2]=corners[i].x;prev[i*2+1]=curr[i*2+1]=corners[i].y;}
  const st=new Uint8Array(n),stBack=new Uint8Array(n);stage='lk-forward';jsfeat.optical_flow_lk.track(pa,pb,prev,curr,n,19,24,st,.01,.0001);stage='lk-back';jsfeat.optical_flow_lk.track(pb,pa,curr,back,n,19,24,stBack,.01,.0001);
  stage='filter';const provisional=[];for(let i=0;i<n;i++){if(!st[i])continue;base.lk++;if(!stBack[i])continue;const x0=prev[i*2],y0=prev[i*2+1],x1=curr[i*2],y1=curr[i*2+1],xb=back[i*2],yb=back[i*2+1];if(![x0,y0,x1,y1,xb,yb].every(Number.isFinite)||x1<1||x1>=w-1||y1<1||y1>=h-1)continue;provisional.push({x0,y0,x1,y1,dx:x1-x0,dy:y1-y0,fb:Math.hypot(xb-x0,yb-y0),flow:Math.hypot(x1-x0,y1-y0)});}
  const fbVals=provisional.map(p=>p.fb),flowVals=provisional.map(p=>p.flow),fbMedAll=median(fbVals),fbSigma=1.4826*mad(fbVals,fbMedAll),flowMed=median(flowVals),flowSigma=1.4826*mad(flowVals,flowMed),fbThreshold=clamp(Math.max(FB_MIN,fbMedAll+3*fbSigma),FB_MIN,FB_MAX),flowLimit=clamp(Math.max(FLOW_MIN,flowMed+3.2*flowSigma),FLOW_MIN,FLOW_MAX);
  const tracks=provisional.filter(p=>p.fb<=fbThreshold&&p.flow<=flowLimit);base.fb=tracks.length;base.lkRatio=base.lk/n;base.fbRatio=base.fb/Math.max(1,base.lk);base.fbMedian=median(tracks.map(p=>p.fb));base.fbThreshold=fbThreshold;base.flowMedian=flowMed;base.flowLimit=flowLimit;
  const up=tracks.filter(p=>p.y0<h*.5).map(p=>p.flow),lo=tracks.filter(p=>p.y0>=h*.5).map(p=>p.flow);base.upperFlow=median(up);base.lowerFlow=median(lo);base.depthRatio=base.upperFlow>.25?base.lowerFlow/base.upperFlow:(base.lowerFlow>.7?2:1);if(tracks.length<MIN_TRACKS)return{...base,source:'fallback',reason:'fb'};
  const dxMed=median(tracks.map(p=>p.dx)),dyMed=median(tracks.map(p=>p.dy)),devs=tracks.map(p=>Math.hypot(p.dx-dxMed,p.dy-dyMed)),devMed=median(devs),devLimit=clamp(Math.max(1.4,devMed+2.8*1.4826*mad(devs,devMed)),1.4,5.0);
  const coherent=tracks.filter(p=>Math.hypot(p.dx-dxMed,p.dy-dyMed)<=devLimit),far=tracks.filter(p=>p.y0<h*.72&&p.flow<=Math.max(4.5,flowMed*1.45+1.0)),farCoherent=far.filter(p=>Math.hypot(p.dx-dxMed,p.dy-dyMed)<=devLimit*1.15);
  const rThreshold=clamp(RANSAC_BASE+Math.min(.45,flowMed*.035),RANSAC_BASE,RANSAC_MAX),candidates=[];
  const pushCandidate=(kind,domain,bias=0)=>{if(domain.length<MIN_TRACKS)return;const robust=ransacSimilarity(domain,w,h,seed+(kind==='full'?0:kind==='background'?17:31),rThreshold),s=modelStats(robust,domain,tracks,w,h,kind,rThreshold);if(s){s.score+=bias;candidates.push(s);}};
  stage='ransac';pushCandidate('full',tracks,.04);pushCandidate('coherent',coherent,(coherent.length>=tracks.length*.55)? .025:0);pushCandidate('background',farCoherent.length>=MIN_TRACKS?farCoherent:far,base.depthRatio>1.35?.14:-.015);
  if(!candidates.length)return{...base,source:'worker-low',confidence:.10,tracks:tracks.length,dx:clamp(dxMed,-MAX_STEP_X,MAX_STEP_X),dy:clamp(dyMed,-MAX_STEP_Y,MAX_STEP_Y),reason:base.depthRatio>1.35?'parallax':'ransac'};
  candidates.sort((a,b)=>b.score-a.score);const chosen=candidates[0],{model,medianError}=chosen.robust,cx=w/2,cy=chosen.kind==='background'?h*.42:h*.50,xx=model.a*cx-model.b*cy+model.tx,yy=model.b*cx+model.a*cy+model.ty,fbm=median(chosen.robust.inliers.map(p=>p.fb)),fbScore=clamp(1-fbm/Math.max(fbThreshold,.001),0,1),fbHealth=clamp((base.fbRatio-.25)/.45,0,1),countScore=clamp((chosen.domainInliers-MIN_TRACKS+2)/TARGET_TRACKS,0,1),errScore=clamp(1-medianError/2.2,0,1);
  let confidence=clamp(.29*chosen.domainRatio+.21*countScore+.18*chosen.robust.coverage+.15*errScore+.08*fbScore+.09*fbHealth,0,1);if(chosen.kind==='background'&&base.depthRatio>1.35)confidence=clamp(confidence+.07,0,1);
  const globalCov=coverage(chosen.globalInliers,w,h);
  return{...base,source:'ransac',confidence,tracks:chosen.domainInliers,rawTracks:tracks.length,inliers:chosen.globalInliers.length,inlierRatio:chosen.globalRatio,domainTracks:chosen.domainTracks,domainInliers:chosen.domainInliers,domainInlierRatio:chosen.domainRatio,coverage:chosen.robust.coverage,globalCoverage:globalCov,reprojection:medianError,fbMedian:fbm,modelKind:chosen.kind,modelScore:chosen.score,coherentTracks:coherent.length,backgroundTracks:far.length,dx:clamp(xx-cx,-MAX_STEP_X,MAX_STEP_X),dy:clamp(yy-cy,-MAX_STEP_Y,MAX_STEP_Y),roll:clamp(model.rotation,-MAX_STEP_ROLL,MAX_STEP_ROLL),logScale:clamp(Math.log(model.scale),-MAX_STEP_LOG_SCALE,MAX_STEP_LOG_SCALE),reason:chosen.kind==='background'?'background-ok':'ok'};
}catch(error){error.journeyStage=stage;throw error;}}
self.postMessage({type:'ready',engine:'jsfeat',build:'0.1.22'});
self.onmessage=event=>{const msg=event.data||{};if(msg.type!=='analyze')return;jobsReceived++;const started=performance.now();try{const raw=analyze(msg),frameIndex=Math.round(((msg.seed||0)-(msg.width||0)*(msg.height||0))/31),result=temporalStabilize(raw,frameIndex);jobsCompleted++;self.postMessage({type:'result',id:msg.id,result:{...result,frameIndex,ms:performance.now()-started,jobsReceived,jobsCompleted,jobsErrored}});}catch(error){jobsErrored++;jobsCompleted++;self.postMessage({type:'result',id:msg.id,result:{...baseResult(),source:'worker-error',reason:'exception',error:String(error?.message||error),stage:error?.journeyStage||'unknown',ms:performance.now()-started,jobsReceived,jobsCompleted,jobsErrored}});}};