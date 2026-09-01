function openSearch(){if(state.stage!=='goal')return;$('searchPanel').hidden=false;$('planner').classList.add('search-open');setTimeout(()=>$('mapSearch').focus(),50)}
function closeSearch(){$('searchPanel').hidden=true;$('searchResults').hidden=true;$('planner').classList.remove('search-open')}
async function handleSearch(){const q=$('mapSearch').value.trim();if(!q)return;$('searchResults').hidden=false;$('searchResults').innerHTML='<button disabled>検索中…</button>';try{const rows=await searchLocation(q);if(!rows?.length)throw new Error('見つかりませんでした');$('searchResults').innerHTML=rows.map((r,i)=>`<button type="button" data-i="${i}"><b>${escapeHtml(r.name.split(',')[0])}</b><small>${escapeHtml(r.name)}</small></button>`).join('');$('searchResults').querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>{const r=rows[+btn.dataset.i];closeSearch();state.map.flyTo({center:[r.lng,r.lat],zoom:14});chooseDestination({name:r.name.split(',')[0],type:'attraction',lat:r.lat,lng:r.lng})}))}catch(e){$('searchResults').innerHTML=`<button disabled>${escapeHtml(e?.message||e)}</button>`}}
function retryStartSelection(){state.stage='start';$('routeSearchCard').hidden=true;$('routeSearchRetry').hidden=true;syncPlannerUI();plannerStatus('出発地点を選ぶ','地図を少し動かして再度「出発地登録」')}

const WARP_PLAYBACK_VERSION='mapillaryjs-v19-dom-warp-exclusive';
const WARP_PUSH_MS=360;
const WARP_RELEASE_MS=120;
const WARP_MIN_SCALE_GAIN=0.08;
const WARP_MAX_SCALE_GAIN=0.16;
const WARP_TRACE_LIMIT=300;
const WARP_PROVIDER_ZOOM_DRIFT_WARN=0.04;
let warpTransitionSeq=0;
let warpFxMoves=0;
let warpUnexpectedEffectCount=0;
let warpTrace=[];
let warpSwitchTimes=[];
let lastWarpAudit=null;
let warpActive=false;
let autoplayDefaultBlockedCount=0;
let warpCameraZoomWriteCount=0;

function warpSurfaceEl(){return $('mly')}
function setWarpSurfaceScale(scale){
  const el=warpSurfaceEl();if(!el)return;
  const s=clamp(Number(scale)||1,1,1.30);
  el.style.transformOrigin='50% 50%';
  el.style.willChange='transform';
  el.style.transition='none';
  el.style.transform=`scale(${s.toFixed(5)})`;
  el.dataset.warpScale=s.toFixed(5)
}
function resetWarpSurface(){const el=warpSurfaceEl();if(!el)return;el.style.transition='none';el.style.transform='scale(1)';el.dataset.warpScale='1.00000'}
function currentWarpSurfaceScale(){const v=Number(warpSurfaceEl()?.dataset?.warpScale);return Number.isFinite(v)?v:1}

