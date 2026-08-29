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
  let map=null,loaded=false,mapillaryReady=false;

  function getToken(){try{return localStorage.getItem(TOKEN_KEY)||'';}catch{return'';}}
  function setToken(v){try{if(v)localStorage.setItem(TOKEN_KEY,v);else localStorage.removeItem(TOKEN_KEY);}catch{}}
  function setStatus(text){if($('mapStatus'))$('mapStatus').textContent=text;}
  function setLayerVisible(id,on){if(map?.getLayer(id))map.setLayoutProperty(id,'visibility',on?'visible':'none');}
  function removeMapillary(){if(!map)return;for(const id of [MLY_IMAGE,MLY_LINE,MLY_GLOW])if(map.getLayer(id))map.removeLayer(id);if(map.getSource(MLY_SOURCE))map.removeSource(MLY_SOURCE);mapillaryReady=false;}

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
    mapillaryReady=true;
    $('mapillaryToggle').checked=true;
    $('mapillaryStatus').textContent='接続中';
  }

  function openSheet(){const s=$('tokenSheet');if(!s)return;$('mapillaryToken').value=getToken();s.hidden=false;requestAnimationFrame(()=>$('mapillaryToken').focus());}
  function closeSheet(){$('tokenSheet').hidden=true;}
  function updateMapillaryState(){const token=getToken();if(!token){removeMapillary();$('mapillaryToggle').checked=false;$('mapillaryStatus').textContent='トークン未設定';return;}if(loaded&&!mapillaryReady)installMapillary(token);}

  function init(){
    if(!window.maplibregl){setStatus('MapLibreを読み込めませんでした');return;}
    map=new maplibregl.Map({container:'coverageMap',style:STYLE_URL,center:[135.7681,35.0116],zoom:11.3,pitch:0,bearing:0,attributionControl:false,maxPitch:55});
    map.addControl(new maplibregl.NavigationControl({showCompass:true,showZoom:true}),'top-right');
    map.addControl(new maplibregl.GeolocateControl({positionOptions:{enableHighAccuracy:true},trackUserLocation:false,showUserHeading:true,fitBoundsOptions:{maxZoom:14}}),'top-right');
    map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
    map.on('load',()=>{loaded=true;installKartaView();updateMapillaryState();setStatus('実データ表示中');});
    map.on('sourcedata',e=>{if(e.sourceId===MLY_SOURCE&&e.isSourceLoaded){$('mapillaryStatus').textContent='実データ表示中';setStatus('Mapillary + KartaView');}});
    map.on('error',e=>{const msg=String(e?.error?.message||'');if(msg.includes('mapillary')||msg.includes('401')||msg.includes('403'))$('mapillaryStatus').textContent='トークンを確認';});

    $('kartaToggle').addEventListener('change',e=>setLayerVisible(KARTA_LAYER,e.target.checked));
    $('mapillaryToggle').addEventListener('change',e=>{if(!getToken()){e.target.checked=false;openSheet();return;}for(const id of [MLY_GLOW,MLY_LINE,MLY_IMAGE])setLayerVisible(id,e.target.checked);});
    $('mapillarySettings').addEventListener('click',openSheet);
    $('tokenBackdrop').addEventListener('click',closeSheet);
    $('closeTokenSheet').addEventListener('click',closeSheet);
    $('saveToken').addEventListener('click',()=>{const token=$('mapillaryToken').value.trim();if(!token){$('mapillaryStatus').textContent='トークン未設定';return;}setToken(token);removeMapillary();installMapillary(token);closeSheet();});
    $('removeToken').addEventListener('click',()=>{setToken('');$('mapillaryToken').value='';updateMapillaryState();closeSheet();});
  }
  init();
})();
