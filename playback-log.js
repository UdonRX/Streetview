/* Playback logger bootstrap + ROAD 1024-only base transport. */
(()=>{
  'use strict';
  if(window.__journeyPlaybackBootstrapInstalled)return;
  window.__journeyPlaybackBootstrapInstalled=true;

  const CORE='/playback-log-core.js?v=0.1.56';
  const ROUTE_KEY='streetview:journey-route';
  let road1024Only=false,restoreAppendChild=null,primeTimer=0;

  function routeObject(){
    if(window.__journeySelectedRoute)return window.__journeySelectedRoute;
    try{return JSON.parse(sessionStorage.getItem(ROUTE_KEY)||'null')}catch{return null}
  }
  function isSphere(f){
    const p=String(f?.projection||f?.camera_type||'').toUpperCase();
    return p==='SPHERE'||p.includes('EQUIRECT')||f?.is_pano===true||Number(f?.fieldOfView)>=180;
  }
  function isRoadRoute(r){
    if(!r)return false;
    const direct=String(r.journeyProfile||r.routeProfile||r.profile||'').toUpperCase();
    if(direct==='ROAD')return true;
    const test=String(r.fixedTestRoute?.routeId||r.destination?.testRouteType||'').toLowerCase();
    if(test==='road')return true;
    const genre=String(r.routeGenre||r.genre||r.category||'').toUpperCase();
    return ['ROAD','CAR','DRIVE','DRIVING'].includes(genre);
  }
  function proxy1024(u){
    if(!u)return'';
    try{
      const x=new URL(String(u),location.href);
      if(x.origin===location.origin&&x.pathname==='/api/imagery'&&x.searchParams.get('mode')==='mapillary-image')return x.pathname+x.search;
    }catch{}
    return `/api/imagery?mode=mapillary-image&url=${encodeURIComponent(String(u))}`;
  }
  function bindRoadFrame(f){
    if(!f||isSphere(f)||f.__road1024Bound)return f;
    const initialHeading=Number(f.heading);
    if(Number.isFinite(initialHeading)&&!Number.isFinite(Number(f.computedHeading)))f.computedHeading=initialHeading;
    const hidden={
      url:String(f.url||''),
      sourceUrl:String(f.sourceUrl||''),
      raw256Url:String(f.raw256Url||f.thumb_256_url||'')
    };
    try{
      Object.defineProperty(f,'heading',{
        configurable:true,enumerable:true,
        get(){return null},
        set(v){const n=Number(v);if(Number.isFinite(n))this.computedHeading=n}
      });
      Object.defineProperty(f,'projectionYaw',{
        configurable:true,enumerable:true,
        get(){return null},
        set(v){const n=Number(v);if(Number.isFinite(n)&&!Number.isFinite(Number(this.computedHeading)))this.computedHeading=n}
      });
      Object.defineProperty(f,'raw256Url',{
        configurable:true,enumerable:true,
        get(){return this.raw1024Url||this.thumb_1024_url||hidden.raw256Url||null},
        set(v){hidden.raw256Url=String(v||'')}
      });
      Object.defineProperty(f,'sourceUrl',{
        configurable:true,enumerable:true,
        get(){return this.raw1024Url||this.thumb_1024_url||hidden.sourceUrl||null},
        set(v){hidden.sourceUrl=String(v||'')}
      });
      Object.defineProperty(f,'url',{
        configurable:true,enumerable:true,
        get(){
          const u=this.raw1024Url||this.thumb_1024_url;
          return u?proxy1024(u):hidden.url
        },
        set(v){hidden.url=String(v||'')}
      });
      Object.defineProperty(f,'__road1024Bound',{value:true,configurable:true,enumerable:false});
    }catch{}
    return f;
  }
  function framesOf(r=routeObject()){
    return Array.isArray(r?.frames)?r.frames:(Array.isArray(window.__journeyStreamState?.frames)?window.__journeyStreamState.frames:[]);
  }
  function bindFrameArray(list){
    if(!Array.isArray(list)||list.__road1024PushBound)return;
    for(const f of list)bindRoadFrame(f);
    const nativePush=list.push;
    try{
      Object.defineProperty(list,'push',{
        configurable:true,writable:true,enumerable:false,
        value:function(...items){
          items.forEach(bindRoadFrame);
          const out=nativePush.apply(this,items);
          scheduleTravelAxisPrime();
          return out;
        }
      });
      Object.defineProperty(list,'__road1024PushBound',{value:true,configurable:true,enumerable:false});
    }catch{}
  }
  function hideRedundantQualityLayers(){
    let s=document.getElementById('road1024OnlyStyle');
    if(!s){s=document.createElement('style');s.id='road1024OnlyStyle';document.head.appendChild(s)}
    s.textContent='#journeyPersistent1024Shell,#journeyAdaptiveQualityShell,#journeyQualityLayer,#journeyHybridQualityLayer{display:none!important}';
  }
  function installHybridBlock(){
    if(!road1024Only||restoreAppendChild)return;
    const native=Node.prototype.appendChild;
    Node.prototype.appendChild=function(node){
      try{
        const src=node?.tagName==='SCRIPT'?String(node.getAttribute?.('src')||node.src||''):'';
        if(window.__journeyRoad1024Only&&src.includes('/hybrid-quality.js')){
          queueMicrotask(()=>{try{node.dispatchEvent(new Event('load'))}catch{}});
          return node;
        }
      }catch{}
      return native.call(this,node)
    };
    restoreAppendChild=()=>{if(Node.prototype.appendChild!==native)Node.prototype.appendChild=native;restoreAppendChild=null};
    if(!window.__journeyHybridQuality){
      window.__journeyHybridQuality={
        state:()=>({
          version:'road-1024-only',
          networkClass:'DIRECT',
          networkSource:'road-1024-only',
          currentImageTier:'1024-full',
          highResAhead:0,
          loadEwmaMs:null,
          qualityCache:{tier1024:0,tier2048:0,inflight:0}
        })
      };
    }
  }
  async function primeTravelAxis(){
    if(!road1024Only||!window.__journeyTravelAxis)return;
    const r=routeObject(),frames=framesOf(r);
    if(!frames.length)return;
    try{
      const response=new Response(JSON.stringify({frames,selection:r?.selection||null}),{headers:{'content-type':'application/json'}});
      try{Object.defineProperty(response,'url',{value:`${location.origin}/api/imagery?mode=journey-center-sync`,configurable:true})}catch{}
      await response.json();
    }catch{}
  }
  function scheduleTravelAxisPrime(){
    if(!road1024Only)return;
    clearTimeout(primeTimer);
    primeTimer=setTimeout(()=>primeTravelAxis(),20);
  }
  function prepareRoad1024Only(){
    const r=routeObject();
    if(!isRoadRoute(r))return false;
    road1024Only=true;
    window.__journeyRoad1024Only=true;
    const list=framesOf(r);
    bindFrameArray(list);
    if(window.__journeyStreamState&&Array.isArray(window.__journeyStreamState.frames)&&window.__journeyStreamState.frames!==list)bindFrameArray(window.__journeyStreamState.frames);
    hideRedundantQualityLayers();
    installHybridBlock();
    scheduleTravelAxisPrime();
    return true;
  }
  function keepRoadFramesBound(){
    if(!road1024Only)return;
    const r=routeObject(),list=framesOf(r);
    bindFrameArray(list);
    for(const f of list)bindRoadFrame(f);
  }
  function waitForCore(n=0){
    if(window.__journeyPlaybackLoggerInstalled){
      if(restoreAppendChild)setTimeout(()=>restoreAppendChild?.(),50);
      return
    }
    if(n<160)setTimeout(()=>waitForCore(n+1),25);
  }

  prepareRoad1024Only();
  if(road1024Only){
    window.addEventListener('journey-playback-started',()=>{keepRoadFramesBound();scheduleTravelAxisPrime()});
    window.addEventListener('journey-frame-presented',()=>keepRoadFramesBound());
    window.addEventListener('journey-transport-classified',()=>keepRoadFramesBound());
    setInterval(keepRoadFramesBound,250);
  }

  if(document.readyState==='loading'){
    document.write(`<script src="/mountain-axis-fix.js?v=0.1.0"><\/script><script src="${CORE}"><\/script>`);
    waitForCore();
    return;
  }
  const load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.async=false;s.onload=resolve;s.onerror=reject;document.head.appendChild(s)});
  load('/mountain-axis-fix.js?v=0.1.0').finally(()=>load(CORE).finally(()=>{if(restoreAppendChild)setTimeout(()=>restoreAppendChild?.(),50)}));
})();