/* Streetview Journey v0.1.25 Motion Worker - worst-pair safety gate */
'use strict';
self.window = self;
try {
  importScripts('https://cdnjs.cloudflare.com/ajax/libs/jsfeat/0.0.8/jsfeat-min.js');
} catch (firstError) {
  try { importScripts('https://cdn.jsdelivr.net/npm/jsfeat@0.0.8/build/jsfeat-min.js'); }
  catch (secondError) { self.postMessage({type:'boot-error',error:'jsfeat load failed'}); throw secondError; }
}

const MIN_TRACKS=8,RESCUE_MIN_TRACKS=12,TARGET_TRACKS=26,MAX_CORNERS=176;
const FB_MIN=1.20,FB_MAX=2.70,FLOW_MIN=14,FLOW_MAX=26;
const RANSAC_BASE=1.55,RANSAC_MAX=2.35,RANSAC_ITERATIONS=280;
const MODEL_SCALE_MIN=.92,MODEL_SCALE_MAX=1.08,MODEL_ROTATION_LIMIT=6.0;
const MAX_STEP_X=4.6,MAX_STEP_Y=3.4,MAX_STEP_ROLL=.70,MAX_STEP_LOG_SCALE=.011;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v)),deg=r=>r*180/Math.PI;
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length&1?s[m]:(s[m-1]+s[m])*.5;};
const mad=(a,m=median(a))=>median(a.map(v=>Math.abs(v-m)));
const parallaxFactor=r=>{const v=Number.isFinite(r)&&r>0?r:1;return Math.max(v,1/v);};

let cornerPool=[];
let jobsReceived=0,jobsCompleted=0,jobsErrored=0;
const temporalModels=new Map();

function ensureCornerPool(size){while(cornerPool.length<size)cornerPool.push(new jsfeat.keypoint_t(0,0,0,0));return cornerPool;}
function coverage(points,w,h){const cells=new Set();for(const p of points)cells.add(`${clamp(Math.floor(p.x0/(w/4)),0,3)}:${clamp(Math.floor(p.y0/(h/4)),0,3)}`);return clamp(cells.size/12,0,1);}
function createRng(seed){let x=((seed+1)*2654435761)>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}

function similarityFromTwo(p,q){
  const sx=q.x0-p.x0,sy=q.y0-p.y0,tx=q.x1-p.x1,ty=q.y1-p.y1,den=sx*sx+sy*sy;
  if(den<64)return null;
  const a=(sx*tx+sy*ty)/den,b=(sx*ty-sy*tx)/den,scale=Math.hypot(a,b),rotation=deg(Math.atan2(b,a));
  if(!Number.isFinite(scale)||scale<MODEL_SCALE_MIN||scale>MODEL_SCALE_MAX||Math.abs(rotation)>MODEL_ROTATION_LIMIT)return null;
  return{a,b,tx:p.x1-a*p.x0+b*p.y0,ty:p.y1-b*p.x0-a*p.y0,scale,rotation};
}
function fitSimilarity(points){
  if(points.length<2)return null;
  let ax=0,ay=0,bx=0,by=0;
  for(const p of points){ax+=p.x0;ay+=p.y0;bx+=p.x1;by+=p.y1;}
  ax/=points.length;ay/=points.length;bx/=points.length;by/=points.length;
  let den=0,A=0,B=0;
  for(const p of points){
    const ux=p.x0-ax,uy=p.y0-ay,vx=p.x1-bx,vy=p.y1-by;
    den+=ux*ux+uy*uy;A+=ux*vx+uy*vy;B+=ux*vy-uy*vx;
  }
  if(den<1e-5)return null;
  const a=A/den,b=B/den,scale=Math.hypot(a,b),rotation=deg(Math.atan2(b,a));
  if(!Number.isFinite(scale)||scale<MODEL_SCALE_MIN||scale>MODEL_SCALE_MAX||Math.abs(rotation)>MODEL_ROTATION_LIMIT)return null;
  return{a,b,tx:bx-a*ax+b*ay,ty:by-b*ax-a*ay,scale,rotation};
}
function reproj(m,p){
  const x=m.a*p.x0-m.b*p.y0+m.tx,y=m.b*p.x0+m.a*p.y0+m.ty;
  return Math.hypot(x-p.x1,y-p.y1);
}
function ransacSimilarity(tracks,w,h,seed,threshold,iterations=RANSAC_ITERATIONS){
  if(tracks.length<MIN_TRACKS)return null;
  const rng=createRng(seed);let best=null;
  for(let k=0;k<iterations;k++){
    const ai=Math.floor(rng()*tracks.length);let bi=Math.floor(rng()*tracks.length);
    if(ai===bi)bi=(bi+1)%tracks.length;
    const m=similarityFromTwo(tracks[ai],tracks[bi]);if(!m)continue;
    const ins=[],errs=[];
    for(const p of tracks){const e=reproj(m,p);if(e<=threshold){ins.push(p);errs.push(e);}}
    if(ins.length<MIN_TRACKS)continue;
    const cov=coverage(ins,w,h),med=median(errs),score=ins.length+cov*4.5-med*.60;
    if(!best||score>best.score)best={inliers:ins,score};
  }
  if(!best)return null;
  const refined=fitSimilarity(best.inliers);if(!refined)return null;
  const ins=[],errs=[];
  for(const p of tracks){const e=reproj(refined,p);if(e<=threshold*1.08){ins.push(p);errs.push(e);}}
  if(ins.length<MIN_TRACKS)return null;
  return{model:fitSimilarity(ins)||refined,inliers:ins,medianError:median(errs),coverage:coverage(ins,w,h),threshold};
}

