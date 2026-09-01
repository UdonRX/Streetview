const HUD_AUTO_HIDE_MS=3500;
const PLAYBACK_VERSION='mapillaryjs-v15-exclusive-transition';
const CUSTOM_PUSH_MS=360;
const CUSTOM_SETTLE_MS=220;
const CUSTOM_MIN_ZOOM=0.28;
const CUSTOM_MAX_ZOOM=0.46;
const IMAGE_EVENT_TIMEOUT_MS=3200;
let hudHideTimer=null;
let viewerTapStart=null;
let cameraMotionToken=0;
let activeBaseZoom=null;
let elevationGeneration=0;
let elevationAbortController=null;
let customTimelineMoves=0;
let nativeDefaultMoves=0;
let lastMoveMode='—';

function journeyHudEl(){return document.querySelector('#viewerScreen .journey-hud')}
function clearHudHideTimer(){if(hudHideTimer){clearTimeout(hudHideTimer);hudHideTimer=null}}
function isJourneyHudVisible(){const hud=journeyHudEl();return !!hud&&hud.dataset.visible!=='0'}
function hideJourneyHud(){const hud=journeyHudEl();if(!hud)return;clearHudHideTimer();hud.dataset.visible='0';hud.style.transform='translateY(calc(100% + 36px))';hud.style.opacity='0';hud.style.pointerEvents='none'}
function showJourneyHud(autoHide=true){const hud=journeyHudEl();if(!hud)return;clearHudHideTimer();hud.dataset.visible='1';hud.style.transform='translateY(0)';hud.style.opacity='1';hud.style.pointerEvents='auto';if(autoHide&&!state.completed)hudHideTimer=setTimeout(hideJourneyHud,HUD_AUTO_HIDE_MS)}
function toggleJourneyHud(){if(isJourneyHudVisible())hideJourneyHud();else showJourneyHud(true)}
function installHudBehavior(){const hud=journeyHudEl();if(!hud||hud.dataset.autoHideInstalled==='1')return;hud.dataset.autoHideInstalled='1';hud.dataset.visible='1';hud.style.transition='transform .28s cubic-bezier(.2,.8,.2,1),opacity .2s ease';hud.style.willChange='transform,opacity';const hold=()=>showJourneyHud(false),release=()=>showJourneyHud(true);hud.addEventListener('pointerdown',hold,{passive:true});hud.addEventListener('pointerup',release,{passive:true});hud.addEventListener('pointercancel',release,{passive:true});hud.addEventListener('input',release,{passive:true})}

function currentFrame(){return state.route?.frames[state.cursor]||null}
function nextFrame(){return state.route?.frames[state.cursor+1]||null}
function updateTravelHeading(){const a=currentFrame(),b=nextFrame()||state.route?.frames[state.cursor-1];state.currentTravelHeading=a&&b?bearing(a,b):null}
async function readBearing(){if(!state.viewer)return null;try{const b=await state.viewer.getBearing();if(Number.isFinite(b)){state.currentViewHeading=norm360(b);return state.currentViewHeading}}catch{}return null}
function setFrameMetrics(){const f=currentFrame();if(!f)return;state.currentProgress=f.routeProgress;state.currentRouteDistance=f.routeDistance;state.maxProgressSeen=Number.isFinite(state.maxProgressSeen)?Math.max(state.maxProgressSeen,f.routeProgress):f.routeProgress;updateTravelHeading();if(Number.isFinite(state.currentViewHeading)&&Number.isFinite(state.currentTravelHeading)){state.userViewOffset=angleDiff(state.currentViewHeading,state.currentTravelHeading);state.heldOffset=state.userViewOffset}renderJourneyHud();renderDiagnostics()}

async function gentlyPreservePano(offset){
  if(!state.viewer||state.pointerActive||state.currentProjection!=='360'||!Number.isFinite(state.currentTravelHeading))return;
  const before=await readBearing();if(!Number.isFinite(before))return;
  const desired=norm360(state.currentTravelHeading+offset),delta=angleDiff(desired,before);
  if(Math.abs(delta)<3)return;if(Math.abs(delta)>45)state.viewJumps++;if(Math.abs(delta)>75)return;
  let center;try{center=await state.viewer.getCenter()}catch{return}
  if(!Array.isArray(center)||center.length<2)return;
  state.correcting=true;
  const startX=Number(center[0]),y=clamp(Number(center[1]),.08,.92),steps=6;
  for(let i=1;i<=steps;i++){if(state.pointerActive)break;const eased=1-Math.pow(1-i/steps,2),x=((startX+(delta/360)*eased)%1+1)%1;state.viewer.setCenter([x,y]);await sleep(26)}
  state.correcting=false;
}

