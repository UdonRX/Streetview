/* Streetview Journey Predecoded 1024 Center Quality v0.1.6 */
(()=>{
  'use strict';
  if(window.__journeyHybridQualityInstalled)return;
  window.__journeyHybridQualityInstalled=true;

  const VERSION='0.1.6';
  const MIN_RAW_AHEAD=10;
  const FULL_RATE_RAW_AHEAD=15;
  const PREFETCH_FROM=6;
  const PREFETCH_TO=26;
  const EXPECTED_LONG_EDGE=900;
  const MAX_QUALITY_INFLIGHT=1;
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

  function strideFor(ahead){if(ahead>=FULL_RATE_RAW_AHEAD)return 1;if(ahead>=13)return 2;if(ahead>=MIN_RAW_AHEAD)return 3;return Infinity}

  function ensureLayer(){
    if(layer?.isConnected)return layer;
    const viewer=document.getElementById('viewer');if(!viewer)return null;
    const old=document.getElementById('journeyQualityLayer');if(old)old.style.display='none';
    layer=document.createElement('img');
    layer.id='journeyHybridQualityLayer';layer.alt='';layer.decoding='sync';layer.draggable=false;
    /*
      Do not use a large radial-gradient mask here. On iPhone Safari that forces
      expensive recompositing whenever the 1024 bitmap changes. A simple ellipse
      clip keeps the center high-res while leaving the outer 256 base visible and
      is dramatically cheaper for the compositor.
    */
    layer.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;opacity:0;z-index:3;pointer-events:none;transform:translateZ(0);backface-visibility:hidden;clip-path:ellipse(38% 36% at 50% 52%);transition:none;filter:none;will-change:opacity';
    viewer.appendChild(layer);
    return layer;
  }

  function loadQuality(index){
    if(cache.has(index)||inflight.has(index))return inflight.get(index)||Promise.resolve(cache.get(index));
    const aheadAtStart=rawAhead();
    if(aheadAtStart<MIN_RAW_AHEAD){lowAheadSkips++;return Promise.resolve(null)}
    const source=qualitySource(index);if(!source)return Promise.resolve(null);
    const promise=new Promise(resolve=>{
      const im=new Image();im.decoding='async';im.referrerPolicy='no-referrer';const started=performance.now();let done=false;
      const finish=(ok,decoded=true)=>{
        if(done)return;done=true;inflight.delete(index);
        const width=im.naturalWidth||0,height=im.naturalHeight||0,longEdge=Math.max(width,height);
        if(ok&&longEdge>=EXPECTED_LONG_EDGE&&decoded){
          cache.set(index,im);loads++;
          emit('load-complete',{index,elapsedMs:Math.round(performance.now()-started),width,height,longEdge,qualityTier:'1024',decoded:true,rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart});resolve(im);
        }else if(ok&&longEdge>=EXPECTED_LONG_EDGE){
          decodeErrors++;emit('decode-error',{index,elapsedMs:Math.round(performance.now()-started),width,height,longEdge,rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart});resolve(null);
        }else if(ok){
          resolutionMismatches++;emit('resolution-mismatch',{index,elapsedMs:Math.round(performance.now()-started),width,height,longEdge,rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart});resolve(null);
        }else{
          errors++;emit('load-error',{index,elapsedMs:Math.round(performance.now()-started),rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart});resolve(null);
        }
      };
      im.onload=()=>{
        /* Force decode while this frame is still several frames ahead. This moves
           the expensive decode work away from the actual presentation deadline. */
        if(typeof im.decode==='function'){
          im.decode().then(()=>finish(true,true)).catch(()=>finish(true,false));
        }else finish(true,true);
      };
      im.onerror=()=>finish(false,false);
      emit('load-start',{index,requestedTier:'1024-predecode',rawAhead:aheadAtStart});
      im.src=source.url;
    });
    inflight.set(index,promise);return promise;
  }

  function prune(nowIndex){for(const k of cache.keys())if(k<nowIndex-2||k>nowIndex+30)cache.delete(k)}

  function schedule(){
    const base=currentIndex(),ahead=rawAhead(),stride=strideFor(ahead);lastStride=Number.isFinite(stride)?stride:null;
    if(ahead<MIN_RAW_AHEAD){lowAheadSkips++;return}
    if(!Number.isFinite(stride)||inflight.size>=MAX_QUALITY_INFLIGHT)return;
    for(let offset=PREFETCH_FROM;offset<=PREFETCH_TO;offset++){
      const i=base+offset;if(i>=frames().length)break;
      if(i%stride!==0||!qualitySource(i)||cache.has(i)||inflight.has(i))continue;
      loadQuality(i);break;
    }
  }

  function hideQuality(index,reason){
    if(layer)layer.style.opacity='0';currentKey=-1;misses++;
    emit('present-base-continuity',{index,reason,rawAhead:rawAhead(),stride:lastStride,centerHighRes:false,baseTier:'256'});
  }

  function present(index){
    ensureLayer();if(!layer)return;
    prune(index);schedule();
    const image=cache.get(index);
    if(!image){hideQuality(index,'exact-predecoded-quality-not-ready');return}
    const src=String(image.currentSrc||image.src||'');
    if(!src){hideQuality(index,'quality-src-missing');return}
    /* The source image has already completed decode(). We only swap the decoded
       resource here; no fade, filter, mask animation, transform or old-frame hold. */
    if(layer.currentSrc!==src&&layer.src!==src)layer.src=src;
    layer.style.opacity='1';currentKey=index;exactHits++;
    const width=image.naturalWidth||0,height=image.naturalHeight||0,longEdge=Math.max(width,height);
    emit('present-exact',{index,keyIndex:index,age:0,rawAhead:rawAhead(),stride:lastStride,width,height,longEdge,qualityTier:'1024',decoded:true,centerHighRes:true,zIndex:3,exactFrameOnly:true,renderMode:'predecoded-ellipse-clip'});
  }

  window.addEventListener('journey-frame-presented',e=>{const d=e.detail||{},i=Number(d.index);if(Number.isFinite(i))present(i)});
  window.addEventListener('journey-playback-started',()=>{ensureLayer();setTimeout(schedule,30)});
  setInterval(schedule,70);

  window.__journeyHybridQuality={version:VERSION,state:()=>({
    version:VERSION,mode:'1024-predecoded-center-256-continuity',renderMode:'predecoded-ellipse-clip',exactFrameOnly:true,
    rawAhead:rawAhead(),stride:lastStride,minRawAhead:MIN_RAW_AHEAD,fullRateRawAhead:FULL_RATE_RAW_AHEAD,maxInflight:MAX_QUALITY_INFLIGHT,
    cache:cache.size,inflight:inflight.size,loads,errors,resolutionMismatches,decodeErrors,exactHits,heldHits:0,misses,lowAheadSkips,currentKey,
    currentLongEdge:currentKey>=0?Math.max(cache.get(currentKey)?.naturalWidth||0,cache.get(currentKey)?.naturalHeight||0):0,
    currentTier:currentKey>=0?'1024':null
  })};
  emit('ready',{mode:'1024-predecoded-center-256-continuity',renderMode:'predecoded-ellipse-clip',exactFrameOnly:true,minRawAhead:MIN_RAW_AHEAD,fullRateRawAhead:FULL_RATE_RAW_AHEAD,prefetchFrom:PREFETCH_FROM,prefetchTo:PREFETCH_TO,maxInflight:MAX_QUALITY_INFLIGHT});
})();
