/* Streetview Journey Exact-Frame 1024 Center Quality v0.1.5 */
(()=>{
  'use strict';
  if(window.__journeyHybridQualityInstalled)return;
  window.__journeyHybridQualityInstalled=true;

  const VERSION='0.1.5';
  // Continuity always wins. High-resolution center frames are purely opportunistic:
  // never keep an old quality frame on screen while the 256 base has advanced.
  const MIN_RAW_AHEAD=10;
  const FULL_RATE_RAW_AHEAD=15;
  const PREFETCH_FROM=5;
  const PREFETCH_TO=24;
  const EXPECTED_LONG_EDGE=900;
  const MAX_QUALITY_INFLIGHT=1;
  const CENTER_MASK='radial-gradient(ellipse 72% 68% at 50% 52%, #000 0%, #000 68%, rgba(0,0,0,.96) 76%, rgba(0,0,0,.72) 84%, rgba(0,0,0,.26) 93%, transparent 100%)';
  const cache=new Map(),inflight=new Map();
  let layer=null,currentKey=-1,loads=0,errors=0,resolutionMismatches=0,exactHits=0,misses=0,lastStride=null,lowAheadSkips=0;

  const emit=(phase,detail={})=>{try{window.dispatchEvent(new CustomEvent('journey-hybrid-quality',{detail:{phase,version:VERSION,...detail}}))}catch{}};
  const runtime=()=>window.__journeyRawRuntime||{};
  const playback=()=>window.__journeyPlaybackState||{};
  const engine=()=>window.JourneyEngine?.getState?.()||{};
  const currentIndex=()=>{const p=playback(),e=engine();return Number.isFinite(p.index)?p.index:(Number.isFinite(e.index)?e.index:0)};
  const rawAhead=()=>{const r=runtime(),p=playback(),e=engine();const v=Number.isFinite(r.contiguousRawAhead)?r.contiguousRawAhead:(p.rawAheadReady??e.actualRenderableAhead??e.rawAheadReady??0);return Math.max(0,Number(v)||0)};
  const frames=()=>window.__journeyStreamState?.frames||window.__journeySelectedRoute?.frames||[];
  const qualitySource=i=>{
    const f=frames()[i];if(!f)return null;
    // 1024 is intentionally preferred over 2048. On iPhone the smaller request
    // preserves enough bandwidth/decoder headroom for the 256 continuity lane.
    const url=f.raw1024Url||f.thumb_1024_url||null;
    return url?{url,tier:'1024'}:null;
  };

  function strideFor(ahead){
    if(ahead>=FULL_RATE_RAW_AHEAD)return 1;
    if(ahead>=13)return 2;
    if(ahead>=MIN_RAW_AHEAD)return 3;
    return Infinity;
  }
  function ensureLayer(){
    if(layer?.isConnected)return layer;
    const viewer=document.getElementById('viewer');if(!viewer)return null;
    const old=document.getElementById('journeyQualityLayer');if(old)old.style.display='none';
    layer=document.createElement('img');layer.id='journeyHybridQualityLayer';layer.alt='';layer.decoding='async';layer.draggable=false;
    layer.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;opacity:0;z-index:3;pointer-events:none;will-change:opacity;transition:opacity 8ms linear;transform:none;filter:brightness(1) contrast(1.06) saturate(1.01)';
    layer.style.webkitMaskImage=CENTER_MASK;
    layer.style.maskImage=CENTER_MASK;
    layer.style.webkitMaskRepeat='no-repeat';
    layer.style.maskRepeat='no-repeat';
    layer.style.webkitMaskSize='100% 100%';
    layer.style.maskSize='100% 100%';
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
      const finish=(ok)=>{
        if(done)return;done=true;inflight.delete(index);
        const width=im.naturalWidth||0,height=im.naturalHeight||0,longEdge=Math.max(width,height);
        if(ok&&longEdge>=EXPECTED_LONG_EDGE){
          cache.set(index,im);loads++;
          emit('load-complete',{index,elapsedMs:Math.round(performance.now()-started),width,height,longEdge,qualityTier:'1024',rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart});resolve(im);
        }else if(ok){
          resolutionMismatches++;emit('resolution-mismatch',{index,elapsedMs:Math.round(performance.now()-started),width,height,longEdge,rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart});resolve(null);
        }else{
          errors++;emit('load-error',{index,elapsedMs:Math.round(performance.now()-started),rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart});resolve(null);
        }
      };
      im.onload=()=>finish(true);im.onerror=()=>finish(false);
      emit('load-start',{index,requestedTier:'1024',rawAhead:aheadAtStart});
      im.setAttribute('src',source.url);
    });
    inflight.set(index,promise);return promise;
  }
  function prune(nowIndex){
    for(const k of cache.keys())if(k<nowIndex-3||k>nowIndex+30)cache.delete(k);
  }
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
    if(layer)layer.style.opacity='0';
    currentKey=-1;misses++;
    emit('present-base-continuity',{index,reason,rawAhead:rawAhead(),stride:lastStride,centerHighRes:false,baseTier:'256'});
  }
  function present(index){
    ensureLayer();if(!layer)return;
    prune(index);schedule();
    // Exact-frame only. This is the key anti-freeze rule: never display frame N's
    // 1024 center while the 256 base has already advanced to N+1 or N+2.
    const image=cache.get(index);
    if(!image){hideQuality(index,'exact-quality-not-ready');return}
    const src=String(image.currentSrc||image.getAttribute('src')||'');
    if(!src){hideQuality(index,'quality-src-missing');return}
    if(layer.getAttribute('src')!==src)layer.setAttribute('src',src);
    layer.style.opacity='1';
    currentKey=index;exactHits++;
    const width=image.naturalWidth||0,height=image.naturalHeight||0,longEdge=Math.max(width,height);
    emit('present-exact',{index,keyIndex:index,age:0,rawAhead:rawAhead(),stride:lastStride,width,height,longEdge,qualityTier:'1024',centerHighRes:true,zIndex:3,exactFrameOnly:true});
  }

  window.addEventListener('journey-frame-presented',e=>{const d=e.detail||{},i=Number(d.index);if(Number.isFinite(i))present(i)});
  window.addEventListener('journey-playback-started',()=>{ensureLayer();setTimeout(schedule,50)});
  setInterval(schedule,90);
  window.__journeyHybridQuality={version:VERSION,state:()=>({
    version:VERSION,
    mode:'1024-exact-center-256-continuity',
    exactFrameOnly:true,
    rawAhead:rawAhead(),stride:lastStride,minRawAhead:MIN_RAW_AHEAD,fullRateRawAhead:FULL_RATE_RAW_AHEAD,
    maxInflight:MAX_QUALITY_INFLIGHT,cache:cache.size,inflight:inflight.size,loads,errors,resolutionMismatches,
    exactHits,heldHits:0,misses,lowAheadSkips,currentKey,
    currentLongEdge:currentKey>=0?Math.max(cache.get(currentKey)?.naturalWidth||0,cache.get(currentKey)?.naturalHeight||0):0,
    currentTier:currentKey>=0?'1024':null
  })};
  emit('ready',{mode:'1024-exact-center-256-continuity',exactFrameOnly:true,minRawAhead:MIN_RAW_AHEAD,fullRateRawAhead:FULL_RATE_RAW_AHEAD,prefetchFrom:PREFETCH_FROM,prefetchTo:PREFETCH_TO,maxInflight:MAX_QUALITY_INFLIGHT});
})();
