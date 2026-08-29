/* Streetview Journey v0.1.29 Visual Heading Calibration */
(()=>{
  'use strict';
  const VERSION='0.1.29';
  const MOTION_WAIT_COMPAT_MS=360;
  const MIN_AXIS_CONF=.16;
  const FULL_MIN_CONF=.20;
  const CAL_MIN_CONF=.18;
  const POSE_COMPENSATION=.78;
  const ANCHOR_WINDOW_RADIUS=2;
  const FULL_SAMPLE_COUNT=8;
  const BOOTSTRAP_WAIT_MS=720;
  const NativeWorker=window.Worker;
  const NativePost=NativeWorker?.prototype?.postMessage;
  const nativeSetTimeout=window.setTimeout.bind(window);
  const nativeDrawImage=CanvasRenderingContext2D.prototype.drawImage;
  const axisByFrame=new Map(),fullAxisByFrame=new Map(),urlToFrame=new Map(),metaAnchorCache=new Map(),bootstrapImages=new Map(),preflightPending=new Map();
  let routeFrames=[],routeSelection=null,generation=0,axisWorker=null,axisErrors=0,lastAxis=null,lastFullAxis=null,diagValue;
  let calibrationCache=null,bootstrapPromise=Promise.resolve(),bootstrapResolve=null,bootstrapGeneration=0,preflightSeq=0;

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const rad=v=>v*Math.PI/180,deg=v=>v*180/Math.PI;
  const angle=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?((b-a+540)%360)-180:0;
  const normalizeURL=value=>{try{const u=new URL(String(value||''),location.href);u.searchParams.delete('analysis');u.searchParams.delete('axisv');return u.href;}catch{return String(value||'').replace(/([?&])(analysis|axisv)=[^&]+(&|$)/g,'$1').replace(/[?&]$/,'');}};
  const weightedMedian=items=>{if(!items.length)return 0;const s=[...items].sort((a,b)=>a.v-b.v),total=s.reduce((n,x)=>n+x.w,0);let acc=0;for(const item of s){acc+=item.w;if(acc>=total*.5)return item.v;}return s[s.length-1].v;};
  const median=a=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!s.length)return 0;const m=s.length>>1;return s.length&1?s[m]:(s[m-1]+s[m])*.5;};
  const hasCoords=f=>Number.isFinite(f?.lat)&&Number.isFinite(f?.lng);
  function distanceMeters(a,b){if(!hasCoords(a)||!hasCoords(b))return Infinity;const p1=rad(a.lat),p2=rad(b.lat),dp=p2-p1,dl=rad(b.lng-a.lng),s=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 12742000*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)));}
  function bearing(a,b){if(!hasCoords(a)||!hasCoords(b))return null;const p1=rad(a.lat),p2=rad(b.lat),dl=rad(b.lng-a.lng),y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return(deg(Math.atan2(y,x))+360)%360;}
  function travelBearing(i){
    const c=routeFrames[i];if(!c)return null;let sx=0,sy=0,sw=0;
    for(let s=1;s<=8;s++)if(i+s<routeFrames.length){const n=routeFrames[i+s],d=distanceMeters(c,n);if(Number.isFinite(d)&&d>=.7){const br=bearing(c,n),w=Math.min(d,16)/(1+.38*(s-1));sx+=Math.cos(rad(br))*w;sy+=Math.sin(rad(br))*w;sw+=w;if(d>=20)break;}}
    for(let s=1;s<=5;s++)if(i-s>=0){const p=routeFrames[i-s],d=distanceMeters(p,c);if(Number.isFinite(d)&&d>=.7){const br=bearing(p,c),w=.62*Math.min(d,14)/(1+.48*(s-1));sx+=Math.cos(rad(br))*w;sy+=Math.sin(rad(br))*w;sw+=w;if(d>=18)break;}}
    if(sw)return(deg(Math.atan2(sy,sx))+360)%360;return Number.isFinite(c.heading)?c.heading:(Number.isFinite(c.projectionYaw)?c.projectionYaw:null);
  }
  const isSphere=f=>String(f?.projection||'').toUpperCase()==='SPHERE'||(Number.isFinite(f?.fieldOfView)&&f.fieldOfView>=180);
  function rawMetadataAnchor(i){const f=routeFrames[i];if(!f)return 50;const tr=travelBearing(i),ih=Number.isFinite(f.heading)?f.heading:f.projectionYaw;if(!Number.isFinite(tr)||!Number.isFinite(ih))return 50;const d=angle(ih,tr);return isSphere(f)?clamp(50+d/3.6,0,100):clamp(50+d/clamp(f.fieldOfView||100,45,170)*100,5,95);}
  function metadataAnchor(i){
    if(metaAnchorCache.has(i))return metaAnchorCache.get(i);const base=rawMetadataAnchor(i),sph=isSphere(routeFrames[i]);let sum=0,sw=0;
    for(let k=Math.max(0,i-ANCHOR_WINDOW_RADIUS);k<=Math.min(routeFrames.length-1,i+ANCHOR_WINDOW_RADIUS);k++){let v=rawMetadataAnchor(k);if(sph||isSphere(routeFrames[k])){let d=v-base;if(d>50)d-=100;if(d<-50)d+=100;v=base+d;}const dist=Math.abs(k-i),w=dist===0?4:dist===1?2:1;sum+=v*w;sw+=w;}
    let out=sw?sum/sw:base;if(sph)out=((out%100)+100)%100;else out=clamp(out,5,95);metaAnchorCache.set(i,out);return out;
  }
  function frameAspect(i){const f=routeFrames[i],w=Number(f?.width),h=Number(f?.height);if(w>0&&h>0)return w/h;if(isSphere(f))return 2;return 16/9;}
  function cropViewFraction(i){const aspect=frameAspect(i),canvasAspect=80/120;return clamp((aspect>canvasAspect?canvasAspect/aspect:1)/1.045,.10,1);}
  function wrappedBias(value,base,sphere){let d=value-base;if(sphere){while(d>.5)d-=1;while(d<-.5)d+=1;}return d;}

  function observationFromResult(r,space){
    if(!r||!Number.isFinite(r.frame)||!Number.isFinite(r.centerX)||!Number.isFinite(r.confidence))return null;
    const i=r.frame,sph=isSphere(routeFrames[i]);let x=r.centerX;
    if(space!=='full-image'){
      const a=metadataAnchor(i)/100,vf=cropViewFraction(i);
      x=a+vf*(r.centerX-a);
    }
    if(sph){while(x<-.5)x+=1;while(x>1.5)x-=1;}
    const cov=Number.isFinite(r.coverage)?r.coverage:.35,ir=Number.isFinite(r.inlierRatio)?r.inlierRatio:.35,err=Number.isFinite(r.medErr)?r.medErr:2.2;
    const quality=clamp(r.confidence,0,1)*(.55+.45*clamp(cov,0,1))*(.65+.35*clamp(ir,0,1))*clamp(1.18-err/7,.45,1);
    const spaceWeight=space==='full-image'?1:.32,kindWeight=r.kind==='side-flow'?.78:1;
    return{frame:i,x,confidence:r.confidence,quality:quality*spaceWeight*kindWeight,space,kind:r.kind||'unknown',outside:x<0||x>1};
  }
  function allObservations(){const out=[];for(const r of fullAxisByFrame.values()){const o=observationFromResult(r,'full-image');if(o&&o.confidence>=FULL_MIN_CONF)out.push(o);}for(const r of axisByFrame.values()){const o=observationFromResult(r,'render-crop');if(o&&o.confidence>=MIN_AXIS_CONF)out.push(o);}return out;}
  function computeCalibration(){
    if(calibrationCache)return calibrationCache;
    const observations=allObservations(),items=[],full=[];let cropCount=0;
    for(const o of observations){const base=metadataAnchor(o.frame)/100,d=wrappedBias(o.x,base,isSphere(routeFrames[o.frame])),w=Math.max(.02,o.quality);items.push({v:d,w,o});if(o.space==='full-image')full.push(o);else cropCount++;}
    if(!items.length)return calibrationCache={bias:0,confidence:0,spread:1,samples:0,fullSamples:0,cropSamples:0,cameraYawBiasDeg:0,source:'metadata-only',outsideRate:0};
    let bias=weightedMedian(items),dev=items.map(x=>Math.abs(x.v-bias)),spread=median(dev),sumW=items.reduce((s,x)=>s+x.w,0),meanQ=sumW/items.length;
    const enough=full.length>=2||cropCount>=10,sampleStrength=clamp(full.length/4+cropCount/24,0,1),stability=clamp(1-spread/.18,.12,1),confidence=enough?clamp(sampleStrength*stability*(.55+.75*meanQ),0,1):clamp(sampleStrength*.35,0,.28);
    bias=clamp(bias,-.48,.48);const fov=median(routeFrames.map(f=>Number(f?.fieldOfView)).filter(v=>Number.isFinite(v)&&v>0&&v<200))||100;
    const outsideRate=observations.length?observations.filter(o=>o.outside).length/observations.length:0;
    calibrationCache={bias,confidence,spread,samples:items.length,fullSamples:full.length,cropSamples:cropCount,cameraYawBiasDeg:bias*fov,source:confidence>=CAL_MIN_CONF?(Math.abs(bias)>=.055?'visual-calibrated':'metadata-confirmed'):'metadata-only',outsideRate};
    return calibrationCache;
  }
  function localBias(frame,globalBias){
    const items=[];
    for(const r of fullAxisByFrame.values()){const o=observationFromResult(r,'full-image');if(!o||o.confidence<FULL_MIN_CONF)continue;const d=Math.abs(o.frame-frame);if(d>12)continue;items.push({v:wrappedBias(o.x,metadataAnchor(o.frame)/100,isSphere(routeFrames[o.frame])),w:o.quality*(1.5/(1+d*.16))});}
    for(let k=Math.max(0,frame-3);k<=Math.min(routeFrames.length-2,frame+3);k++){const r=axisByFrame.get(k),o=observationFromResult(r,'render-crop');if(!o||o.confidence<MIN_AXIS_CONF)continue;const d=Math.abs(k-frame);items.push({v:wrappedBias(o.x,metadataAnchor(k)/100,isSphere(routeFrames[k])),w:o.quality*(d===0?1:d===1?.72:.42)});}
    if(!items.length)return{bias:globalBias,confidence:0};const b=weightedMedian(items),spread=median(items.map(x=>Math.abs(x.v-b))),confidence=clamp(items.reduce((s,x)=>s+x.w,0)/2.2,0,1)*clamp(1-spread/.16,.25,1);return{bias:b,confidence};
  }
  function effectiveAnchor(frame){
    const meta=metadataAnchor(frame)/100,sph=isSphere(routeFrames[frame]),cal=computeCalibration(),local=localBias(frame,cal.bias);let bias=cal.bias,source=cal.source;
    if(local.confidence>.18){const lw=clamp(.18+local.confidence*.58,.18,.74);bias=bias*(1-lw)+local.bias*lw;source=Math.abs(bias)>=.055?'visual-local':'metadata-confirmed';}
    let gain=clamp((cal.confidence-.08)/.42,0,1);if(cal.fullSamples>=3&&cal.spread<.10)gain=Math.max(gain,.82);if(local.confidence>.55)gain=Math.max(gain,.72);
    if(cal.confidence<CAL_MIN_CONF&&local.confidence<.38){bias=0;gain=0;source='metadata-only';}
    let raw=meta+bias*gain;if(sph)raw=((raw%1)+1)%1;const outside=!sph&&(raw<0||raw>1);const anchor=sph?raw:clamp(raw,.02,.98);
    if(outside)source='visual-edge-limit';
    return{anchor,meta,bias:bias*gain,confidence:Math.max(cal.confidence,local.confidence),source,outside,calibration:cal};
  }

  const state=window.__journeyTravelAxis={
    version:VERSION,mode:'visual heading calibration + full-image FOE + metadata fallback',worker:'starting',workerReady:false,
    generation:0,routeFrames:0,routeSelection:null,latest:null,latestFull:null,appliedFrame:null,appliedShift:0,visualShift:0,poseCompensation:0,metadataAnchor:50,effectiveAnchor:50,anchorSource:'metadata-only',appliedConfidence:0,outsideFov:false,errors:0,
    anchorForFrame(frame,fallback){if(!Number.isFinite(frame)||frame<0||frame>=routeFrames.length)return Number.isFinite(fallback)?fallback:50;const e=effectiveAnchor(frame);return e.anchor*100;},
    waitForBootstrap(timeout=BOOTSTRAP_WAIT_MS){return Promise.race([bootstrapPromise,new Promise(r=>nativeSetTimeout(r,timeout))]);},
    snapshot(){const vals=[...axisByFrame.values()].filter(v=>Number.isFinite(v?.confidence)),good=vals.filter(v=>v.confidence>=MIN_AXIS_CONF),fullVals=[...fullAxisByFrame.values()].filter(v=>Number.isFinite(v?.confidence)),fullGood=fullVals.filter(v=>v.confidence>=FULL_MIN_CONF),cal=computeCalibration();return{version:VERSION,mode:this.mode,worker:this.worker,workerReady:this.workerReady,generation,routeFrames:routeFrames.length,routeSelection,results:vals.length,usable:good.length,averageConfidence:good.length?good.reduce((s,v)=>s+v.confidence,0)/good.length:0,fullResults:fullVals.length,fullUsable:fullGood.length,fullAverageConfidence:fullGood.length?fullGood.reduce((s,v)=>s+v.confidence,0)/fullGood.length:0,calibrationBias:cal.bias,calibrationConfidence:cal.confidence,calibrationSpread:cal.spread,calibrationSamples:cal.samples,fullCalibrationSamples:cal.fullSamples,cropCalibrationSamples:cal.cropSamples,cameraYawBiasDeg:cal.cameraYawBiasDeg,calibrationSource:cal.source,outsideObservationRate:cal.outsideRate,latest:lastAxis,latestFull:lastFullAxis,appliedFrame:this.appliedFrame,appliedShift:this.appliedShift,visualShift:this.visualShift,poseCompensation:this.poseCompensation,metadataAnchor:this.metadataAnchor,effectiveAnchor:this.effectiveAnchor,anchorSource:this.anchorSource,appliedConfidence:this.appliedConfidence,outsideFov:this.outsideFov,errors:axisErrors};}
  };

  try{Object.defineProperty(window,'__journeyDiagnostics',{configurable:true,get(){return diagValue;},set(v){diagValue=v;if(v&&typeof v==='object'){v.version=VERSION;v.travelAxis='visual-heading-calibration';v.travelAxisState=state;}}});}catch{}
  window.setTimeout=function(fn,ms,...args){const adjusted=Number(ms)===85?MOTION_WAIT_COMPAT_MS:ms;return nativeSetTimeout(fn,adjusted,...args);};

  function loadBootstrapImage(url){const key=normalizeURL(url);if(bootstrapImages.has(key))return bootstrapImages.get(key);const p=new Promise((resolve,reject)=>{const im=new Image();im.crossOrigin='anonymous';im.referrerPolicy='no-referrer';im.decoding='async';im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('axis image load failed'));im.src=`${key}${key.includes('?')?'&':'?'}axisv=${VERSION}`;});bootstrapImages.set(key,p);return p;}
  function grayPair(imA,imB){const ratioA=imA.naturalWidth/Math.max(1,imA.naturalHeight),ratioB=imB.naturalWidth/Math.max(1,imB.naturalHeight),ratio=(ratioA+ratioB)/2,w=160,h=clamp(Math.round(w/Math.max(.65,ratio)),72,128);const make=im=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(im,0,0,w,h);const d=g.getImageData(0,0,w,h).data,o=new Uint8Array(w*h);for(let k=0,j=0;k<o.length;k++,j+=4)o[k]=Math.round(d[j]*.299+d[j+1]*.587+d[j+2]*.114);return o;};return{w,h,a:make(imA),b:make(imB)};}
  async function submitFullAxis(frame,gen){
    if(gen!==generation||!axisWorker||frame<0||frame>=routeFrames.length-1)return false;
    try{const[imA,imB]=await Promise.all([loadBootstrapImage(routeFrames[frame].url),loadBootstrapImage(routeFrames[frame+1].url)]);if(gen!==generation)return false;const g=grayPair(imA,imB),a=g.a.buffer,b=g.b.buffer;NativePost.call(axisWorker,{type:'axis',space:'full-image',frame,generation:gen,width:g.w,height:g.h,grayA:a,grayB:b,seed:frame*173+g.w*g.h},[a,b]);return true;}catch{return false;}
  }

  function submitPreflightPair(frames,frame){
    return new Promise(async resolve=>{
      if(!axisWorker||!Array.isArray(frames)||frame<0||frame>=frames.length-1){resolve(null);return;}
      const requestId=`pf-${++preflightSeq}`;let timer=null;
      preflightPending.set(requestId,{resolve:r=>{if(timer)clearTimeout(timer);preflightPending.delete(requestId);resolve(r);}});
      timer=nativeSetTimeout(()=>{const p=preflightPending.get(requestId);if(p){preflightPending.delete(requestId);resolve(null);}},320);
      try{
        const[imA,imB]=await Promise.all([loadBootstrapImage(frames[frame].url),loadBootstrapImage(frames[frame+1].url)]),g=grayPair(imA,imB),a=g.a.buffer,b=g.b.buffer;
        NativePost.call(axisWorker,{type:'axis',space:'preflight',requestId,frame,generation:-1,width:g.w,height:g.h,grayA:a,grayB:b,seed:frame*211+g.w*g.h},[a,b]);
      }catch{const p=preflightPending.get(requestId);if(p){preflightPending.delete(requestId);if(timer)clearTimeout(timer);resolve(null);}}
    });
  }
  async function preflightCandidate(candidate){
    const frames=Array.isArray(candidate?.frames)?candidate.frames:[];if(frames.length<2)return{sequenceId:candidate?.sequenceId||null,visualScore:0,confidence:0,outsideRate:1,samples:0};
    const n=frames.length-1,inds=[...new Set([0,Math.round(n*.5),Math.max(0,n-1)])],results=await Promise.all(inds.map(i=>submitPreflightPair(frames,i))),good=results.filter(r=>r&&Number.isFinite(r.centerX)&&Number.isFinite(r.confidence)&&r.confidence>=.16);
    if(!good.length)return{sequenceId:candidate.sequenceId,visualScore:.12,confidence:0,outsideRate:1,samples:0};
    let sw=0,sv=0,sc=0,out=0;for(const r of good){const outside=r.centerX<0||r.centerX>1;if(outside)out++;const margin=outside?0:clamp(1-Math.abs(r.centerX-.5)/.52,0,1),kindGain=String(r.kind||'').startsWith('side-flow')?.58:1,w=Math.max(.04,r.confidence)*(.55+.45*clamp(r.coverage||.35,0,1))*kindGain;sv+=margin*w;sc+=r.confidence*w;sw+=w;}
    const visualScore=sw?sv/sw:0,confidence=sw?sc/sw:0,outsideRate=out/good.length;return{sequenceId:candidate.sequenceId,visualScore,confidence,outsideRate,samples:good.length,score:clamp(visualScore*.72+confidence*.28,0,1)};
  }
  async function chooseVisualCandidate(data){
    const candidates=Array.isArray(data?.candidateRoutes)?data.candidateRoutes.filter(c=>Array.isArray(c?.frames)&&c.frames.length>=2).slice(0,3):[];if(candidates.length<2)return null;
    bootstrapImages.clear();
    const first=await preflightCandidate(candidates[0]);
    const evaluations=[{candidate:candidates[0],preflight:first}];
    if(first.samples>=2&&first.score>=.60&&first.outsideRate<=.34)return{candidate:candidates[0],evaluations};
    const rest=await Promise.all(candidates.slice(1).map(async c=>({candidate:c,preflight:await preflightCandidate(c)})));evaluations.push(...rest);
    let best=evaluations[0],bestScore=-1;for(const e of evaluations){const meta=clamp(Number(e.candidate.score)||0,0,1),pf=e.preflight,combined=pf.score*.68+meta*.32-(pf.outsideRate||0)*.18;if(combined>bestScore){bestScore=combined;best=e;}}
    return{candidate:best.candidate,evaluations,bestScore};
  }

  function bootstrapIndices(){const n=routeFrames.length-1;if(n<=0)return[];const raw=[0,1,2,Math.round(n*.20),Math.round(n*.40),Math.round(n*.60),Math.round(n*.80),n-1];return[...new Set(raw.map(v=>clamp(v,0,n-1)))].slice(0,FULL_SAMPLE_COUNT);}
  function beginBootstrap(gen){
    bootstrapGeneration=gen;bootstrapPromise=new Promise(resolve=>{bootstrapResolve=resolve;});
    const inds=bootstrapIndices();if(!inds.length){bootstrapResolve?.();return bootstrapPromise;}
    (async()=>{for(let p=0;p<inds.length;p+=2){if(gen!==generation)break;await Promise.allSettled(inds.slice(p,p+2).map(i=>submitFullAxis(i,gen)));await new Promise(r=>nativeSetTimeout(r,18));}nativeSetTimeout(()=>{if(gen===generation)bootstrapResolve?.();},120);})();
    nativeSetTimeout(()=>{if(gen===generation)bootstrapResolve?.();},BOOTSTRAP_WAIT_MS);return bootstrapPromise;
  }
  function maybeResolveBootstrap(){if(bootstrapGeneration!==generation||!bootstrapResolve)return;const good=[...fullAxisByFrame.values()].filter(r=>r.confidence>=FULL_MIN_CONF);if(good.length>=3){bootstrapResolve();bootstrapResolve=null;}}

  function resetRoute(frames,selection=null){
    generation++;routeFrames=Array.isArray(frames)?frames:[];routeSelection=selection&&typeof selection==='object'?JSON.parse(JSON.stringify(selection)):null;
    urlToFrame.clear();axisByFrame.clear();fullAxisByFrame.clear();metaAnchorCache.clear();calibrationCache=null;lastAxis=null;lastFullAxis=null;bootstrapImages.clear();
    for(let i=0;i<routeFrames.length;i++)if(routeFrames[i]?.url)urlToFrame.set(normalizeURL(routeFrames[i].url),i);
    Object.assign(state,{generation,routeFrames:routeFrames.length,routeSelection,latest:null,latestFull:null,appliedFrame:null,appliedShift:0,visualShift:0,poseCompensation:0,metadataAnchor:50,effectiveAnchor:50,anchorSource:'metadata-only',appliedConfidence:0,outsideFov:false});
    try{NativePost?.call(axisWorker,{type:'reset',generation});}catch{}
    return beginBootstrap(generation);
  }

  if(window.Response?.prototype?.json){const nativeJson=Response.prototype.json;Response.prototype.json=async function(...args){const data=await nativeJson.apply(this,args);try{if(String(this.url||'').includes('/api/imagery')&&Array.isArray(data?.frames)){const picked=await Promise.race([chooseVisualCandidate(data),new Promise(r=>nativeSetTimeout(()=>r(null),900))]);if(picked?.candidate){const original=data.sequenceId,best=picked.candidate;data.sequenceId=best.sequenceId;data.anchorIndex=best.anchorIndex;data.frames=best.frames;const visualPreflight=picked.evaluations.map(e=>({sequenceId:e.candidate.sequenceId,metadataScore:e.candidate.score,visualScore:e.preflight.visualScore,confidence:e.preflight.confidence,outsideRate:e.preflight.outsideRate,samples:e.preflight.samples}));data.selection={...(data.selection||{}),strategy:'direction+visual',metadataChosenSequenceId:original,visualOverride:String(original)!==String(best.sequenceId),direction:best.direction||data.selection?.direction,alignmentErrorDeg:Number.isFinite(best.alignmentErrorDeg)?best.alignmentErrorDeg:data.selection?.alignmentErrorDeg,score:Number.isFinite(best.score)?best.score:data.selection?.score,proximityMeters:Number.isFinite(best.proximityMeters)?best.proximityMeters:data.selection?.proximityMeters,visualPreflight};}const ready=resetRoute(data.frames,data.selection||null);await Promise.race([ready,new Promise(r=>nativeSetTimeout(r,BOOTSTRAP_WAIT_MS))]);}}catch{}return data;};}

  function inferFrame(message){if(Number.isFinite(message?.frameIndex))return message.frameIndex;const w=Number(message?.width)||0,h=Number(message?.height)||0,seed=Number(message?.seed);if(Number.isFinite(seed)&&w&&h){const v=(seed-w*h)/31;if(Number.isFinite(v)&&Math.abs(v-Math.round(v))<.08)return Math.round(v);}return null;}

  if(NativeWorker&&NativePost){
    try{
      axisWorker=new NativeWorker(`/travel-axis-worker.js?v=${VERSION}`);
      axisWorker.addEventListener('message',event=>{
        const m=event.data||{};
        if(m.type==='axis-ready'){state.worker=m.engine||'tile-flow';state.workerReady=true;return;}
        if(m.type==='axis-boot-error'){axisErrors++;state.worker='fallback';state.workerReady=false;state.errors=axisErrors;bootstrapResolve?.();return;}
        if(m.type==='axis-error'){axisErrors++;state.errors=axisErrors;return;}
        if(m.type!=='axis-result'||!m.result)return;
        const r=m.result;if(r.space==='preflight'&&r.requestId){const p=preflightPending.get(r.requestId);if(p)p.resolve(r);return;}
        if(r.generation!==generation||!Number.isFinite(r.frame))return;calibrationCache=null;
        if(r.space==='full-image'){fullAxisByFrame.set(r.frame,r);lastFullAxis={...r};state.latestFull=lastFullAxis;maybeResolveBootstrap();}
        else{axisByFrame.set(r.frame,r);lastAxis={...r};state.latest=lastAxis;window.dispatchEvent(new CustomEvent('journey-travel-axis',{detail:{...r}}));}
      });
      axisWorker.addEventListener('error',()=>{axisErrors++;state.worker='fallback';state.workerReady=false;state.errors=axisErrors;bootstrapResolve?.();});
      NativeWorker.prototype.postMessage=function(message,transfer){
        if(this!==axisWorker&&message?.type==='analyze'&&message?.grayA instanceof ArrayBuffer&&message?.grayB instanceof ArrayBuffer){const frame=inferFrame(message);if(Number.isFinite(frame)&&frame>=0&&frame<10000){try{const a=message.grayA.slice(0),b=message.grayB.slice(0);NativePost.call(axisWorker,{type:'axis',space:'render-crop',frame,generation,width:message.width,height:message.height,grayA:a,grayB:b,seed:message.seed||frame*97},[a,b]);}catch{}}}
        return NativePost.call(this,message,transfer);
      };
    }catch{state.worker='fallback';state.workerReady=false;axisErrors++;state.errors=axisErrors;bootstrapResolve?.();}
  }else state.worker='unsupported';

  function frameForImage(image){if(!(image instanceof HTMLImageElement))return null;const key=normalizeURL(image.currentSrc||image.src),direct=urlToFrame.get(key);return Number.isFinite(direct)?direct:null;}
  function centeredCropX(canvasWidth,drawWidth,anchorPercent){if(!Number.isFinite(canvasWidth)||!Number.isFinite(drawWidth)||drawWidth<=0)return 0;if(drawWidth<=canvasWidth)return(canvasWidth-drawWidth)/2;const a=clamp(anchorPercent,0,100)/100;return clamp(canvasWidth*.5-drawWidth*a,canvasWidth-drawWidth,0);}

  CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
    try{
      if(args.length===4&&this.canvas&&this.canvas.width>160&&this.canvas.height>220){const frame=frameForImage(image);if(Number.isFinite(frame)){let[x,y,w,h]=args;if([x,y,w,h].every(Number.isFinite)&&w>this.canvas.width*.92){const cw=this.canvas.width,ch=this.canvas.height,e=effectiveAnchor(frame),meta=e.meta*100,anchor=e.anchor*100,metaX=centeredCropX(cw,w,meta),baseX=centeredCropX(cw,w,anchor),m=typeof this.getTransform==='function'?this.getTransform():null,centerScreenShift=m?(m.a*(cw*.5)+m.c*(ch*.5)+m.e-cw*.5):0,mapX=m&&Number.isFinite(m.a)&&Math.abs(m.a)>.55?m.a:1,poseSource=clamp((-centerScreenShift*POSE_COMPENSATION)/mapX,-cw*.085,cw*.085),margin=Math.min(cw*.012,5),minX=cw-w+margin,maxX=-margin,safeMin=minX<=maxX?minX:cw-w,safeMax=minX<=maxX?maxX:0,correctedX=clamp(baseX+poseSource,safeMin,safeMax);x=correctedX;args=[x,y,w,h];Object.assign(state,{appliedFrame:frame,metadataAnchor:meta,effectiveAnchor:anchor,anchorSource:e.source,visualShift:e.anchor-e.meta,poseCompensation:(poseSource*mapX)/cw,appliedShift:(correctedX-metaX)*mapX/cw,appliedConfidence:e.confidence,outsideFov:e.outside});}}}
    }catch{}
    return nativeDrawImage.call(this,image,...args);
  };

  function updateDiagnosticLine(){
    const box=document.getElementById('journeyDiag');if(!box)return;const head=box.querySelector('.jd-head b');if(head)head.textContent='PHASE 1.6 DIAG';let line=document.getElementById('jdAxis');if(!line){line=document.createElement('div');line.id='jdAxis';const ref=document.getElementById('jdApplied')||document.getElementById('jdLine4');ref?.insertAdjacentElement('afterend',line);}const snap=state.snapshot(),dir=snap.appliedShift<-.008?'→':snap.appliedShift>.008?'←':'•',sel=snap.routeSelection,selText=String(sel?.strategy||'').startsWith('direction')?`${sel.direction==='reverse'?'REV':'FWD'} ${Number.isFinite(sel.alignmentErrorDeg)?Math.round(sel.alignmentErrorDeg)+'°':'—'}`:'FIX',calText=snap.calibrationConfidence>=CAL_MIN_CONF?`Cal ${Math.round(snap.cameraYawBiasDeg)}°/${Math.round(snap.calibrationConfidence*100)}%`:'Cal wait',edge=snap.outsideFov?' EDGE':'';line.textContent=`Axis ${state.workerReady?'Ready':'Fallback'} / Sel ${selText} / Full ${snap.fullUsable}/${snap.fullResults} / ${calText} / ${snap.anchorSource}${edge} / Meta ${Math.round(snap.metadataAnchor||50)}→${Math.round(snap.effectiveAnchor||50)} / ${dir}${Math.round(Math.abs(snap.appliedShift||0)*100)}%`;line.style.color='rgba(255,215,145,.96)';if(diagValue&&typeof diagValue==='object'){diagValue.version=VERSION;diagValue.travelAxisSnapshot=snap;}
  }
  nativeSetTimeout(updateDiagnosticLine,120);setInterval(updateDiagnosticLine,250);
})();