function imageEventId(image){return String(image?.id??image?.nodeId??image?.node_id??'')}
function waitForImageEvent(id,timeoutMs=IMAGE_EVENT_TIMEOUT_MS){
  if(!state.viewer)return Promise.resolve(null);
  const wanted=String(id);
  return new Promise(resolve=>{
    let done=false;
    const finish=image=>{if(done)return;done=true;clearTimeout(timer);try{state.viewer.off('image',handler)}catch{}resolve(image||null)};
    const handler=e=>{const image=e?.image;if(image&&imageEventId(image)===wanted)finish(image)};
    const timer=setTimeout(()=>finish(null),timeoutMs);
    try{state.viewer.on('image',handler)}catch{finish(null)}
  });
}
function setTransition(mode){try{state.viewer?.setTransitionMode?.(mode)}catch{}}
function restoreDefaultCamera(forceZoom=true){
  cameraMotionToken++;
  if(state.viewer){
    if(forceZoom&&Number.isFinite(activeBaseZoom)){try{state.viewer.setZoom(activeBaseZoom)}catch{}}
    setTransition(window.mapillary?.TransitionMode?.Default);
  }
  activeBaseZoom=null;
}
function installViewerEvents(){
  const el=state.viewer.getCanvasContainer?.()||$('mly');
  el.addEventListener('pointerdown',e=>{state.pointerActive=true;viewerTapStart={x:e.clientX,y:e.clientY,t:performance.now()}},{passive:true});
  el.addEventListener('pointerup',e=>{state.pointerActive=false;const s=viewerTapStart;viewerTapStart=null;if(!s)return;const moved=Math.hypot(e.clientX-s.x,e.clientY-s.y),elapsed=performance.now()-s.t;if(moved<=12&&elapsed<=550)toggleJourneyHud()},{passive:true});
  el.addEventListener('pointercancel',()=>{state.pointerActive=false;viewerTapStart=null},{passive:true});
  state.viewer.on('pov',async e=>{const b=await e.target.getBearing().catch(()=>null);if(!Number.isFinite(b))return;state.currentViewHeading=norm360(b);if(Number.isFinite(state.currentTravelHeading)&&(!state.correcting||state.pointerActive)){const off=angleDiff(state.currentViewHeading,state.currentTravelHeading);state.userViewOffset=off;if(state.pointerActive||!state.playing)state.heldOffset=off}renderDiagnostics()});
  state.viewer.on('image',e=>{const image=e?.image;if(image){state.currentProjection=String(image.cameraType||'').toLowerCase()==='spherical'?'360':'Rectilinear';renderDiagnostics()}});
}

async function initializeViewer(){
  if(state.viewer||!state.route)return;
  const M=window.mapillary;if(!M?.Viewer)throw new Error('MapillaryJS 4.1.2を読み込めませんでした');
  state.cursor=0;state.successfulFrames=0;state.skippedFrames=0;state.consecutiveMoveErrors=0;state.transitionTimes=[];state.cadenceTimes=[];state.logs=[];state.stopReason='initializing';state.maxProgressSeen=null;state.regressionStreak=0;state.reverseEvents=0;state.viewJumps=0;state.deadlineMisses=0;state.completed=false;
  customTimelineMoves=0;nativeDefaultMoves=0;lastMoveMode='initial';
  state.viewer=new M.Viewer({accessToken:token(),container:'mly',imageTiling:true,transitionMode:M.TransitionMode.Default,component:{cover:false}});
  try{state.viewer.getComponent('pointer').configure({dragPan:true,scrollZoom:false,touchZoom:true})}catch{}
  installViewerEvents();installHudBehavior();setStatus('最初の景色を表示中…');
  setTransition(M.TransitionMode.Default);
  const t0=performance.now(),image=await moveToWithRetry(state.route.frames[0].id,3);nativeDefaultMoves++;
  state.initialDisplayMs=performance.now()-t0;state.successfulFrames=1;state.currentProjection=String(image?.cameraType||'').toLowerCase()==='spherical'||state.route.frames[0].isPano?'360':'Rectilinear';
  await readBearing();setFrameMetrics();logFrame();state.stopReason='ready';updatePlayButton();renderDiagnostics();showJourneyHud(true)
}
async function moveToWithRetry(id,maxAttempts=3){
  let last;
  for(let i=0;i<maxAttempts;i++){try{return await state.viewer.moveTo(id)}catch(error){last=error;if(i+1<maxAttempts)await sleep(180*(i+1))}}
  throw last
}
async function moveToNativeDefault(target,maxAttempts=3){
  setTransition(window.mapillary.TransitionMode.Default);
  lastMoveMode='Default only';nativeDefaultMoves++;
  return moveToWithRetry(target.id,maxAttempts)
}

