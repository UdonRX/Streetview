/* Journey playback diagnostics: clock/load/fallback + A/B/C/D state. */
(()=>{
  if(window.__journeyPlaybackLoggerInstalled)return;
  window.__journeyPlaybackLoggerInstalled=true;
  const VERSION='0.1.53-center1024-lock',MAX_EVENTS=320,POLL_MS=160,STALL_MS=650,RAF_GAP_MS=180;
  const trace={schema:'streetview-journey-playback-diagnostic-v3',version:VERSION,startedAt:null,events:[]};
  let active=false,t0=0,lastIndex=null,lastAdvance=0,lastStall=0,lastRaf=performance.now(),transportSignature='',opticalVisibilityTicket=0;
  const round=v=>Number.isFinite(v)?Math.round(v*10)/10:null;
  const loadStats={raw:{start:0,complete:0,timeout:0,error:0,totalMs:0,maxMs:0},analysis:{start:0,complete:0,timeout:0,error:0,totalMs:0,maxMs:0}};
  function compact(){
    const p=window.__journeyPlaybackState||{},s=window.__journeyStreamState||{},e=window.JourneyEngine?.getState?.()||{},d=window.__journeyDiagnostics||{},r=window.__journeyRawRuntime||{},h=window.__journeyHybridQuality?.state?.()||{},t=window.JourneyTransportClassifier?.state?.()||{};
    const stats={};for(const k of ['raw','analysis']){const x=loadStats[k];stats[k]={start:x.start,complete:x.complete,timeout:x.timeout,error:x.error,avgMs:x.complete?Math.round(x.totalMs/x.complete):0,maxMs:x.maxMs}}
    const contiguous=Number.isFinite(r.contiguousRawAhead)?r.contiguousRawAhead:(p.rawAheadReady??e.rawAheadReady??null);
    return{
      index:Number.isFinite(p.index)?p.index:(Number.isFinite(e.index)?e.index:null),available:Number.isFinite(p.available)?p.available:(Number.isFinite(e.available)?e.available:null),total:Number.isFinite(p.total)?p.total:(Number.isFinite(e.total)?e.total:null),streaming:!!(p.streaming??e.streaming),
      clock:{targetMs:p.targetMs??e.targetMs??80,lastDeltaMs:round(p.lastDeltaMs??e.lastDeltaMs),latenessMs:round(p.latenessMs??e.latenessMs),maxLatenessMs:round(p.maxLatenessMs??e.maxLatenessMs),deadlineMisses:p.deadlineMisses??e.deadlineMisses??0},
      path:{last:p.lastRenderPath??e.lastRenderPath??null,rawFallbacks:p.rawFallbacks??e.rawFallbacks??d.deadlineFallbacks??0,optical:p.opticalPairs??e.opticalPairs??d.opticalPairs??0,opticalAllowed:r.opticalAllowed??null},
      ahead:{rawReady:contiguous,rawTotalReady:p.rawAheadTotalReady??e.rawAheadTotalReady??d.rawAheadTotalReady??null,stabilizedReady:p.stabilizedAheadReady??e.stabilizedAheadReady??null,pairReady:p.pairAheadReady??e.pairAheadReady??null,highResAhead:h.highResAhead??0},
      loader:{queued:p.rawQueue??e.rawQueue??d.rawQueue??null,active:p.rawActive??e.rawActive??d.rawActive??null,emergencyActive:p.rawEmergencyActive??e.rawEmergencyActive??d.rawEmergencyActive??null,backgroundActive:p.rawBackgroundActive??e.rawBackgroundActive??d.rawBackgroundActive??null,rawTimeoutMs:r.rawTimeoutMs??null},
      cache:{raw:e.readyFrames??d.rawReady??null,frame:e.frameCache??null,pair:e.pairCache??null,tile:e.tileLayerCache??null},rawSource:{variant:r.rawVariant??null,lightUrls:r.lightUrlCount??null,lightDisabled:r.lightDisabled??null},loads:stats,
      quality:{journeyQualityScore:h.journeyQualityScore??null,qualityRejectedFrames:h.qualityRejectedFrames??0,qualityUnknownFrames:h.qualityUnknownFrames??0,qualityScoreFieldAvailable:h.qualityScoreFieldAvailable??null},
      transport:{transportMode:t.transportMode||'UNKNOWN',sequenceModes:t.sequenceModes||{},requests:t.requests||0,cacheHits:t.cacheHits||0,errors:t.errors||0},
      progressive:{networkClass:h.networkClass||'NORMAL',networkSource:h.networkSource||null,currentImageTier:h.currentImageTier||'256',highResAhead:h.highResAhead||0,loadEwmaMs:h.loadEwmaMs??null,qualityCache:h.qualityCache||null,centerLockIndex:persistent1024Index},
      warp:{opticalConfidence:h.opticalConfidence??d.opticalConfidence??0,warpEnabled:h.warpEnabled??d.warpEnabled??false,warpFallbackReason:h.warpFallbackReason??d.warpFallbackReason??null,intermediateFramesGenerated:h.intermediateFramesGenerated??d.intermediateFramesGenerated??0,warpRenderMs:h.warpRenderMs??d.warpRenderMs??0},
      stream:{active:!!s.active,complete:!!s.complete,failed:!!s.failed,frameCount:Array.isArray(s.frames)?s.frames.length:0},worker:{ready:!!d.workerReady,lastPairMs:round(d.lastPairMs),lastPair:d.lastWorkerPair?{frame:d.lastWorkerPair.frame,confidence:round(d.lastWorkerPair.confidence),tracks:d.lastWorkerPair.tracks,parallaxFactor:round(d.lastWorkerPair.parallaxFactor),safetyFactor:round(d.lastWorkerPair.safetyFactor)}:null}
    };
  }
  function log(name,data={}){if(!active&&name!=='playback-trace-start')return;const row={tMs:Math.round(performance.now()-t0),name,...data};trace.events.push(row);if(trace.events.length>MAX_EVENTS)trace.events.shift()}
  function start(detail={}){if(active)return;active=true;t0=performance.now();trace.startedAt=new Date().toISOString();lastIndex=null;lastAdvance=t0;lastStall=0;log('playback-trace-start',{detail,state:compact()})}
  async function copy(){const payload={...trace,exportedAt:new Date().toISOString(),current:compact()};const text=JSON.stringify(payload,null,2);try{await navigator.clipboard.writeText(text);return true}catch{}try{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();return true}catch{return false}}
  function installButton(){let btn=document.getElementById('playbackLogCopy');if(!btn){btn=document.createElement('button');btn.id='playbackLogCopy';btn.type='button';document.body.appendChild(btn)}btn.textContent='再生ログコピー';btn.style.cssText='position:fixed;z-index:31;right:10px;top:calc(env(safe-area-inset-top) + 98px);height:30px;padding:0 9px;border:1px solid rgba(255,255,255,.22);border-radius:999px;background:rgba(5,8,12,.58);color:#fff;font:700 9px/1 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);pointer-events:auto';btn.onclick=async e=>{e.preventDefault();e.stopPropagation();const ok=await copy();btn.textContent=ok?'コピー完了':'コピー失敗';setTimeout(()=>btn.textContent='再生ログコピー',1000)}}

  /* Persistent center-1024 compositor.
     Keep the previous decoded 1024 frame visible until the next decoded 1024
     is synchronously painted into the same canvas. The 256 base therefore
     never becomes visible through the center mask between frame swaps. */
  const CENTER_MASK='radial-gradient(ellipse 42% 46% at 50% 50%,#000 0%,#000 68%,rgba(0,0,0,.82) 80%,rgba(0,0,0,.30) 90%,transparent 100%)';
  let persistent1024Shell=null,persistent1024Canvas=null,persistent1024Ctx=null,persistent1024Index=-1,persistent1024Ticket=0;
  function installPersistent1024(){
    if(persistent1024Canvas?.isConnected)return persistent1024Canvas;
    const viewer=document.getElementById('viewer');if(!viewer)return null;
    let style=document.getElementById('persistent1024Style');
    if(!style){style=document.createElement('style');style.id='persistent1024Style';style.textContent='#journeyAdaptiveQualityShell,#journeyQualityLayer,#journeyHybridQualityLayer{display:none!important}';document.head.appendChild(style)}
    persistent1024Shell=document.createElement('div');persistent1024Shell.id='journeyPersistent1024Shell';
    persistent1024Shell.style.cssText=`position:absolute;left:-6%;top:-6%;width:112%;height:112%;z-index:2;pointer-events:none;opacity:0;transform:translateZ(0);backface-visibility:hidden;-webkit-mask-image:${CENTER_MASK};mask-image:${CENTER_MASK};-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-size:100% 100%;mask-size:100% 100%`;
    persistent1024Canvas=document.createElement('canvas');persistent1024Canvas.id='journeyPersistent1024Canvas';
    persistent1024Canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;transform:translate3d(0,0,0);backface-visibility:hidden';
    persistent1024Ctx=persistent1024Canvas.getContext('2d',{alpha:false});persistent1024Shell.appendChild(persistent1024Canvas);viewer.appendChild(persistent1024Shell);return persistent1024Canvas;
  }
  function centerAnchor(index){const x=window.__journeyTravelAxis?.anchorForFrame?.(index,50);return Number.isFinite(x)?Math.max(2,Math.min(98,x)):50}
  function syncPersistentCanvasSize(){if(!persistent1024Canvas||!persistent1024Shell)return null;const w=Math.max(1,Math.round(persistent1024Shell.clientWidth||((innerWidth||390)*1.12))),h=Math.max(1,Math.round(persistent1024Shell.clientHeight||((innerHeight||844)*1.12)));if(persistent1024Canvas.width!==w||persistent1024Canvas.height!==h){persistent1024Canvas.width=w;persistent1024Canvas.height=h;persistent1024Ctx=persistent1024Canvas.getContext('2d',{alpha:false})}return{w,h}}
  function paintPersistent1024(index,im){
    installPersistent1024();if(!persistent1024Ctx||!im?.naturalWidth||!im?.naturalHeight)return false;const size=syncPersistentCanvasSize();if(!size)return false;const {w,h}=size,scale=Math.max(w/im.naturalWidth,h/im.naturalHeight),dw=im.naturalWidth*scale,dh=im.naturalHeight*scale,a=centerAnchor(index),dx=(w-dw)*(a/100),dy=(h-dh)*.5;
    /* cover draw fills the whole canvas, so a single draw replaces the old
       1024 frame without clearing it to transparency/256 first. */
    persistent1024Ctx.globalAlpha=1;persistent1024Ctx.globalCompositeOperation='copy';persistent1024Ctx.drawImage(im,dx,dy,dw,dh);persistent1024Ctx.globalCompositeOperation='source-over';
    const v=window.__journeyVerticalCenter,shift=Number.isFinite(v?.frame)&&v.frame===index?Number(v.shift||0)*100:0;persistent1024Canvas.style.transform=`translate3d(0,${shift}%,0)`;persistent1024Shell.style.opacity='1';persistent1024Index=index;
    if(active)log('center1024-lock-present',{index,width:im.naturalWidth,height:im.naturalHeight,anchorX:round(a)});return true;
  }
  function lockCenter1024(index){
    const i=Number(index);if(!Number.isFinite(i)||i<0)return;const api=window.__journeyHybridQuality;if(typeof api?.ensure1024!=='function')return;const ticket=++persistent1024Ticket;
    Promise.resolve(api.ensure1024(i)).then(im=>{if(!im)return;const nowIndex=Number(window.__journeyPlaybackState?.index);if(ticket!==persistent1024Ticket&&Number.isFinite(nowIndex)&&nowIndex!==i)return;if(Number.isFinite(nowIndex)&&nowIndex!==i)return;paintPersistent1024(i,im)}).catch(()=>{});
  }

  function scheduleOpticalVisibility(index){
    const ticket=++opticalVisibilityTicket,b=window.__journeyOpticalBridge;if(!b?.getPreparedPair)return;
    const ms=Number(b.getSpeedMs?.()||window.__journeyPlaybackState?.targetMs||80),delay=Math.max(6,ms*.5-4);
    setTimeout(()=>{if(ticket!==opticalVisibilityTicket||Number(b.getCurrentIndex?.())!==index)return;/* Center 1024 stays visible even when optical is ready. */},delay)
  }
  window.__copyJourneyPlaybackLog=copy;
  window.addEventListener('journey-playback-started',e=>{start(e.detail||{});maybeClassifyTransport(true);const i=Number(e.detail?.index??window.__journeyPlaybackState?.index??0);queueMicrotask(()=>lockCenter1024(Number.isFinite(i)?i:0))});
  window.addEventListener('journey-frame-presented',e=>{const i=Number(e.detail?.index);if(active)log('present',e.detail||{});if(Number.isFinite(i)){lockCenter1024(i);scheduleOpticalVisibility(i)}});
  window.addEventListener('journey-image-wait-start',e=>{if(active)log('wait-start',e.detail||{})});
  window.addEventListener('journey-image-wait-resolved',e=>{if(active)log('wait-resolved',e.detail||{})});
  window.addEventListener('journey-image-load',e=>{const d=e.detail||{},kind=d.purpose==='analysis'?'analysis':'raw',s=loadStats[kind];if(d.phase==='start')s.start++;else if(d.phase==='complete'){s.complete++;const ms=Number(d.elapsedMs)||0;s.totalMs+=ms;s.maxMs=Math.max(s.maxMs,ms)}else if(d.phase==='timeout')s.timeout++;else if(d.phase==='error')s.error++;if(!active)return;if(['start','complete','timeout','error','optical-paused','optical-resumed'].includes(d.phase))log(`load-${d.phase}`,{index:d.index??null,purpose:kind,transport:d.transport||null,variant:d.variant||null,elapsedMs:d.elapsedMs??null,timeoutMs:d.timeoutMs??null,width:d.width??null,height:d.height??null,contiguousRawAhead:d.contiguousRawAhead??null})});
  window.addEventListener('journey-hybrid-quality',e=>{if(active)log(`hybrid-${e.detail?.phase||'event'}`,e.detail||{})});
  window.addEventListener('journey-transport-classified',e=>{if(active)log('transport-classified',e.detail||{})});
  window.addEventListener('journey-playback-ended',e=>{if(active)log('ended',{detail:e.detail||null,state:compact()})});
  document.addEventListener('visibilitychange',()=>{if(active&&document.visibilityState!=='visible')log('visibility',{value:document.visibilityState})});
  window.addEventListener('resize',()=>{if(persistent1024Index>=0)lockCenter1024(persistent1024Index)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installButton,{once:true});else installButton();
  setInterval(()=>{if(!active)return;const now=performance.now(),s=compact(),idx=s.index;if(idx!==lastIndex){const delta=lastIndex===null?0:now-lastAdvance;lastIndex=idx;lastAdvance=now;log('advance',{index:idx,deltaMs:round(delta),latenessMs:s.clock.latenessMs,path:s.path.last,ahead:s.ahead,loader:s.loader,networkClass:s.progressive.networkClass,currentImageTier:s.progressive.currentImageTier,centerLockIndex:s.progressive.centerLockIndex,warp:s.warp})}const canAdvance=Number.isFinite(idx)&&Number.isFinite(s.available)&&s.available>idx+1;if(canAdvance&&now-lastAdvance>=STALL_MS&&now-lastStall>=1000){lastStall=now;log('stall',{index:idx,stalledMs:Math.round(now-lastAdvance),clock:s.clock,ahead:s.ahead,loader:s.loader,path:s.path.last,networkClass:s.progressive.networkClass})}},POLL_MS);
  function rafWatch(now){const gap=now-lastRaf;lastRaf=now;if(active&&gap>RAF_GAP_MS)log('main-thread-gap',{gapMs:Math.round(gap),index:compact().index});requestAnimationFrame(rafWatch)}requestAnimationFrame(rafWatch);

  function routeFrames(){return window.__journeyStreamState?.frames||window.__journeySelectedRoute?.frames||[]}
  async function maybeClassifyTransport(force=false){const list=routeFrames();if(!Array.isArray(list)||!list.length||!window.JourneyTransportClassifier?.classifyRoute)return null;const seq=[...new Set(list.map(f=>String(f?.sequenceId||'unknown')))];const signature=`${list.length}|${seq.join(',')}`;if(!force&&signature===transportSignature)return window.JourneyTransportClassifier.state?.();transportSignature=signature;try{return await window.JourneyTransportClassifier.classifyRoute(list)}catch(error){if(active)log('transport-error',{message:String(error?.message||error)});return null}}
  window.__journeyTransportReady=new Promise(resolve=>{const script=document.createElement('script');script.src='/transport-classifier.js?v=0.1.0';script.async=false;script.onload=()=>Promise.resolve(maybeClassifyTransport(true)).finally(()=>resolve(true));script.onerror=()=>resolve(false);document.head.appendChild(script)});
  setInterval(()=>maybeClassifyTransport(false),1500);
  const hybrid=document.createElement('script');hybrid.src='/hybrid-quality.js?v=0.3.0';hybrid.async=false;hybrid.onload=()=>{installPersistent1024();const i=Number(window.__journeyPlaybackState?.index??0);lockCenter1024(Number.isFinite(i)?i:0)};document.head.appendChild(hybrid);
})();