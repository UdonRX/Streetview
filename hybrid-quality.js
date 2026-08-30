/* Streetview Journey Hybrid Center-Foveated High-Resolution Journey v0.1.3 */
(()=>{
  'use strict';
  if(window.__journeyHybridQualityInstalled)return;
  window.__journeyHybridQualityInstalled=true;

  const VERSION='0.1.3';
  // 256 remains the continuity/base layer. 1024 becomes the perceptual priority
  // in the central field of view. When the 256 buffer is healthy we aggressively
  // fetch 1024 keyframes, including every frame at very high buffer levels.
  const MIN_RAW_AHEAD=6;
  const PREFETCH_FROM=3;
  const PREFETCH_TO=24;
  const HOLD_FRAMES=2;
  const EXPECTED_LONG_EDGE=900;
  const MAX_QUALITY_INFLIGHT=2;
  const CENTER_MASK='radial-gradient(ellipse 72% 68% at 50% 52%, #000 0%, #000 68%, rgba(0,0,0,.96) 76%, rgba(0,0,0,.72) 84%, rgba(0,0,0,.26) 93%, transparent 100%)';
  const cache=new Map(),inflight=new Map(),frameMeta=new Map();
  let layer=null,currentKey=-1,loads=0,errors=0,resolutionMismatches=0,exactHits=0,heldHits=0,lastStride=null,lowAheadSkips=0;

  const emit=(phase,detail={})=>{try{window.dispatchEvent(new CustomEvent('journey-hybrid-quality',{detail:{phase,version:VERSION,...detail}}))}catch{}};
  const runtime=()=>window.__journeyRawRuntime||{};
  const playback=()=>window.__journeyPlaybackState||{};
  const engine=()=>window.JourneyEngine?.getState?.()||{};
  const currentIndex=()=>{const p=playback(),e=engine();return Number.isFinite(p.index)?p.index:(Number.isFinite(e.index)?e.index:0)};
  const rawAhead=()=>{const r=runtime(),p=playback(),e=engine();const v=Number.isFinite(r.contiguousRawAhead)?r.contiguousRawAhead:(p.rawAheadReady??e.actualRenderableAhead??e.rawAheadReady??0);return Math.max(0,Number(v)||0)};
  const frames=()=>window.__journeyStreamState?.frames||window.__journeySelectedRoute?.frames||[];
  const qualityUrl=i=>{const f=frames()[i];return f?.raw1024Url||f?.thumb_1024_url||null};
  const sameSequence=(a,b)=>{const aa=String(frames()[a]?.sequenceId||''),bb=String(frames()[b]?.sequenceId||'');return !aa||!bb||aa===bb};

  function strideFor(ahead){if(ahead>=16)return 1;if(ahead>=11)return 2;if(ahead>=8)return 3;if(ahead>=MIN_RAW_AHEAD)return 4;return Infinity}
  function ensureLayer(){
    if(layer?.isConnected)return layer;
    const viewer=document.getElementById('viewer');if(!viewer)return null;
    const old=document.getElementById('journeyQualityLayer');if(old)old.style.display='none';
    layer=document.createElement('img');layer.id='journeyHybridQualityLayer';layer.alt='';layer.decoding='async';layer.draggable=false;
    layer.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;opacity:0;z-index:1;pointer-events:none;will-change:transform,opacity;transition:opacity 18ms linear,transform 58ms linear;transform-origin:50% 55%;filter:brightness(.98) contrast(1.08) saturate(1.01)';
    layer.style.webkitMaskImage=CENTER_MASK;
    layer.style.maskImage=CENTER_MASK;
    layer.style.webkitMaskRepeat='no-repeat';
    layer.style.maskRepeat='no-repeat';
    layer.style.webkitMaskSize='100% 100%';
    layer.style.maskSize='100% 100%';
    const flow=document.getElementById('flowCanvas');if(flow)viewer.insertBefore(layer,flow);else viewer.appendChild(layer);
    return layer;
  }
  function load1024(index){
    if(cache.has(index)||inflight.has(index))return inflight.get(index)||Promise.resolve(cache.get(index));
    const aheadAtStart=rawAhead();
    if(aheadAtStart<MIN_RAW_AHEAD){lowAheadSkips++;return Promise.resolve(null)}
    const url=qualityUrl(index);if(!url)return Promise.resolve(null);
    const promise=new Promise(resolve=>{
      const im=new Image();im.decoding='async';im.referrerPolicy='no-referrer';const started=performance.now();let done=false;
      const finish=(ok)=>{if(done)return;done=true;inflight.delete(index);const width=im.naturalWidth||0,height=im.naturalHeight||0,longEdge=Math.max(width,height);if(ok&&longEdge>=EXPECTED_LONG_EDGE){cache.set(index,im);loads++;emit('load-complete',{index,elapsedMs:Math.round(performance.now()-started),width,height,longEdge,rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart});resolve(im)}else if(ok){resolutionMismatches++;emit('resolution-mismatch',{index,elapsedMs:Math.round(performance.now()-started),width,height,longEdge,rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart});resolve(null)}else{errors++;emit('load-error',{index,elapsedMs:Math.round(performance.now()-started),rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart});resolve(null)}};
      im.onload=()=>finish(true);im.onerror=()=>finish(false);emit('load-start',{index,rawAhead:aheadAtStart});
      // Bypass raw-runtime's patched src setter so 1024 cannot be downgraded to 256.
      im.setAttribute('src',url);
    });
    inflight.set(index,promise);return promise;
  }
  function prune(nowIndex){for(const k of cache.keys())if(k<nowIndex-8||k>nowIndex+32)cache.delete(k);for(const k of frameMeta.keys())if(k<nowIndex-8)frameMeta.delete(k)}
  function schedule(){
    const base=currentIndex(),ahead=rawAhead(),stride=strideFor(ahead);lastStride=Number.isFinite(stride)?stride:null;
    if(ahead<MIN_RAW_AHEAD){lowAheadSkips++;return}
    if(!Number.isFinite(stride)||inflight.size>=MAX_QUALITY_INFLIGHT)return;
    let launched=0;
    for(let offset=PREFETCH_FROM;offset<=PREFETCH_TO;offset++){
      const i=base+offset;if(i>=frames().length)break;
      if(i%stride!==0||!qualityUrl(i)||cache.has(i)||inflight.has(i))continue;
      load1024(i);launched++;
      if(inflight.size>=MAX_QUALITY_INFLIGHT||launched>=MAX_QUALITY_INFLIGHT)break;
    }
  }
  function nearestKey(index){
    if(cache.has(index))return{index,age:0,image:cache.get(index)};
    for(let age=1;age<=HOLD_FRAMES;age++){const k=index-age;if(k>=0&&cache.has(k)&&sameSequence(k,index))return{index:k,age,image:cache.get(k)}}
    return null;
  }
  function angle(a,b){return Number.isFinite(a)&&Number.isFinite(b)?((b-a+540)%360)-180:0}
  function present(index,detail={}){
    ensureLayer();if(!layer)return;
    frameMeta.set(index,detail);prune(index);schedule();
    const hit=nearestKey(index);
    if(!hit){layer.style.opacity='0';currentKey=-1;return}
    const src=String(hit.image.currentSrc||hit.image.getAttribute('src')||'');if(!src){layer.style.opacity='0';return}
    const keyMeta=frameMeta.get(hit.index)||{},vw=window.innerWidth||390;
    const dx=(Number(detail.anchorX)-Number(keyMeta.anchorX));
    const px=Number.isFinite(dx)?Math.max(-20,Math.min(20,-dx/100*vw*.32)):0;
    const turn=angle(Number(keyMeta.roadBearing),Number(detail.roadBearing));
    const rot=Math.max(-1.15,Math.min(1.15,-turn*.026));
    const scale=1+hit.age*.006;
    if(layer.getAttribute('src')!==src)layer.setAttribute('src',src);
    layer.style.transform=`translate3d(${px.toFixed(1)}px,0,0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
    // Critical change: the high-resolution center is never alpha-blended back
    // toward the 256 layer. 256 is visible only outside the foveated mask.
    layer.style.opacity='1';
    currentKey=hit.index;if(hit.age===0)exactHits++;else heldHits++;
    emit(hit.age===0?'present-exact':'present-held',{index,keyIndex:hit.index,age:hit.age,rawAhead:rawAhead(),stride:lastStride,width:hit.image.naturalWidth||0,height:hit.image.naturalHeight||0,centerHighRes:true});
  }

  window.addEventListener('journey-frame-presented',e=>{const d=e.detail||{},i=Number(d.index);if(Number.isFinite(i))present(i,d)});
  window.addEventListener('journey-playback-started',()=>{ensureLayer();setTimeout(schedule,40)});
  setInterval(schedule,70);
  window.__journeyHybridQuality={version:VERSION,state:()=>({version:VERSION,mode:'1024-center-256-outer',rawAhead:rawAhead(),stride:lastStride,minRawAhead:MIN_RAW_AHEAD,maxInflight:MAX_QUALITY_INFLIGHT,cache:cache.size,inflight:inflight.size,loads,errors,resolutionMismatches,exactHits,heldHits,lowAheadSkips,currentKey})};
  emit('ready',{mode:'1024-center-256-outer',minRawAhead:MIN_RAW_AHEAD,prefetchFrom:PREFETCH_FROM,prefetchTo:PREFETCH_TO,holdFrames:HOLD_FRAMES,expectedLongEdge:EXPECTED_LONG_EDGE,maxInflight:MAX_QUALITY_INFLIGHT});
})();
