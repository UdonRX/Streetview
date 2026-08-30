/* Streetview Journey Feathered Center Quality v0.1.11 */
(()=>{
  'use strict';
  if(window.__journeyHybridQualityInstalled)return;
  window.__journeyHybridQualityInstalled=true;

  const VERSION='0.1.11';
  const MIN_RAW_AHEAD=5;
  const FULL_RATE_RAW_AHEAD=9;
  const PREFETCH_FROM=1;
  const PREFETCH_TO=14;
  const PREFETCH_ORDER=[3,4,5,2,1,6,7,8,9,10,11,12,13,14];
  const EXPECTED_LONG_EDGE=900;
  const MAX_QUALITY_INFLIGHT=3;
  const MAX_HOLD_AGE=1;
  const VERTICAL_MIN_CONF=.16;
  const VERTICAL_RADIUS=6;
  const VERTICAL_MAX_SHIFT=.12;
  const VERTICAL_GAIN=.86;
  const cache=new Map(),inflight=new Map(),rejected=new Set(),verticalSamples=new Map(),urlFrameCache=new Map();
  let shell=null,vertical=null,layer=null,currentKey=-1,loads=0,errors=0,resolutionMismatches=0,decodeErrors=0,exactHits=0,heldHits=0,misses=0,lastStride=null,lowAheadSkips=0,directBypassLoads=0,sourceFallbackHits=0,verticalApplied=0;

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const emit=(phase,detail={})=>{try{window.dispatchEvent(new CustomEvent('journey-hybrid-quality',{detail:{phase,version:VERSION,...detail}}))}catch{}};
  const runtime=()=>window.__journeyRawRuntime||{};
  const playback=()=>window.__journeyPlaybackState||{};
  const engine=()=>window.JourneyEngine?.getState?.()||{};
  const currentIndex=()=>{const p=playback(),e=engine();return Number.isFinite(p.index)?p.index:(Number.isFinite(e.index)?e.index:0)};
  const rawAhead=()=>{const r=runtime(),p=playback(),e=engine();const v=Number.isFinite(r.contiguousRawAhead)?r.contiguousRawAhead:(p.rawAheadReady??e.actualRenderableAhead??e.rawAheadReady??0);return Math.max(0,Number(v)||0)};
  const frames=()=>window.__journeyStreamState?.frames||window.__journeySelectedRoute?.frames||[];
  const remainingAhead=()=>Math.max(0,frames().length-currentIndex()-1);
  const requiredRawAhead=()=>Math.min(MIN_RAW_AHEAD,remainingAhead());
  const norm=value=>{try{const u=new URL(String(value||''),location.href);u.searchParams.delete('analysis');u.searchParams.delete('axisv');return u.href}catch{return String(value||'')}};

  function qualitySources(i){
    const f=frames()[i];if(!f)return[];
    const values=[
      [f.raw2048Url||f.thumb_2048_url,'2048'],
      [f.sourceUrl,'source'],
      [f.raw1024Url||f.thumb_1024_url,'1024'],
      [f.url,'url']
    ],seen=new Set(),out=[];
    for(const [url,tier] of values){if(!url)continue;const k=String(url);if(seen.has(k))continue;seen.add(k);out.push({url:k,tier})}
    return out;
  }
  function qualitySource(i){return qualitySources(i)[0]||null}
  function strideFor(ahead){if(ahead>=FULL_RATE_RAW_AHEAD)return 1;if(ahead>=MIN_RAW_AHEAD)return 1;return Infinity}
  function setDirectSrc(im,url){directBypassLoads++;im.setAttribute('src',String(url||''))}

  function rebuildUrlFrameCache(){
    urlFrameCache.clear();const list=frames();
    for(let i=0;i<list.length;i++)for(const u of [list[i]?.url,list[i]?.sourceUrl,list[i]?.raw256Url,list[i]?.raw1024Url,list[i]?.raw2048Url,list[i]?.thumb_256_url,list[i]?.thumb_1024_url,list[i]?.thumb_2048_url])if(u)urlFrameCache.set(norm(u),i);
  }
  function frameForImage(image){
    if(!(image instanceof HTMLImageElement))return null;
    const key=norm(image.currentSrc||image.src);let v=urlFrameCache.get(key);
    if(Number.isFinite(v))return v;
    rebuildUrlFrameCache();v=urlFrameCache.get(key);return Number.isFinite(v)?v:null;
  }
  function verticalCorrection(frame){
    const items=[];
    for(let k=Math.max(0,frame-VERTICAL_RADIUS);k<=frame+VERTICAL_RADIUS;k++){
      const r=verticalSamples.get(k);if(!r)continue;
      const d=Math.abs(k-frame),w=r.confidence/(1+d*.55);items.push({v:r.centerY-.5,w});
    }
    if(!items.length)return{shift:0,confidence:0,samples:0};
    items.sort((a,b)=>a.v-b.v);const total=items.reduce((s,x)=>s+x.w,0);let acc=0,med=items[0].v;for(const x of items){acc+=x.w;if(acc>=total*.5){med=x.v;break}}
    const confidence=clamp(total/2.2,0,1),shift=clamp(-med*VERTICAL_GAIN,-VERTICAL_MAX_SHIFT,VERTICAL_MAX_SHIFT)*clamp((confidence-.08)/.42,.28,1);
    return{shift,confidence,samples:items.length};
  }
  window.addEventListener('journey-travel-axis',e=>{
    const r=e.detail||{},frame=Number(r.frame),cy=Number(r.centerY),conf=Number(r.confidence),kind=String(r.kind||'');
    if(!Number.isFinite(frame)||!Number.isFinite(cy)||!Number.isFinite(conf)||conf<VERTICAL_MIN_CONF||kind.startsWith('side-flow')||cy<-.25||cy>1.25)return;
    verticalSamples.set(frame,{centerY:cy,confidence:conf,kind});
    for(const k of verticalSamples.keys())if(k<currentIndex()-30||k>currentIndex()+60)verticalSamples.delete(k);
  });

  const priorDrawImage=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(image,...args){
    try{
      if(args.length===4&&this.canvas&&this.canvas.width>160&&this.canvas.height>220){
        const frame=frameForImage(image);if(Number.isFinite(frame)){
          let[x,y,w,h]=args;if([x,y,w,h].every(Number.isFinite)&&h>this.canvas.height*.92){
            const v=verticalCorrection(frame),ch=this.canvas.height,margin=Math.min(ch*.012,5),minY=ch-h+margin,maxY=-margin,safeMin=minY<=maxY?minY:ch-h,safeMax=minY<=maxY?maxY:0;
            if(Math.abs(v.shift)>.001){y=clamp(y+v.shift*ch,safeMin,safeMax);args=[x,y,w,h];verticalApplied++}
            window.__journeyVerticalCenter={version:VERSION,frame,shift:v.shift,anchorY:50-v.shift*100,confidence:v.confidence,samples:v.samples};
          }
        }
      }
    }catch{}
    return priorDrawImage.call(this,image,...args);
  };

  function ensureLayer(){
    if(layer?.isConnected)return layer;
    const viewer=document.getElementById('viewer');if(!viewer)return null;
    const oldA=document.getElementById('journeyQualityLayer');if(oldA)oldA.style.display='none';
    const oldB=document.getElementById('journeyHybridQualityLayer');if(oldB)oldB.style.display='none';
    shell=document.createElement('div');shell.id='journeyHybridQualityShell';
    shell.style.cssText='position:absolute;inset:0;z-index:3;pointer-events:none;opacity:0;transform:translateZ(0);backface-visibility:hidden;-webkit-mask-image:linear-gradient(to right,transparent 2%,rgba(0,0,0,.12) 7%,rgba(0,0,0,.38) 13%,rgba(0,0,0,.72) 19%,#000 25%,#000 75%,rgba(0,0,0,.72) 81%,rgba(0,0,0,.38) 87%,rgba(0,0,0,.12) 93%,transparent 98%);mask-image:linear-gradient(to right,transparent 2%,rgba(0,0,0,.12) 7%,rgba(0,0,0,.38) 13%,rgba(0,0,0,.72) 19%,#000 25%,#000 75%,rgba(0,0,0,.72) 81%,rgba(0,0,0,.38) 87%,rgba(0,0,0,.12) 93%,transparent 98%);will-change:opacity';
    vertical=document.createElement('div');
    vertical.style.cssText='position:absolute;inset:0;-webkit-mask-image:linear-gradient(to bottom,transparent 1%,rgba(0,0,0,.12) 6%,rgba(0,0,0,.38) 12%,rgba(0,0,0,.72) 18%,#000 23%,#000 81%,rgba(0,0,0,.72) 86%,rgba(0,0,0,.38) 91%,rgba(0,0,0,.12) 96%,transparent 99%);mask-image:linear-gradient(to bottom,transparent 1%,rgba(0,0,0,.12) 6%,rgba(0,0,0,.38) 12%,rgba(0,0,0,.72) 18%,#000 23%,#000 81%,rgba(0,0,0,.72) 86%,rgba(0,0,0,.38) 91%,rgba(0,0,0,.12) 96%,transparent 99%)';
    layer=document.createElement('img');layer.id='journeyHybridQualityLayer';layer.alt='';layer.decoding='sync';layer.draggable=false;
    layer.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;pointer-events:none;opacity:1;filter:none;mix-blend-mode:normal;transform:translate3d(0,0,0);backface-visibility:hidden;will-change:transform';
    vertical.appendChild(layer);shell.appendChild(vertical);viewer.appendChild(shell);return layer;
  }

  function loadCandidate(im,source){return new Promise(resolve=>{let settled=false;const done=ok=>{if(settled)return;settled=true;im.onload=null;im.onerror=null;resolve(ok)};im.onload=()=>done(true);im.onerror=()=>done(false);setDirectSrc(im,source.url)})}
  function decodeImage(im){return typeof im.decode==='function'?im.decode().then(()=>true).catch(()=>false):Promise.resolve(true)}
  function loadQuality(index){
    if(rejected.has(index))return Promise.resolve(null);
    if(cache.has(index)||inflight.has(index))return inflight.get(index)||Promise.resolve(cache.get(index));
    const aheadAtStart=rawAhead(),required=requiredRawAhead();if(aheadAtStart<required){lowAheadSkips++;return Promise.resolve(null)}
    const sources=qualitySources(index);if(!sources.length)return Promise.resolve(null);
    const promise=(async()=>{
      const started=performance.now();let lastSize={width:0,height:0,longEdge:0};
      emit('load-start',{index,requestedTier:sources.map(s=>s.tier).join('>'),rawAhead:aheadAtStart,requiredRawAhead:required,directBypass:true,prefetchDistance:index-currentIndex()});
      for(let n=0;n<sources.length;n++){
        const source=sources[n],im=document.createElement('img');im.decoding='async';im.referrerPolicy='no-referrer';
        const ok=await loadCandidate(im,source);if(!ok)continue;
        const decoded=await decodeImage(im),width=im.naturalWidth||0,height=im.naturalHeight||0,longEdge=Math.max(width,height);lastSize={width,height,longEdge};
        if(decoded&&longEdge>=EXPECTED_LONG_EDGE){if(n>0)sourceFallbackHits++;cache.set(index,im);loads++;emit('load-complete',{index,elapsedMs:Math.round(performance.now()-started),width,height,longEdge,qualityTier:`${source.tier}-center-source`,decoded:true,directBypass:true,sourceAttempt:n+1,rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart,requiredRawAhead:required});return im}
        if(!decoded&&longEdge>=EXPECTED_LONG_EDGE){decodeErrors++;continue}
      }
      resolutionMismatches++;rejected.add(index);emit('resolution-mismatch',{index,...lastSize,directBypass:true,attemptedSources:sources.map(s=>s.tier)});return null;
    })().catch(()=>{errors++;rejected.add(index);emit('load-error',{index,directBypass:true});return null}).finally(()=>inflight.delete(index));
    inflight.set(index,promise);return promise;
  }

  function prune(nowIndex){for(const k of cache.keys())if(k<nowIndex-1||k>nowIndex+15)cache.delete(k);for(const k of rejected)if(k<nowIndex-1||k>nowIndex+15)rejected.delete(k)}
  function schedule(){
    const base=currentIndex(),ahead=rawAhead(),required=requiredRawAhead(),remaining=remainingAhead();let stride=strideFor(ahead);if(remaining<MIN_RAW_AHEAD&&ahead>=required)stride=1;lastStride=Number.isFinite(stride)?stride:null;
    if(ahead<required){lowAheadSkips++;return}if(!Number.isFinite(stride)||inflight.size>=MAX_QUALITY_INFLIGHT)return;
    let started=0;for(const offset of PREFETCH_ORDER){if(offset<PREFETCH_FROM||offset>PREFETCH_TO)continue;const i=base+offset;if(i>=frames().length)continue;if(!qualitySource(i)||cache.has(i)||inflight.has(i)||rejected.has(i))continue;loadQuality(i);started++;if(started>=MAX_QUALITY_INFLIGHT||inflight.size>=MAX_QUALITY_INFLIGHT)break}
  }
  function alignQualityLayer(index){
    if(!layer)return;const v=verticalCorrection(index),x=window.__journeyTravelAxis?.anchorForFrame?.(index,50),shiftY=v.shift*100;
    if(Number.isFinite(x))layer.style.objectPosition=`${clamp(x,2,98)}% 50%`;
    layer.style.transform=`translate3d(0,${shiftY.toFixed(2)}%,0)`;
  }
  function showImage(image,index,age){
    const src=String(image?.currentSrc||image?.getAttribute?.('src')||'');if(!src)return false;const current=String(layer?.currentSrc||layer?.getAttribute?.('src')||'');if(current!==src)setDirectSrc(layer,src);alignQualityLayer(index);if(shell)shell.style.opacity='1';currentKey=index;
    const width=image.naturalWidth||0,height=image.naturalHeight||0,longEdge=Math.max(width,height),v=verticalCorrection(index);
    emit(age===0?'present-exact':'present-held',{index,keyIndex:index-age,age,rawAhead:rawAhead(),requiredRawAhead:requiredRawAhead(),stride:lastStride,width,height,longEdge,qualityTier:'1024-center',decoded:true,directBypass:true,fullFrameHighRes:false,centerHighRes:true,baseTier:'256',exactFrameOnly:age===0,renderMode:'feathered-center-hires-over-256',brightnessPreserved:true,verticalShift:v.shift,verticalConfidence:v.confidence});return true;
  }
  function hideQuality(index,reason){if(shell)shell.style.opacity='0';currentKey=-1;misses++;emit('present-base-continuity',{index,reason,rawAhead:rawAhead(),requiredRawAhead:requiredRawAhead(),stride:lastStride,centerHighRes:false,baseTier:'256'})}
  function present(index){ensureLayer();if(!layer)return;prune(index);schedule();const exact=cache.get(index);if(exact&&showImage(exact,index,0)){exactHits++;return}for(let age=1;age<=MAX_HOLD_AGE;age++){const held=cache.get(index-age);if(held&&showImage(held,index,age)){heldHits++;return}}hideQuality(index,'center-quality-not-ready')}

  window.addEventListener('journey-frame-presented',e=>{const i=Number(e.detail?.index);if(Number.isFinite(i))present(i)});
  window.addEventListener('journey-playback-started',()=>{rebuildUrlFrameCache();ensureLayer();setTimeout(schedule,10)});
  window.addEventListener('journey-stream-updated',()=>{rebuildUrlFrameCache();schedule()});
  setInterval(schedule,45);

  window.__journeyHybridQuality={version:VERSION,state:()=>({
    version:VERSION,mode:'feathered-center-hires-over-256',renderMode:'feathered-center-hires-over-256',exactFrameOnly:false,
    rawAhead:rawAhead(),requiredRawAhead:requiredRawAhead(),remainingAhead:remainingAhead(),stride:lastStride,minRawAhead:MIN_RAW_AHEAD,fullRateRawAhead:FULL_RATE_RAW_AHEAD,maxInflight:MAX_QUALITY_INFLIGHT,
    prefetchFrom:PREFETCH_FROM,prefetchTo:PREFETCH_TO,prefetchOrder:PREFETCH_ORDER,cache:cache.size,inflight:inflight.size,rejected:rejected.size,loads,errors,resolutionMismatches,decodeErrors,exactHits,heldHits,misses,lowAheadSkips,directBypassLoads,sourceFallbackHits,currentKey,
    currentLongEdge:currentKey>=0?Math.max(cache.get(currentKey)?.naturalWidth||cache.get(currentKey-1)?.naturalWidth||0,cache.get(currentKey)?.naturalHeight||cache.get(currentKey-1)?.naturalHeight||0):0,
    currentTier:currentKey>=0?'hires-center':null,fullFrameHighRes:false,centerHighRes:currentKey>=0,brightnessPreserved:true,centerOpaqueWidthPercent:50,centerOpaqueHeightPercent:58,sourceCropSupported:false,
    verticalCenter:{samples:verticalSamples.size,applied:verticalApplied,maxShiftPercent:VERTICAL_MAX_SHIFT*100,current:window.__journeyVerticalCenter||null},
    qualityNote:'Prefer 2048/source/1024 candidates, prefetch 3-5 frames ahead for 80ms playback, and keep the high-res overlay aligned with horizontal and vertical travel-axis corrections.'
  })};
  emit('ready',{mode:'feathered-center-hires-over-256',renderMode:'feathered-center-hires-over-256',minRawAhead:MIN_RAW_AHEAD,fullRateRawAhead:FULL_RATE_RAW_AHEAD,prefetchFrom:PREFETCH_FROM,prefetchTo:PREFETCH_TO,prefetchOrder:PREFETCH_ORDER,maxInflight:MAX_QUALITY_INFLIGHT,maxHoldAge:MAX_HOLD_AGE,directBypass:true,brightnessPreserved:true,verticalCentering:true,sourceFallback:true});
})();
