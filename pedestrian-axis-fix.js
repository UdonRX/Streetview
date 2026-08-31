/* Streetview Journey SIDEWALK runtime — dedicated centered 1024 display layer */
(()=>{
  'use strict';
  if(window.__pedestrianAxisFixInstalled)return;
  window.__pedestrianAxisFixInstalled=true;

  const VERSION='0.5.0-sidewalk-dedicated-center-layer';
  const ROUTE_KEY='streetview:journey-route';
  const CENTER_X=50;
  const CENTER_Y=50;
  const CENTER_EVALUATION_END_INDEX=149;
  const OVERLAY_ID='sidewalkDedicatedCenterLayer';
  const PREFETCH_AHEAD=28;
  const PREFETCH_CONCURRENCY=6;
  const CACHE_LIMIT=48;
  const LOAD_TIMEOUT_MS=3200;

  const ready1024=new Set();
  const failed1024=new Set();
  const queued=new Set();
  const inflight=new Set();
  const imageCache=new Map();
  const queue=[];
  let active=0;
  let centerLockIndex=-1;
  let centerLockDraws=0;
  let centerLoadMisses=0;
  let lastRequestedIndex=-1;
  let lastRequestedKey='';
  let lastPresentedKey='';
  let lastSourceWidth=0;
  let lastSourceHeight=0;
  let qualityWrapped=false;

  function selectedRoute(){
    if(window.__journeySelectedRoute)return window.__journeySelectedRoute;
    try{return JSON.parse(sessionStorage.getItem(ROUTE_KEY)||'null')}catch{return null}
  }
  function normalizeProfile(value){
    const p=String(value||'').trim().toUpperCase();
    if(['ROAD','SIDEWALK','MOUNTAIN','RAIL','BIKE','AUTO','UNKNOWN'].includes(p))return p;
    return 'AUTO';
  }
  function profile(){
    const route=selectedRoute();
    const explicit=normalizeProfile(route?.journeyProfile||route?.routeProfile||route?.profile);
    if(explicit!=='AUTO'&&explicit!=='UNKNOWN')return explicit;
    const id=String(route?.fixedTestRoute?.routeId||route?.destination?.testRouteType||'').toLowerCase();
    if(id==='sidewalk')return 'SIDEWALK';
    const genre=String(route?.routeGenre||route?.genre||route?.category||'').toUpperCase();
    if(['SIDEWALK','WALK','PEDESTRIAN'].includes(genre))return 'SIDEWALK';
    const classified=String(window.JourneyTransportClassifier?.state?.()?.transportMode||'').toUpperCase();
    return classified==='WALK'?'SIDEWALK':explicit;
  }
  const isSidewalk=()=>profile()==='SIDEWALK';

  function frames(){
    const stream=window.__journeyStreamState?.frames;
    if(Array.isArray(stream)&&stream.length)return stream;
    const route=selectedRoute();
    return Array.isArray(route?.frames)?route.frames:[];
  }
  function frameKey(frame,index=-1){
    return String(frame?.id||`${frame?.sequenceId||'seq'}:${frame?.sequenceIndex??index}`);
  }
  function unwrap(value){
    try{
      const u=new URL(String(value||''),location.href);
      if(u.origin===location.origin&&u.pathname==='/api/imagery'&&u.searchParams.get('mode')==='mapillary-image'){
        return String(u.searchParams.get('url')||'');
      }
      return u.href;
    }catch{return String(value||'')}
  }
  function source1024(frame){
    return String(
      frame?.raw1024Url||frame?.thumb_1024_url||frame?.thumb1024Url||
      frame?.source1024Url||frame?.sourceUrl||unwrap(frame?.url)||''
    );
  }
  function playbackIndex(){
    const n=Number(window.__journeyPlaybackState?.index);
    return Number.isFinite(n)?Math.max(0,Math.floor(n)):0;
  }
  function emit(name,detail={}){
    try{window.dispatchEvent(new CustomEvent(name,{detail}))}catch{}
  }

  function lockFrame(frame){
    if(!frame||typeof frame!=='object')return;
    if(!Number.isFinite(Number(frame.__sidewalkOriginalHeading))&&Number.isFinite(Number(frame.heading))){
      frame.__sidewalkOriginalHeading=Number(frame.heading);
    }
    frame.heading=null;
    frame.projectionYaw=null;
    frame.headingSource='sidewalk-dedicated-source-center-50';
    frame.journeyProfile='SIDEWALK';
    frame.photoCenterX=CENTER_X;
    frame.photoCenterY=CENTER_Y;
    frame.preferredImageTier='1024';
  }
  function lockFrames(){
    if(!isSidewalk())return;
    const list=frames();
    for(const frame of list)lockFrame(frame);
    const route=selectedRoute();
    if(route){
      route.journeyProfile='SIDEWALK';
      route.profileIsolation=true;
      route.presentationProfile={
        ...(route.presentationProfile||{}),
        photoCenterX:CENTER_X,
        photoCenterY:CENTER_Y,
        preferredImageTier:'1024',
        strictPhotoCenter:true,
        dedicatedCenterLayer:true,
        centerEvaluationEndIndex:CENTER_EVALUATION_END_INDEX,
        sidewalkRuntime:VERSION
      };
    }
  }

  function ensureOverlay(){
    let img=document.getElementById(OVERLAY_ID);
    if(!img){
      const viewer=document.getElementById('viewer');
      if(!viewer)return null;
      img=document.createElement('img');
      img.id=OVERLAY_ID;
      img.alt='';
      img.decoding='async';
      img.draggable=false;
      img.referrerPolicy='no-referrer';
      img.setAttribute('aria-hidden','true');
      Object.assign(img.style,{
        position:'absolute',
        inset:'0',
        width:'100%',
        height:'100%',
        objectFit:'cover',
        objectPosition:'50% 50%',
        transform:'none',
        transformOrigin:'50% 50%',
        zIndex:'3',
        opacity:'0',
        pointerEvents:'none',
        userSelect:'none',
        filter:'brightness(.9) contrast(1.08) saturate(.94)',
        backfaceVisibility:'hidden',
        WebkitBackfaceVisibility:'hidden'
      });
      img.addEventListener('load',()=>{
        const requestedIndex=Number(img.dataset.requestedIndex);
        const requestedKey=String(img.dataset.requestedKey||'');
        if(!isSidewalk()||!Number.isFinite(requestedIndex)||!requestedKey)return;
        if(requestedIndex!==playbackIndex())return;
        const currentFrame=frames()[requestedIndex];
        if(!currentFrame||frameKey(currentFrame,requestedIndex)!==requestedKey)return;
        img.style.objectPosition='50% 50%';
        img.style.transform='none';
        img.style.opacity='1';
        centerLockIndex=requestedIndex;
        lastPresentedKey=requestedKey;
        lastSourceWidth=img.naturalWidth||0;
        lastSourceHeight=img.naturalHeight||0;
        centerLockDraws++;
        emit('sidewalk-dedicated-center-rendered',{
          index:requestedIndex,
          sourceWidth:lastSourceWidth,
          sourceHeight:lastSourceHeight,
          sourceCenterX:CENTER_X,
          sourceCenterY:CENTER_Y,
          objectPosition:'50% 50%',
          evaluationFrame:requestedIndex<=CENTER_EVALUATION_END_INDEX
        });
      });
      img.addEventListener('error',()=>{
        const i=Number(img.dataset.requestedIndex);
        if(Number.isFinite(i))centerLoadMisses++;
      });
      viewer.appendChild(img);
    }
    img.style.display=isSidewalk()?'block':'none';
    return img;
  }
  function hideOverlay(){
    const img=document.getElementById(OVERLAY_ID);
    if(img){img.style.display='none';img.style.opacity='0'}
    centerLockIndex=-1;
    lastPresentedKey='';
  }

  function rememberImage(key,image){
    if(!key||!image?.naturalWidth)return;
    imageCache.delete(key);
    imageCache.set(key,image);
    while(imageCache.size>CACHE_LIMIT){
      const first=imageCache.keys().next().value;
      imageCache.delete(first);
    }
  }
  function queueFrame(index,priority=100){
    if(!isSidewalk())return;
    const frame=frames()[index];
    if(!frame)return;
    const key=frameKey(frame,index),url=source1024(frame);
    if(!url||failed1024.has(key)||ready1024.has(key)||queued.has(key)||inflight.has(key))return;
    queued.add(key);
    queue.push({index,key,url,priority});
  }
  function finishTask(task,ok,image){
    inflight.delete(task.key);
    active=Math.max(0,active-1);
    if(ok&&image?.naturalWidth){
      ready1024.add(task.key);
      failed1024.delete(task.key);
      rememberImage(task.key,image);
      if(task.index===playbackIndex())presentIndex(task.index,true);
    }else{
      failed1024.add(task.key);
    }
    pumpPrefetch();
  }
  function startTask(task){
    queued.delete(task.key);
    inflight.add(task.key);
    active++;
    const im=new Image();
    im.decoding='async';
    im.referrerPolicy='no-referrer';
    let done=false;
    const finish=(ok)=>{
      if(done)return;
      done=true;
      clearTimeout(timer);
      finishTask(task,ok,ok?im:null);
    };
    im.onload=()=>finish(true);
    im.onerror=()=>finish(false);
    const timer=setTimeout(()=>finish(false),LOAD_TIMEOUT_MS);
    try{im.setAttribute('src',task.url)}catch{finish(false)}
  }
  function pumpPrefetch(){
    if(!isSidewalk())return;
    const list=frames();
    const current=playbackIndex();
    const end=Math.min(list.length-1,current+PREFETCH_AHEAD);
    queueFrame(current,-5000);
    for(let i=current+1;i<=end;i++)queueFrame(i,i-current);
    queue.sort((a,b)=>a.priority-b.priority||a.index-b.index);
    while(active<PREFETCH_CONCURRENCY&&queue.length)startTask(queue.shift());
  }

  function presentIndex(index,force=false){
    if(!isSidewalk())return false;
    index=Number(index);
    if(!Number.isFinite(index))return false;
    const frame=frames()[index];
    if(!frame)return false;
    lockFrame(frame);
    const key=frameKey(frame,index),url=source1024(frame);
    if(!url)return false;
    const overlay=ensureOverlay();
    if(!overlay)return false;

    lastRequestedIndex=index;
    lastRequestedKey=key;
    overlay.dataset.requestedIndex=String(index);
    overlay.dataset.requestedKey=key;
    overlay.style.objectPosition='50% 50%';
    overlay.style.transform='none';

    const currentSrc=unwrap(overlay.currentSrc||overlay.getAttribute('src')||'');
    const wanted=unwrap(url);
    if(force||currentSrc!==wanted||lastPresentedKey!==key){
      try{overlay.setAttribute('src',url)}catch{return false}
    }else if(overlay.complete&&overlay.naturalWidth){
      overlay.style.opacity='1';
      centerLockIndex=index;
      lastPresentedKey=key;
      lastSourceWidth=overlay.naturalWidth||0;
      lastSourceHeight=overlay.naturalHeight||0;
      centerLockDraws++;
    }
    return centerLockIndex===index;
  }

  function patchQualityState(){
    const quality=window.__journeyHybridQuality;
    if(!quality||typeof quality.state!=='function'||qualityWrapped)return;
    const nativeState=quality.state.bind(quality);
    quality.state=()=>{
      const base=nativeState()||{};
      if(!isSidewalk())return base;
      return{
        ...base,
        networkSource:'sidewalk-dedicated-center-layer',
        currentImageTier:centerLockIndex===playbackIndex()?'1024':'1024-loading',
        highResAhead:highResAhead(),
        centerLockIndex,
        strictPhotoCenter:true,
        strictCanvasActive:false,
        dedicatedCenterLayer:true,
        dedicatedCenterLayerActive:isOverlayActive(),
        centerEvaluationEndIndex:CENTER_EVALUATION_END_INDEX,
        qualityCache:{
          ...(base.qualityCache||{}),
          ready1024:ready1024.size,
          failed1024:failed1024.size,
          display1024:imageCache.size
        },
        opticalConfidence:0,
        warpEnabled:false,
        warpFallbackReason:'sidewalk-profile-isolated-dedicated-center-layer',
        intermediateFramesGenerated:0,
        warpRenderMs:0
      };
    };
    quality.__sidewalkCenterLayerWrapped=true;
    qualityWrapped=true;
  }
  function highResAhead(){
    const list=frames(),current=playbackIndex();
    let n=0;
    for(let i=current+1;i<Math.min(list.length,current+1+PREFETCH_AHEAD);i++){
      if(!ready1024.has(frameKey(list[i],i)))break;
      n++;
    }
    return n;
  }
  function isOverlayActive(){
    const img=document.getElementById(OVERLAY_ID);
    return !!(img&&isSidewalk()&&img.style.display!=='none'&&img.style.opacity==='1'&&centerLockIndex===playbackIndex());
  }

  function state(){
    return{
      version:VERSION,
      enabled:isSidewalk(),
      journeyProfile:profile(),
      photoCenterX:CENTER_X,
      photoCenterY:CENTER_Y,
      strictPhotoCenter:true,
      dedicatedCenterLayer:true,
      dedicatedCenterLayerActive:isOverlayActive(),
      centerEvaluationEndIndex:CENTER_EVALUATION_END_INDEX,
      evaluationFrame:playbackIndex()<=CENTER_EVALUATION_END_INDEX,
      playbackIndex:playbackIndex(),
      centerLockIndex,
      centerLockDraws,
      centerLoadMisses,
      lastRequestedIndex,
      lastRequestedKey,
      lastPresentedKey,
      sourceWidth:lastSourceWidth,
      sourceHeight:lastSourceHeight,
      ready1024:ready1024.size,
      failed1024:failed1024.size,
      cached1024:imageCache.size,
      queued1024:queue.length,
      active1024:active,
      highResAhead:highResAhead(),
      preferredImageTier:'1024',
      objectPosition:'50% 50%'
    };
  }

  window.__sidewalkJourneyRuntime={
    version:VERSION,
    state,
    lockFrames,
    pumpPrefetch,
    presentIndex
  };
  window.__pedestrianAxisFix={
    version:VERSION,
    mode:'SIDEWALK-only dedicated 1024 source-center layer',
    state,
    at:new Date().toISOString()
  };

  function tick(){
    if(!isSidewalk()){
      hideOverlay();
      return;
    }
    lockFrames();
    ensureOverlay();
    patchQualityState();
    pumpPrefetch();
    const current=playbackIndex();
    if(centerLockIndex!==current||lastRequestedIndex!==current)presentIndex(current,false);
  }

  window.addEventListener('journey-engine-ready',tick);
  window.addEventListener('journey-profile-changed',tick);
  window.addEventListener('journey-playback-started',tick);
  window.addEventListener('journey-frame-presented',e=>{
    if(!isSidewalk())return;
    const i=Number(e?.detail?.index);
    presentIndex(Number.isFinite(i)?i:playbackIndex(),false);
    pumpPrefetch();
  });
  window.addEventListener('resize',()=>{
    if(isSidewalk())presentIndex(playbackIndex(),true);
  });

  tick();
  setInterval(tick,40);
})();