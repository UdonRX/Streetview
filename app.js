function openSearch(){if(state.stage!=='goal')return;$('searchPanel').hidden=false;$('planner').classList.add('search-open');setTimeout(()=>$('mapSearch').focus(),50)}
function closeSearch(){$('searchPanel').hidden=true;$('searchResults').hidden=true;$('planner').classList.remove('search-open')}
async function handleSearch(){const q=$('mapSearch').value.trim();if(!q)return;$('searchResults').hidden=false;$('searchResults').innerHTML='<button disabled>検索中…</button>';try{const rows=await searchLocation(q);if(!rows?.length)throw new Error('見つかりませんでした');$('searchResults').innerHTML=rows.map((r,i)=>`<button type="button" data-i="${i}"><b>${escapeHtml(r.name.split(',')[0])}</b><small>${escapeHtml(r.name)}</small></button>`).join('');$('searchResults').querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>{const r=rows[+btn.dataset.i];closeSearch();state.map.flyTo({center:[r.lng,r.lat],zoom:14});chooseDestination({name:r.name.split(',')[0],type:'attraction',lat:r.lat,lng:r.lng})}))}catch(e){$('searchResults').innerHTML=`<button disabled>${escapeHtml(e?.message||e)}</button>`}}
function retryStartSelection(){state.stage='start';$('routeSearchCard').hidden=true;$('routeSearchRetry').hidden=true;syncPlannerUI();plannerStatus('出発地点を選ぶ','地図を少し動かして再度「出発地登録」')}

const WARP_PLAYBACK_VERSION='mapillaryjs-v17-forward-warp-zoom-lock';
const WARP_PUSH_MS=360;
const WARP_RELEASE_MS=120;
const WARP_MIN_ZOOM=0.30;
const WARP_MAX_ZOOM=0.50;
const WARP_SWITCH_GUARD_INTERVAL_MS=34;
const WARP_SWITCH_ZOOM_TOLERANCE=0.018;
const WARP_SWITCH_SEVERE_DROP=0.06;
const WARP_TRACE_LIMIT=300;
let warpTransitionSeq=0;
let warpFxMoves=0;
let warpUnexpectedEffectCount=0;
let warpSuppressedEffectCount=0;
let warpTrace=[];
let warpSwitchTimes=[];
let lastWarpAudit=null;
let warpActive=false;

