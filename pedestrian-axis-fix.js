/* Streetview Journey pedestrian vanishing-point calibration v0.3.1 */
(()=>{
  'use strict';
  if(window.__pedestrianAxisFixInstalled)return;
  window.__pedestrianAxisFixInstalled=true;
  const VERSION='0.3.1';
  const STEP_MAX=2.2,MIN_STEPS=3,ANALYSIS_W=160,ANALYSIS_H=120;
  const MIN_CONF=.18,MAX_SAMPLE_PAIRS=5,PAIR_TIMEOUT_MS=700,TOTAL_TIMEOUT_MS=1100;
  const ABS_MIN_ANCHOR=18,ABS_MAX_ANCHOR=82,VISUAL_RESIDUAL_MAX_PCT=10,SMOOTH_ALPHA=.42;
  const STREAM_POLL_MS=180,LOOKAHEAD_FRAMES=70,MIN_RANGE_FRAMES=6;
  const FLIP_TRIGGER_DEG=105,FLIP_IMPROVEMENT_DEG=35;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const rad=v=>v*Math.PI/180,deg=v=>v*180/Math.PI;
  const angle=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?((b-a+540)%360)-180:0;
  const median=a=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!s.length)return null;const m=s.length>>1;return s.length&1?s[m]:(s[m-1]+s[m])*.5};
  const hasCoords=f=>Number.isFinite(+f?.lat)&&Number.isFinite(+f?.lng);
  function distanceMeters(a,b){if(!hasCoords(a)||!hasCoords(b))return Infinity;const p1=rad(+a.lat),p2=rad(+b.lat),dp=p2-p1,dl=rad(+b.lng-+a.lng),s=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 12742000*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)))}
  function bearing(a,b){if(!hasCoords(a)||!hasCoords(b))return null;const p1=rad(+a.lat),p2=rad(+b.lat),dl=rad(+b.lng-+a.lng),y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return(deg(Math.atan2(y,x))+360)%360}
  function travelBearing(frames,i,start,end){const c=frames[i];if(!c)return null;let sx=0,sy=0,sw=0;for(let s=1;s<=20&&i+s<=end;s++){const n=frames[i+s],d=distanceMeters(c,n);if(Number.isFinite(d)&&d>=2.8){const br=bearing(c,n),w=Math.min(d,16)/(1+.15*(s-1));sx+=Math.cos(rad(br))*w;sy+=Math.sin(rad(br))*w;sw+=w;if(d>=11)break}}for(let s=1;s<=14&&i-s>=start;s++){const p=frames[i-s],d=distanceMeters(p,c);if(Number.isFinite(d)&&d>=2.8){const br=bearing(p,c),w=.68*Math.min(d,13)/(1+.18*(s-1));sx+=Math.cos(rad(br))*w;sy+=Math.sin(rad(br))*w;sw+=w;if(d>=10)break}}return sw?(deg(Math.atan2(sy,sx))+360)%360:(Number.isFinite(+c.heading)?+c.heading:null)}
  function pedestrian(frames,start,end){const steps=[];for(let i=start+1;i<=end;i++){const d=distanceMeters(frames[i-1],frames[i]);if(Number.isFinite(d)&&d>.05&&d<12)steps.push(d)}const m=median(steps);return{yes:steps.length>=MIN_STEPS&&Number.isFinite(m)&&m<=STEP_MAX,medianStep:m,samples:steps.length}}
  function sourceUrl(f){return f?.raw256Url||f?.thumb_256_url||f?.raw1024Url||f?.sourceUrl||f?.url||''}
  function proxyUrl(u){if(!u)return'';try{const x=new URL(u,location.href);if(x.origin===location.origin)return u}catch{}return `/api/imagery?mode=mapillary-image&url=${encodeURIComponent(u)}`}
  function loadImage(url){return new Promise((resolve,reject)=>{const im=new Image();im.crossOrigin='anonymous';im.referrerPolicy='no-referrer';im.decoding='async';const timer=setTimeout(()=>{im.src='';reject(new Error('axis-image-timeout'))},PAIR_TIMEOUT_MS);im.onload=()=>{clearTimeout(timer);resolve(im)};im.onerror=()=>{clearTimeout(timer);reject(new Error('axis-image-error'))};im.src=proxyUrl(url)})}
  function gray(im){const c=document.createElement('canvas');c.width=ANALYSIS_W;c.height=ANALYSIS_H;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(im,0,0,ANALYSIS_W,ANALYSIS_H);const d=g.getImageData(0,0,ANALYSIS_W,ANALYSIS_H).data,o=new Uint8Array(ANALYSIS_W*ANALYSIS_H);for(let i=0,j=0;i<o.length;i++,j+=4)o[i]=Math.round(d[j]*.299+d[j+1]*.587+d[j+2]*.114);return o}
  let worker=null,seq=0;const pending=new Map(),rangeState=new Map();
  function ensureWorker(){if(worker)return worker;try{worker=new Worker('/travel-axis-worker.js?v=0.1.31');worker.onmessage=e=>{const m=e.data||{},r=m.result;if(m.type!=='axis-result'||!r?.requestId)return;const p=pending.get(r.requestId);if(!p)return;pending.delete(r.requestId);clearTimeout(p.timer);p.resolve(r)};worker.onerror=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.resolve(null)}pending.clear()}}catch{}return worker}
  async function analyzePair(frames,i){const w=ensureWorker();if(!w)return null;try{const[a,b]=await Promise.all([loadImage(sourceUrl(frames[i])),loadImage(sourceUrl(frames[i+1]))]),ga=gray(a),gb=gray(b),requestId=`walk-${++seq}`;return await new Promise(resolve=>{const timer=setTimeout(()=>{pending.delete(requestId);resolve(null)},PAIR_TIMEOUT_MS);pending.set(requestId,{resolve,timer});try{w.postMessage({type:'axis',space:'preflight',requestId,frame:i,generation:-77,width:ANALYSIS_W,height:ANALYSIS_H,grayA:ga.buffer,grayB:gb.buffer,seed:i*271+ANALYSIS_W*ANALYSIS_H},[ga.buffer,gb.buffer])}catch{clearTimeout(timer);pending.delete(requestId);resolve(null)}})}catch{return null}}
  function samplePairs(start,end){const last=end-1;if(last<start)return[];const span=last-start,raw=[start+Math.min(2,span),Math.round(start+span*.25),Math.round(start+span*.50),Math.round(start+span*.75),last-Math.min(2,span)];return[...new Set(raw.map(i=>clamp(i,start,last)))].slice(0,MAX_SAMPLE_PAIRS)}
  function resultWeight(r){if(!r||!Number.isFinite(r.centerX)||!Number.isFinite(r.confidence)||r.confidence<MIN_CONF)return 0;if(r.centerX<-.08||r.centerX>1.08)return 0;const kind=String(r.kind||'');if(kind.startsWith('side-flow'))return 0;const cov=clamp(Number(r.coverage)||0,0,1),ir=clamp(Number(r.inlierRatio)||0,0,1),err=Number.isFinite(r.medErr)?r.medErr:9,agreement=Number.isFinite(r.modelAgreement)?r.modelAgreement:0,translation=Number.isFinite(r.translationDominance)?r.translationDominance:0;if(cov<.20||ir<.28||err>5.8||agreement>.38||translation>3.2)return 0;return Math.max(.01,r.confidence)*(.45+.55*cov)*(.55+.45*ir)*clamp(1-err/8,.35,1)}
  function weightedCenter(results){const rows=results.map(r=>({r,x:r?.centerX,w:resultWeight(r)})).filter(x=>x.w>0);if(rows.length<2)return null;rows.sort((a,b)=>a.x-b.x);const xs=rows.map(r=>r.x),m=median(xs),spread=median(xs.map(x=>Math.abs(x-m)));const filtered=rows.filter(r=>Math.abs(r.x-m)<=Math.max(.10,(spread||0)*2.8));if(filtered.length<2)return null;const total=filtered.reduce((s,r)=>s+r.w,0);let acc=0,chosen=filtered[0].x;for(const r of filtered){acc+=r.w;if(acc>=total*.5){chosen=r.x;break}}return{center:chosen,usable:filtered.length,confidence:total/filtered.length,spread:spread||0,rawCount:rows.length}}
  function sequenceRanges(frames){const out=[];let start=0;for(let i=1;i<=frames.length;i++){if(i===frames.length||String(frames[i]?.sequenceId||'')!==String(frames[start]?.sequenceId||'')){out.push({start,end:i-1,sequenceId:String(frames[start]?.sequenceId||'')});start=i}}return out}
  function metadataAnchor(frames,i,start,end){const f=frames[i],tr=travelBearing(frames,i,start,end),ih=Number.isFinite(+f?.heading)?+f.heading:null;if(!Number.isFinite(tr)||!Number.isFinite(ih))return 50;const fov=clamp(Number(f?.fieldOfView)||100,45,170);return clamp(50+angle(ih,tr)/fov*100,8,92)}
  function rangeMetadataAnchor(frames,range){const vals=[];const step=Math.max(1,Math.floor((range.end-range.start)/8));for(let i=range.start;i<=range.end;i+=step)vals.push(metadataAnchor(frames,i,range.start,range.end));return median(vals)||50}
  function originalHeading(f){const h=Number(f?.__pedestrianAxisOriginalHeading);if(Number.isFinite(h))return h;const cur=Number(f?.heading);if(Number.isFinite(cur)){f.__pedestrianAxisOriginalHeading=cur;return cur}return null}
  function guardRangeHeading(frames,range){
    let checked=0,flipped=0,maxBefore=0,maxAfter=0;
    for(let i=range.start;i<=range.end;i++){
      const f=frames[i],tr=travelBearing(frames,i,range.start,range.end),ih=Number.isFinite(+f?.heading)?+f.heading:null;
      if(!Number.isFinite(tr)||!Number.isFinite(ih)||String(f?.projection||'').toUpperCase()==='SPHERE')continue;
      checked++;const before=Math.abs(angle(ih,tr));maxBefore=Math.max(maxBefore,before);
      if(before<FLIP_TRIGGER_DEG){maxAfter=Math.max(maxAfter,before);continue}
      const candidate=(ih+180)%360,after=Math.abs(angle(candidate,tr));
      if(after+FLIP_IMPROVEMENT_DEG<before){
        if(!Number.isFinite(Number(f.__headingFlipOriginal)))f.__headingFlipOriginal=ih;
        f.heading=candidate;f.__headingFlipGuard=true;f.__headingFlipTravelBearing=tr;f.__headingFlipBefore=before;f.__headingFlipAfter=after;f.__headingFlipVersion=VERSION;flipped++;maxAfter=Math.max(maxAfter,after);
      }else maxAfter=Math.max(maxAfter,before);
    }
    return{sequenceId:range.sequenceId,start:range.start,end:range.end,checked,flipped,maxBefore,maxAfter,mode:'metadata-180-flip-guard'};
  }
  function guardAllRanges(frames,ranges=sequenceRanges(frames)){const rows=ranges.map(r=>guardRangeHeading(frames,r));window.__journeyHeadingFlipGuard={version:VERSION,rows,flipped:rows.reduce((s,r)=>s+r.flipped,0),checked:rows.reduce((s,r)=>s+r.checked,0),at:new Date().toISOString()};return rows}
  async function calibrateRange(frames,range){
    const prof=pedestrian(frames,range.start,range.end),len=range.end-range.start+1;
    if(!prof.yes||len<MIN_RANGE_FRAMES)return{...range,pedestrian:false,medianStep:prof.medianStep,headingGuard:true};
    const key=`${range.sequenceId}:${range.start}`,prev=rangeState.get(key),pairs=samplePairs(range.start,range.end),results=await Promise.all(pairs.map(i=>analyzePair(frames,i))),center=weightedCenter(results),metaAnchor=rangeMetadataAnchor(frames,range);
    const visualRaw=center?clamp(center.center*100,ABS_MIN_ANCHOR,ABS_MAX_ANCHOR):metaAnchor;
    const confidenceGain=center?clamp((center.confidence-.12)/.45,.18,.72):0;
    const visualResidualPct=center?clamp(visualRaw-metaAnchor,-VISUAL_RESIDUAL_MAX_PCT,VISUAL_RESIDUAL_MAX_PCT)*confidenceGain:0;
    const targetResidual=visualResidualPct;
    const smoothedResidual=prev?.visualResidualPct!=null?prev.visualResidualPct*(1-SMOOTH_ALPHA)+targetResidual*SMOOTH_ALPHA:targetResidual;
    const correctedHeadings=[];
    for(let i=range.start;i<=range.end;i++){
      const f=frames[i],tr=travelBearing(frames,i,range.start,range.end);if(!Number.isFinite(tr)||String(f?.projection||'').toUpperCase()==='SPHERE')continue;
      const fov=clamp(Number(f?.fieldOfView)||100,45,170),ih=originalHeading(f),residualDeg=smoothedResidual*fov/100;
      const desired=(tr+residualDeg+360)%360;
      f.heading=desired;
      f.__pedestrianAxisAnchor=50;
      f.__pedestrianAxisSourceAnchor=visualRaw;
      f.__pedestrianAxisMetadataAnchor=metaAnchor;
      f.__pedestrianAxisResidualPct=smoothedResidual;
      f.__pedestrianAxisOriginalHeading=Number.isFinite(ih)?ih:f.__pedestrianAxisOriginalHeading;
      f.__pedestrianAxisVersion=VERSION;
      correctedHeadings.push(desired);
    }
    const info={...range,pedestrian:true,medianStep:prof.medianStep,applied:true,pairs,usable:center?.usable||0,anchor:50,visualRaw,metaAnchor,flowCenter:center?.center??null,visualResidualPct:smoothedResidual,confidence:center?.confidence||0,spread:center?.spread||0,headingMode:'travel-bearing-centered+visual-residual',headingGuard:true};
    rangeState.set(key,info);return info;
  }
  async function calibrateRelevant(frames,forceAll=false){if(!Array.isArray(frames)||frames.length<2)return[];const idx=Number(window.__journeyPlaybackState?.index)||0,ranges=sequenceRanges(frames);guardAllRanges(frames,ranges);const relevant=ranges.filter(r=>forceAll?r.start<Math.min(frames.length,LOOKAHEAD_FRAMES):r.end>=Math.max(0,idx-8)&&r.start<=idx+LOOKAHEAD_FRAMES);const jobs=relevant.map(r=>calibrateRange(frames,r));if(!jobs.length)return[];return await Promise.race([Promise.all(jobs),new Promise(resolve=>setTimeout(()=>resolve([{timeout:true}]),TOTAL_TIMEOUT_MS))])}
  function publish(result){window.__pedestrianAxisFix={version:VERSION,result,headingFlipGuard:window.__journeyHeadingFlipGuard||null,at:new Date().toISOString()};try{if(window.__journeyDiagnostics&&typeof window.__journeyDiagnostics==='object')window.__journeyDiagnostics.pedestrianAxisFix=window.__pedestrianAxisFix}catch{}}
  let streamBusy=false,lastLength=0,lastSeq='';
  async function watchStream(){const frames=window.__journeyStreamState?.frames||window.__journeySelectedRoute?.frames;if(!Array.isArray(frames)||frames.length<2||streamBusy)return;const idx=Number(window.__journeyPlaybackState?.index)||0,seqId=String(frames[idx]?.sequenceId||''),grew=frames.length!==lastLength,changed=seqId!==lastSeq;if(!grew&&!changed)return;lastLength=frames.length;lastSeq=seqId;streamBusy=true;try{const result=await calibrateRelevant(frames,false);if(result.length)publish(result)}catch{}finally{streamBusy=false}}
  function install(){const engine=window.JourneyEngine;if(!engine?.startFrames||engine.startFrames.__pedestrianWrapped)return false;const native=engine.startFrames.bind(engine);const wrapped=async(frames,stream)=>{const list=Array.isArray(frames)?frames:[];let result=[];try{result=await calibrateRelevant(list,true)}catch(error){result=[{error:String(error?.message||error)}]}publish(result);lastLength=list.length;lastSeq=String(list[0]?.sequenceId||'');setTimeout(watchStream,80);return native(list,stream)};wrapped.__pedestrianWrapped=true;engine.startFrames=wrapped;return true}
  if(!install()){let n=0;const timer=setInterval(()=>{if(install()||++n>200)clearInterval(timer)},20)}
  setInterval(watchStream,STREAM_POLL_MS);
})();