function robustTranslation(domain,w,h){
  if(domain.length<RESCUE_MIN_TRACKS)return null;
  let dx=median(domain.map(p=>p.dx)),dy=median(domain.map(p=>p.dy));
  let residuals=domain.map(p=>Math.hypot(p.dx-dx,p.dy-dy));
  const rMed=median(residuals),rSigma=1.4826*mad(residuals,rMed),gate=clamp(Math.max(1.15,rMed+2.8*rSigma),1.15,3.5);
  let inliers=domain.filter(p=>Math.hypot(p.dx-dx,p.dy-dy)<=gate);
  if(inliers.length<RESCUE_MIN_TRACKS)return null;
  dx=median(inliers.map(p=>p.dx));dy=median(inliers.map(p=>p.dy));
  residuals=inliers.map(p=>Math.hypot(p.dx-dx,p.dy-dy));
  const cov=coverage(inliers,w,h),ratio=inliers.length/domain.length,err=median(residuals);
  if(ratio<.42||cov<.24||err>2.2)return null;
  return{dx,dy,inliers,ratio,coverage:cov,medianError:err,gate};
}

function selectCorners(gray,w,h){
  const img=new jsfeat.matrix_t(w,h,jsfeat.U8C1_t);img.data.set(gray);
  const pool=ensureCornerPool(w*h);
  jsfeat.yape06.laplacian_threshold=20;jsfeat.yape06.min_eigen_value_threshold=16;
  const detected=jsfeat.yape06.detect(img,pool,5);
  const candidates=pool.slice(0,Math.min(detected,pool.length)).map(c=>({x:c.x,y:c.y,score:c.score})).sort((a,b)=>b.score-a.score);
  const gx=4,gy=4,quota=10,buckets=Array.from({length:gx*gy},()=>[]);
  for(const c of candidates){
    if(c.x<4||c.x>=w-4||c.y<5||c.y>=h-7)continue;
    const bx=clamp(Math.floor(c.x/(w/gx)),0,gx-1),by=clamp(Math.floor(c.y/(h/gy)),0,gy-1);
    if(buckets[by*gx+bx].length<quota)buckets[by*gx+bx].push(c);
  }
  const chosen=[];
  const add=c=>{
    for(const p of chosen){const dx=p.x-c.x,dy=p.y-c.y;if(dx*dx+dy*dy<8)return false;}
    chosen.push(c);return true;
  };
  let round=0;
  while(chosen.length<MAX_CORNERS&&round<quota){
    for(const bucket of buckets){if(bucket[round])add(bucket[round]);if(chosen.length>=MAX_CORNERS)break;}
    round++;
  }
  if(chosen.length<MAX_CORNERS){
    for(const c of candidates){if(c.x<4||c.x>=w-4||c.y<5||c.y>=h-7)continue;add(c);if(chosen.length>=MAX_CORNERS)break;}
  }
  return{img,chosen,detected};
}
function makePyramid(img,w,h){const p=new jsfeat.pyramid_t(3);p.allocate(w,h,jsfeat.U8C1_t);p.build(img,false);return p;}
function baseResult(extra={}){
  return{
    detected:0,corners:0,lk:0,fb:0,lkRatio:0,fbRatio:0,
    forwardTracks:0,forwardCoherentTracks:0,rescueUsed:false,
    inliers:0,inlierRatio:0,domainTracks:0,domainInliers:0,domainInlierRatio:0,
    coverage:0,globalCoverage:0,reprojection:0,fbMedian:0,fbThreshold:0,
    flowMedian:0,flowLimit:0,upperFlow:0,lowerFlow:0,depthRatio:1,parallaxFactor:1,
    confidence:0,rawConfidence:0,safetyFactor:1,safetyFlags:'',dx:0,dy:0,roll:0,logScale:0,modelKind:'none',modelScore:0,
    coherentTracks:0,backgroundTracks:0,lowMotionTracks:0,translationGate:0,...extra
  };
}
function modelStats(robust,domain,allTracks,w,h,kind,threshold,penalty=0){
  if(!robust)return null;
  const globalInliers=allTracks.filter(p=>reproj(robust.model,p)<=threshold*1.08);
  const domainRatio=robust.inliers.length/Math.max(1,domain.length);
  const globalRatio=globalInliers.length/Math.max(1,allTracks.length);
  const countScore=clamp((robust.inliers.length-MIN_TRACKS+2)/TARGET_TRACKS,0,1);
  const errScore=clamp(1-robust.medianError/2.2,0,1);
  const score=.40*domainRatio+.20*countScore+.22*robust.coverage+.18*errScore-penalty;
  return{kind,robust,domainTracks:domain.length,domainInliers:robust.inliers.length,domainRatio,globalInliers,globalRatio,score,penalty};
}
function safetyGate(base,chosen,medianError,isRescue,confidence){
  let factor=1;const flags=[];
  if(chosen.robust.coverage<.25){factor*=.70;flags.push('coverage');}
  if(chosen.globalRatio<.35){factor*=.78;flags.push('global-inlier');}
  if(chosen.domainRatio<.45){factor*=.78;flags.push('domain-inlier');}
  if(medianError>1.0){factor*=.82;flags.push('reprojection');}
  if(base.parallaxFactor>2.4&&chosen.globalRatio<.35){factor*=.55;flags.push('extreme-parallax');}
  if(isRescue&&chosen.globalRatio<.30){factor*=.55;flags.push('rescue-global');}
  return{rawConfidence:confidence,safetyFactor:factor,safetyFlags:flags.join(','),confidence:clamp(confidence*factor,0,1)};
}

