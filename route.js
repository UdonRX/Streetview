async function graph(path){const t=token();if(!t)throw new Error('Mapillary Access Tokenが未設定です');const sep=path.includes('?')?'&':'?';const res=await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(t)}`,{cache:'no-store'});const data=await res.json().catch(()=>({}));if(!res.ok||data?.error)throw new Error(data?.error?.message||`Mapillary API ${res.status}`);return data}
async function metadata(ids,fields='id,sequence,computed_geometry,compass_angle,computed_compass_angle,is_pano'){
  const out=new Map(),unique=[...new Set(ids.map(String).filter(Boolean))];
  for(let i=0;i<unique.length;i+=48){const part=unique.slice(i,i+48),data=await graph(`/images?image_ids=${encodeURIComponent(part.join(','))}&limit=${part.length}&fields=${encodeURIComponent(fields)}`);for(const m of data?.data||[])out.set(String(m.id),m)}
  return out;
}
async function orderedIds(sequenceId){const data=await graph(`/image_ids?sequence_id=${encodeURIComponent(sequenceId)}`);return(data?.data||[]).map(x=>String(x?.id??x)).filter(Boolean)}
function sampleIds(ids,target=TARGET_FRAMES){if(ids.length<=target)return ids.slice();const out=[],used=new Set(),step=(ids.length-1)/(target-1);for(let i=0;i<target;i++){const id=ids[Math.round(i*step)];if(id&&!used.has(id)){used.add(id);out.push(id)}}return out}
async function locateEndpoints(ids){
  if(ids.length<2)return null;
  const count=Math.min(24,ids.length),indexes=[];for(let i=0;i<count;i++)indexes.push(Math.round(i*(ids.length-1)/Math.max(1,count-1)));
  const coarse=await metadata(indexes.map(i=>ids[i]),'id,computed_geometry');let startIndex=-1,goalIndex=-1,startD=Infinity,goalD=Infinity;
  for(const i of indexes){const p=pointOf(coarse.get(ids[i]));if(!p)continue;const ds=distanceMeters(state.start,p),dg=distanceMeters(state.goal,p);if(ds<startD){startD=ds;startIndex=i}if(dg<goalD){goalD=dg;goalIndex=i}}
  if(startIndex<0||goalIndex<0)return null;
  const refine=new Set();for(const center of[startIndex,goalIndex])for(let i=Math.max(0,center-10);i<=Math.min(ids.length-1,center+10);i++)refine.add(i);
  const fine=await metadata([...refine].map(i=>ids[i]),'id,computed_geometry');startD=Infinity;goalD=Infinity;
  for(const i of refine){const p=pointOf(fine.get(ids[i]));if(!p)continue;const ds=distanceMeters(state.start,p),dg=distanceMeters(state.goal,p);if(ds<startD){startD=ds;startIndex=i}if(dg<goalD){goalD=dg;goalIndex=i}}
  return{startIndex,goalIndex,startD,goalD};
}
async function evaluateSequence(sequenceId,hintScore=0){
  try{
    const ids=await orderedIds(sequenceId);if(ids.length<2)return null;
    const loc=await locateEndpoints(ids);if(!loc||loc.startD>ENDPOINT_LIMIT||loc.goalD>ENDPOINT_LIMIT||loc.startIndex===loc.goalIndex)return null;
    const sign=loc.goalIndex>loc.startIndex?1:-1,dense=[];for(let i=loc.startIndex;;i+=sign){dense.push(ids[i]);if(i===loc.goalIndex)break}
    if(dense.length<8)return null;
    const chosen=sampleIds(dense,TARGET_FRAMES),metas=await metadata(chosen),frames=[];
    for(const id of chosen){const m=metas.get(id),p=pointOf(m);if(!p)continue;const rm=routeMetrics(p);frames.push({id,sequenceId,lat:p.lat,lng:p.lng,routeProgress:rm.progress,routeDistance:rm.distance,isPano:!!m?.is_pano,compass:Number.isFinite(+m?.computed_compass_angle)?+m.computed_compass_angle:(Number.isFinite(+m?.compass_angle)?+m.compass_angle:null)})}
    if(frames.length<8)return null;
    const gain=frames.at(-1).routeProgress-frames[0].routeProgress;if(gain<.12)return null;
    const onRoute=frames.filter(f=>f.routeDistance<=MAX_ROUTE_DISTANCE).length;if(onRoute<Math.ceil(frames.length*.7))return null;
    const pano=frames.filter(f=>f.isPano).length;
    return{sequenceId,direction:sign>0?'Next':'Prev',frames,startDistance:loc.startD,goalDistance:loc.goalD,denseFrameCount:dense.length,pano,progressGain:gain,score:hintScore*80+frames.length*30+pano*2+gain*220-loc.startD-loc.goalD};
  }catch{return null}
}
async function resolveRoute(){
  const cached=loadRouteCache();if(cached){state.routeCacheHit=true;return cached}
  state.routeCacheHit=false;const t0=performance.now();
  const stops=[0,.25,.5,.75,1],queries=stops.map(async(stop,si)=>{const p=interpolate(state.start,state.goal,stop);const fields='id,sequence,computed_geometry,is_pano';const data=await graph(`/images?bbox=${encodeURIComponent(pointBbox(p))}&limit=20&fields=${encodeURIComponent(fields)}`);return{si,rows:data?.data||[]}});
  const results=await Promise.allSettled(queries),hints=new Map();
  for(const r of results){if(r.status!=='fulfilled')continue;for(const row of r.value.rows){const sid=sequenceOf(row?.sequence),p=pointOf(row);if(!sid||!p||routeMetrics(p).distance>MAX_ROUTE_DISTANCE)continue;let h=hints.get(sid);if(!h)hints.set(sid,h={id:sid,stops:new Set(),hits:0,pano:0});h.stops.add(r.value.si);h.hits++;if(row?.is_pano)h.pano++}}
  const candidates=[...hints.values()].sort((a,b)=>(b.stops.size-a.stops.size)||(b.hits-a.hits)||(b.pano-a.pano)).slice(0,9);
  if(!candidates.length)throw new Error('指定ルート付近にMapillary sequenceが見つかりませんでした');
  const evaluated=[];for(let i=0;i<candidates.length;i+=3){const group=candidates.slice(i,i+3);const rows=await Promise.all(group.map(h=>evaluateSequence(h.id,h.stops.size*3+h.hits)));for(const x of rows)if(x)evaluated.push(x);if(evaluated.some(x=>x.frames.length>=TARGET_FRAMES&&x.startDistance<80&&x.goalDistance<80))break}
  evaluated.sort((a,b)=>b.score-a.score);const best=evaluated[0];if(!best)throw new Error('出発→到着へ進むsequenceをGPSで確定できませんでした');
  state.routeResolveMs=performance.now()-t0;saveRouteCache(best);return best;
}