function animateViewerZoom(from,to,duration,token){
  if(!state.viewer||state.pointerActive||!Number.isFinite(from)||!Number.isFinite(to)||Math.abs(to-from)<.001)return Promise.resolve();
  return new Promise(resolve=>{
    const started=performance.now();
    const tick=now=>{
      if(!state.viewer||state.pointerActive||token!==cameraMotionToken){resolve();return}
      const t=clamp((now-started)/Math.max(1,duration),0,1),eased=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
      try{state.viewer.setZoom(clamp(from+(to-from)*eased,0,3))}catch{}
      if(t<1)requestAnimationFrame(tick);else resolve()
    };
    requestAnimationFrame(tick)
  })
}
function customZoomAmount(stepDistanceM){
  const d=Number.isFinite(stepDistanceM)?stepDistanceM:20;
  const scaled=CUSTOM_MIN_ZOOM+clamp(d/80,0,1)*(CUSTOM_MAX_ZOOM-CUSTOM_MIN_ZOOM);
  return state.currentProjection==='360'?scaled*.82:scaled
}
async function moveToExclusiveCustom(target,maxAttempts=3){
  if(!state.viewer)return moveToWithRetry(target.id,maxAttempts);
  if(state.pointerActive)return moveToNativeDefault(target,maxAttempts);
  const M=window.mapillary,tokenId=++cameraMotionToken;
  let baseZoom=0;try{baseZoom=await state.viewer.getZoom()}catch{}
  if(!Number.isFinite(baseZoom))baseZoom=0;
  activeBaseZoom=baseZoom;
  const pushZoom=clamp(baseZoom+customZoomAmount(target.stepDistanceM),0,3);
  lastMoveMode='Instantaneous + custom timeline';
  customTimelineMoves++;
  setTransition(M.TransitionMode.Instantaneous);
  try{
    // Phase 1: only our camera moves. MapillaryJS internal transition is disabled.
    await animateViewerZoom(baseZoom,pushZoom,CUSTOM_PUSH_MS,tokenId);
    if(tokenId!==cameraMotionToken||!state.viewer)throw new Error('custom-motion-cancelled');
    if(state.pointerActive){
      try{state.viewer.setZoom(baseZoom)}catch{}
      activeBaseZoom=null;
      setTransition(M.TransitionMode.Default);
      return moveToNativeDefault(target,maxAttempts);
    }

    // Phase 2: switch while fully pushed-in. Register the image event first so the
    // settle phase cannot begin until the target image is really current.
    const visiblePromise=waitForImageEvent(target.id);
    let image=await moveToWithRetry(target.id,maxAttempts);
    const visibleImage=await visiblePromise;
    if(visibleImage)image=visibleImage;
    if(tokenId!==cameraMotionToken||!state.viewer)return image;

    // Instantaneous navigation may reset camera zoom with the new image.
    // Put the new image at the same pushed-in zoom, then settle on that image.
    try{state.viewer.setZoom(pushZoom)}catch{}
    await animateViewerZoom(pushZoom,baseZoom,CUSTOM_SETTLE_MS,tokenId);
    if(tokenId===cameraMotionToken&&state.viewer){try{state.viewer.setZoom(baseZoom)}catch{}}
    activeBaseZoom=null;
    setTransition(M.TransitionMode.Default);
    return image
  }catch(error){
    if(tokenId===cameraMotionToken&&state.viewer){try{state.viewer.setZoom(baseZoom)}catch{}}
    activeBaseZoom=null;
    setTransition(M.TransitionMode.Default);
    throw error
  }
}