function temporalStabilize(result,frameIndex){
  if(!Number.isFinite(frameIndex)||result.source!=='ransac')return result;
  if(frameIndex===0)temporalModels.clear();
  const prev=temporalModels.get(frameIndex-1);
  let out={...result};
  if(prev&&prev.source==='ransac'){
    const trust=clamp(result.confidence,0,1);
    const guarded=(result.safetyFactor??1)<.95;
    const risky=(result.parallaxFactor||1)>1.40||result.rescueUsed||guarded||result.modelKind==='background'||result.modelKind==='lowmotion'||result.modelKind.startsWith('translation');
    const mix=risky?.48:(trust<.50?.32:.18);
    out.roll=prev.roll*mix+result.roll*(1-mix);
    out.logScale=prev.logScale*mix+result.logScale*(1-mix);
    out.dx=prev.dx*(risky?.40:.22)+result.dx*(risky?.60:.78);
    out.dy=prev.dy*(risky?.40:.22)+result.dy*(risky?.60:.78);
    const maxXY=risky?1.55:2.55,maxRoll=risky?.30:.42,maxScale=risky?.0045:.0065;
    out.dx=prev.dx+clamp(out.dx-prev.dx,-maxXY,maxXY);
    out.dy=prev.dy+clamp(out.dy-prev.dy,-maxXY,maxXY);
    out.roll=prev.roll+clamp(out.roll-prev.roll,-maxRoll,maxRoll);
    out.logScale=prev.logScale+clamp(out.logScale-prev.logScale,-maxScale,maxScale);
    out.temporalBlend=mix;
  }else out.temporalBlend=0;
  out.roll=clamp(out.roll,-MAX_STEP_ROLL,MAX_STEP_ROLL);
  out.logScale=clamp(out.logScale,-MAX_STEP_LOG_SCALE,MAX_STEP_LOG_SCALE);
  temporalModels.set(frameIndex,{source:out.source,dx:out.dx,dy:out.dy,roll:out.roll,logScale:out.logScale,confidence:out.confidence});
  if(temporalModels.size>24)for(const k of temporalModels.keys())if(k<frameIndex-10)temporalModels.delete(k);
  return out;
}

