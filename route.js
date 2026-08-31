async function graph(path){const t=token();if(!t)throw new Error('Mapillary Access Tokenが未設定です');const sep=path.includes('?')?'&':'?';const res=await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(t)}`,{cache:'no-store'});const data=await res.json().catch(()=>({}));if(!res.ok||data?.error)throw new Error(data?.error?.message||`Mapillary API ${res.status}`);return data}
async function metadata(ids,fields='id,sequence,computed_geometry,compass_angle,computed_compass_angle,is_pano'){
  const out=new Map(),unique=[...new Set(ids.map(String).filter(Boolean))];
  for(let i=0;i<unique.length;i+=48){const part=unique.slice(i,i+48),data=await graph(`/images?image_ids=${encodeURIComponent(part.join(','))}&limit=${part.length}&fields=${encodeURIComponent(fields)}`);for(const m of data?.data||[])out.set(String(m.id),m)}
  return out;
}
async function orderedIds(sequenceId){const data=await graph(`/image_ids?sequence_id=${encodeURIComponent(sequenceId)}`);return(data?.data||[]).map(x=>String(x?.id??x)).filter(Boolean)}
function sampleIds(ids,target=TARGET_FRAMES){if(ids.length<=target)return ids.slice();const out=[],used=new Set(),step=(ids.length-1)/(target-1);for(let i=0;i<target;i++){const id=ids[Math.round(i*step)];if(id&&!used.has(id)){used.add(id);out.push(id)}}return out}
async function locateEndpoints(ids){
  if(ids.length<2)return null;const count=Math.min(28,ids.length),indexes=[];for(let i=0;i<count;i++)indexes.push(Math.round(i*(ids.length-1)/Math.max(1,count-1)));
  const coarse=await metadata(indexes.map(i=>ids[i]),'id,computed_geometry');let startIndex=-1,goalIndex=-1,startD=Infinity,goalD=Infinity;
  for(const i of indexes){const p=pointOf(coarse.get(ids[i]));if(!p)continue;const ds=distanceMeters(state.start,p),dg=distanceMeters(state.goal,p);if(ds<startD){startD=ds;startIndex=i}if(dg<goalD){goalD=dg;goalIndex=i}}
  if(startIndex<0||goalIndex<0)return null;const refine=new Set();for(const center of[startIndex,goalIndex])for(let i=Math.max(0,center-12);i<=Math.min(ids.length-1,center+12);i++)refine.add(i);
  const fine=await metadata([...refine].map(i=>ids[i]),'id,computed_geometry');startD=Infinity;goalD=Infinity;
  for(const i of refine){const p=pointOf(fine.get(ids[i]));if(!p)continue;const ds=distanceMeters(state.start,p),dg=distanceMeters(state.goal,p);if(ds<startD){startD=ds;startIndex=i}if(dg<goalD){goalD=dg;goalIndex=i}}
  return{startIndex,goalIndex,startD,goalD};
}
function decorateRoute(route){
  let total=0;for(let i=0;i<route.frames.length;i++){const f=route.frames[i];if(i){const step=distanceMeters(route.frames[i-1],f);f.stepDistanceM=step;total+=step}else f.stepDistanceM=0;f.distanceFromStartM=total}
  route.totalDistanceM=total||distanceMeters(state.start,state.goal);for(const f of route.frames){f.routeProgress=route.totalDistanceM?f.distanceFromStartM/route.totalDistanceM:0;f.remainingDistanceM=Math.max(0,route.totalDistanceM-f.distanceFromStartM);f.routeDistance=0}
  state.totalDistanceM=route.totalDistanceM;return route;
}
async function evaluateSequence(sequenceId,hintScore=0){
  try{const ids=await orderedIds(sequenceId);if(ids.length<2)return null;const loc=await locateEndpoints(ids);if(!loc||loc.startD>ENDPOINT_LIMIT||loc.goalD>ENDPOINT_LIMIT||loc.startIndex===loc.goalIndex)return null;const sign=loc.goalIndex>loc.startIndex?1:-1,dense=[];for(let i=loc.startIndex;;i+=sign){dense.push(ids[i]);if(i===loc.goalIndex)break}if(dense.length<6)return null;
    const chosen=sampleIds(dense,TARGET_FRAMES),metas=await metadata(chosen),frames=[];for(const id of chosen){const m=metas.get(id),p=pointOf(m);if(!p)continue;frames.push({id,sequenceId,lat:p.lat,lng:p.lng,routeProgress:0,routeDistance:0,isPano:!!m?.is_pano,compass:Number.isFinite(+m?.computed_compass_angle)?+m.computed_compass_angle:(Number.isFinite(+m?.compass_angle)?+m.compass_angle:null)})}
    if(frames.length<6)return null;const route={sequenceId,direction:sign>0?'Next':'Prev',frames,startDistance:loc.startD,goalDistance:loc.goalD,denseFrameCount:dense.length,pano:frames.filter(f=>f.isPano).length,score:hintScore*80+frames.length*30-loc.startD-loc.goalD};return decorateRoute(route)
  }catch{return null}
}
async function resolveRoute(){
  const cached=loadRouteCache();if(cached){state.routeCacheHit=true;state.totalDistanceM=cached.totalDistanceM||null;return cached}state.routeCacheHit=false;const t0=performance.now();let best=null;
  if(state.selectedCandidateId)best=await evaluateSequence(state.selectedCandidateId,99);
  if(!best){const fields='id,sequence,computed_geometry,is_pano',data=await graph(`/images?bbox=${encodeURIComponent(pointBbox(state.goal,160))}&limit=60&fields=${encodeURIComponent(fields)}`),hints=new Map();for(const row of data?.data||[]){const sid=sequenceOf(row?.sequence);if(!sid)continue;let h=hints.get(sid);if(!h)hints.set(sid,h={id:sid,hits:0,pano:0});h.hits++;if(row?.is_pano)h.pano++}const candidates=[...hints.values()].sort((a,b)=>(b.hits-a.hits)||(b.pano-a.pano)).slice(0,8);const evaluated=[];for(let i=0;i<candidates.length;i+=3){const rows=await Promise.all(candidates.slice(i,i+3).map(h=>evaluateSequence(h.id,h.hits+h.pano)));for(const x of rows)if(x)evaluated.push(x)}evaluated.sort((a,b)=>b.score-a.score);best=evaluated[0]}
  if(!best)throw new Error('出発→到着へ進むMapillary sequenceを確定できませんでした');state.routeResolveMs=performance.now()-t0;saveRouteCache(best);return best
}
async function candidateLine(sequenceId,goal){
  const ids=await orderedIds(sequenceId);if(ids.length<4)return null;const count=Math.min(30,ids.length),idx=[];for(let i=0;i<count;i++)idx.push(Math.round(i*(ids.length-1)/(count-1)));const coarse=await metadata(idx.map(i=>ids[i]),'id,computed_geometry,is_pano');let nearest=-1,d=Infinity,pano=0;for(const i of idx){const m=coarse.get(ids[i]),p=pointOf(m);if(!p)continue;const x=distanceMeters(goal,p);if(x<d){d=x;nearest=i}if(m?.is_pano)pano++}if(nearest<0||d>220)return null;const lo=Math.max(0,nearest-100),hi=Math.min(ids.length-1,nearest+100),windowIds=ids.slice(lo,hi+1),chosen=sampleIds(windowIds,90),mm=await metadata(chosen,'id,computed_geometry,is_pano'),coords=[];for(const id of chosen){const p=pointOf(mm.get(id));if(p)coords.push([p.lng,p.lat])}if(coords.length<5)return null;return{sequenceId,coords,goalDistance:d,pano,images:ids.length}
}
async function discoverCandidateRoutes(goal){
  const data=await graph(`/images?bbox=${encodeURIComponent(pointBbox(goal,170))}&limit=80&fields=${encodeURIComponent('id,sequence,computed_geometry,is_pano')}`),hints=new Map();for(const row of data?.data||[]){const sid=sequenceOf(row.sequence);if(!sid)continue;let h=hints.get(sid);if(!h)hints.set(sid,h={id:sid,hits:0,pano:0});h.hits++;if(row.is_pano)h.pano++}const ranked=[...hints.values()].sort((a,b)=>(b.hits-a.hits)||(b.pano-a.pano)).slice(0,6),routes=[];for(let i=0;i<ranked.length;i+=3){const group=await Promise.all(ranked.slice(i,i+3).map(h=>candidateLine(h.id,goal)));for(const r of group)if(r)routes.push(r);if(routes.length>=4)break}return routes.sort((a,b)=>a.goalDistance-b.goalDistance).slice(0,4)
}
const FALLBACK_POIS=[
  {name:'清水寺',type:'attraction',lat:34.99486,lng:135.78505},{name:'伏見稲荷大社',type:'attraction',lat:34.96714,lng:135.77267},{name:'金閣寺',type:'attraction',lat:35.03937,lng:135.72924},{name:'嵐山・渡月橋',type:'attraction',lat:35.01362,lng:135.67778},{name:'京都御苑',type:'attraction',lat:35.02542,lng:135.76212},{name:'大文字山',type:'peak',lat:35.02275,lng:135.81137},{name:'愛宕山',type:'peak',lat:35.06042,lng:135.63436},{name:'比叡山',type:'peak',lat:35.06534,lng:135.83462}
];
function poiType(tags){if(tags?.natural==='peak')return'peak';if(tags?.tourism==='viewpoint')return'viewpoint';return'attraction'}
async function fetchPOIs(bounds){
  const key=[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()].map(v=>v.toFixed(2)).join(':');if(key===state.poiCacheKey)return[];state.poiCacheKey=key;const s=bounds.getSouth(),w=bounds.getWest(),n=bounds.getNorth(),e=bounds.getEast(),q=`[out:json][timeout:10];(node["tourism"~"attraction|viewpoint"]["name"](${s},${w},${n},${e});way["tourism"~"attraction|viewpoint"]["name"](${s},${w},${n},${e});relation["tourism"~"attraction|viewpoint"]["name"](${s},${w},${n},${e});node["natural"="peak"]["name"](${s},${w},${n},${e}););out center 80;`;
  try{const res=await fetch(`${OVERPASS}?data=${encodeURIComponent(q)}`),j=await res.json();return(j.elements||[]).map(x=>({name:x.tags?.name,type:poiType(x.tags),lat:Number(x.lat??x.center?.lat),lng:Number(x.lon??x.center?.lon),tags:x.tags||{}})).filter(p=>p.name&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)).sort((a,b)=>((b.tags?.wikipedia?3:0)+(b.tags?.wikidata?2:0)+(b.type==='peak'?1:0))-((a.tags?.wikipedia?3:0)+(a.tags?.wikidata?2:0)+(a.type==='peak'?1:0))).slice(0,40)}catch{return[]}
}
async function searchLocation(query){if(!query.trim())return null;const res=await fetch(`${NOMINATIM}?format=jsonv2&limit=5&accept-language=ja&q=${encodeURIComponent(query.trim())}`);const rows=await res.json();return(rows||[]).map(r=>({name:r.display_name,lat:+r.lat,lng:+r.lon,type:r.type})).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lng))}
async function loadElevationProfile(route){
  state.elevationLoading=true;state.elevationError=null;try{const frames=route.frames,lats=frames.map(f=>f.lat.toFixed(5)).join(','),lngs=frames.map(f=>f.lng.toFixed(5)).join(','),res=await fetch(`${ELEVATION_API}?latitude=${encodeURIComponent(lats)}&longitude=${encodeURIComponent(lngs)}`),j=await res.json();if(!Array.isArray(j.elevation)||j.elevation.length!==frames.length)throw new Error('標高データ不足');let ascent=0,descent=0;for(let i=0;i<frames.length;i++){frames[i].elevation=Number(j.elevation[i]);if(i){const d=frames[i].elevation-frames[i-1].elevation;if(d>0)ascent+=d;else descent-=d}}route.elevations=frames.map(f=>f.elevation);state.totalAscentM=ascent;state.totalDescentM=descent;state.durationSec=estimateDurationSec(route.totalDistanceM,ascent);return route.elevations}catch(e){state.elevationError=String(e?.message||e);route.elevations=[];state.totalAscentM=0;state.totalDescentM=0;state.durationSec=estimateDurationSec(route.totalDistanceM,0);return[]}finally{state.elevationLoading=false}
}
