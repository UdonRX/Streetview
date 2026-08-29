/* Streetview Journey v0.1.27 Travel Axis Center Lock */
(()=>{
  'use strict';
  const VERSION='0.1.27';
  const MOTION_WAIT_COMPAT_MS=220;
  const AXIS_GAIN=.84;
  const MAX_SHIFT=.30;
  const MAX_FRAME_STEP=.036;
  const MIN_AXIS_CONF=.16;
  const NativeWorker=window.Worker;
  const NativePost=NativeWorker?.prototype?.postMessage;
  const nativeSetTimeout=window.setTimeout.bind(window);
  const nativeDrawImage=CanvasRenderingContext2D.prototype.drawImage;
  const axisByFrame=new Map(),smoothShiftCache=new Map(),urlToFrame=new Map();
  let routeFrames=[],generation=0,axisWorker=null,axisReady=false,axisErrors=0,lastAxis=null,diagValue;

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const normalizeURL=value=>{try{const u=new URL(String(value||''),location.href);u.searchParams.delete('analysis');return u.href;}catch{return String(value||'').replace(/([?&])analysis=[^&]+(&|$)/,'$1').replace(/[?&]$/,'');}};
  const weightedMedian=items=>{
    if(!items.length)return 0;
    const s=[...items].sort((a,b)=>a.v-b.v),total=s.reduce((n,x)=>n+x.w,0);let acc=0;
    for(const item of s){acc+=item.w;if(acc>=total*.5)return item.v;}
    return s[s.length-1].v;
  };

  const state=window.__journeyTravelAxis={
    version:VERSION,mode:'gps-metadata + visual FOE residual',worker:'starting',workerReady:false,
    generation:0,routeFrames:0,latest:null,appliedFrame:null,appliedShift:0,appliedConfidence:0,errors:0,
    snapshot(){
      const vals=[...axisByFrame.values()].filter(v=>Number.isFinite(v?.confidence));
      const good=vals.filter(v=>v.confidence>=MIN_AXIS_CONF);
      return{version:VERSION,mode:this.mode,worker:this.worker,workerReady:this.workerReady,generation,routeFrames:routeFrames.length,results:vals.length,usable:good.length,averageConfidence:good.length?good.reduce((s,v)=>s+v.confidence,0)/good.length:0,latest:lastAxis,appliedFrame:this.appliedFrame,appliedShift:this.appliedShift,appliedConfidence:this.appliedConfidence,errors:axisErrors};
    }
  };

  try{
    Object.defineProperty(window,'__journeyDiagnostics',{
      configurable:true,
      get(){return diagValue;},
      set(v){diagValue=v;if(v&&typeof v==='object'){v.version=VERSION;v.travelAxis='center-lock';v.travelAxisState=state;}}
    });
  }catch{}

  // v0.1.25 used an 85 ms race and permanently cached "worker-pending" for queued jobs.
  // Keep the fail-soft timeout, but give the single jsfeat worker enough room for the warm-ahead queue.
  window.setTimeout=function(fn,ms,...args){
    const adjusted=Number(ms)===85?MOTION_WAIT_COMPAT_MS:ms;
    return nativeSetTimeout(fn,adjusted,...args);
  };

  function resetRoute(frames){
    generation++;
    routeFrames=Array.isArray(frames)?frames:[];
    urlToFrame.clear();axisByFrame.clear();smoothShiftCache.clear();lastAxis=null;
    for(let i=0;i<routeFrames.length;i++)if(routeFrames[i]?.url)urlToFrame.set(normalizeURL(routeFrames[i].url),i);
    state.generation=generation;state.routeFrames=routeFrames.length;state.latest=null;state.appliedFrame=null;state.appliedShift=0;state.appliedConfidence=0;
    try{NativePost?.call(axisWorker,{type:'reset',generation});}catch{}
  }

  if(window.Response?.prototype?.json){
    const nativeJson=Response.prototype.json;
    Response.prototype.json=async function(...args){
      const data=await nativeJson.apply(this,args);
      try{if(String(this.url||'').includes('/api/imagery')&&Array.isArray(data?.frames))resetRoute(data.frames);}catch{}
      return data;
    };
  }

  function inferFrame(message){
    if(Number.isFinite(message?.frameIndex))return message.frameIndex;
    const w=Number(message?.width)||0,h=Number(message?.height)||0,seed=Number(message?.seed);
    if(Number.isFinite(seed)&&w&&h){const v=(seed-w*h)/31;if(Number.isFinite(v)&&Math.abs(v-Math.round(v))<.08)return Math.round(v);}
    return null;
  }

  if(NativeWorker&&NativePost){
    try{
      axisWorker=new NativeWorker(`/travel-axis-worker.js?v=${VERSION}`);
      axisWorker.addEventListener('message',event=>{
        const m=event.data||{};
        if(m.type==='axis-ready'){axisReady=true;state.worker='ready';state.workerReady=true;return;}
        if(m.type==='axis-boot-error'){axisErrors++;state.worker='fallback';state.workerReady=false;state.errors=axisErrors;return;}
        if(m.type==='axis-error'){axisErrors++;state.errors=axisErrors;return;}
        if(m.type!=='axis-result'||!m.result||m.result.generation!==generation)return;
        const r=m.result;if(!Number.isFinite(r.frame))return;
        axisByFrame.set(r.frame,r);lastAxis={...r};state.latest=lastAxis;
        for(let k=Math.max(0,r.frame-4);k<=r.frame+6;k++)smoothShiftCache.delete(k);
        window.dispatchEvent(new CustomEvent('journey-travel-axis',{detail:{...r}}));
      });
      axisWorker.addEventListener('error',()=>{axisErrors++;state.worker='fallback';state.workerReady=false;state.errors=axisErrors;});

      NativeWorker.prototype.postMessage=function(message,transfer){
        if(this!==axisWorker&&message?.type==='analyze'&&message?.grayA instanceof ArrayBuffer&&message?.grayB instanceof ArrayBuffer){
          const frame=inferFrame(message);
          if(Number.isFinite(frame)&&frame>=0&&frame<10000){
            try{
              const a=message.grayA.slice(0),b=message.grayB.slice(0);
              NativePost.call(axisWorker,{type:'axis',frame,generation,width:message.width,height:message.height,grayA:a,grayB:b,seed:message.seed||frame*97},[a,b]);
            }catch{}
          }
        }
        return NativePost.call(this,message,transfer);
      };
    }catch(error){state.worker='fallback';state.workerReady=false;axisErrors++;state.errors=axisErrors;}
  }else{state.worker='unsupported';}

  function shiftEstimate(frame){
    if(smoothShiftCache.has(frame))return smoothShiftCache.get(frame);
    const items=[],confItems=[];
    for(let k=Math.max(0,frame-2);k<=Math.min(routeFrames.length-2,frame+2);k++){
      const r=axisByFrame.get(k);if(!r||!Number.isFinite(r.centerX)||!Number.isFinite(r.confidence)||r.confidence<MIN_AXIS_CONF)continue;
      const dist=Math.abs(k-frame),dw=dist===0?1.45:dist===1?1:.58,w=r.confidence*dw;
      const raw=clamp((.5-r.centerX)*AXIS_GAIN,-MAX_SHIFT,MAX_SHIFT);
      items.push({v:raw,w});confItems.push({v:r.confidence,w:dw});
    }
    if(!items.length){const out={shift:0,confidence:0,source:'metadata-only'};smoothShiftCache.set(frame,out);return out;}
    let target=weightedMedian(items),confidence=weightedMedian(confItems);
    const deviations=items.map(x=>Math.abs(x.v-target)).sort((a,b)=>a-b),spread=deviations[Math.floor(deviations.length/2)]||0;
    const stability=clamp(1-spread/.12,.30,1),trust=clamp((confidence-MIN_AXIS_CONF)/.42,0,1);
    target*=stability*(.36+.64*trust);
    const prev=smoothShiftCache.get(frame-1);
    if(prev&&Number.isFinite(prev.shift))target=prev.shift+clamp(target-prev.shift,-MAX_FRAME_STEP,MAX_FRAME_STEP);
    const out={shift:clamp(target,-MAX_SHIFT,MAX_SHIFT),confidence:confidence*stability,source:'visual-foe'};
    smoothShiftCache.set(frame,out);return out;
  }

  function frameForImage(image){
    if(!(image instanceof HTMLImageElement))return null;
    const key=normalizeURL(image.currentSrc||image.src);const direct=urlToFrame.get(key);if(Number.isFinite(direct))return direct;
    return null;
  }

  CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
    try{
      if(args.length===4&&this.canvas&&this.canvas.width>160&&this.canvas.height>220){
        const frame=frameForImage(image);
        if(Number.isFinite(frame)){
          const est=shiftEstimate(frame);
          if(Math.abs(est.shift)>.002){
            let [x,y,w,h]=args;
            if([x,y,w,h].every(Number.isFinite)&&w>this.canvas.width*.92){
              const wanted=est.shift*this.canvas.width;
              const margin=Math.min(this.canvas.width*.015,6);
              const minShift=this.canvas.width+margin-w-x,maxShift=-margin-x;
              const safe=clamp(wanted,minShift,maxShift);
              x+=safe;args=[x,y,w,h];
              state.appliedFrame=frame;state.appliedShift=safe/this.canvas.width;state.appliedConfidence=est.confidence;
            }
          }else{state.appliedFrame=frame;state.appliedShift=0;state.appliedConfidence=est.confidence;}
        }
      }
    }catch{}
    return nativeDrawImage.call(this,image,...args);
  };

  function updateDiagnosticLine(){
    const box=document.getElementById('journeyDiag');if(!box)return;
    let line=document.getElementById('jdAxis');
    if(!line){line=document.createElement('div');line.id='jdAxis';const ref=document.getElementById('jdApplied')||document.getElementById('jdLine4');ref?.insertAdjacentElement('afterend',line);}
    const snap=state.snapshot(),dir=snap.appliedShift<-.008?'→':snap.appliedShift>.008?'←':'•';
    line.textContent=`Axis ${state.workerReady?'Ready':'Fallback'} / ${snap.usable}/${Math.max(0,routeFrames.length-1)} / ${dir} ${Math.round(Math.abs(snap.appliedShift)*100)}% / Conf ${Math.round((snap.appliedConfidence||0)*100)}%`;
    line.style.color='rgba(255,215,145,.96)';
    if(diagValue&&typeof diagValue==='object'){diagValue.version=VERSION;diagValue.travelAxisSnapshot=snap;}
  }
  nativeSetTimeout(()=>updateDiagnosticLine(),120);
  setInterval(updateDiagnosticLine,250);
})();
