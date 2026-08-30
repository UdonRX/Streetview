/* Streetview Journey Full-Frame Predecoded 1024 Quality v0.1.7 */
(()=>{
  'use strict';
  if(window.__journeyHybridQualityInstalled)return;
  window.__journeyHybridQualityInstalled=true;

  const VERSION='0.1.7';
  /* 256 continuity still has priority, but quality is allowed much earlier than
     v0.1.6. The previous threshold of 10 made quality disappear in the latter
     half whenever the continuity window temporarily shrank. */
  const MIN_RAW_AHEAD=6;
  const FULL_RATE_RAW_AHEAD=12;
  const PREFETCH_FROM=3;
  const PREFETCH_TO=24;
  const EXPECTED_LONG_EDGE=900;
  const MAX_QUALITY_INFLIGHT=2;
  const cache=new Map(),inflight=new Map();
  let layer=null,currentKey=-1,loads=0,errors=0,resolutionMismatches=0,decodeErrors=0,exactHits=0,misses=0,lastStride=null,lowAheadSkips=0;

  const emit=(phase,detail={})=>{try{window.dispatchEvent(new CustomEvent('journey-hybrid-quality',{detail:{phase,version:VERSION,...detail}}))}catch{}};
  const runtime=()=>window.__journeyRawRuntime||{};
  const playback=()=>window.__journeyPlaybackState||{};
  const engine=()=>window.JourneyEngine?.getState?.()||{};
  const currentIndex=()=>{const p=playback(),e=engine();return Number.isFinite(p.index)?p.index:(Number.isFinite(e.index)?e.index:0)};
  const rawAhead=()=>{const r=runtime(),p=playback(),e=engine();const v=Number.isFinite(r.contiguousRawAhead)?r.contiguousRawAhead:(p.rawAheadReady??e.actualRenderableAhead??e.rawAheadReady??0);return Math.max(0,Number(v)||0)};
  const frames=()=>window.__journeyStreamState?.frames||window.__journeySelectedRoute?.frames||[];
  const qualitySource=i=>{const f=frames()[i];if(!f)return null;const url=f.raw1024Url||f.thumb_1024_url||null;return url?{url,tier:'1024'}:null};
  const remainingAhead=()=>Math.max(0,frames().length-currentIndex()-1);
  const requiredRawAhead=()=>Math.min(MIN_RAW_AHEAD,remainingAhead());

  function strideFor(ahead){
    /* Prefer 1024 on every frame whenever possible. Only reduce the quality
       sampling rate when the 256 continuity reserve becomes genuinely small. */
    if(ahead>=FULL_RATE_RAW_AHEAD)return 1;
    if(ahead>=9)return 1;
    if(ahead>=MIN_RAW_AHEAD)return 2;
    return Infinity;
  }

  function ensureLayer(){
    if(layer?.isConnected)return layer;
    const viewer=document.getElementById('viewer');if(!viewer)return null;
    const old=document.getElementById('journeyQualityLayer');if(old)old.style.display='none';
    layer=document.createElement('img');
    layer.id='journeyHybridQualityLayer';layer.alt='';layer.decoding='sync';layer.draggable=false;
    /* No clip-path and no mask. The 1024 bitmap is the same camera frame as the
       256 base, so once decoded it can replace the complete viewport directly.
       This removes the visible oval/seam and is also cheaper for Safari's
       compositor than masking a changing large image every frame. */
    layer.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;opacity:0;z-index:3;pointer-events:none;transform:translateZ(0);backface-visibility:hidden;transition:none;filter:none;will-change:opacity';
    viewer.appendChild(layer);
    return layer;
  }

  function loadQuality(index){
    if(cache.has(index)||inflight.has(index))return inflight.get(index)||Promise.resolve(cache.get(index));
    const aheadAtStart=rawAhead(),required=requiredRawAhead();
    /* Near the end of a completed route, fewer future raw frames exist by
       definition. Do not disable 1024 merely because there cannot be six frames
       ahead anymore. */
    if(aheadAtStart<required){lowAheadSkips++;return Promise.resolve(null)}
    const source=qualitySource(index);if(!source)return Promise.resolve(null);
    const promise=new Promise(resolve=>{
      const im=new Image();im.decoding='async';im.referrerPolicy='no-referrer';const started=performance.now();let done=false;
      const finish=(ok,decoded=true)=>{
        if(done)return;done=true;inflight.delete(index);
        const width=im.naturalWidth||0,height=im.naturalHeight||0,longEdge=Math.max(width,height);
        if(ok&&longEdge>=EXPECTED_LONG_EDGE&&decoded){
          cache.set(index,im);loads++;
          emit('load-complete',{index,elapsedMs:Math.round(performance.now()-started),width,height,longEdge,qualityTier:'1024',decoded:true,rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart,requiredRawAhead:required});resolve(im);
        }else if(ok&&longEdge>=EXPECTED_LONG_EDGE){
          decodeErrors++;emit('decode-error',{index,elapsedMs:Math.round(performance.now()-started),width,height,longEdge,rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart});resolve(null);
        }else if(ok){
          resolutionMismatches++;emit('resolution-mismatch',{index,elapsedMs:Math.round(performance.now()-started),width,height,longEdge,rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart});resolve(null);
        }else{
          errors++;emit('load-error',{index,elapsedMs:Math.round(performance.now()-started),rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart});resolve(null);
        }
      };
      im.onload=()=>{
        if(typeof im.decode==='function')im.decode().then(()=>finish(true,true)).catch(()=>finish(true,false));
        else finish(true,true);
      };
      im.onerror=()=>finish(false,false);
      emit('load-start',{index,requestedTier:'1024-predecode-full-frame',rawAhead:aheadAtStart,requiredRawAhead:required});
      im.src=source.url;
    });
    inflight.set(index,promise);return promise;
  }

  function prune(nowIndex){for(const k of cache.keys())if(k<nowIndex-2||k>nowIndex+32)cache.delete(k)}

  function schedule(){
    const base=currentIndex(),ahead=rawAhead(),required=requiredRawAhead(),remaining=remainingAhead();
    let stride=strideFor(ahead);
    /* At route end, the reserve naturally collapses. Continue full-rate quality
       for the remaining frames instead of treating it as starvation. */
    if(remaining<MIN_RAW_AHEAD&&ahead>=required)stride=1;
    lastStride=Number.isFinite(stride)?stride:null;
    if(ahead<required){lowAheadSkips++;return}
    if(!Number.isFinite(stride)||inflight.size>=MAX_QUALITY_INFLIGHT)return;
    let started=0;
    for(let offset=PREFETCH_FROM;offset<=PREFETCH_TO&&inflight.size<MAX_QUALITY_INFLIGHT;offset++){
      const i=base+offset;if(i>=frames().length)break;
      if(i%stride!==0||!qualitySource(i)||cache.has(i)||inflight.has(i))continue;
      loadQuality(i);started++;
      if(started>=MAX_QUALITY_INFLIGHT)break;
    }
  }

  function hideQuality(index,reason){
    if(layer)layer.style.opacity='0';currentKey=-1;misses++;
    emit('present-base-continuity',{index,reason,rawAhead:rawAhead(),requiredRawAhead:requiredRawAhead(),stride:lastStride,fullFrameHighRes:false,baseTier:'256'});
  }

  function present(index){
    ensureLayer();if(!layer)return;
    prune(index);schedule();
    const image=cache.get(index);
    if(!image){hideQuality(index,'exact-predecoded-quality-not-ready');return}
    const src=String(image.currentSrc||image.src||'');
    if(!src){hideQuality(index,'quality-src-missing');return}
    /* Exact frame only: never hold an old 1024 bitmap over a newer 256 frame.
       The decoded 1024 frame covers the whole viewport, so there is no visible
       high/low-resolution boundary anywhere on screen. */
    if(layer.currentSrc!==src&&layer.src!==src)layer.src=src;
    layer.style.opacity='1';currentKey=index;exactHits++;
    const width=image.naturalWidth||0,height=image.naturalHeight||0,longEdge=Math.max(width,height);
    emit('present-exact',{index,keyIndex:index,age:0,rawAhead:rawAhead(),requiredRawAhead:requiredRawAhead(),stride:lastStride,width,height,longEdge,qualityTier:'1024',decoded:true,fullFrameHighRes:true,centerHighRes:false,zIndex:3,exactFrameOnly:true,renderMode:'predecoded-full-frame'});
  }

  window.addEventListener('journey-frame-presented',e=>{const d=e.detail||{},i=Number(d.index);if(Number.isFinite(i))present(i)});
  window.addEventListener('journey-playback-started',()=>{ensureLayer();setTimeout(schedule,20)});
  window.addEventListener('journey-stream-updated',schedule);
  setInterval(schedule,55);

  window.__journeyHybridQuality={version:VERSION,state:()=>({
    version:VERSION,mode:'1024-predecoded-full-frame-256-continuity',renderMode:'predecoded-full-frame',exactFrameOnly:true,
    rawAhead:rawAhead(),requiredRawAhead:requiredRawAhead(),remainingAhead:remainingAhead(),stride:lastStride,minRawAhead:MIN_RAW_AHEAD,fullRateRawAhead:FULL_RATE_RAW_AHEAD,maxInflight:MAX_QUALITY_INFLIGHT,
    cache:cache.size,inflight:inflight.size,loads,errors,resolutionMismatches,decodeErrors,exactHits,heldHits:0,misses,lowAheadSkips,currentKey,
    currentLongEdge:currentKey>=0?Math.max(cache.get(currentKey)?.naturalWidth||0,cache.get(currentKey)?.naturalHeight||0):0,
    currentTier:currentKey>=0?'1024':null,
    fullFrameHighRes:currentKey>=0
  })};
  emit('ready',{mode:'1024-predecoded-full-frame-256-continuity',renderMode:'predecoded-full-frame',exactFrameOnly:true,minRawAhead:MIN_RAW_AHEAD,fullRateRawAhead:FULL_RATE_RAW_AHEAD,prefetchFrom:PREFETCH_FROM,prefetchTo:PREFETCH_TO,maxInflight:MAX_QUALITY_INFLIGHT});
})();