function reverseGuard(target){
  const maxSeen=Number.isFinite(state.maxProgressSeen)?state.maxProgressSeen:currentFrame()?.routeProgress,behind=Number.isFinite(maxSeen)?maxSeen-target.routeProgress:0;
  if(behind>REGRESSION_HARD){state.reverseEvents++;return'route-progress-hard-regression'}
  if(behind>REGRESSION_SOFT)state.regressionStreak++;else state.regressionStreak=Math.max(0,state.regressionStreak-1);
  return null
}
async function moveOne(){
  const target=nextFrame();if(!target)return false;
  const guard=reverseGuard(target);if(guard){state.cursor++;state.skippedFrames++;state.stopReason=`skip:${guard}`;logFrame();renderJourneyHud();return true}
  const myToken=state.moveToken,held=Number.isFinite(state.userViewOffset)?state.userViewOffset:0;state.heldOffset=held;const t0=performance.now();
  try{
    // Autoplay always uses the custom timeline with MapillaryJS set to Instantaneous.
    // If the user is actively touching the viewer, fall back to Default only.
    const image=state.pointerActive?await moveToNativeDefault(target,3):await moveToExclusiveCustom(target,3);
    if(!state.playing||myToken!==state.moveToken)return false;
    const dt=performance.now()-t0;state.lastTransitionMs=dt;state.transitionTimes.push(dt);state.cursor++;state.successfulFrames++;state.consecutiveMoveErrors=0;
    state.currentProjection=String(image?.cameraType||'').toLowerCase()==='spherical'||target.isPano?'360':'Rectilinear';
    const now=performance.now();if(Number.isFinite(state.lastDisplayAt)){state.lastCadenceMs=now-state.lastDisplayAt;state.cadenceTimes.push(state.lastCadenceMs)}state.lastDisplayAt=now;
    setFrameMetrics();await readBearing();await gentlyPreservePano(state.pointerActive?state.heldOffset:held);setFrameMetrics();state.stopReason='playing';logFrame();return true
  }catch(error){
    if(!state.playing||myToken!==state.moveToken)return false;
    restoreDefaultCamera(true);
    if(String(error?.message||error)==='custom-motion-cancelled')return true;
    state.cursor++;state.skippedFrames++;state.consecutiveMoveErrors++;state.stopReason=`skip-load:${error?.message||error}`;state.lastTransitionMs=performance.now()-t0;
    logFrame();renderJourneyHud();await sleep(Math.min(600,140+state.consecutiveMoveErrors*80));return true
  }
}
async function playback(){
  if(state.playing||!state.viewer||state.completed)return;
  const run=++state.moveToken;state.playing=true;state.stopReason='playing';state.lastDisplayAt=performance.now();updatePlayButton();setStatus('自動再生中');showJourneyHud(true);
  while(state.playing&&run===state.moveToken&&state.cursor<state.route.frames.length-1){
    const ok=await moveOne();if(!ok||!state.playing)break;
    const hold=Number($('speed').value)||DEFAULT_CADENCE;if(hold>0)await sleep(hold)
  }
  if(state.playing&&state.cursor>=state.route.frames.length-1)completeJourney()
}
function pausePlayback(reason='user-pause',silent=false){state.playing=false;state.moveToken++;restoreDefaultCamera(true);state.stopReason=reason;updatePlayButton();showJourneyHud(true);if(!silent)setStatus('一時停止');renderDiagnostics()}
function stopPlayback(reason='user-stop',silent=false){pausePlayback(reason,true);if(!silent)setStatus(`停止: ${reason}`)}
function completeJourney(){state.playing=false;state.moveToken++;restoreDefaultCamera(true);state.completed=true;state.stopReason='arrived';updatePlayButton();renderJourneyHud();hideJourneyHud();$('arrivalText').textContent=`${state.selectedPlace?.name||'到着地'}まで ${distanceLabel(state.route?.totalDistanceM||0)} の旅を完了しました。`;$('arrivalOverlay').hidden=false;setStatus('到着しました')}
function destroyViewer(){clearHudHideTimer();viewerTapStart=null;restoreDefaultCamera(true);if(state.viewer){try{state.viewer.remove()}catch{}state.viewer=null}if($('mly'))$('mly').innerHTML='';state.playing=false;state.moveToken++;updatePlayButton()}

