/* Streetview Journey raw/analysis transport split v0.1.41 */
(()=>{
  'use strict';
  if(window.__journeyRawRuntimeInstalled)return;
  window.__journeyRawRuntimeInstalled=true;
  const VERSION='0.1.41';
  const RAW_TIMEOUT_MS=2600;
  const OPTICAL_PAUSE_BELOW=8;
  const OPTICAL_RESUME_AT=12;
  const nativeSetTimeout=window.setTimeout.bind(window);
  const nativeClearTimeout=window.clearTimeout.bind(window);
  const nativeRIC=window.requestIdleCallback?.bind(window);
  const nativeCancelRIC=window.cancelIdleCallback?.bind(window);
  const srcDesc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
  const nativeSetSrc=srcDesc?.set;
  const timers=new WeakMap();
  const started=new WeakMap();
  let opticalAllowed=true;

  const now=()=>performance.now();
  function sameOrigin(u){try{return new URL(u,location.href).origin===location.origin}catch{return false}}
  function unwrapProxy(value){
    try{
      const u=new URL(String(value||''),location.href);
      if(u.origin===location.origin&&u.pathname==='/api/imagery'&&u.searchParams.get('mode')==='mapillary-image'){
        const source=u.searchParams.get('url');
        if(source)return source;
      }
    }catch{}
    return String(value||'');
  }
  function proxyFor(value){
    const raw=unwrapProxy(value);
    if(!raw)return raw;
    if(sameOrigin(raw))return raw;
    return `/api/imagery?mode=mapillary-image&url=${encodeURIComponent(raw)}`;
  }
  function frameIndexFor(raw){
    const lists=[window.__journeyStreamState?.frames,window.__journeySelectedRoute?.frames];
    for(const list of lists){
      if(!Array.isArray(list))continue;
      for(let i=0;i<list.length;i++){
        const f=list[i];
        if(!f)continue;
        if(unwrapProxy(f.url)===raw||f.sourceUrl===raw)return i;
      }
    }
    return null;
  }
  function emit(phase,detail){
    try{window.dispatchEvent(new CustomEvent('journey-image-load',{detail:{phase,...detail}}))}catch{}
  }
  function clearTimer(im){const t=timers.get(im);if(t){nativeClearTimeout(t);timers.delete(im)}}
  function installLifecycle(im){
    if(im.__journeyLifecycleInstalled)return;
    im.__journeyLifecycleInstalled=true;
    im.addEventListener('load',()=>{
      const meta=started.get(im);if(!meta)return;
      clearTimer(im);started.delete(im);
      emit('complete',{...meta,elapsedMs:Math.round(now()-meta.startedAt),width:im.naturalWidth||0,height:im.naturalHeight||0});
    });
    im.addEventListener('error',()=>{
      const meta=started.get(im);if(!meta)return;
      clearTimer(im);started.delete(im);
      emit('error',{...meta,elapsedMs:Math.round(now()-meta.startedAt)});
    });
  }
  if(nativeSetSrc){
    Object.defineProperty(HTMLImageElement.prototype,'src',{
      configurable:srcDesc.configurable,
      enumerable:srcDesc.enumerable,
      get:srcDesc.get,
      set(value){
        installLifecycle(this);
        clearTimer(this);
        const requested=String(value||'');
        const raw=unwrapProxy(requested);
        const analysis=this.crossOrigin==='anonymous';
        const actual=analysis?proxyFor(raw):raw;
        const purpose=analysis?'analysis':'raw';
        const index=frameIndexFor(raw);
        const meta={purpose,index,transport:analysis?'same-origin-proxy':'mapillary-direct',startedAt:now(),timeoutMs:analysis?1800:RAW_TIMEOUT_MS};
        started.set(this,meta);
        emit('start',meta);
        if(!analysis){
          const timer=nativeSetTimeout(()=>{
            if(started.get(this)!==meta)return;
            timers.delete(this);started.delete(this);
            emit('timeout',{...meta,elapsedMs:Math.round(now()-meta.startedAt)});
            try{nativeSetSrc.call(this,'')}catch{}
            try{this.dispatchEvent(new Event('error'))}catch{}
          },RAW_TIMEOUT_MS);
          timers.set(this,timer);
        }
        nativeSetSrc.call(this,actual);
      }
    });
  }

  function rawAhead(){return Number(window.__journeyPlaybackState?.rawAheadReady??window.__journeyDiagnostics?.rawAheadReady??0)}
  function updateOpticalGate(){
    const ahead=rawAhead();
    if(opticalAllowed&&ahead<OPTICAL_PAUSE_BELOW){opticalAllowed=false;emit('optical-paused',{rawAhead:ahead,threshold:OPTICAL_PAUSE_BELOW})}
    else if(!opticalAllowed&&ahead>=OPTICAL_RESUME_AT){opticalAllowed=true;emit('optical-resumed',{rawAhead:ahead,threshold:OPTICAL_RESUME_AT})}
    return opticalAllowed;
  }
  window.requestIdleCallback=(callback,options={})=>{
    let cancelled=false,inner=null;
    const attempt=deadline=>{
      if(cancelled)return;
      if(updateOpticalGate()){callback(deadline);return}
      schedule();
    };
    const schedule=()=>{
      if(cancelled)return;
      if(nativeRIC)inner=nativeRIC(attempt,{timeout:Math.max(120,Number(options.timeout)||0)});
      else inner=nativeSetTimeout(()=>attempt({didTimeout:true,timeRemaining:()=>0}),120);
    };
    schedule();
    return{__journeyIdle:true,cancel(){cancelled=true;if(nativeRIC&&nativeCancelRIC&&inner!=null){try{nativeCancelRIC(inner)}catch{}}else if(inner!=null)nativeClearTimeout(inner)}};
  };
  window.cancelIdleCallback=handle=>{if(handle?.__journeyIdle)return handle.cancel();if(nativeCancelRIC)return nativeCancelRIC(handle);nativeClearTimeout(handle)};

  window.__journeyRawRuntime={version:VERSION,rawTimeoutMs:RAW_TIMEOUT_MS,opticalPauseBelow:OPTICAL_PAUSE_BELOW,opticalResumeAt:OPTICAL_RESUME_AT,get opticalAllowed(){return opticalAllowed}};
})();