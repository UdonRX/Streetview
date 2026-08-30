/* Streetview Journey Hybrid High-Resolution Journey v0.1.1 */
(()=>{
  'use strict';
  if(window.__journeyHybridQualityInstalled)return;
  window.__journeyHybridQualityInstalled=true;

  const VERSION='0.1.1';
  const MIN_RAW_AHEAD=3;
  const PREFETCH_FROM=5;
  const PREFETCH_TO=20;
  const HOLD_FRAMES=2;
  const EXPECTED_LONG_EDGE=900;
  const cache=new Map(),inflight=new Map(),frameMeta=new Map();
  let layer=null,currentKey=-1,loads=0,errors=0,resolutionMismatches=0,exactHits=0,heldHits=0,lastStride=null;

  const emit=(phase,detail={})=>{try{window.dispatchEvent(new CustomEvent('journey-hybrid-quality',{detail:{phase,version:VERSION,...detail}}))}catch{}};
  const runtime=()=>window.__journeyRawRuntime||{};
  const playback=()=>window.__journeyPlaybackState||{};
  const engine=()=>window.JourneyEngine?.getState?.()||{};
  const currentIndex=()=>{const p=playback(),e=engine();return Number.isFinite(p.index)?p.index:(Number.isFinite(e.index)?e.index:0)};
  const rawAhead=()=>{const r=runtime(),p=playback(),e=engine();const v=Number.isFinite(r.contiguousRawAhead)?r.contiguousRawAhead:(p.rawAheadReady??e.actualRenderableAhead??e.rawAheadReady??0);return Math.max(0,Number(v)||0)};
  const frames=()=>window.__journeyStreamState?.frames||window.__journeySelectedRoute?.frames||[];
  const qualityUrl=i=>{const f=frames()[i];return f?.raw1024Url||f?.thumb_1024_url||null};
  const sameSequence=(a,b)=>{const aa=String(frames()[a]?.sequenceId||''),bb=String(frames()[b]?.sequenceId||'');return !aa||!bb||aa===bb};

  function strideFor(ahead){if(ahead>=8)return 2;if(ahead>=5)return 3;if(ahead>=MIN_RAW_AHEAD)return 4;return Infinity}
  function ensureLayer(){
    if(layer?.isConnected)return layer;
    const viewer=document.getElementById('viewer');if(!viewer)return null;
    const old=document.getElementById('journeyQualityLayer');if(old)old.style.display='none';
    layer=document.createElement('img');layer.id='journeyHybridQualityLayer';layer.alt='';layer.decoding='async';layer.draggable=false;
    layer.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;opacity:0;z-index:1;pointer-events:none;will-change:transform,opacity;transition:opacity 28ms linear,transform 70ms linear;transform-origin:50% 55%;filter:brightness(.94) contrast(1.04) saturate(.98)';
    const flow=document.getElementById('flowCanvas');if(flow)viewer.insertBefore(layer,flow);else viewer.appendChild(layer);
    return layer;
  }
  function load1024(index){
    if(cache.has(index)||inflight.has(index))return inflight.get(index)||Promise.resolve(cache.get(index));
    const url=qualityUrl(index);if(!url)return Promise.resolve(null);
    const promise=new Promise(resolve=>{
      const im=new Image();im.decoding='async';im.referrerPolicy='no-referrer';const started=performance.now();let done=false;
      const finish=(ok)=>{if(done)return;done=true;inflight.delete(index);const width=im.naturalWidth||0,height=im.naturalHeight||0,longEdge=Math.max(width,height);if(ok&&longEdge>=EXPECTED_LONG_EDGE){cache.set(index,im);loads++;emit('load-complete',{index,elapsedMs:Math.round(performance.now()-started),width,height,longEdge,rawAhead:rawAhead()});resolve(im)}else if(ok){resolutionMismatches++;emit('resolution-mismatch',{index,elapsedMs:Math.round(performance.now()-started),width,height,longEdge,rawAhead:rawAhead()});resolve(null)}else{errors++;emit('load-error',{index,elapsedMs:Math.round(performance.now()-started),rawAhead:rawAhead()});resolve(null)}};
      im.onload=()=>finish(true);im.onerror=()=>finish(false);emit('load-start',{index,rawAhead:rawAhead()});
      // Important: setAttribute bypasses raw-runtime's patched HTMLImageElement.src setter,
      // so a requested thumb_1024_url cannot be silently downgraded to 256-continuity.
      im.setAttribute('src',url);
    });
    inflight.set(index,promise);return promise;
  }
  function prune(nowIndex){for(const k of cache.keys())if(k<nowIndex-8||k>nowIndex+30)cache.delete(k);for(const k of frameMeta.keys())if(k<nowIndex-8)frameMeta.delete(k)}
  function schedule(){
    const base=currentIndex(),ahead=rawAhead(),stride=strideFor(ahead);lastStride=Number.isFinite(stride)?stride:null;
    if(!Number.isFinite(stride)||inflight.size>=1)return;
    for(let offset=PREFETCH_FROM;offset<=PREFETCH_TO;offset++){
      const i=base+offset;if(i>=frames().length)break;
      if(i%stride!==0||!qualityUrl(i)||cache.has(i)||inflight.has(i))continue;
      load1024(i);break;
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
    const px=Number.isFinite(dx)?Math.max(-18,Math.min(18,-dx/100*vw*.28)):0;
    const turn=angle(Number(keyMeta.roadBearing),Number(detail.roadBearing));
    const rot=Math.max(-1.1,Math.min(1.1,-turn*.025));
    const scale=1+hit.age*.008;
    if(layer.getAttribute('src')!==src)layer.setAttribute('src',src);
    layer.style.transform=`translate3d(${px.toFixed(1)}px,0,0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
    layer.style.opacity=hit.age===0?'1':hit.age===1?'.78':'.56';
    currentKey=hit.index;if(hit.age===0)exactHits++;else heldHits++;
    emit(hit.age===0?'present-exact':'present-held',{index,keyIndex:hit.index,age:hit.age,rawAhead:rawAhead(),stride:lastStride,width:hit.image.naturalWidth||0,height:hit.image.naturalHeight||0});
  }

  window.addEventListener('journey-frame-presented',e=>{const d=e.detail||{},i=Number(d.index);if(Number.isFinite(i))present(i,d)});
  window.addEventListener('journey-playback-started',()=>{ensureLayer();setTimeout(schedule,60)});
  setInterval(schedule,100);
  window.__journeyHybridQuality={version:VERSION,state:()=>({version:VERSION,rawAhead:rawAhead(),stride:lastStride,cache:cache.size,inflight:inflight.size,loads,errors,resolutionMismatches,exactHits,heldHits,currentKey})};
  emit('ready',{minRawAhead:MIN_RAW_AHEAD,prefetchFrom:PREFETCH_FROM,prefetchTo:PREFETCH_TO,holdFrames:HOLD_FRAMES,expectedLongEdge:EXPECTED_LONG_EDGE});
})();