function logFrame(){
  const f=currentFrame();
  state.logs.push({step:state.cursor+1,id:f?.id||null,sequenceIndex:f?.sequenceIndex??null,sequenceGap:f?.sequenceGap??null,distanceFromStartM:f?.distanceFromStartM??null,remainingDistanceM:f?.remainingDistanceM??null,stepDistanceM:f?.stepDistanceM??null,routeProgress:state.currentProgress,travelHeading:state.currentTravelHeading,userViewOffset:state.userViewOffset,currentViewHeading:state.currentViewHeading,moveEffectMs:state.lastTransitionMs,moveMode:lastMoveMode,actualCadenceMs:state.lastCadenceMs,projection:state.currentProjection,stopReason:state.stopReason})
}
function renderJourneyHud(){
  const f=currentFrame(),total=state.route?.totalDistanceM||0,done=f?.distanceFromStartM||0,remain=Math.max(0,total-done),pct=total?clamp(done/total*100,0,100):0;
  if($('journeyProgress'))$('journeyProgress').value=Math.round(pct*10);
  if($('journeyProgressFill'))$('journeyProgressFill').style.width=`${pct}%`;
  if($('journeyDistance'))$('journeyDistance').textContent=`${distanceLabel(done)} / ${distanceLabel(total)}`;
  if($('journeyRemaining'))$('journeyRemaining').textContent=`残り ${distanceLabel(remain)}`;
  if($('journeyStep'))$('journeyStep').textContent=`+${distanceLabel(f?.stepDistanceM||0)}`;
  if($('journeyDepart'))$('journeyDepart').textContent=timeLabel(state.departureTime);
  if($('journeyArrive'))$('journeyArrive').textContent=timeLabel(state.arrivalTime);
  if($('journeyPercent'))$('journeyPercent').textContent=`${Math.round(pct)}%`;
  if($('journeyPlace'))$('journeyPlace').textContent=state.selectedPlace?.name||'到着地';
  updatePlayButton()
}
function updatePlayButton(){if(!$('playToggle'))return;$('playToggle').textContent=state.playing?'Ⅱ  一時停止':'▶  再生';$('playToggle').disabled=!state.viewer||state.completed}
async function seekToRatio(ratio){
  if(!state.viewer||!state.route)return;
  showJourneyHud(false);const was=state.seekWasPlaying||state.playing;state.seekWasPlaying=false;pausePlayback('seeking',true);
  const idx=clamp(Math.round(ratio*(state.route.frames.length-1)),0,state.route.frames.length-1),target=state.route.frames[idx];setStatus(`${distanceLabel(target.distanceFromStartM)}へ移動中…`);
  try{setTransition(window.mapillary.TransitionMode.Default);lastMoveMode='Default seek';nativeDefaultMoves++;const image=await moveToWithRetry(target.id,3);state.cursor=idx;state.currentProjection=String(image?.cameraType||'').toLowerCase()==='spherical'||target.isPano?'360':'Rectilinear';state.maxProgressSeen=target.routeProgress;await readBearing();setFrameMetrics();state.stopReason='seeked';logFrame()}catch(e){setStatus(`移動失敗: ${e?.message||e}`)}
  renderJourneyHud();showJourneyHud(true);if(was&&!state.completed)playback()
}

function renderDiagnostics(){
  if(!$('diagGrid'))return;const f=currentFrame(),rows=[
    ['version',PLAYBACK_VERSION],
    ['frame / step',`${Math.min(state.cursor+1,state.route?.frames.length||0)} / ${state.route?.frames.length||0} (success ${state.successfulFrames}, skip ${state.skippedFrames})`],
    ['sequenceId',state.route?.sequenceId||'—'],['Next / Prev',state.route?.direction||'—'],
    ['sequence gap',`${f?.sequenceGap??'—'} / max ${state.route?.maxSequenceGap??'—'}`],
    ['distance',`${distanceLabel(f?.distanceFromStartM)} / ${distanceLabel(state.route?.totalDistanceM)}`],['remaining',distanceLabel(f?.remainingDistanceM)],
    ['transition strategy','exclusive: Instantaneous+custom OR Default only'],
    ['current move mode',lastMoveMode],
    ['custom / Default moves',`${customTimelineMoves} / ${nativeDefaultMoves}`],
    ['custom zoom',`${CUSTOM_MIN_ZOOM.toFixed(2)}–${CUSTOM_MAX_ZOOM.toFixed(2)}`],
    ['custom timing',`${CUSTOM_PUSH_MS}ms push → image event → ${CUSTOM_SETTLE_MS}ms settle`],
    ['hold after move',fmt(Number($('speed')?.value)||DEFAULT_CADENCE,0,'ms')],
    ['move effect',fmt(state.lastTransitionMs,0,'ms')],['avg move effect',fmt(average(state.transitionTimes),0,'ms')],
    ['actual cadence',fmt(state.lastCadenceMs,0,'ms')],['avg cadence',fmt(average(state.cadenceTimes),0,'ms')],
    ['visible provider','MapillaryJS built-in'],['route cache',state.routeCacheHit?'HIT':'MISS'],['initialDisplayMs',fmt(state.initialDisplayMs,0,'ms')],
    ['travelHeading',fmt(state.currentTravelHeading,1,'°')],['userViewOffset',fmt(state.userViewOffset,1,'°')],['currentViewHeading',fmt(state.currentViewHeading,1,'°')],
    ['360 / Rectilinear',state.currentProjection],['reverse events',String(state.reverseEvents)],['view jumps',String(state.viewJumps)],['stopReason',state.stopReason],['frameId',f?.id||'—']
  ];$('diagGrid').innerHTML=rows.map(([k,v])=>`<span>${k}</span><b>${String(v)}</b>`).join('')
}
function diagnosticsText(){
  const f=currentFrame();return JSON.stringify({
    test:'MapillaryJS Journey',version:PLAYBACK_VERSION,start:state.start,goal:state.goal,place:state.selectedPlace?.name||null,
    sequenceId:state.route?.sequenceId||null,direction:state.route?.direction||null,totalDistanceM:state.route?.totalDistanceM||null,
    currentDistanceM:f?.distanceFromStartM||0,remainingDistanceM:f?.remainingDistanceM||null,departure:state.departureTime?.toISOString?.()||null,arrival:state.arrivalTime?.toISOString?.()||null,
    targetFrames:state.route?.frames.length||0,denseSequenceFrames:state.route?.denseFrameCount||null,maxSequenceGap:state.route?.maxSequenceGap??null,avgSequenceGap:state.route?.avgSequenceGap??null,
    requestedCadenceMs:Number($('speed').value)||DEFAULT_CADENCE,
    playbackTiming:'exclusive-custom-instantaneous-plus-hold',
    transitionStrategy:'autoplay=Instantaneous+custom timeline; manual/seek=Default only; never overlapped',
    customPushMs:CUSTOM_PUSH_MS,customSettleMs:CUSTOM_SETTLE_MS,customZoomRange:[CUSTOM_MIN_ZOOM,CUSTOM_MAX_ZOOM],
    customTimelineMoves,nativeDefaultMoves,lastMoveMode,imageEventGate:true,
    hudAutoHideMs:HUD_AUTO_HIDE_MS,hudTapToggle:true,elevationSamples:state.route?.elevationProfile?.length||0,
    successfulFrames:state.successfulFrames,skippedFrames:state.skippedFrames,initialDisplayMs:state.initialDisplayMs,
    averageMoveEffectMs:average(state.transitionTimes),averageCadenceMs:average(state.cadenceTimes),
    routeCacheHit:state.routeCacheHit,reverseEvents:state.reverseEvents,viewJumps:state.viewJumps,panoFrames:state.route?.pano||0,totalPreparedFrames:state.route?.frames.length||0,
    stopReason:state.stopReason,setupMs:state.setupMs,frames:state.logs
  },null,2)
}
async function copyDiagnostics(){const text=diagnosticsText();try{await navigator.clipboard.writeText(text);setStatus('Diagnosticsをコピーしました')}catch{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();setStatus('Diagnosticsをコピーしました')}}