function ensureForwardWarpFx(){
  let fx=$('journeyWarpFx');
  if(fx)return fx;
  const style=document.createElement('style');
  style.id='journeyWarpFxStyle';
  style.textContent=`
#viewerScreen{overflow:hidden}
#journeyWarpFx{position:fixed;inset:0;z-index:66;pointer-events:none;overflow:hidden;contain:paint}
#journeyWarpFx .warp-layer{position:absolute;inset:-8%;opacity:0;transform:scale(1.015);transform-origin:50% 50%;will-change:opacity,transform}
#journeyWarpFx .warp-near{-webkit-backdrop-filter:blur(1.8px);backdrop-filter:blur(1.8px);-webkit-mask-image:radial-gradient(circle at 50% 50%,transparent 0 22%,rgba(0,0,0,.18) 36%,#000 62%);mask-image:radial-gradient(circle at 50% 50%,transparent 0 22%,rgba(0,0,0,.18) 36%,#000 62%)}
#journeyWarpFx .warp-mid{-webkit-backdrop-filter:blur(4.2px);backdrop-filter:blur(4.2px);-webkit-mask-image:radial-gradient(circle at 50% 50%,transparent 0 40%,rgba(0,0,0,.20) 56%,#000 80%);mask-image:radial-gradient(circle at 50% 50%,transparent 0 40%,rgba(0,0,0,.20) 56%,#000 80%)}
#journeyWarpFx .warp-far{-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);-webkit-mask-image:radial-gradient(circle at 50% 50%,transparent 0 58%,rgba(0,0,0,.24) 73%,#000 100%);mask-image:radial-gradient(circle at 50% 50%,transparent 0 58%,rgba(0,0,0,.24) 73%,#000 100%)}
#journeyWarpFx .warp-flare{position:absolute;inset:-14%;opacity:0;background:radial-gradient(circle at 50% 50%,transparent 0 24%,rgba(255,255,255,.018) 48%,rgba(255,255,255,.065) 100%);mix-blend-mode:screen;transform-origin:50% 50%;will-change:opacity,transform}
#journeyWarpFx[data-hold="1"] .warp-flare{animation:journeyWarpFlowOut .42s linear infinite}
@keyframes journeyWarpFlowOut{0%{transform:scale(.80);opacity:.04}58%{opacity:.38}100%{transform:scale(1.24);opacity:0}}
`;
  document.head.appendChild(style);
  fx=document.createElement('div');
  fx.id='journeyWarpFx';
  fx.dataset.hold='0';
  fx.innerHTML='<i class="warp-layer warp-near"></i><i class="warp-layer warp-mid"></i><i class="warp-layer warp-far"></i><i class="warp-flare"></i>';
  $('viewerScreen')?.appendChild(fx);
  resetWarpSurface();
  return fx;
}
function setForwardWarpIntensity(value){
  const fx=ensureForwardWarpFx(),v=clamp(Number(value)||0,0,1);
  if(!fx)return;
  const layers=fx.querySelectorAll('.warp-layer');
  if(layers[0]){layers[0].style.opacity=String(v*.46);layers[0].style.transform=`scale(${(1.014+v*.014).toFixed(4)})`}
  if(layers[1]){layers[1].style.opacity=String(v*.68);layers[1].style.transform=`scale(${(1.018+v*.024).toFixed(4)})`}
  if(layers[2]){layers[2].style.opacity=String(v*.84);layers[2].style.transform=`scale(${(1.022+v*.036).toFixed(4)})`}
  const flare=fx.querySelector('.warp-flare');if(flare&&fx.dataset.hold!=='1')flare.style.opacity=String(v*.42);
  fx.dataset.intensity=v.toFixed(3);
  warpActive=v>.001;
}
function setForwardWarpHold(active){const fx=ensureForwardWarpFx();if(fx)fx.dataset.hold=active?'1':'0'}
function clearForwardWarp(){setForwardWarpHold(false);setForwardWarpIntensity(0);resetWarpSurface();warpActive=false}
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
async function currentViewerZoom(){try{const z=await state.viewer?.getZoom?.();return Number.isFinite(z)?z:null}catch{return null}}
function forwardWarpScaleGain(stepDistanceM){
  const d=Number.isFinite(stepDistanceM)?stepDistanceM:20;
  return WARP_MIN_SCALE_GAIN+clamp(d/80,0,1)*(WARP_MAX_SCALE_GAIN-WARP_MIN_SCALE_GAIN)
}
function animateForwardWarpVisual(scaleGain,duration,token,audit){
  if(!state.viewer||state.pointerActive||!Number.isFinite(scaleGain)||scaleGain<=0)return Promise.resolve();
  return new Promise(resolve=>{
    const started=performance.now();let lastScale=1;
    const tick=now=>{
      if(!state.viewer||state.pointerActive||token!==cameraMotionToken){resolve();return}
      const t=clamp((now-started)/Math.max(1,duration),0,1),eased=t*t*(3-2*t),scale=1+scaleGain*eased;
      if(scale+0.0005<lastScale)recordUnexpectedWarp(audit,'visual-scale-decrease-during-forward-push',{lastScale,scale});
      lastScale=scale;
      setWarpSurfaceScale(scale);
      setForwardWarpIntensity(eased);
      if(t<1)requestAnimationFrame(tick);else resolve()
    };
    requestAnimationFrame(tick)
  })
}
function releaseForwardWarp(duration,token){
  setForwardWarpHold(false);
  return new Promise(resolve=>{
    const started=performance.now();
    const tick=now=>{
      if(token!==cameraMotionToken){clearForwardWarp();resolve();return}
      const t=clamp((now-started)/Math.max(1,duration),0,1),eased=1-Math.pow(1-t,2);
      setForwardWarpIntensity(1-eased);
      if(t<1)requestAnimationFrame(tick);else{setForwardWarpIntensity(0);warpActive=false;resolve()}
    };
    requestAnimationFrame(tick)
  })
}

