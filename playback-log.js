/* Playback logger bootstrap + unified RECTILINEAR 1024-only base transport. */
(()=>{
  'use strict';
  if(window.__journeyPlaybackBootstrapInstalled)return;
  window.__journeyPlaybackBootstrapInstalled=true;

  const CORE='/playback-log-core.js?v=0.1.56';
  const ROUTE_KEY='streetview:journey-route';
  const FULL1024_PROFILES=new Set(['ROAD','SIDEWALK','MOUNTAIN','RAIL']);
  let unified1024Only=false,unifiedProfile='',restoreAppendChild=null,primeTimer=0;

  function routeObject(){
    if(window.__journeySelectedRoute)return window.__journeySelectedRoute;
    try{return JSON.parse(sessionStorage.getItem(ROUTE_KEY)||'null')}catch{return null}
  }
  function isSphere(f){
    const p=String(f?.projection||f?.camera_type||'').toUpperCase();
    return p==='SPHERE'||p.includes('EQUIRECT')||f?.is_pano===true||Number(f?.fieldOfView)>=180;
  }
  function routeProfile(r){
    if(!r)return'';
    const direct=String(r.journeyProfile||r.routeProfile||r.profile||'').trim().toUpperCase();
    if(FULL1024_PROFILES.has(direct))return direct;
    const test=String(r.fixedTestRoute?.routeId||r.destination?.testRouteType||'').trim().toLowerCase();
    if(test==='road')return'ROAD';
    if(test==='sidewalk')return'SIDEWALK';
    if(test==='mountain')return'MOUNTAIN';
    if(test==='rail')return'RAIL';
    const genre=String(r.routeGenre||r.genre||r.category||'').trim().toUpperCase();
    if(['ROAD','CAR','DRIVE','DRIVING'].includes(genre))return'ROAD';
    if(['SIDEWALK','WALK','PEDESTRIAN'].includes(genre))return'SIDEWALK';
    if(['MOUNTAIN','TRAIL','HIKING'].includes(genre))return'MOUNTAIN';
    if(['RAIL','TRAIN'].includes(genre))return'RAIL';
    const classified=String(window.JourneyTransportClassifier?.state?.()?.transportMode||'').toUpperCase();
    return classified==='CAR'?'ROAD':classified==='WALK'?'SIDEWALK':classified==='TRAIL'?'MOUNTAIN':classified==='TRAIN'?'RAIL':'';
  }
  function proxy1024(u){
    if(!u)return'';
    try{
      const x=new URL(String(u),location.href);
      if(x.origin===location.origin&&x.pathname==='/api/imagery'&&x.searchParams.get('mode')==='mapillary-image')return x.pathname+x.search;
    }catch{}
    return `/api/imagery?mode=mapillary-image&url=${encodeURIComponent(String(u))}`;
  }
  function bind1024Frame(f){
    if(!f||isSphere(f)||f.__unified1024Bound)return f;
    const initialHeading=Number(f.computedHeading ?? f.heading);
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
        set(v){if(v!==null&&v!==''&&Number.isFinite(Number(v)))this.computedHeading=Number(v)}
      });
      Object.defineProperty(f,'projectionYaw',{
        configurable:true,enumerable:true,
        get(){return null},
        set(v){if(v!==null&&v!==''&&Number.isFinite(Number(v))&&!Number.isFinite(Number(this.computedHeading)))this.computedHeading=Number(v)}
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
      f.photoCenterX=50;
      f.photoCenterY=50;
      f.preferredImageTier='1024';
      Object.defineProperty(f,'__unified1024Bound',{value:true,configurable:true,enumerable:false});
    }catch{}
    return f;
  }
  function framesOf(r=routeObject()){
    return Array.isArray(r?.frames)?r.frames:(Array.isArray(window.__journeyStreamState?.frames)?window.__journeyStreamState.frames:[]);
  }
  function bindFrameArray(list){
    if(!Array.isArray(list)||list.__unified1024PushBound)return;
    for(const f of list)bind1024Frame(f);
    const nativePush=list.push;
    try{
      Object.defineProperty(list,'push',{
        configurable:true,writable:true,enumerable:false,
        value:function(...items){
          items.forEach(bind1024Frame);
          const out=nativePush.apply(this,items);
          scheduleTravelAxisPrime();
          return out;
        }
      });
      Object.defineProperty(list,'__unified1024PushBound',{value:true,configurable:true,enumerable:false});
    }catch{}
  }
  function hideRedundantQualityLayers(){
    let s=document.getElementById('unified1024OnlyStyle');
    if(!s){s=document.createElement('style');s.id='unified1024OnlyStyle';document.head.appendChild(s)}
    s.textContent='#journeyPersistent1024Shell,#journeyAdaptiveQualityShell,#journeyQualityLayer,#journeyHybridQualityLayer,#sidewalkDedicatedCenterLayer,#mountainCenterA,#mountainCenterB{display:none!important}';
  }
  function installHybridBlock(){
    if(!unified1024Only||restoreAppendChild)return;
    const native=Node.prototype.appendChild;
    Node.prototype.appendChild=function(node){
      try{
        const src=node?.tagName==='SCRIPT'?String(node.getAttribute?.('src')||node.src||''):'';
        if(window.__journeyUnified1024Only&&src.includes('/hybrid-quality.js')){
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
          version:'unified-1024-only',
          networkClass:'DIRECT',
          networkSource:`${String(unifiedProfile||'route').toLowerCase()}-1024-only`,
          currentImageTier:'1024-full',
          highResAhead:0,
          loadEwmaMs:null,
          qualityCache:{tier1024:0,tier2048:0,inflight:0}
        })
      };
    }
  }
  async function primeTravelAxis(){
    if(!unified1024Only||!window.__journeyTravelAxis)return;
    const r=routeObject(),frames=framesOf(r);
    if(!frames.length)return;
    try{
      const response=new Response(JSON.stringify({frames,selection:r?.selection||null}),{headers:{'content-type':'application/json'}});
      try{Object.defineProperty(response,'url',{value:`${location.origin}/api/imagery?mode=journey-center-sync`,configurable:true})}catch{}
      await response.json();
    }catch{}
  }
  function scheduleTravelAxisPrime(){
    if(!unified1024Only)return;
    clearTimeout(primeTimer);
    primeTimer=setTimeout(()=>primeTravelAxis(),20);
  }
  function prepareUnified1024Only(){
    const r=routeObject(),profile=routeProfile(r);
    if(!FULL1024_PROFILES.has(profile))return false;
    unified1024Only=true;
    unifiedProfile=profile;
    window.__journeyUnified1024Only=true;
    window.__journeyUnified1024Profile=profile;
    window.__journeyRoad1024Only=profile==='ROAD';
    if(profile==='SIDEWALK')window.__pedestrianAxisFixInstalled=true;
    const list=framesOf(r);
    bindFrameArray(list);
    if(window.__journeyStreamState&&Array.isArray(window.__journeyStreamState.frames)&&window.__journeyStreamState.frames!==list)bindFrameArray(window.__journeyStreamState.frames);
    hideRedundantQualityLayers();
    installHybridBlock();
    scheduleTravelAxisPrime();
    return true;
  }
  function keepFramesBound(){
    if(!unified1024Only)return;
    const r=routeObject(),list=framesOf(r);
    bindFrameArray(list);
    for(const f of list)bind1024Frame(f);
    hideRedundantQualityLayers();
  }
  function waitForCore(n=0){
    if(window.__journeyPlaybackLoggerInstalled){
      if(restoreAppendChild)setTimeout(()=>restoreAppendChild?.(),50);
      return
    }
    if(n<160)setTimeout(()=>waitForCore(n+1),25);
  }

  prepareUnified1024Only();
  if(unified1024Only){
    window.addEventListener('journey-playback-started',()=>{keepFramesBound();scheduleTravelAxisPrime()});
    window.addEventListener('journey-frame-presented',()=>keepFramesBound());
    window.addEventListener('journey-transport-classified',()=>keepFramesBound());
    setInterval(keepFramesBound,250);
  }

  if(document.readyState==='loading'){
    const mountainScript=unified1024Only?'':`<script src="/mountain-axis-fix.js?v=0.1.0"><\/script>`;
    document.write(`${mountainScript}<script src="${CORE}"><\/script>`);
    waitForCore();
    return;
  }
  const load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.async=false;s.onload=resolve;s.onerror=reject;document.head.appendChild(s)});
  if(unified1024Only){
    load(CORE).finally(()=>{if(restoreAppendChild)setTimeout(()=>restoreAppendChild?.(),50)});
  }else{
    load('/mountain-axis-fix.js?v=0.1.0').finally(()=>load(CORE).finally(()=>{if(restoreAppendChild)setTimeout(()=>restoreAppendChild?.(),50)}));
  }
})();