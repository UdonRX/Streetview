/* Streetview Journey Feathered Center 1024 Quality v0.1.10 */
(()=>{
  'use strict';
  if(window.__journeyHybridQualityInstalled)return;
  window.__journeyHybridQualityInstalled=true;

  const VERSION='0.1.10';
  const MIN_RAW_AHEAD=5;
  const FULL_RATE_RAW_AHEAD=9;
  const PREFETCH_FROM=1;
  const PREFETCH_TO=14;
  const EXPECTED_LONG_EDGE=900;
  const MAX_QUALITY_INFLIGHT=2;
  const MAX_HOLD_AGE=1;
  const cache=new Map(),inflight=new Map(),rejected=new Set();
  let shell=null,vertical=null,layer=null,currentKey=-1,loads=0,errors=0,resolutionMismatches=0,decodeErrors=0,exactHits=0,heldHits=0,misses=0,lastStride=null,lowAheadSkips=0,directBypassLoads=0;

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
    if(ahead>=FULL_RATE_RAW_AHEAD)return 1;
    if(ahead>=MIN_RAW_AHEAD)return 1;
    return Infinity;
  }

  /* raw-runtime overrides the JS src property for playback. 1024 quality must
     bypass that override or it is silently converted back to the 256 lane. */
  function setDirectSrc(im,url){directBypassLoads++;im.setAttribute('src',String(url||''))}

  function ensureLayer(){
    if(layer?.isConnected)return layer;
    const viewer=document.getElementById('viewer');if(!viewer)return null;
    const oldA=document.getElementById('journeyQualityLayer');if(oldA)oldA.style.display='none';
    const oldB=document.getElementById('journeyHybridQualityLayer');if(oldB)oldB.style.display='none';

    /* Keep a large fully-opaque 1024 center, then blend only resolution at the
       outside edge. No brightness/filter/opacity adjustment is applied to the
       quality layer, including one-frame holds, so the feather cannot darken. */
    shell=document.createElement('div');shell.id='journeyHybridQualityShell';
    shell.style.cssText='position:absolute;inset:0;z-index:3;pointer-events:none;opacity:0;transform:translateZ(0);backface-visibility:hidden;-webkit-mask-image:linear-gradient(to right,transparent 2%,rgba(0,0,0,.12) 7%,rgba(0,0,0,.38) 13%,rgba(0,0,0,.72) 19%,#000 25%,#000 75%,rgba(0,0,0,.72) 81%,rgba(0,0,0,.38) 87%,rgba(0,0,0,.12) 93%,transparent 98%);mask-image:linear-gradient(to right,transparent 2%,rgba(0,0,0,.12) 7%,rgba(0,0,0,.38) 13%,rgba(0,0,0,.72) 19%,#000 25%,#000 75%,rgba(0,0,0,.72) 81%,rgba(0,0,0,.38) 87%,rgba(0,0,0,.12) 93%,transparent 98%);will-change:opacity';
    vertical=document.createElement('div');
    vertical.style.cssText='position:absolute;inset:0;-webkit-mask-image:linear-gradient(to bottom,transparent 1%,rgba(0,0,0,.12) 6%,rgba(0,0,0,.38) 12%,rgba(0,0,0,.72) 18%,#000 23%,#000 81%,rgba(0,0,0,.72) 86%,rgba(0,0,0,.38) 91%,rgba(0,0,0,.12) 96%,transparent 99%);mask-image:linear-gradient(to bottom,transparent 1%,rgba(0,0,0,.12) 6%,rgba(0,0,0,.38) 12%,rgba(0,0,0,.72) 18%,#000 23%,#000 81%,rgba(0,0,0,.72) 86%,rgba(0,0,0,.38) 91%,rgba(0,0,0,.12) 96%,transparent 99%)';
    layer=document.createElement('img');layer.id='journeyHybridQualityLayer';layer.alt='';layer.decoding='sync';layer.draggable=false;
    layer.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;pointer-events:none;opacity:1;filter:none;mix-blend-mode:normal;transform:translateZ(0);backface-visibility:hidden';
    vertical.appendChild(layer);shell.appendChild(vertical);viewer.appendChild(shell);
    return layer;
  }

  function loadQuality(index){
    if(rejected.has(index))return Promise.resolve(null);
    if(cache.has(index)||inflight.has(index))return inflight.get(index)||Promise.resolve(cache.get(index));
    const aheadAtStart=rawAhead(),required=requiredRawAhead();
    if(aheadAtStart<required){lowAheadSkips++;return Promise.resolve(null)}
    const source=qualitySource(index);if(!source)return Promise.resolve(null);
    const promise=new Promise(resolve=>{
      const im=document.createElement('img');im.decoding='async';im.referrerPolicy='no-referrer';const started=performance.now();let done=false;
      const finish=(ok,decoded=true)=>{
        if(done)return;done=true;inflight.delete(index);
        const width=im.naturalWidth||0,height=im.naturalHeight||0,longEdge=Math.max(width,height);
        if(ok&&longEdge>=EXPECTED_LONG_EDGE&&decoded){cache.set(index,im);loads++;emit('load-complete',{index,elapsedMs:Math.round(performance.now()-started),width,height,longEdge,qualityTier:'1024-center-source',decoded:true,directBypass:true,rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart,requiredRawAhead:required});resolve(im)}
        else if(ok&&longEdge>=EXPECTED_LONG_EDGE){decodeErrors++;rejected.add(index);emit('decode-error',{index,width,height,longEdge,directBypass:true});resolve(null)}
        else if(ok){resolutionMismatches++;rejected.add(index);emit('resolution-mismatch',{index,width,height,longEdge,directBypass:true});resolve(null)}
        else{errors++;rejected.add(index);emit('load-error',{index,directBypass:true});resolve(null)}
      };
      im.onload=()=>{if(typeof im.decode==='function')im.decode().then(()=>finish(true,true)).catch(()=>finish(true,false));else finish(true,true)};
      im.onerror=()=>finish(false,false);
      emit('load-start',{index,requestedTier:'1024-direct-center-source',rawAhead:aheadAtStart,requiredRawAhead:required,directBypass:true,prefetchDistance:index-currentIndex()});
      setDirectSrc(im,source.url);
    });
    inflight.set(index,promise);return promise;
  }

  function prune(nowIndex){
    for(const k of cache.keys())if(k<nowIndex-1||k>nowIndex+15)cache.delete(k);
    for(const k of rejected)if(k<nowIndex-1||k>nowIndex+15)rejected.delete(k);
  }

  function schedule(){
    const base=currentIndex(),ahead=rawAhead(),required=requiredRawAhead(),remaining=remainingAhead();
    let stride=strideFor(ahead);if(remaining<MIN_RAW_AHEAD&&ahead>=required)stride=1;
    lastStride=Number.isFinite(stride)?stride:null;
    if(ahead<required){lowAheadSkips++;return}
    if(!Number.isFinite(stride)||inflight.size>=MAX_QUALITY_INFLIGHT)return;
    let started=0;
    for(let offset=PREFETCH_FROM;offset<=PREFETCH_TO&&inflight.size<MAX_QUALITY_INFLIGHT;offset++){
      const i=base+offset;if(i>=frames().length)break;
      if(!qualitySource(i)||cache.has(i)||inflight.has(i)||rejected.has(i))continue;
      loadQuality(i);started++;if(started>=MAX_QUALITY_INFLIGHT)break;
    }
  }

  function showImage(image,index,age){
    const src=String(image?.currentSrc||image?.getAttribute?.('src')||'');if(!src)return false;
    const current=String(layer?.currentSrc||layer?.getAttribute?.('src')||'');if(current!==src)setDirectSrc(layer,src);
    /* Never dim a held 1024 frame. The previous 0.68 opacity made the feathered
       area visibly darker when the underlying 256 frame had a different exposure. */
    if(shell)shell.style.opacity='1';
    currentKey=index;
    const width=image.naturalWidth||0,height=image.naturalHeight||0,longEdge=Math.max(width,height);
    emit(age===0?'present-exact':'present-held',{index,keyIndex:index-age,age,rawAhead:rawAhead(),requiredRawAhead:requiredRawAhead(),stride:lastStride,width,height,longEdge,qualityTier:'1024-center',decoded:true,directBypass:true,fullFrameHighRes:false,centerHighRes:true,baseTier:'256',exactFrameOnly:age===0,renderMode:'wide-feathered-center-1024-over-256',brightnessPreserved:true});
    return true;
  }

  function hideQuality(index,reason){if(shell)shell.style.opacity='0';currentKey=-1;misses++;emit('present-base-continuity',{index,reason,rawAhead:rawAhead(),requiredRawAhead:requiredRawAhead(),stride:lastStride,centerHighRes:false,baseTier:'256'})}

  function present(index){
    ensureLayer();if(!layer)return;prune(index);schedule();
    const exact=cache.get(index);if(exact&&showImage(exact,index,0)){exactHits++;return}
    for(let age=1;age<=MAX_HOLD_AGE;age++){const held=cache.get(index-age);if(held&&showImage(held,index,age)){heldHits++;return}}
    hideQuality(index,'center-quality-not-ready');
  }

  window.addEventListener('journey-frame-presented',e=>{const d=e.detail||{},i=Number(d.index);if(Number.isFinite(i))present(i)});
  window.addEventListener('journey-playback-started',()=>{ensureLayer();setTimeout(schedule,10)});
  window.addEventListener('journey-stream-updated',schedule);
  setInterval(schedule,45);

  window.__journeyHybridQuality={version:VERSION,state:()=>({
    version:VERSION,mode:'wide-feathered-center-1024-over-256',renderMode:'wide-feathered-center-1024-over-256',exactFrameOnly:false,
    rawAhead:rawAhead(),requiredRawAhead:requiredRawAhead(),remainingAhead:remainingAhead(),stride:lastStride,minRawAhead:MIN_RAW_AHEAD,fullRateRawAhead:FULL_RATE_RAW_AHEAD,maxInflight:MAX_QUALITY_INFLIGHT,
    prefetchFrom:PREFETCH_FROM,prefetchTo:PREFETCH_TO,cache:cache.size,inflight:inflight.size,rejected:rejected.size,loads,errors,resolutionMismatches,decodeErrors,exactHits,heldHits,misses,lowAheadSkips,directBypassLoads,currentKey,
    currentLongEdge:currentKey>=0?Math.max(cache.get(currentKey)?.naturalWidth||cache.get(currentKey-1)?.naturalWidth||0,cache.get(currentKey)?.naturalHeight||cache.get(currentKey-1)?.naturalHeight||0):0,
    currentTier:currentKey>=0?'1024-center':null,fullFrameHighRes:false,centerHighRes:currentKey>=0,
    brightnessPreserved:true,centerOpaqueWidthPercent:50,centerOpaqueHeightPercent:58,sourceCropSupported:false,
    qualityNote:'The center 1024 region is wider and uses mask-only feathering. No opacity, brightness, filter, or blend adjustment is applied to the quality image.'
  })};
  emit('ready',{mode:'wide-feathered-center-1024-over-256',renderMode:'wide-feathered-center-1024-over-256',minRawAhead:MIN_RAW_AHEAD,fullRateRawAhead:FULL_RATE_RAW_AHEAD,prefetchFrom:PREFETCH_FROM,prefetchTo:PREFETCH_TO,maxInflight:MAX_QUALITY_INFLIGHT,maxHoldAge:MAX_HOLD_AGE,directBypass:true,brightnessPreserved:true,centerOpaqueWidthPercent:50,centerOpaqueHeightPercent:58,sourceCropSupported:false});
})();