const initializeViewerBeforeWarpAudit=initializeViewer;
initializeViewer=async function(){
  warpTransitionSeq=0;warpFxMoves=0;warpUnexpectedEffectCount=0;warpTrace=[];warpSwitchTimes=[];lastWarpAudit=null;autoplayDefaultBlockedCount=0;warpCameraZoomWriteCount=0;clearForwardWarp();
  return initializeViewerBeforeWarpAudit.apply(this,arguments)
};

const restoreDefaultCameraBeforeWarp=restoreDefaultCamera;
restoreDefaultCamera=function(forceZoom=true){
  if(warpActive)warpLog('warp-cancelled',{reason:'camera-restore'});
  clearForwardWarp();
  return restoreDefaultCameraBeforeWarp(forceZoom)
};

const moveToNativeDefaultBeforeExclusiveWarp=moveToNativeDefault;
moveToNativeDefault=async function(target,maxAttempts=3){
  if(state.playing){
    autoplayDefaultBlockedCount++;
    warpLog('autoplay-default-blocked',{reason:state.pointerActive?'pointer-active':'exclusive-warp-policy',targetId:String(target?.id||'')});
    throw new Error('custom-motion-cancelled')
  }
  return moveToNativeDefaultBeforeExclusiveWarp(target,maxAttempts)
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
  if(state.pointerActive){autoplayDefaultBlockedCount++;warpLog('warp-deferred-pointer',{reason:'pointer-active'});throw new Error('custom-motion-cancelled')}
  const M=window.mapillary,tokenId=++cameraMotionToken;
  warpTransitionSeq++;warpFxMoves++;
  const providerZoomBefore=await currentViewerZoom();
  const scaleGain=forwardWarpScaleGain(target.stepDistanceM),pushScale=1+scaleGain;
  activeBaseZoom=null;
  const audit={
    transition:warpTransitionSeq,targetId:String(target.id),
    providerZoomBefore,providerZoomAfter:null,providerZoomDelta:null,
    scaleFrom:1,pushScale,scaleGain,pushMs:WARP_PUSH_MS,blurReleaseMs:WARP_RELEASE_MS,
    mapillaryTransition:'Instantaneous',visibleZoomOutAnimation:false,
    visualZoomImplementation:'DOM-transform',viewerZoomTouchedByWarp:false,
    imageEventObserved:false,imageSwitchMs:null,switchFlow:'outward-only-flare-loop',
    visualScaleReset:'instant-at-target-image-event-under-max-warp',
    defaultTransitionUsed:false,unexpectedEffects:[],status:'running'
  };
  lastWarpAudit=audit;
  lastMoveMode='Instantaneous + DOM forward warp only';
  customTimelineMoves++;
  setTransition(M.TransitionMode.Instantaneous);
  warpLog('transition-start',{targetId:String(target.id),providerZoomBefore,scaleFrom:1,pushScale,transitionMode:'Instantaneous',viewerZoomTouchedByWarp:false});
  try{
    warpLog('forward-push-start',{durationMs:WARP_PUSH_MS,scaleFrom:1,scaleTo:pushScale,radialLikeBlur:true,implementation:'DOM-transform'});
    await animateForwardWarpVisual(scaleGain,WARP_PUSH_MS,tokenId,audit);
    if(tokenId!==cameraMotionToken||!state.viewer)throw new Error('custom-motion-cancelled');
    if(state.pointerActive){autoplayDefaultBlockedCount++;warpLog('warp-deferred-pointer',{reason:'pointer-became-active'});throw new Error('custom-motion-cancelled')}
    setWarpSurfaceScale(pushScale);setForwardWarpIntensity(1);
    warpLog('forward-push-end',{visualScale:currentWarpSurfaceScale(),warpIntensity:1,providerZoom:await currentViewerZoom()});

    const switchStarted=performance.now();
    const visiblePromise=waitForImageEvent(target.id);
    setForwardWarpHold(true);
    warpLog('image-switch-start',{targetId:String(target.id),warpIntensity:1,transitionMode:'Instantaneous',visualScale:pushScale,outwardFlowWhileLoading:true,viewerZoomTouchedByWarp:false});
    let image=await moveToWithRetry(target.id,maxAttempts);
    const visibleImage=await visiblePromise;
    if(visibleImage){image=visibleImage;audit.imageEventObserved=true}
    else recordUnexpectedWarp(audit,'target-image-event-timeout',{targetId:String(target.id)});
    audit.imageSwitchMs=Math.round(performance.now()-switchStarted);
    warpSwitchTimes.push(audit.imageSwitchMs);
    setForwardWarpHold(false);setForwardWarpIntensity(1);
    audit.providerZoomAfter=await currentViewerZoom();
    audit.providerZoomDelta=Number.isFinite(providerZoomBefore)&&Number.isFinite(audit.providerZoomAfter)?audit.providerZoomAfter-providerZoomBefore:null;
    if(Number.isFinite(audit.providerZoomDelta)&&Math.abs(audit.providerZoomDelta)>WARP_PROVIDER_ZOOM_DRIFT_WARN){
      recordUnexpectedWarp(audit,'provider-zoom-drift-during-instantaneous-switch',{providerZoomBefore,providerZoomAfter:audit.providerZoomAfter,providerZoomDelta:audit.providerZoomDelta})
    }
    warpLog('image-switch-end',{targetId:String(target.id),imageEventObserved:audit.imageEventObserved,imageSwitchMs:audit.imageSwitchMs,providerZoomBefore,providerZoomAfter:audit.providerZoomAfter,visualScaleBeforeReset:currentWarpSurfaceScale()});
    if(tokenId!==cameraMotionToken||!state.viewer)return image;

    resetWarpSurface();
    warpLog('visual-scale-reset-instant',{scaleTo:1,observedScale:currentWarpSurfaceScale(),animated:false,underMaximumWarp:true,afterTargetImageEvent:audit.imageEventObserved});

    warpLog('warp-release-start',{durationMs:WARP_RELEASE_MS,zoomAnimation:false,visualScale:1,viewerZoomTouchedByWarp:false});
    await releaseForwardWarp(WARP_RELEASE_MS,tokenId);
    warpLog('warp-release-end',{visualScale:currentWarpSurfaceScale(),providerZoom:await currentViewerZoom(),zoomAnimation:false});

    setTransition(M.TransitionMode.Default);
    audit.status=audit.unexpectedEffects.length?'WARN':'OK';
    audit.finishedAt=Math.round(performance.now());
    lastWarpAudit={...audit};
    warpLog('transition-end',{status:audit.status,visibleZoomOutAnimation:false,defaultTransitionUsed:false,viewerZoomTouchedByWarp:false,unexpectedEffects:audit.unexpectedEffects});
    return image
  }catch(error){
    clearForwardWarp();
    setTransition(M.TransitionMode.Default);
    const message=String(error?.message||error);
    if(message==='custom-motion-cancelled'){
      audit.status='CANCELLED';audit.cancelReason=state.pointerActive?'pointer-active':'motion-token';audit.finishedAt=Math.round(performance.now());
      lastWarpAudit={...audit};warpLog('transition-cancelled',{reason:audit.cancelReason,defaultTransitionUsed:false});
      throw error
    }
    audit.status='ERROR';audit.error=message;audit.finishedAt=Math.round(performance.now());
    lastWarpAudit={...audit};warpLog('transition-error',{error:audit.error});
    throw error
  }
};

