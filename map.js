(() => {
  'use strict';
  const STYLE_URL='https://tiles.openfreemap.org/styles/liberty';
  const TOKEN_KEY='streetview:mapillary-token';
  const KARTA_SOURCE='kartaview-coverage';
  const KARTA_LAYER='kartaview-coverage-layer';
  const MLY_SOURCE='mapillary-coverage';
  const MLY_GLOW='mapillary-sequence-glow';
  const MLY_LINE='mapillary-sequence-line';
  const MLY_IMAGE='mapillary-image-points';
  const $=id=>document.getElementById(id);
  let map=null,loaded=false,mapillaryReady=false,candidateAbort=null;

  function getToken(){try{return localStorage.getItem(TOKEN_KEY)||'';}catch{return'';}}
  function setToken(v){try{if(v)localStorage.setItem(TOKEN_KEY,v);else localStorage.removeItem(TOKEN_KEY);}catch{}}
  function setStatus(text){if($('mapStatus'))$('mapStatus').textContent=text;}
  function setLayerVisible(id,on){if(map?.getLayer(id))map.setLayoutProperty(id,'visibility',on?'visible':'none');}
  function removeMapillary(){if(!map)return;for(const id of [MLY_IMAGE,MLY_LINE,MLY_GLOW])if(map.getLayer(id))map.removeLayer(id);if(map.getSource(MLY_SOURCE))map.removeSource(MLY_SOURCE);mapillaryReady=false;}

  function installCandidateUI(){
    if($('journeyCandidate'))return;
    const style=document.createElement('style');
    style.textContent=`
      .coverage-map{cursor:crosshair}.journey-candidate{position:fixed;z-index:12;left:14px;right:14px;bottom:calc(var(--safe-bottom) + 14px);transform:translateY(125%);opacity:0;pointer-events:none;transition:transform .28s cubic-bezier(.2,.8,.2,1),opacity .2s ease;padding:14px;border:1px solid rgba(255,255,255,.15);border-radius:20px;background:rgba(7,15,14,.92);box-shadow:0 16px 46px rgba(0,0,0,.34);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px)}.journey-candidate.is-open{transform:translateY(0);opacity:1;pointer-events:auto}.journey-candidate.is-loading .jc-main{opacity:.55}.provider-panel.has-candidate{transform:translateY(125%);opacity:0;pointer-events:none}.provider-panel{transition:transform .28s cubic-bezier(.2,.8,.2,1),opacity .2s ease}.jc-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.jc-kicker{font-size:8px;font-weight:850;letter-spacing:.16em;color:#65e8ff}.jc-close{width:32px;height:32px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.06);color:#fff;font-size:18px}.jc-main{display:grid;gap:5px;margin-top:8px}.jc-main strong{font-size:18px;letter-spacing:-.025em}.jc-main p{margin:0;font-size:10px;line-height:1.5;color:rgba(255,255,255,.58)}.jc-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:11px}.jc-stat{display:grid;gap:3px;padding:9px 10px;border:1px solid rgba(255,255,255,.09);border-radius:12px;background:rgba(255,255,255,.035)}.jc-stat small{font-size:8px;color:rgba(255,255,255,.42)}.jc-stat b{font-size:11px}.jc-actions{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:10px}.jc-actions a,.jc-actions button{display:grid;place-items:center;min-height:44px;border:1px solid rgba(255,255,255,.12);border-radius:13px;text-decoration:none;font-size:11px;font-weight:800}.jc-actions a{background:#fff;color:#07110f}.jc-actions button{padding:0 15px;background:rgba(255,255,255,.06);color:#fff}.jc-error{color:#ffcf9b!important}@media(orientation:landscape){.journey-candidate{left:14px;right:auto;width:min(390px,42vw)}}`;
    document.head.appendChild(style);
    const card=document.createElement('section');card.id='journeyCandidate';card.className='journey-candidate';card.innerHTML=`<div class="jc-head"><span class="jc-kicker">KARTAVIEW JOURNEY CANDIDATE</span><button id="candidateClose" class="jc-close" type="button" aria-label="閉じる">×</button></div><div class="jc-main"><strong id="candidateTitle">撮影済みルートを確認中</strong><p id="candidateText">タップ位置の近くから連続写真を探している。</p></div><div id="candidateStats" class="jc-stats" hidden></div><div id="candidateActions" class="jc-actions" hidden><a id="candidateJourney" href="/journey.html">Journey Engineで確認</a><button id="candidateDismiss" type="button">戻る</button></div>`;document.body.appendChild(card);
    $('candidateClose').addEventListener('click',closeCandidate);$('candidateDismiss').addEventListener('click',closeCandidate);
  }
  function closeCandidate(){candidateAbort?.abort();candidateAbort=null;$('journeyCandidate')?.classList.remove('is-open','is-loading');document.querySelector('.provider-panel')?.classList.remove('has-candidate');}
  function openCandidateLoading(lng,lat){installCandidateUI();const c=$('journeyCandidate');c.classList.add('is-open','is-loading');document.querySelector('.provider-panel')?.classList.add('has-candidate');$('candidateTitle').textContent='撮影済みルートを確認中';$('candidateText').classList.remove('jc-error');$('candidateText').textContent=`${lat.toFixed(5)}, ${lng.toFixed(5)} 付近のKartaView連続写真を検索中…`;$('candidateStats').hidden=true;$('candidateActions').hidden=true;}
  function renderCandidate(data,lng,lat){const sel=data?.selection||{},frames=Array.isArray(data?.frames)?data.frames:[],distance=Number(sel.proximityMeters),alignment=Number(sel.alignmentErrorDeg);$('journeyCandidate').classList.remove('is-loading');$('candidateTitle').textContent=`Sequence #${data.sequenceId||'—'}`;$('candidateText').classList.remove('jc-error');$('candidateText').textContent='この地点の近くに、Journey Engineで再生できるKartaViewの連続写真が見つかった。';const stats=$('candidateStats');stats.hidden=false;stats.innerHTML=`<div class="jc-stat"><small>写真</small><b>${frames.length}枚</b></div><div class="jc-stat"><small>タップ地点から</small><b>${Number.isFinite(distance)?(distance<1000?`${Math.round(distance)}m`:`${(distance/1000).toFixed(1)}km`):'—'}</b></div><div class="jc-stat"><small>進行方向誤差</small><b>${Number.isFinite(alignment)?`${alignment.toFixed(1)}°`:'—'}</b></div>`;$('candidateActions').hidden=false;const a=$('candidateJourney');a.href=`/journey.html?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&sequence=${encodeURIComponent(data.sequenceId||'')}&index=${encodeURIComponent(data.anchorIndex??'')}`;}
  function renderCandidateError(message){$('journeyCandidate').classList.remove('is-loading');$('candidateTitle').textContent='この場所では候補を作れなかった';$('candidateText').classList.add('jc-error');$('candidateText').textContent=message||'近くに再生可能なKartaViewの連続写真が見つからなかった。';$('candidateStats').hidden=true;$('candidateActions').hidden=true;}
  async function findKartaCandidate(lngLat){
    if(!$('kartaToggle')?.checked)return;
    const {lng,lat}=lngLat;openCandidateLoading(lng,lat);candidateAbort?.abort();candidateAbort=new AbortController();
    try{const r=await fetch(`/api/imagery?source=karta&lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`,{signal:candidateAbort.signal,cache:'no-store'});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'候補を取得できなかった');const distance=Number(data?.selection?.proximityMeters);if(Number.isFinite(distance)&&distance>700)throw new Error(`最も近い再生可能ルートが約${Math.round(distance)}m先なので、このタップ位置の候補にはしなかった。紫の線の上をもう少し正確にタップしてみて。`);renderCandidate(data,lng,lat);}catch(e){if(e?.name==='AbortError')return;renderCandidateError(e?.message);}finally{candidateAbort=null;}
  }

  function installKartaView(){
    if(!map||map.getSource(KARTA_SOURCE))return;
    map.addSource(KARTA_SOURCE,{type:'raster',tiles:['https://api.openstreetcam.org/2.0/sequence/tiles/{x}/{y}/{z}.png'],tileSize:256,minzoom:0,maxzoom:20,attribution:'© KartaView'});
    map.addLayer({id:KARTA_LAYER,type:'raster',source:KARTA_SOURCE,paint:{'raster-opacity':.88,'raster-contrast':.16,'raster-saturation':.35,'raster-brightness-max':1}});
    $('kartaStatus').textContent='実データ表示中';
  }

  function installMapillary(token){
    if(!map||!loaded||!token)return;
    removeMapillary();
    const url=`https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${encodeURIComponent(token)}`;
    map.addSource(MLY_SOURCE,{type:'vector',tiles:[url],minzoom:6,maxzoom:14,attribution:'© Mapillary'});
    map.addLayer({id:MLY_GLOW,type:'line',source:MLY_SOURCE,'source-layer':'sequence',minzoom:6,paint:{'line-color':'#58ff93','line-width':['interpolate',['linear'],['zoom'],6,2,11,5,14,10],'line-opacity':.25,'line-blur':3}});
    map.addLayer({id:MLY_LINE,type:'line',source:MLY_SOURCE,'source-layer':'sequence',minzoom:6,paint:{'line-color':'#73ffa1','line-width':['interpolate',['linear'],['zoom'],6,.8,11,1.7,14,3.1],'line-opacity':.92}});
    map.addLayer({id:MLY_IMAGE,type:'circle',source:MLY_SOURCE,'source-layer':'image',minzoom:14,paint:{'circle-radius':['interpolate',['linear'],['zoom'],14,1.2,18,3.4],'circle-color':'#dcffe6','circle-opacity':.82,'circle-stroke-width':1,'circle-stroke-color':'#43ff86'}});
    mapillaryReady=true;$('mapillaryToggle').checked=true;$('mapillaryStatus').textContent='接続中';
  }

  function openSheet(){const s=$('tokenSheet');if(!s)return;$('mapillaryToken').value=getToken();s.hidden=false;requestAnimationFrame(()=>$('mapillaryToken').focus());}
  function closeSheet(){$('tokenSheet').hidden=true;}
  function updateMapillaryState(){const token=getToken();if(!token){removeMapillary();$('mapillaryToggle').checked=false;$('mapillaryStatus').textContent='トークン未設定';return;}if(loaded&&!mapillaryReady)installMapillary(token);}

  function init(){
    installCandidateUI();
    if(!window.maplibregl){setStatus('MapLibreを読み込めませんでした');return;}
    map=new maplibregl.Map({container:'coverageMap',style:STYLE_URL,center:[135.7681,35.0116],zoom:11.3,pitch:0,bearing:0,attributionControl:false,maxPitch:55});
    map.addControl(new maplibregl.NavigationControl({showCompass:true,showZoom:true}),'top-right');
    map.addControl(new maplibregl.GeolocateControl({positionOptions:{enableHighAccuracy:true},trackUserLocation:false,showUserHeading:true,fitBoundsOptions:{maxZoom:14}}),'top-right');
    map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
    map.on('load',()=>{loaded=true;installKartaView();updateMapillaryState();setStatus('実データ表示中');});
    map.on('click',e=>findKartaCandidate(e.lngLat));
    map.on('sourcedata',e=>{if(e.sourceId===MLY_SOURCE&&e.isSourceLoaded){$('mapillaryStatus').textContent='実データ表示中';setStatus('Mapillary + KartaView');}});
    map.on('error',e=>{const msg=String(e?.error?.message||'');if(msg.includes('mapillary')||msg.includes('401')||msg.includes('403'))$('mapillaryStatus').textContent='トークンを確認';});

    $('kartaToggle').addEventListener('change',e=>{setLayerVisible(KARTA_LAYER,e.target.checked);if(!e.target.checked)closeCandidate();});
    $('mapillaryToggle').addEventListener('change',e=>{if(!getToken()){e.target.checked=false;openSheet();return;}for(const id of [MLY_GLOW,MLY_LINE,MLY_IMAGE])setLayerVisible(id,e.target.checked);});
    $('mapillarySettings').addEventListener('click',openSheet);$('tokenBackdrop').addEventListener('click',closeSheet);$('closeTokenSheet').addEventListener('click',closeSheet);
    $('saveToken').addEventListener('click',()=>{const token=$('mapillaryToken').value.trim();if(!token){$('mapillaryStatus').textContent='トークン未設定';return;}setToken(token);removeMapillary();installMapillary(token);closeSheet();});
    $('removeToken').addEventListener('click',()=>{setToken('');$('mapillaryToken').value='';updateMapillaryState();closeSheet();});
  }
  init();
})();