function elevationAbortError(){const e=new Error('elevation-cancelled');e.name='AbortError';return e}
function cancelElevationProfile(){elevationGeneration++;try{elevationAbortController?.abort()}catch{}elevationAbortController=null;state.elevationLoading=false}
function elevationSampleLimit(distanceM){if(distanceM>=25000)return 18;if(distanceM>=8000)return 24;if(distanceM>=4000)return 30;return 36}
function sampleElevationFrames(route,limit){const frames=route?.frames||[];if(!frames.length)return[];if(frames.length<=limit)return frames.slice();const out=[],used=new Set();for(let i=0;i<limit;i++){const idx=Math.round(i*(frames.length-1)/Math.max(1,limit-1));if(!used.has(idx)){used.add(idx);out.push(frames[idx])}}return out}
async function fetchElevationBatch(samples,masterSignal,timeoutMs=4500){
  const local=new AbortController(),abort=()=>local.abort();if(masterSignal?.aborted)throw elevationAbortError();masterSignal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>local.abort(),timeoutMs);
  try{const lats=samples.map(f=>f.lat.toFixed(5)).join(','),lngs=samples.map(f=>f.lng.toFixed(5)).join(',');const res=await fetch(`${ELEVATION_API}?latitude=${encodeURIComponent(lats)}&longitude=${encodeURIComponent(lngs)}`,{signal:local.signal,cache:'no-store'});if(!res.ok)throw new Error(`標高API ${res.status}`);const j=await res.json();if(!Array.isArray(j.elevation)||j.elevation.length!==samples.length)throw new Error('標高データ不足');return j.elevation.map(Number)}
  catch(error){if(masterSignal?.aborted)throw elevationAbortError();if(error?.name==='AbortError')throw new Error('標高APIタイムアウト');throw error}
  finally{clearTimeout(timer);masterSignal?.removeEventListener('abort',abort)}
}
function interpolateElevationToFrames(route,profile){if(!route?.frames?.length||!profile?.length)return;let j=0;for(const f of route.frames){while(j<profile.length-2&&profile[j+1].distanceFromStartM<f.distanceFromStartM)j++;const a=profile[j],b=profile[Math.min(profile.length-1,j+1)],den=Math.max(.001,b.distanceFromStartM-a.distanceFromStartM),t=clamp((f.distanceFromStartM-a.distanceFromStartM)/den,0,1);f.elevation=a.elevation+(b.elevation-a.elevation)*t}}
async function loadElevationProfileFast(route){
  const gen=++elevationGeneration;try{elevationAbortController?.abort()}catch{}const controller=new AbortController();elevationAbortController=controller;state.elevationLoading=true;state.elevationError=null;
  try{
    const primary=elevationSampleLimit(route.totalDistanceM||0),attempts=[primary,Math.min(14,primary)].filter((v,i,a)=>a.indexOf(v)===i);let samples=null,values=null,lastError=null;
    for(const limit of attempts){try{samples=sampleElevationFrames(route,limit);values=await fetchElevationBatch(samples,controller.signal,limit===primary?4500:3200);break}catch(error){if(error?.name==='AbortError')throw error;lastError=error}}
    if(!values)throw lastError||new Error('標高データを取得できませんでした');if(gen!==elevationGeneration||route!==state.route)throw elevationAbortError();
    const profile=samples.map((f,i)=>({distanceFromStartM:f.distanceFromStartM,elevation:Number(values[i])}));route.elevationProfile=profile;route.elevations=profile.map(x=>x.elevation);interpolateElevationToFrames(route,profile);
    let ascent=0,descent=0;for(let i=1;i<profile.length;i++){const d=profile[i].elevation-profile[i-1].elevation;if(d>0)ascent+=d;else descent-=d}
    state.totalAscentM=ascent;state.totalDescentM=descent;state.durationSec=estimateDurationSec(route.totalDistanceM,ascent);return route.elevations
  }catch(error){
    if(error?.name==='AbortError')throw error;
    if(gen===elevationGeneration&&route===state.route){state.elevationError=String(error?.message||error);route.elevationProfile=[];route.elevations=[];state.totalAscentM=0;state.totalDescentM=0;state.durationSec=estimateDurationSec(route.totalDistanceM,0)}
    return[]
  }finally{if(gen===elevationGeneration){state.elevationLoading=false;if(elevationAbortController===controller)elevationAbortController=null}}
}
function renderElevationChartFast(){
  const svg=$('elevationChart'),route=state.route;if(!svg)return;
  const profile=route?.elevationProfile?.length?route.elevationProfile:(route?.frames||[]).filter(f=>Number.isFinite(f.elevation)).map(f=>({distanceFromStartM:f.distanceFromStartM,elevation:f.elevation}));
  if(!profile.length){svg.innerHTML='<text x="18" y="70" fill="rgba(255,255,255,.45)" font-size="10">標高を取得中…</text>';return}
  const w=360,h=130,pad=18,vals=profile.map(p=>p.elevation),min=Math.min(...vals),max=Math.max(...vals),span=Math.max(1,max-min),total=Math.max(1,route.totalDistanceM),pts=profile.map(p=>{const x=pad+(w-pad*2)*(p.distanceFromStartM/total),y=h-pad-(h-pad*2)*((p.elevation-min)/span);return[x,y]}),line=pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '),area=`${line} L${pts.at(-1)[0]},${h-pad} L${pts[0][0]},${h-pad} Z`;
  svg.innerHTML=`<defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(124,242,200,.32)"/><stop offset="1" stop-color="rgba(124,242,200,0)"/></linearGradient></defs><path d="${area}" fill="url(#eg)"/><path d="${line}" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}" stroke="rgba(255,255,255,.12)"/><text x="${pad}" y="${h-2}" fill="rgba(255,255,255,.45)" font-size="9">0</text><text x="${w-pad}" y="${h-2}" text-anchor="end" fill="rgba(255,255,255,.45)" font-size="9">${distanceLabel(total)}</text><text x="${pad}" y="12" fill="rgba(255,255,255,.45)" font-size="9">${Math.round(max)}m</text><text x="${pad}" y="${h-pad-4}" fill="rgba(255,255,255,.45)" font-size="9">${Math.round(min)}m</text>`
}

