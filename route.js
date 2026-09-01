const graphMemo=new Map();
const MLY_INDEX_SOURCE='mapillary-route-index';
const MLY_INDEX_LAYER='mapillary-route-index-line';
const ROUTE_INDEX_BASE_MARGINS=[350,900,1800,3200];
const ROUTE_INDEX_ENDPOINT_LIMIT=6000;
const ROUTE_INDEX_CANDIDATE_MAX=12;
const ROUTE_INDEX_EVALUATE_MAX=8;
const ROUTE_INDEX_WAIT_MS=2600;
let routeIndexToken='';
let routeIndexPromise=null;
const poiMemoryCache=new Map();
let poiAbortController=null;

async function graph(path){
  const t=token();if(!t)throw new Error('Mapillary Access Tokenが未設定です');
  const key=`${t.slice(-12)}:${path}`;if(graphMemo.has(key))return graphMemo.get(key);
  state.graphRequestCount++;const sep=path.includes('?')?'&':'?';
  const p=fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(t)}`,{cache:'no-store'}).then(async res=>{
    const data=await res.json().catch(()=>({}));
    if(!res.ok||data?.error)throw new Error(data?.error?.message||`Mapillary API ${res.status}`);
    return data;
  }).catch(e=>{graphMemo.delete(key);throw e});
  graphMemo.set(key,p);return p;
}
async function metadataPart(ids,fields){
  if(!ids.length)return{data:[]};
  try{return await graph(`/images?image_ids=${encodeURIComponent(ids.join(','))}&limit=${ids.length}&fields=${encodeURIComponent(fields)}`)}
  catch(error){
    if(ids.length<=4||!/reduce the amount of data|too much data|request.*large/i.test(String(error?.message||error)))throw error;
    const half=Math.ceil(ids.length/2),a=await metadataPart(ids.slice(0,half),fields),b=await metadataPart(ids.slice(half),fields);
    return{data:[...(a?.data||[]),...(b?.data||[])]};
  }
}
async function metadata(ids,fields='id,sequence,computed_geometry,compass_angle,computed_compass_angle,is_pano'){
  const out=new Map(),unique=[...new Set(ids.map(String).filter(Boolean))];
  for(let i=0;i<unique.length;i+=24){
    const part=unique.slice(i,i+24),data=await metadataPart(part,fields);
    for(const m of data?.data||[])out.set(String(m.id),m);
  }
  return out;
}
async function orderedIds(sequenceId){const data=await graph(`/image_ids?sequence_id=${encodeURIComponent(sequenceId)}`);return(data?.data||[]).map(x=>String(x?.id??x)).filter(Boolean)}
function sampleSequenceEntries(ids){
  if(!ids.length)return[];
  const target=Math.min(MAX_PLAYBACK_FRAMES,Math.max(TARGET_FRAMES,Math.ceil(ids.length/MAX_SEQUENCE_GAP)));
  if(ids.length<=target)return ids.map((id,index)=>({id,index}));
  const out=[],used=new Set(),step=(ids.length-1)/(target-1);
  for(let i=0;i<target;i++){
    const index=Math.round(i*step);if(used.has(index))continue;used.add(index);out.push({id:ids[index],index});
  }
  return out;
}
async function refineEndpointIndexes(ids,startIndex,goalIndex){
  const refine=new Set();for(const center of[startIndex,goalIndex])for(let i=Math.max(0,center-7);i<=Math.min(ids.length-1,center+7);i++)refine.add(i);
  const fine=await metadata([...refine].map(i=>ids[i]),'id,computed_geometry');let bestStart=startIndex,bestGoal=goalIndex,startD=Infinity,goalD=Infinity;
  for(const i of refine){const p=pointOf(fine.get(ids[i]));if(!p)continue;const ds=distanceMeters(state.start,p),dg=distanceMeters(state.goal,p);if(ds<startD){startD=ds;bestStart=i}if(dg<goalD){goalD=dg;bestGoal=i}}
  return{startIndex:bestStart,goalIndex:bestGoal,startD,goalD};
}
async function locateEndpoints(ids){
  if(ids.length<2)return null;
  const count=Math.min(26,ids.length),indexes=[];for(let i=0;i<count;i++)indexes.push(Math.round(i*(ids.length-1)/Math.max(1,count-1)));
  const coarse=await metadata(indexes.map(i=>ids[i]),'id,computed_geometry');let startD=Infinity,goalD=Infinity,startIndex=-1,goalIndex=-1;
  for(const i of indexes){const p=pointOf(coarse.get(ids[i]));if(!p)continue;const ds=distanceMeters(state.start,p),dg=distanceMeters(state.goal,p);if(ds<startD){startD=ds;startIndex=i}if(dg<goalD){goalD=dg;goalIndex=i}}
  if(startIndex<0||goalIndex<0||startIndex===goalIndex)return null;
  return refineEndpointIndexes(ids,startIndex,goalIndex);
}
function filterNearDuplicateFrames(frames){
  if(frames.length<3)return frames;
  const out=[frames[0]];
  for(let i=1;i<frames.length-1;i++){
    const prev=out[out.length-1],cur=frames[i];
    if(distanceMeters(prev,cur)>=MIN_FRAME_DISTANCE_M)out.push(cur);
  }
  const last=frames[frames.length-1];if(out[out.length-1]?.id!==last.id)out.push(last);
  return out;
}
function decorateRoute(route){
  let total=0;
  for(let i=0;i<route.frames.length;i++){
    const f=route.frames[i];
    if(i){const step=distanceMeters(route.frames[i-1],f);f.stepDistanceM=step;total+=step}else f.stepDistanceM=0;
    f.distanceFromStartM=total;
    f.sequenceGap=i?Math.abs(Number(f.sequenceIndex)-Number(route.frames[i-1].sequenceIndex)):0;
  }
  route.totalDistanceM=total||distanceMeters(state.start,state.goal);
  route.maxSequenceGap=Math.max(0,...route.frames.map(f=>Number(f.sequenceGap)||0));
  route.avgSequenceGap=route.frames.length>1?route.frames.slice(1).reduce((s,f)=>s+(Number(f.sequenceGap)||0),0)/(route.frames.length-1):0;
  for(const f of route.frames){f.routeProgress=route.totalDistanceM?f.distanceFromStartM/route.totalDistanceM:0;f.remainingDistanceM=Math.max(0,route.totalDistanceM-f.distanceFromStartM);f.routeDistance=0}
  state.totalDistanceM=route.totalDistanceM;return route;
}
async function evaluateSequence(sequenceId,hint={}){
  try{
    const ids=await orderedIds(sequenceId);if(ids.length<2)return null;
    const loc=await locateEndpoints(ids);
    const endpointLimit=Math.max(ROUTE_INDEX_ENDPOINT_LIMIT,(hint.margin||0)+900);
    if(!loc||loc.startD>endpointLimit||loc.goalD>endpointLimit||loc.startIndex===loc.goalIndex)return null;
    const sign=loc.goalIndex>loc.startIndex?1:-1,dense=[];
    for(let i=loc.startIndex;;i+=sign){dense.push(ids[i]);if(i===loc.goalIndex)break}
    if(dense.length<4)return null;
    const entries=sampleSequenceEntries(dense),metas=await metadata(entries.map(x=>x.id)),rawFrames=[];
    for(const entry of entries){
      const m=metas.get(entry.id),p=pointOf(m);if(!p)continue;
      rawFrames.push({id:entry.id,sequenceId,sequenceIndex:loc.startIndex+sign*entry.index,lat:p.lat,lng:p.lng,routeProgress:0,routeDistance:0,isPano:!!m?.is_pano,compass:Number.isFinite(+m?.computed_compass_angle)?+m.computed_compass_angle:(Number.isFinite(+m?.compass_angle)?+m.compass_angle:null)});
    }
    const frames=filterNearDuplicateFrames(rawFrames);if(frames.length<4)return null;
    const route={sequenceId,direction:sign>0?'Next':'Prev',frames,startDistance:loc.startD,goalDistance:loc.goalD,denseFrameCount:dense.length,pano:frames.filter(f=>f.isPano).length,searchRadiusM:hint.margin||0,score:frames.length*30-loc.startD-loc.goalD};
    return decorateRoute(route);
  }catch(error){return null}
}

function mapillaryIndexFeatureId(feature){return String(feature?.properties?.id??feature?.properties?.sequence_id??feature?.properties?.sequenceId??feature?.id??'').trim()}
function geometryLines(geometry){if(!geometry)return[];if(geometry.type==='LineString'&&Array.isArray(geometry.coordinates))return[geometry.coordinates];if(geometry.type==='MultiLineString'&&Array.isArray(geometry.coordinates))return geometry.coordinates;return[]}
function distanceToLineMeters(point,coords){
  if(!point||!Array.isArray(coords)||!coords.length)return Infinity;
  if(coords.length===1)return distanceMeters(point,{lng:+coords[0][0],lat:+coords[0][1]});
  const lat0=point.lat*Math.PI/180,mx=111320*Math.cos(lat0),my=111320;let best=Infinity;
  for(let i=0;i<coords.length-1;i++){
    const a=coords[i],b=coords[i+1];if(!a||!b)continue;
    const ax=(+a[0]-point.lng)*mx,ay=(+a[1]-point.lat)*my,bx=(+b[0]-point.lng)*mx,by=(+b[1]-point.lat)*my;
    const vx=bx-ax,vy=by-ay,den=vx*vx+vy*vy,t=den?clamp(-(ax*vx+ay*vy)/den,0,1):0,x=ax+vx*t,y=ay+vy*t;best=Math.min(best,Math.hypot(x,y));
  }
  return best;
}
function routeIndexMargins(){
  const direct=state.start&&state.goal?distanceMeters(state.start,state.goal):0;
  const adaptive=clamp(Math.round(direct*.8),2600,6000);
  return [...new Set([...ROUTE_INDEX_BASE_MARGINS,adaptive])].sort((a,b)=>a-b);
}
function indexBounds(marginM){
  const midLat=(state.start.lat+state.goal.lat)/2,latPad=marginM/111320,lngPad=marginM/(111320*Math.max(.2,Math.cos(midLat*Math.PI/180)));
  const west=Math.min(state.start.lng,state.goal.lng)-lngPad,east=Math.max(state.start.lng,state.goal.lng)+lngPad,south=Math.min(state.start.lat,state.goal.lat)-latPad,north=Math.max(state.start.lat,state.goal.lat)+latPad;
  return new maplibregl.LngLatBounds([west,south],[east,north]);
}
async function ensureMapillaryRouteIndex(){
  if(!state.map)throw new Error('地図を初期化できていません');
  const t=token();if(!t)throw new Error('Mapillary Access Tokenが未設定です');
  if(state.map.getSource(MLY_INDEX_SOURCE)&&routeIndexToken===t)return true;
  if(routeIndexPromise)return routeIndexPromise;
  routeIndexPromise=(async()=>{
    if(!state.map.isStyleLoaded())await new Promise(resolve=>state.map.once('load',resolve));
    if(state.map.getLayer(MLY_INDEX_LAYER))state.map.removeLayer(MLY_INDEX_LAYER);
    if(state.map.getSource(MLY_INDEX_SOURCE))state.map.removeSource(MLY_INDEX_SOURCE);
    const url=`https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${encodeURIComponent(t)}`;
    state.map.addSource(MLY_INDEX_SOURCE,{type:'vector',tiles:[url],minzoom:6,maxzoom:14,attribution:'© Mapillary'});
    state.map.addLayer({id:MLY_INDEX_LAYER,type:'line',source:MLY_INDEX_SOURCE,'source-layer':'sequence',minzoom:6,paint:{'line-color':'#7cf2c8','line-width':14,'line-opacity':0.001}});
    routeIndexToken=t;return true;
  })().finally(()=>{routeIndexPromise=null});
  return routeIndexPromise;
}
async function waitForRouteIndex(timeout=ROUTE_INDEX_WAIT_MS){const start=performance.now();await sleep(40);while(performance.now()-start<timeout){try{if(state.map.isSourceLoaded(MLY_INDEX_SOURCE))return true}catch{}await sleep(60)}return false}
function collectIndexCandidates(features,margin){
  const groups=new Map();
  for(const feature of features||[]){
    const sid=mapillaryIndexFeatureId(feature);if(!sid)continue;
    let item=groups.get(sid);if(!item)groups.set(sid,item={sequenceId:sid,startDistance:Infinity,goalDistance:Infinity,segments:0,margin});
    for(const line of geometryLines(feature.geometry)){item.startDistance=Math.min(item.startDistance,distanceToLineMeters(state.start,line));item.goalDistance=Math.min(item.goalDistance,distanceToLineMeters(state.goal,line));item.segments++}
  }
  const limit=Math.min(ROUTE_INDEX_ENDPOINT_LIMIT,Math.max(1200,margin+700)),out=[];
  for(const item of groups.values()){
    if(item.startDistance>limit||item.goalDistance>limit)continue;
    item.score=item.startDistance+item.goalDistance-Math.min(120,item.segments*3);out.push(item);
  }
  out.sort((a,b)=>a.score-b.score);return out.slice(0,ROUTE_INDEX_CANDIDATE_MAX);
}
async function queryRouteIndex(margin){
  await ensureMapillaryRouteIndex();state.routeSearchRadiusM=margin;
  updateRouteSearchCard?.(`Mapillary撮影ルート索引を確認中… 周囲 ${margin}m`,Math.min(62,14+margin/90));
  state.map.fitBounds(indexBounds(margin),{padding:{top:92,bottom:190,left:30,right:30},duration:0,maxZoom:14});
  await waitForRouteIndex();
  let features=[];try{features=state.map.querySourceFeatures(MLY_INDEX_SOURCE,{sourceLayer:'sequence'})||[]}catch{}
  if(!features.length){await Promise.race([new Promise(resolve=>state.map.once('idle',resolve)),sleep(700)]);try{features=state.map.querySourceFeatures(MLY_INDEX_SOURCE,{sourceLayer:'sequence'})||[]}catch{}}
  return{features,candidates:collectIndexCandidates(features,margin)};
}
async function findRouteIndexCandidates(){
  const t0=performance.now();state.routeSearchCandidates=0;let best=[];
  for(const margin of routeIndexMargins()){
    const result=await queryRouteIndex(margin);
    if(result.candidates.length){best=result.candidates;state.routeSearchCandidates=best.length;state.routeSearchMs=performance.now()-t0;return best}
  }
  state.routeSearchMs=performance.now()-t0;return best;
}
async function resolveRouteBetweenPoints(){
  const cached=loadRouteCache();
  if(cached){state.routeCacheHit=true;state.totalDistanceM=cached.totalDistanceM||null;state.routeSearchMs=0;state.routeSearchApiRequests=0;state.routeSearchRadiusM=cached.searchRadiusM||0;return cached}
  state.routeCacheHit=false;
  const before=state.graphRequestCount,t0=performance.now(),seen=new Set();let best=null,totalCandidates=0;
  for(const margin of routeIndexMargins()){
    const result=await queryRouteIndex(margin),candidates=result.candidates.filter(c=>!seen.has(c.sequenceId));
    for(const c of candidates)seen.add(c.sequenceId);totalCandidates+=candidates.length;state.routeSearchCandidates=totalCandidates;
    if(!candidates.length)continue;
    updateRouteSearchCard?.(`周囲 ${margin}m: 候補 ${candidates.length}本。画像順序を確認しています…`,66);
    for(let i=0;i<Math.min(ROUTE_INDEX_EVALUATE_MAX,candidates.length);i++){
      updateRouteSearchCard?.(`周囲 ${margin}m / 候補 ${i+1}/${Math.min(ROUTE_INDEX_EVALUATE_MAX,candidates.length)} を確認中…`,68+i*3);
      best=await evaluateSequence(candidates[i].sequenceId,candidates[i]);if(best)break;
    }
    if(best)break;
  }
  state.routeSearchMs=performance.now()-t0;state.routeSearchApiRequests=state.graphRequestCount-before;
  if(!best)throw new Error(totalCandidates?'近い撮影ルートでは接続できなかったため最大6kmまで広げましたが、出発→到着区間を確定できませんでした':'最大6kmまで撮影ルート索引を広げましたが、同一sequenceが見つかりませんでした');
  state.routeResolveMs=performance.now()-t0;saveRouteCache(best);return best;
}

const FALLBACK_POIS=[
  {name:'清水寺',type:'attraction',lat:34.99486,lng:135.78505},{name:'伏見稲荷大社',type:'attraction',lat:34.96714,lng:135.77267},{name:'金閣寺',type:'attraction',lat:35.03937,lng:135.72924},{name:'嵐山・渡月橋',type:'attraction',lat:35.01362,lng:135.67778},{name:'京都御苑',type:'attraction',lat:35.02542,lng:135.76212},{name:'大文字山',type:'peak',lat:35.02275,lng:135.81137},{name:'愛宕山',type:'peak',lat:35.06042,lng:135.63436},{name:'比叡山',type:'peak',lat:35.06534,lng:135.83462}
];
function poiType(tags){if(tags?.natural==='peak')return'peak';if(tags?.tourism==='viewpoint')return'viewpoint';return'attraction'}
function poiBoundsKey(bounds){return[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()].map(v=>v.toFixed(2)).join(':')}
async function fetchPOIs(bounds,signal){
  const key=poiBoundsKey(bounds);if(poiMemoryCache.has(key))return poiMemoryCache.get(key);
  const s=bounds.getSouth(),w=bounds.getWest(),n=bounds.getNorth(),e=bounds.getEast(),q=`[out:json][timeout:7];(node["tourism"~"attraction|viewpoint"]["name"](${s},${w},${n},${e});way["tourism"~"attraction|viewpoint"]["name"](${s},${w},${n},${e});relation["tourism"~"attraction|viewpoint"]["name"](${s},${w},${n},${e});node["natural"="peak"]["name"](${s},${w},${n},${e}););out center 60;`;
  try{
    const res=await fetch(`${OVERPASS}?data=${encodeURIComponent(q)}`,{signal}),j=await res.json();
    const rows=(j.elements||[]).map(x=>({name:x.tags?.name,type:poiType(x.tags),lat:Number(x.lat??x.center?.lat),lng:Number(x.lon??x.center?.lon),tags:x.tags||{}})).filter(p=>p.name&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)).sort((a,b)=>((b.tags?.wikipedia?3:0)+(b.tags?.wikidata?2:0)+(b.type==='peak'?1:0))-((a.tags?.wikipedia?3:0)+(a.tags?.wikidata?2:0)+(a.type==='peak'?1:0))).slice(0,36);
    poiMemoryCache.set(key,rows);if(poiMemoryCache.size>8)poiMemoryCache.delete(poiMemoryCache.keys().next().value);return rows;
  }catch(error){if(error?.name==='AbortError')throw error;return[]}
}
async function searchLocation(query){if(!query.trim())return null;const res=await fetch(`${NOMINATIM}?format=jsonv2&limit=5&accept-language=ja&q=${encodeURIComponent(query.trim())}`);const rows=await res.json();return(rows||[]).map(r=>({name:r.display_name,lat:+r.lat,lng:+r.lon,type:r.type})).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lng))}
async function loadElevationProfile(route){
  state.elevationLoading=true;state.elevationError=null;
  try{
    const frames=route.frames,lats=frames.map(f=>f.lat.toFixed(5)).join(','),lngs=frames.map(f=>f.lng.toFixed(5)).join(','),res=await fetch(`${ELEVATION_API}?latitude=${encodeURIComponent(lats)}&longitude=${encodeURIComponent(lngs)}`),j=await res.json();
    if(!Array.isArray(j.elevation)||j.elevation.length!==frames.length)throw new Error('標高データ不足');
    let ascent=0,descent=0;for(let i=0;i<frames.length;i++){frames[i].elevation=Number(j.elevation[i]);if(i){const d=frames[i].elevation-frames[i-1].elevation;if(d>0)ascent+=d;else descent-=d}}
    route.elevations=frames.map(f=>f.elevation);state.totalAscentM=ascent;state.totalDescentM=descent;state.durationSec=estimateDurationSec(route.totalDistanceM,ascent);return route.elevations;
  }catch(e){state.elevationError=String(e?.message||e);route.elevations=[];state.totalAscentM=0;state.totalDescentM=0;state.durationSec=estimateDurationSec(route.totalDistanceM,0);return[]}
  finally{state.elevationLoading=false}
}
function primeMapillaryRouteIndex(){if(!state.map||!token())return;ensureMapillaryRouteIndex().catch(()=>{})}
addEventListener('load',()=>setTimeout(primeMapillaryRouteIndex,0),{once:true});
