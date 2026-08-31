/* Streetview Journey SIDEWALK runtime — centered 1024 primary lane */
(()=>{
  'use strict';
  if(window.__pedestrianAxisFixInstalled)return;
  window.__pedestrianAxisFixInstalled=true;

  const VERSION='0.4.0-sidewalk-center1024';
  const ROUTE_KEY='streetview:journey-route';
  const BOOTSTRAP_FRAMES=8;
  const PREFETCH_AHEAD=30;
  const PREFETCH_CONCURRENCY=8;
  const PREFETCH_TIMEOUT_MS=2600;
  const CENTER_X=50;

  const ready1024=new Set();
  const failed1024=new Set();
  const queued1024=new Set();
  const inflight1024=new Set();
  const queue=[];
  const urlIndex=new Map();
  let activePrefetch=0;
  let mappedLength=-1;
  let engineWrapped=false;
  let srcWrapped=false;
  let enabledOnce=false;
  let currentTier='1024-loading';
  let total1024Loads=0;
  let total1024Errors=0;

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
  function frameKey(frame,index=-1){return String(frame?.id||`${frame?.sequenceId||'seq'}:${frame?.sequenceIndex??index}`)}
  function unwrap(value){
    try{
      const u=new URL(String(value||''),location.href);
      if(u.origin===location.origin&&u.pathname==='/api/imagery'&&u.searchParams.get('mode')==='mapillary-image'){
        return String(u.searchParams.get('url')||'');
      }
      return u.href;
    }catch{return String(value||'')}
  }
  function emit(phase,detail={}){
    try{window.dispatchEvent(new CustomEvent('journey-image-load',{detail:{phase,...detail}}))}catch{}
  }
  function lockFrame(frame){
    if(!frame||typeof frame!=='object')return;
    if(!Number.isFinite(Number(frame.__sidewalkOriginalHeading))&&Number.isFinite(Number(frame.heading)))frame.__sidewalkOriginalHeading=Number(frame.heading);
    frame.heading=null;
    frame.projectionYaw=null;
    frame.headingSource='sidewalk-photo-center-50';
    frame.journeyProfile='SIDEWALK';
    frame.photoCenterX=CENTER_X;
    frame.preferredImageTier='1024';
  }
  function lockFrames(list=frames()){
    if(!isSidewalk()||!Array.isArray(list))return;
    enabledOnce=true;
    for(const frame of list)lockFrame(frame);
    const route=selectedRoute();
    if(route){
      route.journeyProfile='SIDEWALK';
      route.profileIsolation=true;
      route.presentationProfile={...(route.presentationProfile||{}),photoCenterX:CENTER_X,preferredImageTier:'1024',sidewalkRuntime:VERSION};
    }
  }
  function rebuildUrlIndex(force=false){
    const list=frames();
    if(!force&&mappedLength===list.length)return;
    urlIndex.clear();
    for(let i=0;i<list.length;i++){
      const frame=list[i];
      for(const candidate of [frame?.url,frame?.sourceUrl,frame?.raw2048Url,frame?.raw1024Url,frame?.raw256Url,frame?.thumb_2048_url,frame?.thumb_1024_url,frame?.thumb_256_url]){
        const key=unwrap(candidate);if(key)urlIndex.set(key,{frame,index:i});
      }
    }
    mappedLength=list.length;
  }
  function frameForRequest(value){
    rebuildUrlIndex();
    const key=unwrap(value);
    return urlIndex.get(key)||null;
  }
  function highResAhead(){
    const list=frames();
    const current=Math.max(0,Number(window.__journeyPlaybackState?.index)||0);
    let n=0;
    for(let i=current+1;i<Math.min(list.length,current+1+PREFETCH_AHEAD);i++){
      if(!ready1024.has(frameKey(list[i],i)))break;
      n++;
    }
    return n;
  }
  function updateTier(){
    if(!isSidewalk()){currentTier='inactive';return}
    const list=frames(),i=Math.max(0,Number(window.__journeyPlaybackState?.index)||0),key=frameKey(list[i],i);
    currentTier=ready1024.has(key)?'1024':'1024-loading';
  }
  function queueFrame(index,priority=100){
    if(!isSidewalk())return;
    const list=frames(),frame=list[index];
    if(!frame)return;
    const key=frameKey(frame,index),url=frame.raw1024Url||frame.thumb_1024_url||null;
    if(!url||ready1024.has(key)||failed1024.has(key)||queued1024.has(key)||inflight1024.has(key))return;
    queued1024.add(key);queue.push({index,key,url,priority});
  }
  function finishPrefetch(task,ok){
    inflight1024.delete(task.key);activePrefetch=Math.max(0,activePrefetch-1);
    if(ok){ready1024.add(task.key);total1024Loads++}else{failed1024.add(task.key);total1024Errors++}
    updateTier();pumpPrefetch();
  }
  function startPrefetch(task){
    queued1024.delete(task.key);inflight1024.add(task.key);activePrefetch++;
    const im=new Image();im.decoding='async';im.referrerPolicy='no-referrer';let done=false;
    const finish=ok=>{if(done)return;done=true;clearTimeout(timer);finishPrefetch(task,ok)};
    im.onload=()=>finish(true);im.onerror=()=>finish(false);
    const timer=setTimeout(()=>{try{im.removeAttribute('src')}catch{}finish(false)},PREFETCH_TIMEOUT_MS);
    try{im.setAttribute('src',task.url)}catch{finish(false)}
  }
  function pumpPrefetch(){
    if(!isSidewalk())return;
    lockFrames();rebuildUrlIndex();
    const list=frames(),current=Math.max(0,Number(window.__journeyPlaybackState?.index)||0);
    const end=Math.min(list.length-1,Math.max(BOOTSTRAP_FRAMES-1,current+PREFETCH_AHEAD));
    for(let i=current;i<=end;i++)queueFrame(i,i-current);
    queue.sort((a,b)=>a.priority-b.priority||a.index-b.index);
    while(activePrefetch<PREFETCH_CONCURRENCY&&queue.length)startPrefetch(queue.shift());
  }

  function installSrcOverride(){
    if(srcWrapped)return true;
    const desc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
    if(!desc?.set)return false;
    const previousSet=desc.set;
    Object.defineProperty(HTMLImageElement.prototype,'src',{
      configurable:desc.configurable,enumerable:desc.enumerable,get:desc.get,
      set(value){
        if(!isSidewalk()||this.crossOrigin==='anonymous'||!value){previousSet.call(this,value);return}
        lockFrames();
        const hit=frameForRequest(value),frame=hit?.frame,index=hit?.index,key=frameKey(frame,index);
        const high=frame?.raw1024Url||frame?.thumb_1024_url||null;
        if(!frame||!high||failed1024.has(key)){previousSet.call(this,value);return}
        const started=performance.now();let settled=false;
        const finish=(phase)=>{
          if(settled)return;settled=true;
          if(phase==='complete'){ready1024.add(key);total1024Loads++;currentTier='1024'}
          else{failed1024.add(key);total1024Errors++}
          emit(phase,{purpose:'raw',index,frameId:key,transport:'mapillary-direct',variant:'1024-sidewalk-primary',elapsedMs:Math.round(performance.now()-started),timeoutMs:PREFETCH_TIMEOUT_MS,width:this.naturalWidth||0,height:this.naturalHeight||0,contiguousRawAhead:highResAhead()});
          pumpPrefetch();
        };
        this.addEventListener('load',()=>finish('complete'),{once:true});
        this.addEventListener('error',()=>finish('error'),{once:true});
        emit('start',{purpose:'raw',index,frameId:key,transport:'mapillary-direct',variant:'1024-sidewalk-primary',startedAt:performance.now(),timeoutMs:PREFETCH_TIMEOUT_MS});
        try{this.setAttribute('src',high)}catch{failed1024.add(key);previousSet.call(this,value)}
      }
    });
    srcWrapped=true;return true;
  }

  function installEngineWrapper(){
    if(engineWrapped||!window.JourneyEngine?.startFrames)return false;
    const native=window.JourneyEngine.startFrames.bind(window.JourneyEngine);
    const wrapped=async(initialFrames,streamState)=>{
      if(!isSidewalk())return native(initialFrames,streamState);
      lockFrames(initialFrames);lockFrames(streamState?.frames);rebuildUrlIndex(true);pumpPrefetch();
      const realStream=streamState||window.__journeyStreamState||null;
      const bootstrap=(Array.isArray(initialFrames)?initialFrames:[]).slice(0,BOOTSTRAP_FRAMES);
      const shadow=realStream?{...realStream,frames:bootstrap.slice(),active:true,complete:false}:realStream;
      const restore=()=>{
        if(realStream)window.__journeyStreamState=realStream;
        lockFrames();rebuildUrlIndex(true);pumpPrefetch();
      };
      window.addEventListener('journey-playback-started',restore,{once:true});
      try{return await native(bootstrap.length>=2?bootstrap:initialFrames,shadow)}finally{restore()}
    };
    wrapped.__sidewalk1024Wrapped=true;
    window.JourneyEngine.startFrames=wrapped;engineWrapped=true;return true;
  }

  const state=()=>({
    version:VERSION,enabled:isSidewalk(),journeyProfile:profile(),photoCenterX:CENTER_X,
    currentImageTier:isSidewalk()?currentTier:'inactive',highResAhead:isSidewalk()?highResAhead():0,
    ready1024:ready1024.size,failed1024:failed1024.size,queued1024:queue.length,
    active1024:activePrefetch,total1024Loads,total1024Errors,prefetchAhead:PREFETCH_AHEAD,
    prefetchConcurrency:PREFETCH_CONCURRENCY,bootstrapFrames:BOOTSTRAP_FRAMES
  });
  window.__sidewalkJourneyRuntime={version:VERSION,state,lockFrames,pumpPrefetch};

  /* Playback logger already reads this API. ROAD never reaches this branch, so
     ROAD's real hybrid-quality module remains completely separate. */
  function publishQualityState(){
    if(!isSidewalk())return;
    if(!window.__journeyHybridQuality||window.__journeyHybridQuality.__sidewalkShim){
      window.__journeyHybridQuality={__sidewalkShim:true,state:()=>({
        networkClass:'NORMAL',networkSource:'sidewalk-1024-prefetch',currentImageTier:state().currentImageTier,
        highResAhead:highResAhead(),loadEwmaMs:null,qualityCache:{ready1024:ready1024.size,failed1024:failed1024.size},
        journeyQualityScore:null,qualityRejectedFrames:0,qualityUnknownFrames:0,qualityScoreFieldAvailable:null,
        opticalConfidence:0,warpEnabled:false,warpFallbackReason:'sidewalk-profile-isolated',intermediateFramesGenerated:0,warpRenderMs:0
      })};
    }
  }

  installSrcOverride();
  installEngineWrapper();
  lockFrames();pumpPrefetch();publishQualityState();
  window.addEventListener('journey-engine-ready',()=>{installEngineWrapper();lockFrames();pumpPrefetch();publishQualityState()});
  window.addEventListener('journey-profile-changed',()=>{lockFrames();pumpPrefetch();publishQualityState()});
  window.addEventListener('journey-frame-presented',()=>{lockFrames();pumpPrefetch();updateTier()});
  setInterval(()=>{
    if(!isSidewalk())return;
    installSrcOverride();installEngineWrapper();lockFrames();pumpPrefetch();publishQualityState();updateTier();
  },16);

  window.__pedestrianAxisFix={version:VERSION,mode:'SIDEWALK-only photo-center-50 + 1024-primary',state,at:new Date().toISOString()};
})();