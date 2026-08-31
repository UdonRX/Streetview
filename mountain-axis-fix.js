/* Mountain Journey strict source-center isolation v0.1.0 */
(()=>{
  'use strict';
  if(window.__mountainJourneyRuntimeInstalled)return;

  const ROUTE_KEY='streetview:journey-route';
  const PROFILE='MOUNTAIN';
  const HEADING_SOURCE='mountain-photo-center-50-strict';
  const CENTER_MODE='mountain-source-center-50-isolated';
  const state={version:'0.1.0',profile:PROFILE,active:false,centerX:50,centerY:50,index:-1,visibleIndex:-1,lockedFrames:0,preparedIndex:-1};

  function routeObject(){
    if(window.__journeySelectedRoute)return window.__journeySelectedRoute;
    try{return JSON.parse(sessionStorage.getItem(ROUTE_KEY)||'null')}catch{return null}
  }
  function profile(){
    const r=routeObject();
    const p=String(r?.journeyProfile||r?.routeProfile||r?.profile||'').trim().toUpperCase();
    if(p)return p;
    const id=String(r?.fixedTestRoute?.routeId||r?.destination?.testRouteType||'').toLowerCase();
    return id==='mountain'?PROFILE:'';
  }
  if(profile()!==PROFILE)return;

  window.__mountainJourneyRuntimeInstalled=true;
  state.active=true;

  function lockFrame(frame){
    if(!frame||typeof frame!=='object')return false;
    if(!Object.prototype.hasOwnProperty.call(frame,'__mountainOriginalHeading'))frame.__mountainOriginalHeading=Number.isFinite(frame.heading)?frame.heading:null;
    if(!Object.prototype.hasOwnProperty.call(frame,'__mountainOriginalProjectionYaw'))frame.__mountainOriginalProjectionYaw=Number.isFinite(frame.projectionYaw)?frame.projectionYaw:null;
    frame.heading=null;
    frame.projectionYaw=null;
    frame.headingSource=HEADING_SOURCE;
    frame.photoCenterX=50;
    frame.photoCenterY=50;
    frame.journeyProfile=PROFILE;
    return true;
  }
  function arrays(){
    const out=[],r=routeObject(),s=window.__journeyStreamState;
    if(Array.isArray(r?.frames))out.push(r.frames);
    if(Array.isArray(s?.frames)&&s.frames!==r?.frames)out.push(s.frames);
    return out;
  }
  function lockAll(){
    let count=0;
    for(const list of arrays())for(const frame of list)if(lockFrame(frame))count++;
    const r=routeObject();
    if(r){
      r.journeyProfile=PROFILE;
      r.profileSource=r.profileSource||'explicit-test-route';
      r.profileIsolation=true;
      r.presentationProfile={...(r.presentationProfile||{}),photoCenterX:50,photoCenterY:50,centerMode:CENTER_MODE,headingPolicy:'ignore-for-presentation'};
    }
    state.lockedFrames=count;
    const d=window.__journeyDiagnostics;
    if(d&&typeof d==='object'){
      d.centerMode=CENTER_MODE;
      d.warpEnabled=false;
      d.warpFallbackReason='mountain-profile-isolated-strict-center';
    }
    const p=window.__journeyPlaybackState;
    if(p&&typeof p==='object'){
      p.centerMode=CENTER_MODE;
      p.roadAnchorX=50;
      p.viewHeading=null;
      p.headingSource=HEADING_SOURCE;
    }
    return count;
  }
  function frameAt(index){
    lockAll();
    const s=window.__journeyStreamState?.frames,r=routeObject()?.frames;
    return (Array.isArray(s)?s[index]:null)||(Array.isArray(r)?r[index]:null)||null;
  }
  function imageUrl(frame){
    return String(frame?.raw256Url||frame?.raw1024Url||frame?.sourceUrl||frame?.url||'');
  }

  let layerA=null,layerB=null,front=null;
  function styleLayer(layer){
    layer.alt='';layer.decoding='async';layer.draggable=false;layer.referrerPolicy='no-referrer';
    layer.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:2;pointer-events:none;object-fit:cover;object-position:50% 50%;transform:none!important;filter:none;opacity:0;transition:none;backface-visibility:hidden;-webkit-backface-visibility:hidden;';
  }
  function ensureLayers(){
    if(layerA?.isConnected&&layerB?.isConnected)return true;
    const viewer=document.getElementById('viewer');if(!viewer)return false;
    layerA=document.getElementById('mountainCenterA')||document.createElement('img');
    layerB=document.getElementById('mountainCenterB')||document.createElement('img');
    layerA.id='mountainCenterA';layerB.id='mountainCenterB';styleLayer(layerA);styleLayer(layerB);
    if(!layerA.isConnected)viewer.appendChild(layerA);if(!layerB.isConnected)viewer.appendChild(layerB);
    front=layerA;
    return true;
  }
  function layerFor(index){
    if(layerA?.dataset.index===String(index))return layerA;
    if(layerB?.dataset.index===String(index))return layerB;
    return null;
  }
  function inactiveLayer(){return front===layerA?layerB:layerA}
  function showLayer(layer,index){
    if(!layer||state.index!==index||!layer.complete||!layer.naturalWidth)return false;
    const other=layer===layerA?layerB:layerA;
    other.style.opacity='0';layer.style.opacity='1';front=layer;state.visibleIndex=index;return true;
  }
  function prepare(index,showWhenReady=false){
    if(!Number.isFinite(index)||index<0||!ensureLayers())return null;
    const frame=frameAt(index),url=imageUrl(frame);if(!url)return null;
    let layer=layerFor(index);
    if(!layer){layer=inactiveLayer();layer.style.opacity='0';layer.dataset.index=String(index);layer.dataset.ready='0';layer.onload=()=>{layer.dataset.ready='1';if(showWhenReady||state.index===index)showLayer(layer,index)};layer.onerror=()=>{layer.dataset.ready='0'};layer.src=url;}
    if(showWhenReady)showLayer(layer,index);
    state.preparedIndex=index;
    return layer;
  }
  function present(index){
    if(!Number.isFinite(index)||index<0)return;
    state.index=index;lockAll();
    const ready=layerFor(index);if(!showLayer(ready,index))prepare(index,true);
    prepare(index+1,false);
  }

  lockAll();
  const lockTimer=setInterval(()=>{if(profile()!==PROFILE)return;lockAll();const i=Number(window.__journeyPlaybackState?.index);if(Number.isFinite(i)&&i>=0&&state.index<0)prepare(i,false)},24);
  window.addEventListener('journey-playback-started',e=>{const i=Number(e.detail?.index??0);present(Number.isFinite(i)?i:0);prepare((Number.isFinite(i)?i:0)+1,false)});
  window.addEventListener('journey-frame-presented',e=>present(Number(e.detail?.index)));
  window.addEventListener('journey-image-load',e=>{const d=e.detail||{};if(d.purpose==='raw'&&d.phase==='complete'){const i=Number(d.index),current=Number(window.__journeyPlaybackState?.index);if(Number.isFinite(i)&&(i===current||i===current+1))prepare(i,i===current)}});
  window.addEventListener('pagehide',()=>clearInterval(lockTimer),{once:true});

  window.__mountainJourneyRuntime={...state,state:()=>({...state}),lockAll,present};
})();