function ensureForwardWarpFx(){
  let fx=$('journeyWarpFx');
  if(fx)return fx;
  const style=document.createElement('style');
  style.id='journeyWarpFxStyle';
  style.textContent=`
#journeyWarpFx{position:fixed;inset:0;z-index:66;pointer-events:none;overflow:hidden;contain:paint}
#journeyWarpFx .warp-layer{position:absolute;inset:-8%;opacity:0;transform:scale(1.015);transform-origin:50% 50%;will-change:opacity,transform}
#journeyWarpFx .warp-near{-webkit-backdrop-filter:blur(1.6px);backdrop-filter:blur(1.6px);-webkit-mask-image:radial-gradient(circle at 50% 50%,transparent 0 24%,rgba(0,0,0,.18) 38%,#000 64%);mask-image:radial-gradient(circle at 50% 50%,transparent 0 24%,rgba(0,0,0,.18) 38%,#000 64%)}
#journeyWarpFx .warp-mid{-webkit-backdrop-filter:blur(3.4px);backdrop-filter:blur(3.4px);-webkit-mask-image:radial-gradient(circle at 50% 50%,transparent 0 43%,rgba(0,0,0,.18) 58%,#000 82%);mask-image:radial-gradient(circle at 50% 50%,transparent 0 43%,rgba(0,0,0,.18) 58%,#000 82%)}
#journeyWarpFx .warp-far{-webkit-backdrop-filter:blur(6.5px);backdrop-filter:blur(6.5px);-webkit-mask-image:radial-gradient(circle at 50% 50%,transparent 0 62%,rgba(0,0,0,.22) 76%,#000 100%);mask-image:radial-gradient(circle at 50% 50%,transparent 0 62%,rgba(0,0,0,.22) 76%,#000 100%)}
#journeyWarpFx .warp-flare{position:absolute;inset:-12%;opacity:0;background:radial-gradient(circle at 50% 50%,transparent 0 28%,rgba(255,255,255,.015) 52%,rgba(255,255,255,.055) 100%);mix-blend-mode:screen;will-change:opacity}
`;
  document.head.appendChild(style);
  fx=document.createElement('div');
  fx.id='journeyWarpFx';
  fx.innerHTML='<i class="warp-layer warp-near"></i><i class="warp-layer warp-mid"></i><i class="warp-layer warp-far"></i><i class="warp-flare"></i>';
  $('viewerScreen')?.appendChild(fx);
  return fx;
}
function setForwardWarpIntensity(value){
  const fx=ensureForwardWarpFx(),v=clamp(Number(value)||0,0,1);
  if(!fx)return;
  const layers=fx.querySelectorAll('.warp-layer');
  if(layers[0]){layers[0].style.opacity=String(v*.42);layers[0].style.transform=`scale(${(1.015+v*.010).toFixed(4)})`}
  if(layers[1]){layers[1].style.opacity=String(v*.62);layers[1].style.transform=`scale(${(1.018+v*.016).toFixed(4)})`}
  if(layers[2]){layers[2].style.opacity=String(v*.78);layers[2].style.transform=`scale(${(1.020+v*.024).toFixed(4)})`}
  const flare=fx.querySelector('.warp-flare');if(flare)flare.style.opacity=String(v*.38);
  fx.dataset.intensity=v.toFixed(3);
  warpActive=v>.001;
}
function clearForwardWarp(){setForwardWarpIntensity(0);warpActive=false}
function warpLog(phase,details={}){
  const row={at:Math.round(performance.now()),transition:warpTransitionSeq,phase,fromId:currentFrame()?.id||null,toId:nextFrame()?.id||null,...details};
  warpTrace.push(row);if(warpTrace.length>WARP_TRACE_LIMIT)warpTrace.splice(0,warpTrace.length-WARP_TRACE_LIMIT);
  try{console.info('[JourneyFX]',row)}catch{}
  return row
}
function recordUnexpectedWarp(audit,code,details={}){
  if(!audit.unexpectedEffects.includes(code)){audit.unexpectedEffects.push(code);warpUnexpectedEffectCount++}
  warpLog('unexpected-effect',{code,...details})
}
function recordSuppressedWarp(audit,code,details={}){
  if(!audit.suppressedEffects.includes(code)){audit.suppressedEffects.push(code);warpSuppressedEffectCount++}
  warpLog('suppressed-effect',{code,...details})
}
async function currentViewerZoom(){try{const z=await state.viewer?.getZoom?.();return Number.isFinite(z)?z:null}catch{return null}}
function forwardWarpZoomAmount(stepDistanceM){
  const d=Number.isFinite(stepDistanceM)?stepDistanceM:20;
  const scaled=WARP_MIN_ZOOM+clamp(d/80,0,1)*(WARP_MAX_ZOOM-WARP_MIN_ZOOM);
  return state.currentProjection==='360'?scaled*.82:scaled
}
function animateForwardWarpZoom(from,to,duration,token,audit){
  if(!state.viewer||state.pointerActive||!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return Promise.resolve();
  return new Promise(resolve=>{
    const started=performance.now();let lastRequested=from;
    const tick=now=>{
      if(!state.viewer||state.pointerActive||token!==cameraMotionToken){resolve();return}
      const t=clamp((now-started)/Math.max(1,duration),0,1),eased=t*t*(3-2*t),requested=clamp(from+(to-from)*eased,0,3);
      if(requested+0.0005<lastRequested)recordUnexpectedWarp(audit,'zoom-decrease-during-forward-push',{lastRequested,requested})
      lastRequested=requested;
      try{state.viewer.setZoom(requested)}catch{}
      setForwardWarpIntensity(eased);
      if(t<1)requestAnimationFrame(tick);else resolve()
    };
    requestAnimationFrame(tick)
  })
}
function startSwitchZoomGuard(pushZoom,token,audit){
  let active=true,timer=null,samples=0,corrections=0,minObserved=pushZoom,maxObservedDrop=0;
  const started=performance.now();
  const loop=async()=>{
    if(!active||token!==cameraMotionToken||!state.viewer||state.pointerActive)return;
    const observed=await currentViewerZoom();
    if(Number.isFinite(observed)){
      samples++;
      minObserved=Math.min(minObserved,observed);
      const drop=Math.max(0,pushZoom-observed);
      maxObservedDrop=Math.max(maxObservedDrop,drop);
      if(drop>WARP_SWITCH_ZOOM_TOLERANCE)corrections++;
    }
    try{state.viewer.setZoom(pushZoom)}catch{}
    setForwardWarpIntensity(1);
    if(active)timer=setTimeout(loop,WARP_SWITCH_GUARD_INTERVAL_MS)
  };
  loop();
  return {stop:async()=>{
    active=false;if(timer)clearTimeout(timer);
    const observed=await currentViewerZoom();
    if(Number.isFinite(observed)){
      samples++;minObserved=Math.min(minObserved,observed);maxObservedDrop=Math.max(maxObservedDrop,Math.max(0,pushZoom-observed))
    }
    try{state.viewer?.setZoom?.(pushZoom)}catch{}
    const finalZoom=await currentViewerZoom();
    const metrics={durationMs:Math.round(performance.now()-started),samples,corrections,minObserved,maxObservedDrop,finalZoom,guardIntervalMs:WARP_SWITCH_GUARD_INTERVAL_MS,tolerance:WARP_SWITCH_ZOOM_TOLERANCE};
    if(maxObservedDrop>WARP_SWITCH_ZOOM_TOLERANCE)recordSuppressedWarp(audit,'mapillary-switch-zoom-drop-suppressed',{maxObservedDrop,minObserved,pushZoom,corrections});
    if(Number.isFinite(finalZoom)&&pushZoom-finalZoom>WARP_SWITCH_SEVERE_DROP)recordUnexpectedWarp(audit,'switch-zoom-lock-failed',{pushZoom,finalZoom,maxObservedDrop});
    return metrics
  }}
}
function releaseForwardWarp(duration,token){
  return new Promise(resolve=>{
    const started=performance.now();
    const tick=now=>{
      if(token!==cameraMotionToken){clearForwardWarp();resolve();return}
      const t=clamp((now-started)/Math.max(1,duration),0,1),eased=1-Math.pow(1-t,2);
      setForwardWarpIntensity(1-eased);
      if(t<1)requestAnimationFrame(tick);else{clearForwardWarp();resolve()}
    };
    requestAnimationFrame(tick)
  })
}

const initializeViewerBeforeWarpAudit=initializeViewer;
initializeViewer=async function(){
  warpTransitionSeq=0;warpFxMoves=0;warpUnexpectedEffectCount=0;warpSuppressedEffectCount=0;warpTrace=[];warpSwitchTimes=[];lastWarpAudit=null;clearForwardWarp();
  return initializeViewerBeforeWarpAudit.apply(this,arguments)
};

const restoreDefaultCameraBeforeWarp=restoreDefaultCamera;
restoreDefaultCamera=function(forceZoom=true){
  if(warpActive)warpLog('warp-cancelled',{reason:'camera-restore'});
  clearForwardWarp();
  return restoreDefaultCameraBeforeWarp(forceZoom)
};

const gentlyPreservePanoBeforeWarpAudit=gentlyPreservePano;
gentlyPreservePano=async function(offset){
  if(!state.viewer||state.currentProjection!=='360')return gentlyPreservePanoBeforeWarpAudit(offset);
  let before=null;try{before=await state.viewer.getBearing()}catch{}
  const started=performance.now();
  const result=await gentlyPreservePanoBeforeWarpAudit(offset);
  let after=null;try{after=await state.viewer.getBearing()}catch{}
  const delta=Number.isFinite(before)&&Number.isFinite(after)?angleDiff(after,before):null;
  if(Number.isFinite(delta)&&Math.abs(delta)>.5)warpLog('post-image-heading-correction',{deltaDeg:delta,durationMs:Math.round(performance.now()-started),classification:'360-heading-preservation'});
  return result
};

moveToExclusiveCustom=async function(target,maxAttempts=3){
  if(!state.viewer)return moveToWithRetry(target.id,maxAttempts);
  if(state.pointerActive){warpLog('fallback-default',{reason:'pointer-active'});return moveToNativeDefault(target,maxAttempts)}
  const M=window.mapillary,tokenId=++cameraMotionToken;
  warpTransitionSeq++;warpFxMoves++;
  let baseZoom=await currentViewerZoom();if(!Number.isFinite(baseZoom))baseZoom=0;
  activeBaseZoom=baseZoom;
  const pushZoom=clamp(baseZoom+forwardWarpZoomAmount(target.stepDistanceM),0,3);
  const audit={
    transition:warpTransitionSeq,targetId:String(target.id),baseZoom,pushZoom,
    pushMs:WARP_PUSH_MS,blurReleaseMs:WARP_RELEASE_MS,
    mapillaryTransition:'Instantaneous',visibleZoomOutAnimation:false,
    cameraReset:'instant-under-maximum-warp',imageEventObserved:false,
    imageSwitchMs:null,switchZoomGuard:null,
    zoomOutAnimationCalls:0,suppressedEffects:[],unexpectedEffects:[],status:'running'
  };
  lastWarpAudit=audit;
  lastMoveMode='Instantaneous + forward warp + switch zoom lock';
  customTimelineMoves++;
  setTransition(M.TransitionMode.Instantaneous);
  warpLog('transition-start',{targetId:String(target.id),baseZoom,pushZoom,transitionMode:'Instantaneous'});
  let zoomGuard=null;
  try{
    warpLog('forward-push-start',{durationMs:WARP_PUSH_MS,zoomFrom:baseZoom,zoomTo:pushZoom,radialLikeBlur:true});
    await animateForwardWarpZoom(baseZoom,pushZoom,WARP_PUSH_MS,tokenId,audit);
    if(tokenId!==cameraMotionToken||!state.viewer)throw new Error('custom-motion-cancelled');
    try{state.viewer.setZoom(pushZoom)}catch{}
    warpLog('forward-push-end',{zoom:await currentViewerZoom(),warpIntensity:1});
    if(state.pointerActive){
      clearForwardWarp();try{state.viewer.setZoom(baseZoom)}catch{}
      activeBaseZoom=null;setTransition(M.TransitionMode.Default);
      warpLog('fallback-default',{reason:'pointer-became-active'});
      return moveToNativeDefault(target,maxAttempts)
    }

    const switchStarted=performance.now();
    const visiblePromise=waitForImageEvent(target.id);
    zoomGuard=startSwitchZoomGuard(pushZoom,tokenId,audit);
    warpLog('image-switch-start',{targetId:String(target.id),warpIntensity:1,transitionMode:'Instantaneous',zoomLock:true,zoomLockTarget:pushZoom});
    let image=await moveToWithRetry(target.id,maxAttempts);
    const visibleImage=await visiblePromise;
    if(visibleImage){image=visibleImage;audit.imageEventObserved=true}
    else recordUnexpectedWarp(audit,'target-image-event-timeout',{targetId:String(target.id)});
    audit.imageSwitchMs=Math.round(performance.now()-switchStarted);
    warpSwitchTimes.push(audit.imageSwitchMs);
    audit.switchZoomGuard=await zoomGuard.stop();zoomGuard=null;
    const zoomBeforeReset=await currentViewerZoom();
    warpLog('image-switch-end',{targetId:String(target.id),imageEventObserved:audit.imageEventObserved,imageSwitchMs:audit.imageSwitchMs,zoomBeforeReset,pushZoom,zoomGuard:audit.switchZoomGuard});
    if(Number.isFinite(zoomBeforeReset)&&pushZoom-zoomBeforeReset>WARP_SWITCH_SEVERE_DROP)recordUnexpectedWarp(audit,'switch-ended-below-push',{pushZoom,zoomBeforeReset});
    if(tokenId!==cameraMotionToken||!state.viewer)return image;

    setForwardWarpIntensity(1);
    try{state.viewer.setZoom(baseZoom)}catch{}
    const resetZoom=await currentViewerZoom();
    warpLog('camera-reset-instant',{zoomTo:baseZoom,observedZoom:resetZoom,animated:false,hiddenByWarp:true,afterTargetImageEvent:audit.imageEventObserved});
    if(Number.isFinite(resetZoom)&&Math.abs(resetZoom-baseZoom)>.08)recordUnexpectedWarp(audit,'instant-reset-did-not-land-near-base',{baseZoom,resetZoom})

    warpLog('warp-release-start',{durationMs:WARP_RELEASE_MS,zoomAnimation:false,viewerZoomLockedAtBase:true});
    await releaseForwardWarp(WARP_RELEASE_MS,tokenId);
    warpLog('warp-release-end',{zoom:await currentViewerZoom(),zoomAnimation:false});

    activeBaseZoom=null;setTransition(M.TransitionMode.Default);
    audit.status=audit.unexpectedEffects.length?'WARN':'OK';
    audit.finishedAt=Math.round(performance.now());
    lastWarpAudit={...audit};
    warpLog('transition-end',{status:audit.status,visibleZoomOutAnimation:false,suppressedEffects:audit.suppressedEffects,unexpectedEffects:audit.unexpectedEffects});
    return image
  }catch(error){
    if(zoomGuard){try{audit.switchZoomGuard=await zoomGuard.stop()}catch{}zoomGuard=null}
    clearForwardWarp();
    if(tokenId===cameraMotionToken&&state.viewer){try{state.viewer.setZoom(baseZoom)}catch{}}
    activeBaseZoom=null;setTransition(M.TransitionMode.Default);
    audit.status='ERROR';audit.error=String(error?.message||error);audit.finishedAt=Math.round(performance.now());
    lastWarpAudit={...audit};warpLog('transition-error',{error:audit.error});
    throw error
  }
};

const logFrameBeforeWarpAudit=logFrame;
logFrame=function(){
  logFrameBeforeWarpAudit();
  const row=state.logs[state.logs.length-1];
  if(row)Object.assign(row,{
    transitionFx:'forward-warp',
    visibleZoomOutAnimation:false,
    warpAuditStatus:lastWarpAudit?.status||null,
    warpTransition:lastWarpAudit?.transition||null,
    warpImageEventObserved:lastWarpAudit?.imageEventObserved??null,
    warpImageSwitchMs:lastWarpAudit?.imageSwitchMs??null,
    warpSwitchMaxZoomDrop:lastWarpAudit?.switchZoomGuard?.maxObservedDrop??null,
    warpSuppressedEffects:lastWarpAudit?.suppressedEffects?.slice?.()||[],
    warpUnexpectedEffects:lastWarpAudit?.unexpectedEffects?.slice?.()||[]
  })
};

renderDiagnostics=function(){
  if(!$('diagGrid'))return;const f=currentFrame(),audit=lastWarpAudit,rows=[
    ['version',WARP_PLAYBACK_VERSION],
    ['frame / step',`${Math.min(state.cursor+1,state.route?.frames.length||0)} / ${state.route?.frames.length||0} (success ${state.successfulFrames}, skip ${state.skippedFrames})`],
    ['sequenceId',state.route?.sequenceId||'—'],['Next / Prev',state.route?.direction||'—'],
    ['sequence gap',`${f?.sequenceGap??'—'} / max ${state.route?.maxSequenceGap??'—'}`],
    ['distance',`${distanceLabel(f?.distanceFromStartM)} / ${distanceLabel(state.route?.totalDistanceM)}`],['remaining',distanceLabel(f?.remainingDistanceM)],
    ['transition strategy','zoom-in + radial-like outer blur → zoom-locked Instantaneous switch'],
    ['visible zoom-out','DISABLED'],
    ['switch zoom lock',`ON / ${WARP_SWITCH_GUARD_INTERVAL_MS}ms / tol ${WARP_SWITCH_ZOOM_TOLERANCE.toFixed(3)}`],
    ['camera reset','instant at max blur after target image event'],
    ['current move mode',lastMoveMode],
    ['warp / Default moves',`${warpFxMoves} / ${nativeDefaultMoves}`],
    ['warp zoom',`${WARP_MIN_ZOOM.toFixed(2)}–${WARP_MAX_ZOOM.toFixed(2)}`],
    ['warp timing',`${WARP_PUSH_MS}ms push → locked switch → ${WARP_RELEASE_MS}ms blur release`],
    ['last image switch',audit?.imageSwitchMs!=null?`${audit.imageSwitchMs}ms`:'—'],
    ['avg image switch',fmt(average(warpSwitchTimes),0,'ms')],
    ['last switch zoom drop',audit?.switchZoomGuard?fmt(audit.switchZoomGuard.maxObservedDrop,3,''):'—'],
    ['suppressed FX',String(warpSuppressedEffectCount)],
    ['unexpected FX',String(warpUnexpectedEffectCount)],
    ['last warp audit',audit?`${audit.status} / image ${audit.imageEventObserved?'event':'timeout'}`:'—'],
    ['last FX phase',warpTrace.at(-1)?.phase||'—'],
    ['hold after move',fmt(Number($('speed')?.value)||DEFAULT_CADENCE,0,'ms')],
    ['move effect',fmt(state.lastTransitionMs,0,'ms')],['avg move effect',fmt(average(state.transitionTimes),0,'ms')],
    ['actual cadence',fmt(state.lastCadenceMs,0,'ms')],['avg cadence',fmt(average(state.cadenceTimes),0,'ms')],
    ['visible provider','MapillaryJS built-in'],['route cache',state.routeCacheHit?'HIT':'MISS'],['initialDisplayMs',fmt(state.initialDisplayMs,0,'ms')],
    ['travelHeading',fmt(state.currentTravelHeading,1,'°')],['userViewOffset',fmt(state.userViewOffset,1,'°')],['currentViewHeading',fmt(state.currentViewHeading,1,'°')],
    ['360 / Rectilinear',state.currentProjection],['reverse events',String(state.reverseEvents)],['view jumps',String(state.viewJumps)],['stopReason',state.stopReason],['frameId',f?.id||'—']
  ];$('diagGrid').innerHTML=rows.map(([k,v])=>`<span>${k}</span><b>${String(v)}</b>`).join('')
};

diagnosticsText=function(){
  const f=currentFrame();return JSON.stringify({
    test:'MapillaryJS Journey',version:WARP_PLAYBACK_VERSION,start:state.start,goal:state.goal,place:state.selectedPlace?.name||null,
    sequenceId:state.route?.sequenceId||null,direction:state.route?.direction||null,totalDistanceM:state.route?.totalDistanceM||null,
    currentDistanceM:f?.distanceFromStartM||0,remainingDistanceM:f?.remainingDistanceM||null,departure:state.departureTime?.toISOString?.()||null,arrival:state.arrivalTime?.toISOString?.()||null,
    targetFrames:state.route?.frames.length||0,denseSequenceFrames:state.route?.denseFrameCount||null,maxSequenceGap:state.route?.maxSequenceGap??null,avgSequenceGap:state.route?.avgSequenceGap??null,
    requestedCadenceMs:Number($('speed').value)||DEFAULT_CADENCE,
    playbackTiming:'forward-warp-push + zoom-locked instantaneous-image-switch + instant hidden reset + blur-release + hold',
    transitionStrategy:'autoplay=forward zoom-in with center-sharp/outer-blur warp; Mapillary moveTo=Instantaneous; push zoom is guarded during image loading; no visible zoom-out animation',
    visibleZoomOutAnimation:false,
    cameraReset:'instant-under-maximum-warp-after-target-image-event',
    switchZoomLock:{enabled:true,intervalMs:WARP_SWITCH_GUARD_INTERVAL_MS,tolerance:WARP_SWITCH_ZOOM_TOLERANCE,severeDropThreshold:WARP_SWITCH_SEVERE_DROP},
    warpEffect:{pushMs:WARP_PUSH_MS,blurReleaseMs:WARP_RELEASE_MS,zoomRange:[WARP_MIN_ZOOM,WARP_MAX_ZOOM],layers:['outer-blur-near','outer-blur-mid','outer-blur-far'],trueRadialConvolution:false},
    customTimelineMoves,nativeDefaultMoves,warpFxMoves,warpSuppressedEffectCount,warpUnexpectedEffectCount,lastMoveMode,imageEventGate:true,
    averageImageSwitchMs:average(warpSwitchTimes),lastWarpAudit,transitionTrace:warpTrace.slice(-WARP_TRACE_LIMIT),
    hudAutoHideMs:HUD_AUTO_HIDE_MS,hudTapToggle:true,elevationSamples:state.route?.elevationProfile?.length||0,
    successfulFrames:state.successfulFrames,skippedFrames:state.skippedFrames,initialDisplayMs:state.initialDisplayMs,
    averageMoveEffectMs:average(state.transitionTimes),averageCadenceMs:average(state.cadenceTimes),
    routeCacheHit:state.routeCacheHit,reverseEvents:state.reverseEvents,viewJumps:state.viewJumps,panoFrames:state.route?.pano||0,totalPreparedFrames:state.route?.frames.length||0,
    stopReason:state.stopReason,setupMs:state.setupMs,frames:state.logs
  },null,2)
};

function boot(){
  initMap();resetPlanner();if(!token())openTokenSheet();
  $('registerDestination').addEventListener('click',registerDestination);$('registerStart').addEventListener('click',registerStartPoint);$('changeGoal').addEventListener('click',resetPlanner);$('routeSearchReset').addEventListener('click',resetPlanner);$('routeSearchRetry').addEventListener('click',retryStartSelection);
  $('tripStart').addEventListener('click',startJourney);$('backToPlanner').addEventListener('click',backToPlanner);$('finishJourney').addEventListener('click',finishJourney);
  $('playToggle').addEventListener('click',()=>state.playing?pausePlayback('user-pause'):playback());$('toggleDiag').addEventListener('click',()=>{$('diag').classList.toggle('is-open');renderDiagnostics()});$('copyDiag').addEventListener('click',copyDiagnostics);$('speed').addEventListener('input',()=>{$('speedOut').value=`${(Number($('speed').value)/1000).toFixed(2)}s`});
  $('journeyProgress').addEventListener('pointerdown',()=>{state.seekWasPlaying=state.playing;if(state.playing)pausePlayback('scrub',true)});$('journeyProgress').addEventListener('input',()=>{const ratio=+$('journeyProgress').value/1000,f=state.route?.frames[Math.round(ratio*((state.route?.frames.length||1)-1))];if(f){$('journeyDistance').textContent=`${distanceLabel(f.distanceFromStartM)} / ${distanceLabel(state.route.totalDistanceM)}`;$('journeyRemaining').textContent=`残り ${distanceLabel(f.remainingDistanceM)}`}});$('journeyProgress').addEventListener('change',()=>seekToRatio(+$('journeyProgress').value/1000));
  $('tokenSettings').addEventListener('click',openTokenSheet);$('saveToken').addEventListener('click',saveToken);$('cancelToken').addEventListener('click',()=>{$('tokenSheet').hidden=true});
  $('searchToggle').addEventListener('click',openSearch);$('closeSearch').addEventListener('click',closeSearch);$('searchButton').addEventListener('click',handleSearch);$('mapSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();handleSearch()}});$('clearSearch').addEventListener('click',()=>{$('mapSearch').value='';$('searchResults').hidden=true});
  state.tripClockTimer=setInterval(()=>{if(state.stage==='trip'&&!state.playing){resetTripTiming();renderTripTimes()}},30000);addEventListener('pagehide',()=>{state.preloadGeneration++;clearInterval(state.tripClockTimer);destroyViewer()},{once:true});renderDiagnostics();
}
boot();