async function prepareRouteFromEndpointsExclusive(){
  const setupStart=performance.now();$('tripSheet').hidden=true;$('tripStart').disabled=true;$('prepArea').hidden=false;
  try{
    state.route=await resolveRouteBetweenPoints();state.totalDistanceM=state.route.totalDistanceM;showResolvedRoute(state.route);updateRouteSearchCard(`${state.route.direction}方向でルート確定`,86);
    state.provider=null;state.providerStats=null;state.preloadGeneration++;state.preloaded.clear();state.preloadTarget=0;state.preloadReadyAtOpen=0;
    state.stage='trip';syncPlannerUI();$('routeSearchCard').hidden=true;$('tripSheet').hidden=false;ensureTripEditButton();resetTripTiming();updateRouteSummary();renderTripTimes();renderElevationChartFast();
    const summary=state.routeCacheHit?'保存済みルートを使用':`${(state.routeResolveMs/1000).toFixed(1)}秒 / ${state.routeSearchApiRequests} API / ${state.route.direction}`;
    $('prepText').textContent=`出発準備OK ・ ${summary} ・ MapillaryJS標準Viewer`;$('prepBar').style.width='100%';$('tripStart').disabled=false;
    const routeRef=state.route;loadElevationProfileFast(routeRef).then(()=>{if(state.route!==routeRef||state.stage!=='trip')return;resetTripTiming();renderTripTimes();renderElevationChartFast()}).catch(()=>{});
    state.setupMs=performance.now()-setupStart;plannerStatus('ルート確定','旅を開始できます。標高は軽量サンプルで取得します')
  }catch(error){
    state.stage='search';syncPlannerUI();$('routeSearchTitle').textContent='ルートが見つかりませんでした';$('routeSearchHint').textContent=String(error?.message||error);$('routeSearchBar').style.width='0';$('routeSearchRetry').hidden=false;plannerStatus('出発地点を調整','少し場所を変えて再検索できます')
  }
}
function updateTripReadyStateExclusive(){if(!$('tripStart'))return;$('tripStart').disabled=!state.route}
function returnToStartSelectionFromTrip(){
  const oldStart=state.start?{...state.start}:null;cancelElevationProfile();state.preloadGeneration++;state.preloaded.clear();state.preloadTarget=0;state.route=null;state.provider=null;state.providerStats=null;state.totalDistanceM=null;state.totalAscentM=0;state.totalDescentM=0;state.routeCacheHit=false;state.routeResolveMs=null;state.startMarker?.remove();state.startMarker=null;state.start=null;clearResolvedRoute();$('tripSheet').hidden=true;$('prepArea').hidden=true;$('tripStart').disabled=true;state.stage='start';plannerStatus('出発地点を選ぶ','地図を動かし、中央の照準を出発地点に合わせます');syncPlannerUI();if(oldStart){try{state.map?.jumpTo({center:[oldStart.lng,oldStart.lat],zoom:Math.max(13,state.map.getZoom())})}catch{}}updateStartPickerCoord();state.map?.resize()
}
function ensureTripEditButton(){
  const panel=document.querySelector('#tripSheet .trip-panel');if(!panel||$('tripEditStart'))return;
  panel.style.position='relative';const head=panel.querySelector('.trip-head');if(head)head.style.paddingRight='42px';
  const btn=document.createElement('button');btn.id='tripEditStart';btn.type='button';btn.textContent='×';btn.setAttribute('aria-label','出発地点を選び直す');
  Object.assign(btn.style,{position:'absolute',right:'10px',top:'8px',width:'34px',height:'34px',minHeight:'34px',padding:'0',borderRadius:'50%',fontSize:'20px',lineHeight:'30px',zIndex:'3',background:'rgba(255,255,255,.08)',border:'1px solid rgba(255,255,255,.14)',color:'#fff'});
  btn.addEventListener('click',returnToStartSelectionFromTrip);panel.appendChild(btn)
}
try{loadElevationProfile=loadElevationProfileFast}catch{}
try{renderElevationChart=renderElevationChartFast}catch{}
try{prepareRouteFromEndpoints=prepareRouteFromEndpointsExclusive}catch{}
try{updateTripReadyState=updateTripReadyStateExclusive}catch{}
ensureTripEditButton();