function analyze(msg){
  let stage='input';
  try{
    const{width:w,height:h,grayA,grayB,seed=1}=msg;
    if(!grayA||!grayB||!w||!h)throw new Error('invalid image payload');
    stage='decode';
    const aData=new Uint8Array(grayA),bData=new Uint8Array(grayB);
    if(aData.length!==w*h||bData.length!==w*h)throw new Error(`gray size mismatch ${aData.length}/${bData.length} expected ${w*h}`);

    stage='corners';
    const a=selectCorners(aData,w,h),bImg=new jsfeat.matrix_t(w,h,jsfeat.U8C1_t);bImg.data.set(bData);
    const corners=a.chosen,n=corners.length,base=baseResult({detected:a.detected,corners:n});
    if(n<MIN_TRACKS)return{...base,source:'fallback',reason:'features'};

    stage='pyramid';
    const pa=makePyramid(a.img,w,h),pb=makePyramid(bImg,w,h);
    const prev=new Float32Array(n*2),curr=new Float32Array(n*2),back=new Float32Array(n*2);
    for(let i=0;i<n;i++){prev[i*2]=curr[i*2]=corners[i].x;prev[i*2+1]=curr[i*2+1]=corners[i].y;}
    const st=new Uint8Array(n),stBack=new Uint8Array(n);
    stage='lk-forward';jsfeat.optical_flow_lk.track(pa,pb,prev,curr,n,19,24,st,.01,.0001);
    stage='lk-back';jsfeat.optical_flow_lk.track(pb,pa,curr,back,n,19,24,stBack,.01,.0001);

    stage='filter';
    const forward=[];
    for(let i=0;i<n;i++){
      if(!st[i])continue;
      base.lk++;
      const x0=prev[i*2],y0=prev[i*2+1],x1=curr[i*2],y1=curr[i*2+1];
      if(![x0,y0,x1,y1].every(Number.isFinite)||x1<1||x1>=w-1||y1<1||y1>=h-1)continue;
      const dx=x1-x0,dy=y1-y0,flow=Math.hypot(dx,dy);
      const hasBack=!!stBack[i]&&Number.isFinite(back[i*2])&&Number.isFinite(back[i*2+1]);
      const fb=hasBack?Math.hypot(back[i*2]-x0,back[i*2+1]-y0):Infinity;
      forward.push({x0,y0,x1,y1,dx,dy,flow,fb,hasBack});
    }
    base.forwardTracks=forward.length;
    base.lkRatio=base.lk/n;

    const flowVals=forward.map(p=>p.flow),flowMed=median(flowVals),flowSigma=1.4826*mad(flowVals,flowMed);
    const flowLimit=clamp(Math.max(FLOW_MIN,flowMed+3.2*flowSigma),FLOW_MIN,FLOW_MAX);
    const forwardFlow=forward.filter(p=>p.flow<=flowLimit);
    const backable=forwardFlow.filter(p=>p.hasBack);
    const fbVals=backable.map(p=>p.fb),fbMedAll=median(fbVals),fbSigma=1.4826*mad(fbVals,fbMedAll);
    const fbThreshold=clamp(Math.max(FB_MIN,fbMedAll+3.2*fbSigma),FB_MIN,FB_MAX);
    const tracks=backable.filter(p=>p.fb<=fbThreshold);

    base.fb=tracks.length;
    base.fbRatio=base.fb/Math.max(1,base.lk);
    base.fbMedian=median(tracks.map(p=>p.fb));
    base.fbThreshold=fbThreshold;base.flowMedian=flowMed;base.flowLimit=flowLimit;

    const flowSource=tracks.length>=MIN_TRACKS?tracks:forwardFlow;
    const up=flowSource.filter(p=>p.y0<h*.5).map(p=>p.flow),lo=flowSource.filter(p=>p.y0>=h*.5).map(p=>p.flow);
    base.upperFlow=median(up);base.lowerFlow=median(lo);
    base.depthRatio=base.upperFlow>.25?base.lowerFlow/base.upperFlow:(base.lowerFlow>.7?2:1);
    base.parallaxFactor=parallaxFactor(base.depthRatio);

    const consensusSource=tracks.length>=MIN_TRACKS?tracks:forwardFlow;
    const dxMed=median(consensusSource.map(p=>p.dx)),dyMed=median(consensusSource.map(p=>p.dy));
    const devs=consensusSource.map(p=>Math.hypot(p.dx-dxMed,p.dy-dyMed)),devMed=median(devs);
    const devSigma=1.4826*mad(devs,devMed),devLimit=clamp(Math.max(1.35,devMed+2.6*devSigma),1.35,5.0);

    const coherent=tracks.filter(p=>Math.hypot(p.dx-dxMed,p.dy-dyMed)<=devLimit);
    const flowMAD=1.4826*mad(consensusSource.map(p=>p.flow),flowMed);
    const lowMotionCut=Math.max(2.8,flowMed+.35*flowMAD);
    const lowMotion=tracks.filter(p=>p.flow<=lowMotionCut&&Math.hypot(p.dx-dxMed,p.dy-dyMed)<=devLimit*1.20);
    const far=tracks.filter(p=>p.y0<h*.72&&p.flow<=Math.max(4.5,flowMed*1.45+1.0));
    const farCoherent=far.filter(p=>Math.hypot(p.dx-dxMed,p.dy-dyMed)<=devLimit*1.15);
    base.coherentTracks=coherent.length;base.backgroundTracks=far.length;base.lowMotionTracks=lowMotion.length;

    const forwardDx=median(forwardFlow.map(p=>p.dx)),forwardDy=median(forwardFlow.map(p=>p.dy));
    const forwardDevs=forwardFlow.map(p=>Math.hypot(p.dx-forwardDx,p.dy-forwardDy));
    const forwardDevMed=median(forwardDevs),forwardDevSigma=1.4826*mad(forwardDevs,forwardDevMed);
    const forwardDevLimit=clamp(Math.max(1.45,forwardDevMed+2.3*forwardDevSigma),1.45,4.5);
    const forwardCoherent=forwardFlow.filter(p=>Math.hypot(p.dx-forwardDx,p.dy-forwardDy)<=forwardDevLimit);
    const forwardBackground=forwardCoherent.filter(p=>p.y0<h*.74);
    base.forwardCoherentTracks=forwardCoherent.length;

    const rThreshold=clamp(RANSAC_BASE+Math.min(.60,flowMed*.040),RANSAC_BASE,RANSAC_MAX);
    const candidates=[];
    const pushCandidate=(kind,domain,bias=0,penalty=0,seedOffset=0)=>{
      if(domain.length<MIN_TRACKS)return;
      const robust=ransacSimilarity(domain,w,h,seed+seedOffset,rThreshold,kind.startsWith('forward')?340:RANSAC_ITERATIONS);
      const s=modelStats(robust,domain,tracks.length?tracks:forwardFlow,w,h,kind,rThreshold,penalty);
      if(s){s.score+=bias;candidates.push(s);}
    };

    stage='ransac';
    if(tracks.length>=MIN_TRACKS){
      pushCandidate('full',tracks,.035,0,0);
      pushCandidate('coherent',coherent,coherent.length>=tracks.length*.52?.035:0,0,31);
      pushCandidate('background',farCoherent.length>=MIN_TRACKS?farCoherent:far,base.parallaxFactor>1.35?.13:-.02,0,17);
      pushCandidate('lowmotion',lowMotion,base.parallaxFactor>1.35?.09:.015,0,53);
    }

    const fbHealth=base.fb/Math.max(1,base.lk);
    const rescueCandidates=()=>{
      pushCandidate('forward-coherent',forwardCoherent,.02,.11,71);
      pushCandidate('forward-background',forwardBackground,base.parallaxFactor>1.35?.10:0,.12,89);
    };
    if(base.lk>=RESCUE_MIN_TRACKS&&(tracks.length<MIN_TRACKS||fbHealth<.36))rescueCandidates();
    if(!candidates.length&&base.lk>=RESCUE_MIN_TRACKS)rescueCandidates();

    if(!candidates.length){
      const translationDomain=(base.parallaxFactor>1.45&&forwardBackground.length>=RESCUE_MIN_TRACKS)
        ? forwardBackground
        : (forwardCoherent.length>=RESCUE_MIN_TRACKS?forwardCoherent:forwardFlow);
      const tr=robustTranslation(translationDomain,w,h);
      if(tr){
        const countScore=clamp((tr.inliers.length-RESCUE_MIN_TRACKS+3)/TARGET_TRACKS,0,1),errScore=clamp(1-tr.medianError/2.2,0,1);
        let confidence=clamp(.30*tr.ratio+.24*countScore+.24*tr.coverage+.22*errScore,0,1);
        confidence=clamp(confidence*(base.parallaxFactor>1.8?.78:.86),.24,.58);
        return{
          ...base,source:'ransac',reason:'translation-rescue',modelKind:base.parallaxFactor>1.45?'translation-background':'translation-rescue',rescueUsed:true,
          confidence,rawConfidence:confidence,safetyFactor:1,safetyFlags:'translation',tracks:tr.inliers.length,rawTracks:tracks.length,
          inliers:tr.inliers.length,inlierRatio:tr.ratio,domainTracks:translationDomain.length,domainInliers:tr.inliers.length,domainInlierRatio:tr.ratio,
          coverage:tr.coverage,globalCoverage:tr.coverage,reprojection:tr.medianError,translationGate:tr.gate,
          dx:clamp(tr.dx,-MAX_STEP_X,MAX_STEP_X),dy:clamp(tr.dy,-MAX_STEP_Y,MAX_STEP_Y),roll:0,logScale:0,
          modelScore:confidence
        };
      }
      const rescueDomain=forwardCoherent.length>=RESCUE_MIN_TRACKS?forwardCoherent:forwardFlow;
      if(rescueDomain.length>=RESCUE_MIN_TRACKS){
        const dx=median(rescueDomain.map(p=>p.dx)),dy=median(rescueDomain.map(p=>p.dy));
        return{...base,source:'worker-low',confidence:.12,rawConfidence:.12,safetyFactor:1,safetyFlags:'forward-consensus',tracks:rescueDomain.length,dx:clamp(dx,-MAX_STEP_X,MAX_STEP_X),dy:clamp(dy,-MAX_STEP_Y,MAX_STEP_Y),reason:'forward-consensus',rescueUsed:true,modelKind:'forward-consensus'};
      }
      return{...base,source:'fallback',reason:tracks.length<MIN_TRACKS?'fb':'ransac'};
    }

    candidates.sort((a,b)=>b.score-a.score);
    const chosen=candidates[0],{model,medianError}=chosen.robust;
    const riskyKind=chosen.kind==='background'||chosen.kind==='lowmotion'||chosen.kind.startsWith('forward');
    const cx=w/2,cy=riskyKind?h*.44:h*.50;
    const xx=model.a*cx-model.b*cy+model.tx,yy=model.b*cx+model.a*cy+model.ty;
    const fbInliers=chosen.robust.inliers.filter(p=>Number.isFinite(p.fb));
    const fbm=median(fbInliers.map(p=>p.fb));
    const fbScore=fbInliers.length?clamp(1-fbm/Math.max(fbThreshold,.001),0,1):.35;
    const countScore=clamp((chosen.domainInliers-MIN_TRACKS+2)/TARGET_TRACKS,0,1);
    const errScore=clamp(1-medianError/2.2,0,1);
    const isRescue=chosen.kind.startsWith('forward');
    let confidence=clamp(.30*chosen.domainRatio+.21*countScore+.19*chosen.robust.coverage+.17*errScore+.07*fbScore+.06*clamp((base.fbRatio-.18)/.50,0,1),0,1);
    if((chosen.kind==='background'||chosen.kind==='lowmotion')&&base.parallaxFactor>1.35)confidence=clamp(confidence+.06,0,1);
    if(isRescue)confidence=clamp(confidence*.80,0,.62);
    const safety=safetyGate(base,chosen,medianError,isRescue,confidence);
    confidence=safety.confidence;

    const globalCov=coverage(chosen.globalInliers,w,h);
    return{
      ...base,source:'ransac',confidence,rawConfidence:safety.rawConfidence,safetyFactor:safety.safetyFactor,safetyFlags:safety.safetyFlags,tracks:chosen.domainInliers,rawTracks:tracks.length,
      inliers:chosen.globalInliers.length,inlierRatio:chosen.globalRatio,
      domainTracks:chosen.domainTracks,domainInliers:chosen.domainInliers,domainInlierRatio:chosen.domainRatio,
      coverage:chosen.robust.coverage,globalCoverage:globalCov,reprojection:medianError,fbMedian:fbm,
      modelKind:chosen.kind,modelScore:chosen.score,rescueUsed:isRescue,
      dx:clamp(xx-cx,-MAX_STEP_X,MAX_STEP_X),dy:clamp(yy-cy,-MAX_STEP_Y,MAX_STEP_Y),
      roll:clamp(model.rotation,-MAX_STEP_ROLL,MAX_STEP_ROLL),
      logScale:clamp(Math.log(model.scale),-MAX_STEP_LOG_SCALE,MAX_STEP_LOG_SCALE),
      reason:isRescue?'forward-rescue':chosen.kind==='background'?'background-ok':chosen.kind==='lowmotion'?'lowmotion-ok':'ok'
    };
  }catch(error){error.journeyStage=stage;throw error;}
}

self.postMessage({type:'ready',engine:'jsfeat',build:'0.1.25'});
self.onmessage=event=>{
  const msg=event.data||{};if(msg.type!=='analyze')return;
  jobsReceived++;const started=performance.now();
  try{
    const raw=analyze(msg),frameIndex=Number.isFinite(msg.frameIndex)?msg.frameIndex:Math.round(((msg.seed||0)-(msg.width||0)*(msg.height||0))/31),result=temporalStabilize(raw,frameIndex);
    jobsCompleted++;
    self.postMessage({type:'result',id:msg.id,result:{...result,frameIndex,ms:performance.now()-started,jobsReceived,jobsCompleted,jobsErrored}});
  }catch(error){
    jobsErrored++;jobsCompleted++;
    self.postMessage({type:'result',id:msg.id,result:{...baseResult(),source:'worker-error',reason:'exception',error:String(error?.message||error),stage:error?.journeyStage||'unknown',frameIndex:Number.isFinite(msg.frameIndex)?msg.frameIndex:undefined,ms:performance.now()-started,jobsReceived,jobsCompleted,jobsErrored}});
  }
};