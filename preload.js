function createMemoizedProvider(){
  const M=window.mapillary;if(!M?.GraphDataProvider)throw new Error('Mapillary GraphDataProviderを読み込めませんでした');
  const base=new M.GraphDataProvider({accessToken:token()});
  const stats={imagesHit:0,imagesMiss:0,bufferHit:0,bufferMiss:0,meshHit:0,meshMiss:0,clusterHit:0,clusterMiss:0};
  const images=new Map(),spatial=new Map(),buffers=new Map(),meshes=new Map(),clusters=new Map(),tiles=new Map(),sequences=new Map();
  const original={getImages:base.getImages.bind(base),getSpatialImages:base.getSpatialImages.bind(base),getImageBuffer:base.getImageBuffer.bind(base),getMesh:base.getMesh.bind(base),getCluster:base.getCluster.bind(base),getImageTiles:base.getImageTiles.bind(base),getSequence:base.getSequence.bind(base)};
  base.getImages=async ids=>{const keys=ids.map(String),miss=keys.filter(id=>!images.has(id));if(miss.length){stats.imagesMiss+=miss.length;const rows=await original.getImages(miss);for(const row of rows||[]){const id=String(row?.node_id??row?.node?.id??'');if(id){images.set(id,row);spatial.set(id,row)}}}else stats.imagesHit+=keys.length;return keys.map(id=>images.get(id)).filter(Boolean)};
  base.getSpatialImages=async ids=>{const keys=ids.map(String),miss=keys.filter(id=>!spatial.has(id));if(miss.length){const rows=await original.getSpatialImages(miss);for(const row of rows||[]){const id=String(row?.node_id??row?.node?.id??'');if(id)spatial.set(id,row)}}return keys.map(id=>spatial.get(id)).filter(Boolean)};
  function memoUrl(map,hitKey,missKey,fn){return async(url,abort)=>{if(map.has(url)){stats[hitKey]++;return map.get(url)}stats[missKey]++;const p=fn(url).catch(e=>{map.delete(url);throw e});map.set(url,p);return p}}
  base.getImageBuffer=memoUrl(buffers,'bufferHit','bufferMiss',original.getImageBuffer);
  base.getMesh=memoUrl(meshes,'meshHit','meshMiss',original.getMesh);
  base.getCluster=memoUrl(clusters,'clusterHit','clusterMiss',original.getCluster);
  base.getImageTiles=async req=>{const key=`${req.imageId}:${req.z}`;if(!tiles.has(key))tiles.set(key,original.getImageTiles(req).catch(e=>{tiles.delete(key);throw e}));return tiles.get(key)};
  base.getSequence=async id=>{const key=String(id);if(!sequences.has(key))sequences.set(key,original.getSequence(key).catch(e=>{sequences.delete(key);throw e}));return sequences.get(key)};
  return{provider:base,stats};
}
function contractNode(rows,id){const row=(rows||[]).find(x=>String(x?.node_id??x?.node?.id??'')===String(id))||(rows||[])[0];return row?.node||null}
async function prefetchFrame(index,generation=state.preloadGeneration){
  if(generation!==state.preloadGeneration||!state.route||state.preloaded.has(index))return false;
  const frame=state.route.frames[index];if(!frame)return false;const t0=performance.now();
  try{
    const rows=await state.provider.getImages([frame.id]);if(generation!==state.preloadGeneration)return false;const node=contractNode(rows,frame.id);if(!node)throw new Error('image-contract-missing');
    const jobs=[];if(node.thumb?.url)jobs.push(state.provider.getImageBuffer(node.thumb.url));if(node.mesh?.url)jobs.push(state.provider.getMesh(node.mesh.url));if(node.cluster?.url)jobs.push(state.provider.getCluster(node.cluster.url));
    const settled=await Promise.allSettled(jobs);if(!jobs.length||settled.every(x=>x.status==='rejected'))throw new Error('asset-prefetch-failed');
    state.preloaded.add(index);state.preloadTimes.push(performance.now()-t0);return true;
  }catch{state.preloadFailures++;return false}
}
async function prefetchIndexes(indexes,concurrency=PRELOAD_CONCURRENCY,generation=state.preloadGeneration){
  let cursor=0;const workers=Array.from({length:Math.min(concurrency,indexes.length)},async()=>{while(cursor<indexes.length&&generation===state.preloadGeneration){const i=indexes[cursor++];await prefetchFrame(i,generation)}});await Promise.all(workers)
}
function contiguousAhead(){let n=0;for(let i=state.cursor+1;i<state.route?.frames.length;i++){if(!state.preloaded.has(i))break;n++}return n}
function updatePreloadUI(){const total=Math.max(1,state.preloadTarget||PRELOAD_MIN),ready=Math.min(total,state.preloaded.size),pct=clamp(ready/total*100,0,100);$('preloadBar').style.width=`${pct}%`;$('preloadText').textContent=`先読み ${state.preloaded.size}/${state.route?.frames.length||0}（開始目標 ${state.preloadTarget||'—'}）`;if(!$('plannerProgress').hidden){$('plannerBar').style.width=`${pct}%`;$('plannerProgressText').textContent=`先読み ${state.preloaded.size}/${state.preloadTarget||'…'} ・ ${fmt(state.preloadRateFps,2,'fps')}`}}
async function adaptivePreload(){
  const gen=++state.preloadGeneration;state.preloaded.clear();state.preloadTimes=[];state.preloadFailures=0;state.preloadTarget=PRELOAD_MIN;const wallStart=performance.now();
  $('plannerProgress').hidden=false;updatePreloadUI();
  const sample=[...Array(Math.min(PRELOAD_SAMPLE,state.route.frames.length)).keys()];const sampleStart=performance.now();await prefetchIndexes(sample,PRELOAD_CONCURRENCY,gen);const sampleWall=performance.now()-sampleStart;
  const sampleReady=sample.filter(i=>state.preloaded.has(i)).length;state.preloadRateFps=sampleReady?sampleReady/(sampleWall/1000):0;
  const consumeRate=1000/DEFAULT_CADENCE,playSeconds=Math.max(1,(state.route.frames.length-1)*DEFAULT_CADENCE/1000),deficit=Math.max(0,(consumeRate-state.preloadRateFps)*playSeconds);
  state.preloadTarget=clamp(Math.ceil(deficit)+PRELOAD_MIN,PRELOAD_MIN,Math.min(PRELOAD_MAX,state.route.frames.length));updatePreloadUI();
  let next=sample.length;
  while(gen===state.preloadGeneration&&state.preloaded.size<state.preloadTarget&&next<state.route.frames.length&&performance.now()-wallStart<PRELOAD_WAIT_MAX_MS){const batch=[];while(batch.length<PRELOAD_CONCURRENCY&&next<state.route.frames.length)batch.push(next++);await prefetchIndexes(batch,PRELOAD_CONCURRENCY,gen);updatePreloadUI()}
  state.preloadWallMs=performance.now()-wallStart;state.preloadReadyAtOpen=state.preloaded.size;updatePreloadUI();
}
async function backgroundWarm(){
  if(state.backgroundWarming||!state.route||!state.provider)return;state.backgroundWarming=true;const gen=state.preloadGeneration;
  try{while(gen===state.preloadGeneration&&state.route){const end=Math.min(state.route.frames.length,state.cursor+1+BACKGROUND_AHEAD),needed=[];for(let i=state.cursor+1;i<end;i++)if(!state.preloaded.has(i))needed.push(i);if(!needed.length)break;await prefetchIndexes(needed.slice(0,2),2,gen);updatePreloadUI()}}finally{state.backgroundWarming=false}
}
function plannerStatus(title,hint){$('plannerTitle').textContent=title;$('plannerHint').textContent=hint}
function updateRouteSummary(){if(!state.goal){$('routeSummary').textContent='到着地点を選択してください';return}if(!state.start){$('routeSummary').textContent=`到着 ${coordLabel(state.goal)}`;return}$('routeSummary').textContent=`${coordLabel(state.start)} → ${coordLabel(state.goal)}`}
function resetPlanner(){
  stopPlayback('route-reset',true);destroyViewer();state.preloadGeneration++;state.route=null;state.provider=null;state.providerStats=null;state.start=null;state.goal=null;state.stage='goal';state.routeCacheHit=false;state.routeResolveMs=null;state.preloaded.clear();
  state.goalMarker?.remove();state.startMarker?.remove();state.goalMarker=state.startMarker=null;$('openViewer').disabled=true;$('plannerProgress').hidden=true;$('plannerBar').style.width='0';plannerStatus('① 到着地点をタップ','最初に旅の到着地点を地図で選ぶ');updateRouteSummary();$('routeDetail').textContent='到着地点 → 出発地点の順に決める。出発地点が決まった瞬間からMapillaryの先読みを開始する。';
}
async function selectMapPoint(e){
  if(state.stage==='busy')return;const p={lng:e.lngLat.lng,lat:e.lngLat.lat};
  if(state.stage==='goal'){
    state.goal=p;state.goalMarker?.remove();state.goalMarker=new maplibregl.Marker().setLngLat([p.lng,p.lat]).addTo(state.map);state.stage='start';plannerStatus('② 出発地点をタップ','到着地点は決定済み。次に出発地点を選ぶ');updateRouteSummary();return;
  }
  if(state.stage==='start'){
    state.start=p;state.startMarker?.remove();state.startMarker=new maplibregl.Marker().setLngLat([p.lng,p.lat]).addTo(state.map);state.stage='busy';updateRouteSummary();await prepareSelectedRoute();
  }
}
async function prepareSelectedRoute(){
  const setupStart=performance.now();$('openViewer').disabled=true;$('plannerProgress').hidden=false;$('plannerProgressText').textContent='Mapillary sequenceをGPSで確認中…';$('plannerBar').style.width='4%';
  try{
    state.route=await resolveRoute();const memo=createMemoizedProvider();state.provider=memo.provider;state.providerStats=memo.stats;$('plannerProgressText').textContent='同じMapillary DataProviderへ先読み中…';$('plannerBar').style.width='10%';
    await adaptivePreload();state.setupMs=performance.now()-setupStart;state.stage='ready';$('openViewer').disabled=false;$('plannerProgressText').textContent=`準備完了：${state.preloaded.size}枚先読み / ${Math.round(state.preloadWallMs/1000)}秒`;plannerStatus('ルート準備完了','Viewerを開くと同じメモリキャッシュをそのまま使う');$('routeDetail').textContent=`sequence ${state.route.sequenceId} / ${state.route.direction} / ${state.route.frames.length}枚。表示方式はDefault transitionのまま。`;
  }catch(error){state.stage='start';$('plannerProgressText').textContent=`準備失敗: ${error?.message||error}`;$('plannerBar').style.width='0';plannerStatus('② 出発地点を選び直す','ルート準備に失敗しました');$('routeDetail').textContent=String(error?.message||error)}
}
function initMap(){
  state.map=new maplibregl.Map({container:'routeMap',style:'https://tiles.openfreemap.org/styles/liberty',center:[135.7594,35.0068],zoom:15,attributionControl:false});state.map.addControl(new maplibregl.NavigationControl({showCompass:true}),'bottom-right');state.map.on('click',selectMapPoint)
}
