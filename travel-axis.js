/* Streetview Journey v0.1.28 Direction-aware Travel Axis */
(()=>{
  'use strict';
  const VERSION='0.1.28';
  const MOTION_WAIT_COMPAT_MS=360;
  const AXIS_GAIN=.92;
  const SIDE_FLOW_GAIN=.68;
  const MAX_SHIFT=.24;
  const MAX_FRAME_STEP=.034;
  const MIN_AXIS_CONF=.16;
  const POSE_COMPENSATION=.78;
  const ANCHOR_WINDOW_RADIUS=2;
  const NativeWorker=window.Worker;
  const NativePost=NativeWorker?.prototype?.postMessage;
  const nativeSetTimeout=window.setTimeout.bind(window);
  const nativeDrawImage=CanvasRenderingContext2D.prototype.drawImage;
  const axisByFrame=new Map(),smoothShiftCache=new Map(),urlToFrame=new Map(),metaAnchorCache=new Map();
  let routeFrames=[],routeSelection=null,generation=0,axisWorker=null,axisErrors=0,lastAxis=null,diagValue;

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const rad=v=>v*Math.PI/180,deg=v=>v*180/Math.PI;
  const angle=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?((b-a+540)%360)-180:0;
  const normalizeURL=value=>{try{const u=new URL(String(value||''),location.href);u.searchParams.delete('analysis');return u.href;}catch{return String(value||'').replace(/([?&])analysis=[^&]+(&|$)/,'$1').replace(/[?&]$/,'');}};
  const weightedMedian=items=>{if(!items.length)return 0;const s=[...items].sort((a,b)=>a.v-b.v),total=s.reduce((n,x)=>n+x.w,0);let acc=0;for(const item of s){acc+=item.w;if(acc>=total*.5)return item.v;}return s[s.length-1].v;};
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

  const state=window.__journeyTravelAxis={
    version:VERSION,mode:'direction-aware sequence + metadata absolute center + tile-flow residual',worker:'starting',workerReady:false,
    generation:0,routeFrames:0,routeSelection:null,latest:null,appliedFrame:null,appliedShift:0,visualShift:0,poseCompensation:0,metadataAnchor:50,appliedConfidence:0,errors:0,
    snapshot(){const vals=[...axisByFrame.values()].filter(v=>Number.isFinite(v?.confidence)),good=vals.filter(v=>v.confidence>=MIN_AXIS_CONF);return{version:VERSION,mode:this.mode,worker:this.worker,workerReady:this.workerReady,generation,routeFrames:routeFrames.length,routeSelection,results:vals.length,usable:good.length,averageConfidence:good.length?good.reduce((s,v)=>s+v.confidence,0)/good.length:0,latest:lastAxis,appliedFrame:this.appliedFrame,appliedShift:this.appliedShift,visualShift:this.visualShift,poseCompensation:this.poseCompensation,metadataAnchor:this.metadataAnchor,appliedConfidence:this.appliedConfidence,errors:axisErrors};}
  };

  try{Object.defineProperty(window,'__journeyDiagnostics',{configurable:true,get(){return diagValue;},set(v){diagValue=v;if(v&&typeof v==='object'){v.version=VERSION;v.travelAxis='direction-aware-center-lock';v.travelAxisState=state;}}});}catch{}

  window.setTimeout=function(fn,ms,...args){const adjusted=Number(ms)===85?MOTION_WAIT_COMPAT_MS:ms;return nativeSetTimeout(fn,adjusted,...args);};

  function resetRoute(frames,selection=null){
    generation++;routeFrames=Array.isArray(frames)?frames:[];routeSelection=selection&&typeof selection==='object'?JSON.parse(JSON.stringify(selection)):null;
    urlToFrame.clear();axisByFrame.clear();smoothShiftCache.clear();metaAnchorCache.clear();lastAxis=null;
    for(let i=0;i<routeFrames.length;i++)if(routeFrames[i]?.url)urlToFrame.set(normalizeURL(routeFrames[i].url),i);
    Object.assign(state,{generation,routeFrames:routeFrames.length,routeSelection,latest:null,appliedFrame:null,appliedShift:0,visualShift:0,poseCompensation:0,metadataAnchor:50,appliedConfidence:0});
    try{NativePost?.call(axisWorker,{type:'reset',generation});}catch{}
  }

  if(window.Response?.prototype?.json){const nativeJson=Response.prototype.json;Response.prototype.json=async function(...args){const data=await nativeJson.apply(this,args);try{if(String(this.url||'').includes('/api/imagery')&&Array.isArray(data?.frames))resetRoute(data.frames,data.selection||null);}catch{}return data;};}

  function inferFrame(message){if(Number.isFinite(message?.frameIndex))return message.frameIndex;const w=Number(message?.width)||0,h=Number(message?.height)||0,seed=Number(message?.seed);if(Number.isFinite(seed)&&w&&h){const v=(seed-w*h)/31;if(Number.isFinite(v)&&Math.abs(v-Math.round(v))<.08)return Math.round(v);}return null;}

  if(NativeWorker&&NativePost){
    try{
      axisWorker=new NativeWorker(`/travel-axis-worker.js?v=${VERSION}`);
      axisWorker.addEventListener('message',event=>{
        const m=event.data||{};
        if(m.type==='axis-ready'){state.worker=m.engine||'tile-flow';state.workerReady=true;return;}
        if(m.type==='axis-boot-error'){axisErrors++;state.worker='fallback';state.workerReady=false;state.errors=axisErrors;return;}
        if(m.type==='axis-error'){axisErrors++;state.errors=axisErrors;return;}
        if(m.type!=='axis-result'||!m.result||m.result.generation!==generation)return;
        const r=m.result;if(!Number.isFinite(r.frame))return;axisByFrame.set(r.frame,r);lastAxis={...r};state.latest=lastAxis;
        for(let k=Math.max(0,r.frame-4);k<=r.frame+6;k++)smoothShiftCache.delete(k);
        window.dispatchEvent(new CustomEvent('journey-travel-axis',{detail:{...r}}));
      });
      axisWorker.addEventListener('error',()=>{axisErrors++;state.worker='fallback';state.workerReady=false;state.errors=axisErrors;});
      NativeWorker.prototype.postMessage=function(message,transfer){
        if(this!==axisWorker&&message?.type==='analyze'&&message?.grayA instanceof ArrayBuffer&&message?.grayB instanceof ArrayBuffer){const frame=inferFrame(message);if(Number.isFinite(frame)&&frame>=0&&frame<10000){try{const a=message.grayA.slice(0),b=message.grayB.slice(0);NativePost.call(axisWorker,{type:'axis',frame,generation,width:message.width,height:message.height,grayA:a,grayB:b,seed:message.seed||frame*97},[a,b]);}catch{}}}
        return NativePost.call(this,message,transfer);
      };
    }catch{state.worker='fallback';state.workerReady=false;axisErrors++;state.errors=axisErrors;}
  }else state.worker='unsupported';

  function shiftEstimate(frame){
    if(smoothShiftCache.has(frame))return smoothShiftCache.get(frame);const items=[],confItems=[];
    for(let k=Math.max(0,frame-2);k<=Math.min(routeFrames.length-2,frame+2);k++){const r=axisByFrame.get(k);if(!r||!Number.isFinite(r.centerX)||!Number.isFinite(r.confidence)||r.confidence<MIN_AXIS_CONF)continue;const expected=metadataAnchor(k)/100,dist=Math.abs(k-frame),dw=dist===0?1.45:dist===1?1:.58,w=r.confidence*dw,kindGain=r.kind==='side-flow'?SIDE_FLOW_GAIN:1,raw=clamp((expected-r.centerX)*AXIS_GAIN*kindGain,-MAX_SHIFT,MAX_SHIFT);items.push({v:raw,w});confItems.push({v:r.confidence,w:dw});}
    if(!items.length){const out={shift:0,confidence:0,source:'metadata-only'};smoothShiftCache.set(frame,out);return out;}
    let target=weightedMedian(items),confidence=weightedMedian(confItems);const deviations=items.map(x=>Math.abs(x.v-target)).sort((a,b)=>a-b),spread=deviations[Math.floor(deviations.length/2)]||0,stability=clamp(1-spread/.10,.30,1),trust=clamp((confidence-MIN_AXIS_CONF)/.42,0,1);target*=stability*(.38+.62*trust);const prev=smoothShiftCache.get(frame-1);if(prev&&Number.isFinite(prev.shift))target=prev.shift+clamp(target-prev.shift,-MAX_FRAME_STEP,MAX_FRAME_STEP);const out={shift:clamp(target,-MAX_SHIFT,MAX_SHIFT),confidence:confidence*stability,source:'tile-flow-residual'};smoothShiftCache.set(frame,out);return out;
  }

  function frameForImage(image){if(!(image instanceof HTMLImageElement))return null;const key=normalizeURL(image.currentSrc||image.src),direct=urlToFrame.get(key);return Number.isFinite(direct)?direct:null;}
  function centeredCropX(canvasWidth,drawWidth,anchorPercent){if(!Number.isFinite(canvasWidth)||!Number.isFinite(drawWidth)||drawWidth<=0)return 0;if(drawWidth<=canvasWidth)return(canvasWidth-drawWidth)/2;const a=clamp(anchorPercent,0,100)/100;return clamp(canvasWidth*.5-drawWidth*a,canvasWidth-drawWidth,0);}

  CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
    try{
      if(args.length===4&&this.canvas&&this.canvas.width>160&&this.canvas.height>220){const frame=frameForImage(image);if(Number.isFinite(frame)){let[x,y,w,h]=args;if([x,y,w,h].every(Number.isFinite)&&w>this.canvas.width*.92){const cw=this.canvas.width,ch=this.canvas.height,anchor=metadataAnchor(frame),est=shiftEstimate(frame),baseX=centeredCropX(cw,w,anchor),m=typeof this.getTransform==='function'?this.getTransform():null,centerScreenShift=m?(m.a*(cw*.5)+m.c*(ch*.5)+m.e-cw*.5):0,mapX=m&&Number.isFinite(m.a)&&Math.abs(m.a)>.55?m.a:1,visualScreen=est.shift*cw,visualSource=visualScreen/mapX,poseSource=clamp((-centerScreenShift*POSE_COMPENSATION)/mapX,-cw*.085,cw*.085),margin=Math.min(cw*.012,5),minX=cw-w+margin,maxX=-margin,safeMin=minX<=maxX?minX:cw-w,safeMax=minX<=maxX?maxX:0,correctedX=clamp(baseX+visualSource+poseSource,safeMin,safeMax);x=correctedX;args=[x,y,w,h];Object.assign(state,{appliedFrame:frame,metadataAnchor:anchor,visualShift:visualScreen/cw,poseCompensation:(poseSource*mapX)/cw,appliedShift:(correctedX-baseX)*mapX/cw,appliedConfidence:est.confidence});}}}
    }catch{}
    return nativeDrawImage.call(this,image,...args);
  };

  function updateDiagnosticLine(){
    const box=document.getElementById('journeyDiag');if(!box)return;let line=document.getElementById('jdAxis');if(!line){line=document.createElement('div');line.id='jdAxis';const ref=document.getElementById('jdApplied')||document.getElementById('jdLine4');ref?.insertAdjacentElement('afterend',line);}const snap=state.snapshot(),dir=snap.appliedShift<-.008?'→':snap.appliedShift>.008?'←':'•',sel=snap.routeSelection,selText=sel?.strategy==='direction-aware'?`${sel.direction==='reverse'?'REV':'FWD'} ${Number.isFinite(sel.alignmentErrorDeg)?Math.round(sel.alignmentErrorDeg)+'°':'—'}`:'FIX';line.textContent=`Axis ${state.workerReady?'Ready':'Fallback'} / Sel ${selText} / ${snap.results}/${Math.max(0,snap.routeFrames-1)} / Meta ${Math.round(snap.metadataAnchor||50)}→50 / FOE ${Math.round((snap.visualShift||0)*100)}% / ${dir}${Math.round(Math.abs(snap.appliedShift||0)*100)}% / Conf ${Math.round((snap.appliedConfidence||0)*100)}%`;line.style.color='rgba(255,215,145,.96)';if(diagValue&&typeof diagValue==='object'){diagValue.version=VERSION;diagValue.travelAxisSnapshot=snap;}
  }
  nativeSetTimeout(updateDiagnosticLine,120);setInterval(updateDiagnosticLine,250);
})();
