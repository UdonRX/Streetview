/* Streetview Journey raw/analysis transport split v0.1.46 */
(()=>{
  'use strict';
  if(window.__journeyRawRuntimeInstalled)return;
  window.__journeyRawRuntimeInstalled=true;

  const VERSION='0.1.46';
  const RAW_TIMEOUT_MS=2600,OPTICAL_PAUSE_BELOW=8,OPTICAL_RESUME_AT=14,ANALYSIS_RELAXED_AT=16;
  const LIGHT_FIELD_1024='thumb_1024_url',LIGHT_FIELD_256='thumb_256_url',GRAPH='https://graph.mapillary.com',TOKEN_KEY='streetview:mapillary-token';
  const PREFETCH_BASE_CONCURRENCY=4,PREFETCH_EMERGENCY_BURST=2,PREFETCH_AHEAD=48;
  const CONTINUITY_256_AHEAD=36,QUALITY_1024_AHEAD=12,CONTINUITY_LOW_WATER=12,QUALITY_ENABLE_AT=18;

  const nativeSetTimeout=window.setTimeout.bind(window),nativeClearTimeout=window.clearTimeout.bind(window),nativeFetch=window.fetch.bind(window),nativeRIC=window.requestIdleCallback?.bind(window),nativeCancelRIC=window.cancelIdleCallback?.bind(window);
  const srcDesc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src'),nativeSetSrc=srcDesc?.set;
  const timers=new WeakMap(),started=new WeakMap(),analysisQueued=new Set(),analysisActiveImages=new Set(),readyRawIndices=new Set(),activeRawIndices=new Set();
  const light1024Urls=new Map(),light256Urls=new Map(),lightMisses=new Set(),rawVariantFailures=new Map(),readyVariants=new Map();
  const prefetchQueued=new Set(),prefetchInflight=new Set();
  let opticalAllowed=true,analysisGeneration=0,analysisActive=0,analysisQueue=[],lightRefreshPromise=null,lightDisabled=false,routeKey='';
  let prefetchQueue=[],prefetchActive=0,prefetchEmergencyActive=0;

  const now=()=>performance.now();
  function sameOrigin(u){try{return new URL(u,location.href).origin===location.origin}catch{return false}}
  function unwrapProxy(value){try{const u=new URL(String(value||''),location.href);if(u.origin===location.origin&&u.pathname==='/api/imagery'&&u.searchParams.get('mode')==='mapillary-image'){const source=u.searchParams.get('url');if(source)return source}}catch{}return String(value||'')}
  function proxyFor(value){const raw=unwrapProxy(value);if(!raw||sameOrigin(raw))return raw;return `/api/imagery?mode=mapillary-image&url=${encodeURIComponent(raw)}`}
  function routeLists(){return [window.__journeyStreamState?.frames,window.__journeySelectedRoute?.frames].filter(Array.isArray)}
  function currentRouteKey(){const list=routeLists()[0]||[],first=list[0];return `${String(first?.sequenceId||'')}|${String(first?.id||'')}`}
  function frameAt(i){for(const list of routeLists())if(list[i])return list[i];return null}
  function currentIndex(){const p=window.__journeyPlaybackState||{},e=window.JourneyEngine?.getState?.()||{};return Number.isFinite(p.index)?p.index:(Number.isFinite(e.index)?e.index:0)}
  function variantSet(index){let set=readyVariants.get(index);if(!set){set=new Set();readyVariants.set(index,set)}return set}
  function markVariantReady(index,variant){if(Number.isFinite(index)&&variant)variantSet(index).add(variant)}
  function variantReady(index,variant){return !!readyVariants.get(index)?.has(variant)}
  function seedLightUrls(){
    for(const list of routeLists())for(let i=0;i<list.length;i++){
      const f=list[i],id=String(f?.id||'');if(!id)continue;
      const u256=f.raw256Url||f.thumb_256_url||null,u1024=f.raw1024Url||f.thumb_1024_url||null;
      if(u256)light256Urls.set(id,u256);if(u1024)light1024Urls.set(id,u1024);
      if(f.prewarmed){if(f.prewarmedVariant==='1024')markVariantReady(i,'1024');else markVariantReady(i,'256')}
    }
  }
  function resetPrefetch(){prefetchQueue=[];prefetchQueued.clear();prefetchInflight.clear();readyVariants.clear();prefetchActive=0;prefetchEmergencyActive=0}
  function ensureRouteGeneration(){
    const key=currentRouteKey();
    if(key&&routeKey&&key!==routeKey){readyRawIndices.clear();activeRawIndices.clear();analysisGeneration++;analysisQueue=[];analysisActiveImages.clear();analysisActive=0;rawVariantFailures.clear();resetPrefetch()}
    if(key)routeKey=key;
    seedLightUrls();
  }
  function frameIndexFor(raw){for(const list of routeLists()){for(let i=0;i<list.length;i++){const f=list[i];if(f&&(unwrapProxy(f.url)===raw||f.sourceUrl===raw||f.analysisUrl===raw||f.raw256Url===raw||f.raw1024Url===raw||light1024Urls.get(String(f.id||''))===raw||light256Urls.get(String(f.id||''))===raw))return i}}return null}
  function contiguousRawAhead(){ensureRouteGeneration();let n=0;const start=currentIndex()+1;for(let i=start;i<start+64;i++){if(!readyRawIndices.has(i))break;n++}return n}
  function contiguousVariantAhead(variant,limit=64){ensureRouteGeneration();let n=0;const start=currentIndex()+1;for(let i=start;i<start+limit;i++){if(!variantReady(i,variant))break;n++}return n}
  function emit(phase,detail){try{window.dispatchEvent(new CustomEvent('journey-image-load',{detail:{phase,...detail}}))}catch{}}
  function rawAhead(){const contiguous=contiguousRawAhead();if(contiguous||readyRawIndices.has(currentIndex()+1))return contiguous;return Number(window.__journeyPlaybackState?.rawAheadReady??window.__journeyDiagnostics?.rawAheadReady??0)}
  function clearTimer(im){const t=timers.get(im);if(t){nativeClearTimeout(t);timers.delete(im)}}
  function finishAnalysis(im){if(analysisActiveImages.delete(im))analysisActive=Math.max(0,analysisActive-1);analysisQueued.delete(im);pumpAnalysis()}
  function finishRawMeta(meta){if(Number.isFinite(meta?.index))activeRawIndices.delete(meta.index)}
  function failureSet(id){if(!id)return null;let set=rawVariantFailures.get(id);if(!set){set=new Set();rawVariantFailures.set(id,set)}return set}
  function variantFailed(id,variant){return !!id&&!!variant&&rawVariantFailures.get(id)?.has(variant)}
  function markVariantFailure(meta){const id=String(meta?.frameId||'');if(!id||!meta?.variant)return;failureSet(id)?.add(meta.variant);emit('raw-variant-failed',{index:meta.index,frameId:id,variant:meta.variant,failedVariants:[...(rawVariantFailures.get(id)||[])]})}
  function clearVariantFailure(meta){const id=String(meta?.frameId||'');if(!id||!meta?.variant)return;const set=rawVariantFailures.get(id);if(!set)return;set.delete(meta.variant);if(!set.size)rawVariantFailures.delete(id)}

  function installLifecycle(im){
    if(im.__journeyLifecycleInstalled)return;
    im.__journeyLifecycleInstalled=true;
    im.addEventListener('load',()=>{
      const meta=started.get(im);if(!meta)return;clearTimer(im);started.delete(im);
      if(meta.purpose==='analysis')finishAnalysis(im);else{finishRawMeta(meta);clearVariantFailure(meta);if(Number.isFinite(meta.index)){readyRawIndices.add(meta.index);markVariantReady(meta.index,meta.variant)}}
      if(meta.generation!=null&&meta.generation!==analysisGeneration)return;
      emit('complete',{...meta,elapsedMs:Math.round(now()-meta.startedAt),width:im.naturalWidth||0,height:im.naturalHeight||0,contiguousRawAhead:contiguousRawAhead()});schedulePrefetch();
    });
    im.addEventListener('error',()=>{
      const meta=started.get(im);if(!meta)return;clearTimer(im);started.delete(im);
      if(meta.purpose==='analysis')finishAnalysis(im);else{finishRawMeta(meta);markVariantFailure(meta);if(Number.isFinite(meta.index))readyRawIndices.delete(meta.index)}
      if(meta.generation!=null&&meta.generation!==analysisGeneration)return;
      emit('error',{...meta,elapsedMs:Math.round(now()-meta.startedAt),contiguousRawAhead:contiguousRawAhead()});schedulePrefetch();
    });
  }

  function token(){try{return localStorage.getItem(TOKEN_KEY)||''}catch{return''}}
  function collectLightRefs(){const out=[],seen=new Set();for(const list of routeLists())for(const f of list){const id=String(f?.id||'');if(!id||seen.has(id)||lightMisses.has(id)||(light1024Urls.has(id)&&light256Urls.has(id)))continue;seen.add(id);out.push(id);if(out.length>=32)return out}return out}
  async function refreshLightUrls(){
    ensureRouteGeneration();if(lightDisabled)return;if(lightRefreshPromise)return lightRefreshPromise;
    const ids=collectLightRefs(),t=token();if(!ids.length||!t)return;
    lightRefreshPromise=(async()=>{try{
      const fields=`id,${LIGHT_FIELD_1024},${LIGHT_FIELD_256}`,url=`${GRAPH}/images?image_ids=${encodeURIComponent(ids.join(','))}&fields=${encodeURIComponent(fields)}`;
      const r=await nativeFetch(url,{headers:{Authorization:`OAuth ${t}`},cache:'no-store'}),j=await r.json().catch(()=>({}));
      if(!r.ok||j?.error){if(r.status===400)lightDisabled=true;return}
      const by=new Map((j?.data||[]).map(x=>[String(x.id),x]));
      for(const id of ids){const row=by.get(id),u1024=row?.[LIGHT_FIELD_1024],u256=row?.[LIGHT_FIELD_256];if(u1024)light1024Urls.set(id,u1024);if(u256)light256Urls.set(id,u256);if(!u1024&&!u256)lightMisses.add(id)}
    }catch{}finally{lightRefreshPromise=null;schedulePrefetch()}})();
    return lightRefreshPromise;
  }

  function rawVariantFor(raw,index){
    ensureRouteGeneration();
    const f=Number.isFinite(index)?frameAt(index):null,id=String(f?.id||''),offset=Number.isFinite(index)?index-currentIndex():99;
    const u256=id?light256Urls.get(id):null,u1024=id?light1024Urls.get(id):null;
    if(id&&u1024&&variantReady(index,'1024')&&!variantFailed(id,'1024'))return{url:u1024,variant:'1024'};
    if(id&&u256&&variantReady(index,'256')&&!variantFailed(id,'256-continuity'))return{url:u256,variant:'256-continuity'};
    if(id&&offset>=1&&offset<=CONTINUITY_LOW_WATER&&u256&&!variantFailed(id,'256-continuity'))return{url:u256,variant:'256-continuity'};
    if(id&&u1024&&contiguousVariantAhead('256',QUALITY_ENABLE_AT)>=QUALITY_ENABLE_AT&&!variantFailed(id,'1024'))return{url:u1024,variant:'1024'};
    if(id&&u256&&!variantFailed(id,'256-continuity'))return{url:u256,variant:'256-continuity'};
    if(id&&!lightDisabled&&!lightMisses.has(id))refreshLightUrls();
    if(!id||!variantFailed(id,'source'))return{url:raw,variant:'source'};
    rawVariantFailures.delete(id);return{url:raw,variant:'source'};
  }

  function taskKey(index,variant){return `${index}:${variant}`}
  function queueTask(index,variant,url,priority,emergency=false){
    const key=taskKey(index,variant);if(!url||variantReady(index,variant)||prefetchQueued.has(key)||prefetchInflight.has(key))return;
    prefetchQueued.add(key);prefetchQueue.push({key,index,variant,url,priority,emergency});
  }
  function queuePrefetch(){
    ensureRouteGeneration();const base=currentIndex(),continuity=contiguousVariantAhead('256',CONTINUITY_256_AHEAD);
    for(let offset=1;offset<=PREFETCH_AHEAD;offset++){
      const index=base+offset,f=frameAt(index);if(!f)break;const id=String(f.id||''),u256=id?light256Urls.get(id):null,u1024=id?light1024Urls.get(id):null;
      if(offset<=CONTINUITY_256_AHEAD&&u256&&!variantFailed(id,'256-continuity'))queueTask(index,'256',u256,offset<=CONTINUITY_LOW_WATER?offset-100:offset,false);
      if(offset<=QUALITY_1024_AHEAD&&continuity>=QUALITY_ENABLE_AT&&u1024&&!variantFailed(id,'1024'))queueTask(index,'1024',u1024,200+offset,false);
    }
    prefetchQueue.sort((a,b)=>a.priority-b.priority||a.index-b.index);
  }
  function startPrefetch(task){
    prefetchQueued.delete(task.key);prefetchInflight.add(task.key);prefetchActive++;if(task.emergency)prefetchEmergencyActive++;
    const im=new Image();im.decoding='async';im.referrerPolicy='no-referrer';let done=false;
    const finish=ok=>{if(done)return;done=true;nativeClearTimeout(timer);prefetchInflight.delete(task.key);prefetchActive=Math.max(0,prefetchActive-1);if(task.emergency)prefetchEmergencyActive=Math.max(0,prefetchEmergencyActive-1);if(ok)markVariantReady(task.index,task.variant);pumpPrefetch()};
    im.onload=()=>finish(true);im.onerror=()=>finish(false);
    const timer=nativeSetTimeout(()=>{try{nativeSetSrc.call(im,'')}catch{}finish(false)},RAW_TIMEOUT_MS);
    try{nativeSetSrc.call(im,task.url)}catch{finish(false)}
  }
  function pumpPrefetch(){
    queuePrefetch();
    for(;;){
      if(!prefetchQueue.length)break;
      const continuity=contiguousVariantAhead('256',CONTINUITY_LOW_WATER);
      const urgentIndex=prefetchQueue.findIndex(x=>x.variant==='256'&&x.index-currentIndex()<=CONTINUITY_LOW_WATER);
      const urgent=urgentIndex>=0&&continuity<CONTINUITY_LOW_WATER;
      const cap=PREFETCH_BASE_CONCURRENCY+(urgent?PREFETCH_EMERGENCY_BURST:0);
      if(prefetchActive>=cap)break;
      const idx=urgent?urgentIndex:0,task=prefetchQueue.splice(idx,1)[0];
      task.emergency=urgent&&task.variant==='256';
      startPrefetch(task);
    }
  }
  function schedulePrefetch(){refreshLightUrls();pumpPrefetch()}

  function analysisCapacity(){if(!opticalAllowed)return 0;return rawAhead()>=ANALYSIS_RELAXED_AT&&Number(window.__journeyDiagnostics?.rawActive||0)===0?2:1}
  function cancelAnalysis(reason='raw-low'){
    analysisGeneration++;const queued=analysisQueue;analysisQueue=[];
    for(const q of queued){analysisQueued.delete(q.im);started.delete(q.im);try{nativeSetSrc.call(q.im,'')}catch{};nativeSetTimeout(()=>{try{q.im.dispatchEvent(new Event('error'))}catch{}},0)}
    for(const im of [...analysisActiveImages]){analysisActiveImages.delete(im);analysisActive=Math.max(0,analysisActive-1);started.delete(im);try{nativeSetSrc.call(im,'')}catch{};nativeSetTimeout(()=>{try{im.dispatchEvent(new Event('error'))}catch{}},0)}
    emit('analysis-generation',{generation:analysisGeneration,reason});
  }
  function updateOpticalGate(){const ahead=rawAhead();if(opticalAllowed&&ahead<OPTICAL_PAUSE_BELOW){opticalAllowed=false;cancelAnalysis('contiguous-raw-below-8');emit('optical-paused',{rawAhead:ahead,threshold:OPTICAL_PAUSE_BELOW,generation:analysisGeneration})}else if(!opticalAllowed&&ahead>=OPTICAL_RESUME_AT){opticalAllowed=true;analysisGeneration++;emit('optical-resumed',{rawAhead:ahead,threshold:OPTICAL_RESUME_AT,generation:analysisGeneration});pumpAnalysis()}return opticalAllowed}
  function pumpAnalysis(){updateOpticalGate();const cap=analysisCapacity();while(analysisActive<cap&&analysisQueue.length){const q=analysisQueue.shift();analysisQueued.delete(q.im);if(q.generation!==analysisGeneration||!opticalAllowed){started.delete(q.im);continue}analysisActive++;analysisActiveImages.add(q.im);started.set(q.im,q.meta);emit('start',q.meta);nativeSetSrc.call(q.im,q.actual)}}

  function startRaw(im,raw,index){
    const picked=rawVariantFor(raw,index),frame=Number.isFinite(index)?frameAt(index):null,meta={purpose:'raw',index,frameId:String(frame?.id||''),transport:'mapillary-direct',startedAt:now(),timeoutMs:RAW_TIMEOUT_MS,variant:picked.variant};
    if(Number.isFinite(index))activeRawIndices.add(index);started.set(im,meta);emit('start',meta);
    const timer=nativeSetTimeout(()=>{if(started.get(im)!==meta)return;timers.delete(im);started.delete(im);finishRawMeta(meta);markVariantFailure(meta);if(Number.isFinite(index))readyRawIndices.delete(index);emit('timeout',{...meta,elapsedMs:Math.round(now()-meta.startedAt),contiguousRawAhead:contiguousRawAhead()});try{nativeSetSrc.call(im,'')}catch{};try{im.dispatchEvent(new Event('error'))}catch{};schedulePrefetch()},RAW_TIMEOUT_MS);
    timers.set(im,timer);nativeSetSrc.call(im,picked.url);schedulePrefetch();
  }

  if(nativeSetSrc){Object.defineProperty(HTMLImageElement.prototype,'src',{configurable:srcDesc.configurable,enumerable:srcDesc.enumerable,get:srcDesc.get,set(value){
    installLifecycle(this);clearTimer(this);ensureRouteGeneration();const requested=String(value||''),raw=unwrapProxy(requested),analysis=this.crossOrigin==='anonymous',index=frameIndexFor(raw);
    if(!requested){nativeSetSrc.call(this,requested);return}
    if(analysis){
      updateOpticalGate();const generation=analysisGeneration,actual=proxyFor(raw),meta={purpose:'analysis',index,transport:'same-origin-proxy',startedAt:now(),timeoutMs:1800,generation};
      if(!opticalAllowed){emit('analysis-blocked',{...meta,rawAhead:rawAhead()});nativeSetTimeout(()=>{try{this.dispatchEvent(new Event('error'))}catch{}},0);return}
      analysisQueue.push({im:this,actual,meta,generation});analysisQueued.add(this);pumpAnalysis();return;
    }
    startRaw(this,raw,index);
  }})}

  window.requestIdleCallback=(callback,options={})=>{let cancelled=false,inner=null;const attempt=deadline=>{if(cancelled)return;if(updateOpticalGate()){callback(deadline);return}schedule()};const schedule=()=>{if(cancelled)return;if(nativeRIC)inner=nativeRIC(attempt,{timeout:Math.max(120,Number(options.timeout)||0)});else inner=nativeSetTimeout(()=>attempt({didTimeout:true,timeRemaining:()=>0}),120)};schedule();return{__journeyIdle:true,cancel(){cancelled=true;if(nativeRIC&&nativeCancelRIC&&inner!=null){try{nativeCancelRIC(inner)}catch{}}else if(inner!=null)nativeClearTimeout(inner)}}};
  window.cancelIdleCallback=handle=>{if(handle?.__journeyIdle)return handle.cancel();if(nativeCancelRIC)return nativeCancelRIC(handle);nativeClearTimeout(handle)};

  setInterval(()=>{const before=opticalAllowed;updateOpticalGate();if(opticalAllowed&&before)pumpAnalysis();schedulePrefetch()},100);
  ensureRouteGeneration();refreshLightUrls();schedulePrefetch();
  window.__journeyRawRuntime={
    version:VERSION,rawTimeoutMs:RAW_TIMEOUT_MS,opticalPauseBelow:OPTICAL_PAUSE_BELOW,opticalResumeAt:OPTICAL_RESUME_AT,analysisRelaxedAt:ANALYSIS_RELAXED_AT,
    rawVariant:'256 continuity lane + 1024 quality lane + source fallback',prefetchBaseConcurrency:PREFETCH_BASE_CONCURRENCY,prefetchEmergencyBurst:PREFETCH_EMERGENCY_BURST,prefetchAhead:PREFETCH_AHEAD,
    get opticalAllowed(){return opticalAllowed},get analysisGeneration(){return analysisGeneration},get analysisActive(){return analysisActive},get analysisQueued(){return analysisQueue.length},
    get contiguousRawAhead(){return contiguousRawAhead()},get continuity256Ahead(){return contiguousVariantAhead('256',CONTINUITY_256_AHEAD)},get quality1024Ahead(){return contiguousVariantAhead('1024',QUALITY_1024_AHEAD)},
    get lightUrlCount(){return light1024Urls.size},get emergencyUrlCount(){return light256Urls.size},get lightDisabled(){return lightDisabled},
    get rawVariantFailureCount(){let n=0;for(const s of rawVariantFailures.values())n+=s.size;return n},get prefetchActive(){return prefetchActive},get prefetchEmergencyActive(){return prefetchEmergencyActive},get prefetchQueued(){return prefetchQueue.length}
  };
})();
