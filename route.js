const graphMemo=new Map();
async function graph(path){
  const t=token();if(!t)throw new Error('Mapillary Access Tokenが未設定です');
  const key=`${t.slice(-12)}:${path}`;if(graphMemo.has(key))return graphMemo.get(key);
  state.graphRequestCount++;const sep=path.includes('?')?'&':'?';
  const p=fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(t)}`,{cache:'no-store'}).then(async res=>{const data=await res.json().catch(()=>({}));if(!res.ok||data?.error)throw new Error(data?.error?.message||`Mapillary API ${res.status}`);return data}).catch(e=>{graphMemo.delete(key);throw e});
  graphMemo.set(key,p);return p;
}
async function metadata(ids,fields='id,sequence,computed_geometry,compass_angle,computed_compass_angle,is_pano'){
  const out=new Map(),unique=[...new Set(ids.map(String).filter(Boolean))];
  for(let i=0;i<unique.length;i+=48){const part=unique.slice(i,i+48),data=await graph(`/images?image_ids=${encodeURIComponent(part.join(','))}&limit=${part.length}&fields=${encodeURIComponent(fields)}`);for(const m of data?.data||[])out.set(String(m.id),m)}
  return out;
}
async function orderedIds(sequenceId){const data=await graph(`/image_ids?sequence_id=${encodeURIComponent(sequenceId)}`);return(data?.data||[]).map(x=>String(x?.id??x)).filter(Boolean)}
function sampleIds(ids,target=TARGET_FRAMES){if(ids.length<=target)return ids.slice();const out=[],used=new Set(),step=(ids.length-1)/(target-1);for(let i=0;i<target;i++){const id=ids[Math.round(i*step)];if(id&&!used.has(id)){used.add(id);out.push(id)}}return out}
async function refineEndpointIndexes(ids,startIndex,goalIndex){
  const refine=new Set();for(const center of[startIndex,goalIndex])for(let i=Math.max(0,center-6);i<=Math.min(ids.length-1,center+6);i++)refine.add(i);
  const fine=await metadata([...refine].map(i=>ids[i]),'id,computed_geometry');let bestStart=startIndex,bestGoal=goalIndex,startD=Infinity,goalD=Infinity;
  for(const i of refine){const p=pointOf(fine.get(ids[i]));if(!p)continue;const ds=distanceMeters(state.start,p),dg=distanceMeters(state.goal,p);if(ds<startD){startD=ds;bestStart=i}if(dg<goalD){goalD=dg;bestGoal=i}}
  return{startIndex:bestStart,goalIndex:bestGoal,startD,goalD};
}
async function locateEndpoints(ids,startHintId,goalHintId){
  if(ids.length<2)return null;let startIndex=ids.indexOf(String(startHintId||'')),goalIndex=ids.indexOf(String(goalHintId||''));
  if(startIndex>=0&&goalIndex>=0&&startIndex!==goalIndex)return refineEndpointIndexes(ids,startIndex,goalIndex);
  const count=Math.min(18,ids.length),indexes=[];for(let i=0;i<count;i++)indexes.push(Math.round(i*(ids.length-1)/Math.max(1,count-1)));
  const coarse=await metadata(indexes.map(i=>ids[i]),'id,computed_geometry');let startD=Infinity,goalD=Infinity;startIndex=-1;goalIndex=-1;
  for(const i of indexes){const p=pointOf(coarse.get(ids[i]));if(!p)continue;const ds=distanceMeters(state.start,p),dg=distanceMeters(state.goal,p);if(ds<startD){startD=ds;startIndex=i}if(dg<goalD){goalD=dg;goalIndex=i}}
  if(startIndex<0||goalIndex<0||startIndex===goalIndex)return null;return refineEndpointIndexes(ids,startIndex,goalIndex);
}
function decorateRoute(route){
  let total=0;for(let i=0;i<route.frames.length;i++){const f=route.frames[i];if(i){const step=distanceMeters(route.frames[i-1],f);f.stepDistanceM=step;total+=step}else f.stepDistanceM=0;f.distanceFromStartM=total}
  route.totalDistanceM=total||distanceMeters(state.start,state.goal);for(const f of route.frames){f.routeProgress=route.totalDistanceM?f.distanceFromStartM/route.totalDistanceM:0;f.remainingDistanceM=Math.max(0,route.totalDistanceM-f.distanceFromStartM);f.routeDistance=0}
  state.totalDistanceM=route.totalDistanceM;return route;
}
async function evaluateSequence(sequenceId,hint){
  try{
    const ids=await orderedIds(sequenceId);if(ids.length<2)return null;
    const hintedStart=ids.indexOf(String(hint.startImageId||'')),hintedGoal=ids.indexOf(String(hint.goalImageId||''));
    const loc=hintedStart>=0&&hintedGoal>=0&&hintedStart!==hintedGoal?{startIndex:hintedStart,goalIndex:hintedGoal,startD:hint.startDistance,goalD:hint.goalDistance}:await locateEndpoints(ids,hint.startImageId,hint.goalImageId);
    if(!loc||loc.startD>ENDPOINT_LIMIT||loc.goalD>ENDPOINT_LIMIT||loc.startIndex===loc.goalIndex)return null;
    const sign=loc.goalIndex>loc.startIndex?1:-1,dense=[];for(let i=loc.startIndex;;i+=sign){dense.push(ids[i]);if(i===loc.goalIndex)break}if(dense.length<4)return null;
    const chosen=sampleIds(dense,TARGET_FRAMES),metas=await metadata(chosen),frames=[];
    for(const id of chosen){const m=metas.get(id),p=pointOf(m);if(!p)continue;frames.push({id,sequenceId,lat:p.lat,lng:p.lng,routeProgress:0,routeDistance:0,isPano:!!m?.is_pano,compass:Number.isFinite(+m?.computed_compass_angle)?+m.computed_compass_angle:(Number.isFinite(+m?.compass_angle)?+m.compass_angle:null)})}
    if(frames.length<4)return null;
    const route={sequenceId,direction:sign>0?'Next':'Prev',frames,startDistance:loc.startD,goalDistance:loc.goalD,denseFrameCount:dense.length,pano:frames.filter(f=>f.isPano).length,searchRadiusM:hint.radius,score:frames.length*30-loc.startD-loc.goalD};
    return decorateRoute(route);
  }catch{return null}
}
async function endpointRows(point,radius){
  const fields='id,sequence,captured_at,computed_geometry,is_pano';
  const data=await graph(`/images?bbox=${encodeURIComponent(pointBbox(point,radius))}&limit=${ENDPOINT_SEARCH_LIMIT}&fields=${encodeURIComponent(fields)}`);
  return data?.data||[];
}
function endpointHints(rows,point){
  const map=new Map();for(const row of rows){const sid=sequenceOf(row.sequence),p=pointOf(row);if(!sid||!p)continue;const d=distanceMeters(point,p);let h=map.get(sid);if(!h)map.set(sid,h={sequenceId:sid,hits:0,pano:0,distance:Infinity,imageId:null});h.hits++;if(row.is_pano)h.pano++;if(d<h.distance){h.distance=d;h.imageId=String(row.id)}}return map;
}
async function findDirectSequenceCandidates(){
  const before=state.graphRequestCount,t0=performance.now();state.routeSearchCandidates=0;
  for(const radius of ENDPOINT_SEARCH_RADII){
    state.routeSearchRadiusM=radius;updateRouteSearchCard?.(`出発地・到着地の周囲 ${radius}m を検索中…`,Math.min(55,8+radius/10));
    const [startRows,goalRows]=await Promise.all([endpointRows(state.start,radius),endpointRows(state.goal,radius)]);
    const s=endpointHints(startRows,state.start),g=endpointHints(goalRows,state.goal),common=[];
    for(const [sid,sh] of s){const gh=g.get(sid);if(!gh)continue;common.push({sequenceId:sid,startImageId:sh.imageId,goalImageId:gh.imageId,startDistance:sh.distance,goalDistance:gh.distance,radius,hits:sh.hits+gh.hits,pano:sh.pano+gh.pano,score:sh.distance+gh.distance-(sh.hits+gh.hits)*2-(sh.pano+gh.pano)})}
    common.sort((a,b)=>a.score-b.score);if(common.length){state.routeSearchCandidates=common.length;state.routeSearchMs=performance.now()-t0;state.routeSearchApiRequests=state.graphRequestCount-before;return common.slice(0,ROUTE_CANDIDATE_MAX)}
  }
  state.routeSearchMs=performance.now()-t0;state.routeSearchApiRequests=state.graphRequestCount-before;return[];
}
async function resolveRouteBetweenPoints(){
  const cached=loadRouteCache();if(cached){state.routeCacheHit=true;state.totalDistanceM=cached.totalDistanceM||null;state.routeSearchMs=0;state.routeSearchApiRequests=0;state.routeSearchRadiusM=cached.searchRadiusM||0;return cached}
  state.routeCacheHit=false;const before=state.graphRequestCount,t0=performance.now(),candidates=await findDirectSequenceCandidates();if(!candidates.length)throw new Error('出発地と到着地の両方を通るMapillary sequenceが周囲に見つかりませんでした');
  updateRouteSearchCard?.('進行方向を確認しています…',68);
  let best=null;for(const candidate of candidates){best=await evaluateSequence(candidate.sequenceId,candidate);if(best)break}
  if(!best)throw new Error('候補sequenceは見つかりましたが、出発→到着方向の区間を確定できませんでした');
  state.routeResolveMs=performance.now()-t0;state.routeSearchApiRequests=state.graphRequestCount-before;saveRouteCache(best);return best;
}
const FALLBACK_POIS=[
  {name:'清水寺',type:'attraction',lat:34.99486,lng:135.78505},{name:'伏見稲荷大社',type:'attraction',lat:34.96714,lng:135.77267},{name:'金閣寺',type:'attraction',lat:35.03937,lng:135.72924},{name:'嵐山・渡月橋',type:'attraction',lat:35.01362,lng:135.67778},{name:'京都御苑',type:'attraction',lat:35.02542,lng:135.76212},{name:'大文字山',type:'peak',lat:35.02275,lng:135.81137},{name:'愛宕山',type:'peak',lat:35.06042,lng:135.63436},{name:'比叡山',type:'peak',lat:35.06534,lng:135.83462}
];
function poiType(tags){if(tags?.natural==='peak')return'peak';if(tags?.tourism==='viewpoint')return'viewpoint';return'attraction'}
async function fetchPOIs(bounds){
  const key=[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()].map(v=>v.toFixed(2)).join(':');if(key===state.poiCacheKey)return[];state.poiCacheKey=key;
  const s=bounds.getSouth(),w=bounds.getWest(),n=bounds.getNorth(),e=bounds.getEast(),q=`[out:json][timeout:10];(node["tourism"~"attraction|viewpoint"]["name"](${s},${w},${n},${e});way["tourism"~"attraction|viewpoint"]["name"](${s},${w},${n},${e});relation["tourism"~"attraction|viewpoint"]["name"](${s},${w},${n},${e});node["natural"="peak"]["name"](${s},${w},${n},${e}););out center 80;`;
  try{const res=await fetch(`${OVERPASS}?data=${encodeURIComponent(q)}`),j=await res.json();return(j.elements||[]).map(x=>({name:x.tags?.name,type:poiType(x.tags),lat:Number(x.lat??x.center?.lat),lng:Number(x.lon??x.center?.lon),tags:x.tags||{}})).filter(p=>p.name&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)).sort((a,b)=>((b.tags?.wikipedia?3:0)+(b.tags?.wikidata?2:0)+(b.type==='peak'?1:0))-((a.tags?.wikipedia?3:0)+(a.tags?.wikidata?2:0)+(a.type==='peak'?1:0))).slice(0,40)}catch{return[]}
}
async function searchLocation(query){if(!query.trim())return null;const res=await fetch(`${NOMINATIM}?format=jsonv2&limit=5&accept-language=ja&q=${encodeURIComponent(query.trim())}`);const rows=await res.json();return(rows||[]).map(r=>({name:r.display_name,lat:+r.lat,lng:+r.lon,type:r.type})).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lng))}
async function loadElevationProfile(route){
  state.elevationLoading=true;state.elevationError=null;
  try{const frames=route.frames,lats=frames.map(f=>f.lat.toFixed(5)).join(','),lngs=frames.map(f=>f.lng.toFixed(5)).join(','),res=await fetch(`${ELEVATION_API}?latitude=${encodeURIComponent(lats)}&longitude=${encodeURIComponent(lngs)}`),j=await res.json();if(!Array.isArray(j.elevation)||j.elevation.length!==frames.length)throw new Error('標高データ不足');let ascent=0,descent=0;for(let i=0;i<frames.length;i++){frames[i].elevation=Number(j.elevation[i]);if(i){const d=frames[i].elevation-frames[i-1].elevation;if(d>0)ascent+=d;else descent-=d}}route.elevations=frames.map(f=>f.elevation);state.totalAscentM=ascent;state.totalDescentM=descent;state.durationSec=estimateDurationSec(route.totalDistanceM,ascent);return route.elevations}
  catch(e){state.elevationError=String(e?.message||e);route.elevations=[];state.totalAscentM=0;state.totalDescentM=0;state.durationSec=estimateDurationSec(route.totalDistanceM,0);return[]}
  finally{state.elevationLoading=false}
}