async function startJourney(){
  if(!state.route)return;cancelElevationProfile();state.preloadGeneration++;state.departureTime=new Date();state.durationSec=estimateDurationSec(state.route.totalDistanceM,state.totalAscentM);state.arrivalTime=new Date(state.departureTime.getTime()+state.durationSec*1000);
  $('tripSheet').hidden=true;$('planner').hidden=true;$('viewerScreen').hidden=false;$('arrivalOverlay').hidden=true;$('viewerRouteLabel').textContent=`${state.selectedPlace?.name||'到着地'} ・ ${distanceLabel(state.route.totalDistanceM)}`;
  await initializeViewer();renderJourneyHud();showJourneyHud(true);playback()
}
function backToPlanner(){
  pausePlayback('planner',true);destroyViewer();cancelElevationProfile();$('viewerScreen').hidden=true;$('planner').hidden=false;$('arrivalOverlay').hidden=true;resetPlanner();
  try{state.map?.jumpTo({center:[135.7594,35.0068],zoom:12.5,bearing:0,pitch:0})}catch{}
  state.map?.resize();setTimeout(()=>{refreshPOIs();primeMapillaryRouteIndex()},80)
}
function finishJourney(){backToPlanner()}
function openTokenSheet(){$('tokenInput').value=token();$('tokenSheet').hidden=false}
function saveToken(){const v=$('tokenInput').value.trim();if(!v)return;try{localStorage.setItem(TOKEN_KEY,v)}catch{}$('tokenSheet').hidden=true;resetPlanner()}