const logFrameBeforeWarpAudit=logFrame;
logFrame=function(){
  logFrameBeforeWarpAudit();
  const row=state.logs[state.logs.length-1];
  if(row)Object.assign(row,{
    transitionFx:'dom-forward-warp',
    visibleZoomOutAnimation:false,
    warpAuditStatus:lastWarpAudit?.status||null,
    warpTransition:lastWarpAudit?.transition||null,
    warpImageEventObserved:lastWarpAudit?.imageEventObserved??null,
    warpImageSwitchMs:lastWarpAudit?.imageSwitchMs??null,
    warpPushScale:lastWarpAudit?.pushScale??null,
    warpProviderZoomDelta:lastWarpAudit?.providerZoomDelta??null,
    warpDefaultTransitionUsed:lastWarpAudit?.defaultTransitionUsed??null,
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
    ['transition strategy','DOM scale forward + radial-like outer blur → Instantaneous image switch'],
    ['visible zoom-out','DISABLED'],
    ['Mapillary zoom used for warp','NO'],
    ['autoplay Default transition','BLOCKED'],
    ['blocked Default attempts',String(autoplayDefaultBlockedCount)],
    ['warp / Default moves',`${warpFxMoves} / ${nativeDefaultMoves}`],
    ['warp scale gain',`${WARP_MIN_SCALE_GAIN.toFixed(2)}–${WARP_MAX_SCALE_GAIN.toFixed(2)}`],
    ['last push scale',audit?.pushScale?audit.pushScale.toFixed(3):'—'],
    ['switch warp flow','outward-only / active while loading'],
    ['visual reset','instant at target image event under max warp'],
    ['current move mode',lastMoveMode],
    ['warp timing',`${WARP_PUSH_MS}ms push → switch → ${WARP_RELEASE_MS}ms blur release`],
    ['last image switch',audit?.imageSwitchMs!=null?`${audit.imageSwitchMs}ms`:'—'],
    ['avg image switch',fmt(average(warpSwitchTimes),0,'ms')],
    ['provider zoom delta',audit?.providerZoomDelta!=null?fmt(audit.providerZoomDelta,3,''):'—'],
    ['warp camera zoom writes',String(warpCameraZoomWriteCount)],
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
    playbackTiming:'DOM-forward-push + outward-only loading warp + Mapillary Instantaneous image switch + instant DOM-scale reset + blur-release + hold',
    transitionStrategy:'autoplay warp zoom is DOM transform only; Mapillary camera zoom is not used by warp; Default transition is blocked during autoplay; no visible zoom-out animation',
    visibleZoomOutAnimation:false,
    visualZoomImplementation:'DOM-transform-on-mly',
    viewerZoomTouchedByWarp:false,
    warpCameraZoomWriteCount,
    cameraReset:'none-for-warp; DOM-scale-reset-instant-at-target-image-event',
    autoplayDefaultTransition:{allowed:false,blockedAttempts:autoplayDefaultBlockedCount,nativeDefaultMoves},
    warpEffect:{pushMs:WARP_PUSH_MS,blurReleaseMs:WARP_RELEASE_MS,scaleGainRange:[WARP_MIN_SCALE_GAIN,WARP_MAX_SCALE_GAIN],layers:['outer-blur-near','outer-blur-mid','outer-blur-far'],switchFlow:'outward-only-flare-loop',trueRadialConvolution:false},
    customTimelineMoves,nativeDefaultMoves,warpFxMoves,warpUnexpectedEffectCount,lastMoveMode,imageEventGate:true,
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
  $('journeyProgress').addEventListener('pointerdown',()=>{state.seekWasPlaying=state.playing;if(state.playing)pausePlayback('scrub',true)});$('journeyProgress').addEventListener('input',()=>{const ratio=+$('journeyProgress').value/1000,f=state.route?.frames[Math.round(ratio*((state.route?.frames.length||1)-1))];if(f){$('journeyDistance').textContent=`${distanceLabel(f.distanceFromStartM)} / ${distanceLabel(state.route.totalDistanceM)}`;$('journeyRemaining').textContent=`残り ${distanceLabel(f.remainingDistanceM)}`}});
  $('journeyProgress').addEventListener('change',()=>seekToRatio(+$('journeyProgress').value/1000));
  $('tokenSettings').addEventListener('click',openTokenSheet);$('saveToken').addEventListener('click',saveToken);$('cancelToken').addEventListener('click',()=>{$('tokenSheet').hidden=true});
  $('searchToggle').addEventListener('click',openSearch);$('closeSearch').addEventListener('click',closeSearch);$('searchButton').addEventListener('click',handleSearch);$('mapSearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();handleSearch()}});$('clearSearch').addEventListener('click',()=>{$('mapSearch').value='';$('searchResults').hidden=true});
  state.tripClockTimer=setInterval(()=>{if(state.stage==='trip'&&!state.playing){resetTripTiming();renderTripTimes()}},30000);addEventListener('pagehide',()=>{state.preloadGeneration++;clearInterval(state.tripClockTimer);destroyViewer()},{once:true});renderDiagnostics();
}
boot();
