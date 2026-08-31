(() => {
  'use strict';

  const DEST_KEY = 'streetview:phase3-destination';
  const ROUTE_KEY = 'streetview:journey-route';
  const TEST_KEY = 'streetview:kyoto-test-route';
  const TOKEN_KEY = 'streetview:mapillary-token';
  const CACHE_KEY = 'streetview:kyoto-mapillary-fixed-routes:v3';
  const GRAPH = 'https://graph.mapillary.com';
  const SOURCE = 'kyoto-test-routes';
  const LINE = 'kyoto-test-route-lines';
  const POINTS = 'kyoto-test-route-points';
  const LABELS = 'kyoto-test-route-labels';

  const TARGET_FRAMES = 200;
  const MIN_FRAMES = 170;
  const MAX_FRAMES = 220;
  const INITIAL_FRAMES = 16;
  const META_BATCH = 16;
  const PROBE_BATCH = 12;
  const PROBE_COUNT = 24;
  const REFINE_RADIUS = 8;
  const LIGHT_FIELDS = 'id,sequence';
  const META_FIELDS = 'id,sequence,captured_at,computed_geometry,compass_angle,computed_compass_angle,thumb_256_url,thumb_1024_url,thumb_2048_url,is_pano';
  const PROFILE_BY_ID = Object.freeze({ road:'ROAD', sidewalk:'SIDEWALK', mountain:'MOUNTAIN', rail:'RAIL' });

  const prepared = new Map();
  const resolving = new Map();

  const routes = [
    {
      id:'road', profile:'ROAD', label:'道路', name:'烏丸通',
      start:{lat:35.01039,lng:135.75943,name:'烏丸御池'},
      end:{lat:35.00367,lng:135.75937,name:'四条烏丸'},
      maxEndpointM:850,
      seedSequenceId:'zq8vy4bui6shkiv29w5fp9'
    },
    {
      id:'sidewalk', profile:'SIDEWALK', label:'歩道', name:'鴨川遊歩道',
      start:{lat:35.00902,lng:135.77168,name:'三条大橋東岸'},
      end:{lat:35.00368,lng:135.77155,name:'四条大橋東岸'},
      maxEndpointM:900,
      seedSequenceId:'JPc0yiXf3nDrovBwm8gFHT',
      search:{stops:[0,.18,.36,.54,.72,.88,1],offsets:[0,18,-18,36,-36],cellRadius:12,limits:[8,5,3]}
    },
    {
      id:'mountain', profile:'MOUNTAIN', label:'山道', name:'伏見稲荷山',
      start:{lat:34.96720,lng:135.77322,name:'千本鳥居付近'},
      end:{lat:34.97055,lng:135.77920,name:'三ツ辻方面'},
      maxEndpointM:1300,
      search:{stops:[0,.2,.4,.6,.8,1],offsets:[0,24,-24,48,-48],cellRadius:14,limits:[8,5,3]}
    },
    {
      id:'rail', profile:'RAIL', label:'線路', name:'嵯峨野線',
      start:{lat:34.98758,lng:135.74245,name:'梅小路京都西'},
      end:{lat:34.99512,lng:135.74210,name:'丹波口'},
      maxEndpointM:1100,
      search:{stops:[0,.2,.4,.6,.8,1],offsets:[0,22,-22,44,-44],cellRadius:12,limits:[8,5,3]}
    }
  ];

  const $ = id => document.getElementById(id);
  const status = text => { const el = $('testRouteStatus'); if (el) el.textContent = text; };
  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function loadCache() {
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch { return {}; }
  }
  function saveCache(value) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch {} }
  function validFixed(fixed) {
    const count = Array.isArray(fixed?.imageRefs) ? fixed.imageRefs.length : (Array.isArray(fixed?.imageIds) ? fixed.imageIds.length : 0);
    return !!fixed?.sequenceId && count >= MIN_FRAMES && count <= MAX_FRAMES;
  }

  function distanceMeters(a, b) {
    const r = Math.PI / 180;
    const p1 = Number(a.lat) * r, p2 = Number(b.lat) * r;
    const dp = (Number(b.lat) - Number(a.lat)) * r;
    const dl = (Number(b.lng) - Number(a.lng)) * r;
    const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 12742000 * Math.atan2(Math.sqrt(s), Math.sqrt(Math.max(0, 1 - s)));
  }
  function coords(meta) {
    const c = meta?.computed_geometry?.coordinates;
    return Array.isArray(c) && c.length >= 2 ? { lat:Number(c[1]), lng:Number(c[0]) } : null;
  }
  function sequenceId(meta) { return String(meta?.sequence?.id ?? meta?.sequence ?? '').trim(); }
  function interpolate(route, t) {
    return { lat:route.start.lat + (route.end.lat-route.start.lat)*t, lng:route.start.lng + (route.end.lng-route.start.lng)*t };
  }
  function routeBearing(route) {
    const r = Math.PI / 180, p1 = route.start.lat*r, p2 = route.end.lat*r, dl = (route.end.lng-route.start.lng)*r;
    const y = Math.sin(dl)*Math.cos(p2), x = Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
    return (Math.atan2(y,x)*180/Math.PI+360)%360;
  }
  function routeProgress(route, point) {
    if (!point) return 0;
    const cos = Math.cos(((route.start.lat + route.end.lat) * .5) * Math.PI / 180);
    const vx = (route.end.lng-route.start.lng)*cos, vy = route.end.lat-route.start.lat;
    const px = (point.lng-route.start.lng)*cos, py = point.lat-route.start.lat;
    const denom = vx*vx + vy*vy;
    return denom > 0 ? (px*vx + py*vy)/denom : 0;
  }
  function offsetPoint(point, meters, bearingDeg) {
    if (!meters) return point;
    const br = bearingDeg*Math.PI/180;
    return {
      lat:point.lat + (Math.cos(br)*meters)/111320,
      lng:point.lng + (Math.sin(br)*meters)/(111320*Math.max(.2,Math.cos(point.lat*Math.PI/180)))
    };
  }
  function pointBbox(point, radiusM) {
    const latPad = radiusM/111320;
    const lngPad = radiusM/(111320*Math.max(.2,Math.cos(Number(point.lat)*Math.PI/180)));
    return `${point.lng-lngPad},${point.lat-latPad},${point.lng+lngPad},${point.lat+latPad}`;
  }

  async function mly(path) {
    const t = token();
    if (!t) throw new Error('Mapillary Access Tokenが未設定です');
    const sep = path.includes('?') ? '&' : '?';
    const response = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(t)}`, { cache:'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) {
      const message = data?.error?.message || `Mapillary API ${response.status}`;
      const error = new Error(message);
      error.reduceAmount = /reduce the amount of data/i.test(message);
      throw error;
    }
    return data;
  }

  async function batchMeta(ids, fields=META_FIELDS, batch=META_BATCH) {
    const out = new Map();
    const unique = [...new Set((ids || []).map(String).filter(Boolean))];
    for (let start=0; start<unique.length; start+=batch) {
      const part = unique.slice(start, start+batch);
      let data;
      try {
        data = await mly(`/images?image_ids=${encodeURIComponent(part.join(','))}&limit=${part.length}&fields=${encodeURIComponent(fields)}`);
      } catch (error) {
        if (error?.reduceAmount && part.length > 3) {
          const half = Math.ceil(part.length/2);
          const a = await batchMeta(part.slice(0,half), fields, Math.max(3,Math.floor(batch/2)));
          const b = await batchMeta(part.slice(half), fields, Math.max(3,Math.floor(batch/2)));
          for (const [k,v] of a) out.set(k,v);
          for (const [k,v] of b) out.set(k,v);
          continue;
        }
        throw error;
      }
      for (const row of data?.data || []) out.set(String(row.id), row);
      if (start+batch < unique.length) await sleep(12);
    }
    return out;
  }
  async function orderedIds(sequence) {
    try {
      const data = await mly(`/image_ids?sequence_id=${encodeURIComponent(sequence)}`);
      return (data?.data || []).map(x => String(x?.id ?? x)).filter(Boolean);
    } catch (error) {
      if (error?.reduceAmount) return [];
      throw error;
    }
  }

  function normalizeFrame(meta, sequence, index, profile) {
    const c = coords(meta);
    const source = meta?.thumb_2048_url || meta?.thumb_1024_url || meta?.thumb_256_url;
    if (!c || !source) return null;
    const computed = Number(meta?.computed_compass_angle), exif = Number(meta?.compass_angle);
    const heading = Number.isFinite(computed) ? computed : (Number.isFinite(exif) ? exif : null);
    return {
      id:String(meta.id), sequenceId:String(sequence), sequenceIndex:index,
      lat:c.lat, lng:c.lng, heading,
      headingSource:Number.isFinite(computed) ? 'sfm-computed' : 'exif',
      exifHeading:Number.isFinite(exif) ? exif : null,
      computedHeading:Number.isFinite(computed) ? computed : null,
      projection:meta.is_pano ? 'SPHERE' : 'RECTILINEAR', fieldOfView:meta.is_pano ? 360 : 100,
      sourceUrl:source,
      raw2048Url:meta?.thumb_2048_url || null,
      raw1024Url:meta?.thumb_1024_url || null,
      raw256Url:meta?.thumb_256_url || null,
      url:source, provider:'Mapillary', capturedAt:meta.captured_at || null,
      journeyProfile:profile
    };
  }

  function sampleExact(segment, target=TARGET_FRAMES) {
    if (segment.length <= target) return segment.slice();
    const out = [], used = new Set(), step = (segment.length-1)/(target-1);
    for (let i=0; i<target; i++) {
      const id = segment[Math.round(i*step)];
      if (!used.has(id)) { used.add(id); out.push(id); }
    }
    return out;
  }
  function sampleRefsExact(refs, target=TARGET_FRAMES) {
    if (refs.length <= target) return refs.slice();
    const out=[], used=new Set(), step=(refs.length-1)/(target-1);
    for(let i=0;i<target;i++){
      const ref=refs[Math.round(i*step)];
      if(ref && !used.has(ref.id)){used.add(ref.id);out.push(ref)}
    }
    return out;
  }
  function targetSegment(ids, startIndex, endIndex) {
    if (!Array.isArray(ids) || ids.length < MIN_FRAMES || startIndex < 0 || endIndex < 0) return null;
    const forward = endIndex >= startIndex;
    let lo = Math.min(startIndex,endIndex), hi = Math.max(startIndex,endIndex), goal = Math.min(TARGET_FRAMES,ids.length);
    while (hi-lo+1 < goal && (lo>0 || hi<ids.length-1)) {
      if (lo>0) lo--;
      if (hi-lo+1 < goal && hi<ids.length-1) hi++;
    }
    let segment = ids.slice(lo,hi+1);
    if (segment.length > TARGET_FRAMES) segment = sampleExact(segment,TARGET_FRAMES);
    if (!forward) segment.reverse();
    return segment.length >= MIN_FRAMES && segment.length <= MAX_FRAMES ? segment : null;
  }

  async function locateEndpoints(route, ids) {
    if (ids.length < MIN_FRAMES) return null;
    const count = Math.min(PROBE_COUNT,ids.length), indexes=[];
    for (let i=0; i<count; i++) indexes.push(Math.round(i*(ids.length-1)/Math.max(1,count-1)));
    const meta = await batchMeta([...new Set(indexes.map(i=>ids[i]))], 'id,computed_geometry', PROBE_BATCH);
    let startIndex=-1,endIndex=-1,startD=Infinity,endD=Infinity;
    for (const i of indexes) {
      const c=coords(meta.get(ids[i])); if(!c)continue;
      const ds=distanceMeters(route.start,c),de=distanceMeters(route.end,c);
      if(ds<startD){startD=ds;startIndex=i} if(de<endD){endD=de;endIndex=i}
    }
    if(startIndex<0||endIndex<0)return null;
    const refine=new Set();
    for(const center of [startIndex,endIndex]) for(let i=Math.max(0,center-REFINE_RADIUS);i<=Math.min(ids.length-1,center+REFINE_RADIUS);i++)refine.add(i);
    const refineMeta=await batchMeta([...refine].map(i=>ids[i]),'id,computed_geometry',PROBE_BATCH);
    startD=Infinity;endD=Infinity;
    for(const i of refine){
      const c=coords(refineMeta.get(ids[i]));if(!c)continue;
      const ds=distanceMeters(route.start,c),de=distanceMeters(route.end,c);
      if(ds<startD){startD=ds;startIndex=i} if(de<endD){endD=de;endIndex=i}
    }
    return {startIndex,endIndex,startD,endD};
  }
  async function fixedFromSequence(route, sequence, source) {
    const ids = await orderedIds(sequence);
    if (ids.length < MIN_FRAMES) return null;
    const loc = await locateEndpoints(route, ids);
    if (!loc) return null;
    const imageIds = targetSegment(ids,loc.startIndex,loc.endIndex);
    if (!imageIds) return null;
    return {
      sequenceId:sequence,startImageId:imageIds[0],endImageId:imageIds[imageIds.length-1],
      anchorStartImageId:ids[loc.startIndex],anchorEndImageId:ids[loc.endIndex],imageIds,
      startDistanceMeters:loc.startD,endDistanceMeters:loc.endD,source
    };
  }
  async function resolveSeed(route) {
    if (!route.seedSequenceId) return null;
    try { return await fixedFromSequence(route,route.seedSequenceId,'seed-confirmed'); }
    catch { return null; }
  }

  async function tinySequenceSearch(point,radiusM,limits) {
    let reduced=false,lastError=null;
    for(const limit of limits){
      try{
        const data=await mly(`/images?bbox=${encodeURIComponent(pointBbox(point,radiusM))}&limit=${limit}&fields=${encodeURIComponent(LIGHT_FIELDS)}`);
        return {rows:Array.isArray(data?.data)?data.data:[],reduced};
      }catch(error){lastError=error;if(!error?.reduceAmount)throw error;reduced=true;await sleep(20)}
    }
    return {rows:[],reduced:true,error:lastError};
  }
  function effectiveSearchConfig(route) {
    if (route.profile==='SIDEWALK' && route.quietRoute) {
      return {
        ...(route.search||{}),
        stops:[0,.125,.25,.375,.5,.625,.75,.875,1],
        offsets:[0,12,-12],
        cellRadius:Math.max(12,Number(route.search?.cellRadius)||12),
        limits:Array.isArray(route.search?.limits)&&route.search.limits.length ? route.search.limits : [6,3]
      };
    }
    return route.search||{stops:[0,.25,.5,.75,1],offsets:[0],cellRadius:12,limits:[8,5,3]};
  }
  async function collectSequenceHints(route) {
    const cfg=effectiveSearchConfig(route);
    const perpendicular=(routeBearing(route)+90)%360,hints=new Map();
    let reducedCells=0,okCells=0;
    for(let si=0;si<cfg.stops.length;si++){
      const base=interpolate(route,cfg.stops[si]);status(`${route.label}：軽量sequence探索 ${si+1}/${cfg.stops.length}…`);
      for(const offset of cfg.offsets){
        const point=offsetPoint(base,Math.abs(offset),offset<0?(perpendicular+180)%360:perpendicular);
        const result=await tinySequenceSearch(point,cfg.cellRadius,cfg.limits);
        if(result.reduced)reducedCells++;if(result.rows.length)okCells++;
        for(const row of result.rows){
          const seq=sequenceId(row);if(!seq)continue;
          let hint=hints.get(seq);
          if(!hint)hints.set(seq,hint={sequenceId:seq,stops:new Set(),hits:0,offsetPenalty:0,samples:[]});
          hint.stops.add(si);hint.hits++;hint.offsetPenalty+=Math.abs(offset);
          hint.samples.push({stop:si,id:String(row.id),offset:Math.abs(offset)});
        }
        await sleep(8);
      }
    }
    const candidates=[...hints.values()].map(h=>{
      const stopList=[...h.stops].sort((a,b)=>a-b);
      return {...h,stopList,minStop:stopList[0]??0,maxStop:stopList[stopList.length-1]??0,coverage:stopList.length,score:stopList.length*100+h.hits*5-h.offsetPenalty*.08};
    }).sort((a,b)=>b.score-a.score);
    return {candidates,reducedCells,okCells,stopCount:cfg.stops.length};
  }

  async function sidewalkChunkFromHint(route, candidate) {
    const ids=await orderedIds(candidate.sequenceId);
    if(ids.length<12)return null;
    const indexById=new Map(ids.map((id,i)=>[String(id),i]));
    const samples=(candidate.samples||[]).map(s=>({...s,index:indexById.get(String(s.id))})).filter(s=>Number.isInteger(s.index));
    if(!samples.length)return null;
    samples.sort((a,b)=>a.stop-b.stop || a.offset-b.offset);
    let lo=Math.min(...samples.map(s=>s.index)), hi=Math.max(...samples.map(s=>s.index));
    const desired=Math.min(ids.length,Math.max(70,Math.min(140,50+candidate.coverage*30)));
    while(hi-lo+1<desired && (lo>0||hi<ids.length-1)){
      if(lo>0)lo--;
      if(hi-lo+1<desired&&hi<ids.length-1)hi++;
    }
    let forward=true;
    const distinct=[];
    for(const sample of samples){if(!distinct.length||distinct[distinct.length-1].stop!==sample.stop)distinct.push(sample)}
    if(distinct.length>=2){forward=distinct[distinct.length-1].index>=distinct[0].index}
    else {
      const a=Math.max(0,lo),b=Math.min(ids.length-1,hi);
      const probe=await batchMeta([ids[a],ids[b]],'id,computed_geometry',2);
      const pa=routeProgress(route,coords(probe.get(ids[a]))),pb=routeProgress(route,coords(probe.get(ids[b])));
      if(Number.isFinite(pa)&&Number.isFinite(pb)&&Math.abs(pb-pa)>.002)forward=pb>=pa;
    }
    let chunk=ids.slice(lo,hi+1).map((id,i)=>({id:String(id),sequenceId:String(candidate.sequenceId),sourceSequenceIndex:lo+i}));
    if(!forward)chunk.reverse();
    return {sequenceId:candidate.sequenceId,refs:chunk,minStop:candidate.minStop,maxStop:candidate.maxStop,coverage:candidate.coverage,score:candidate.score,stopList:candidate.stopList};
  }

  async function stitchSidewalkRoute(route, discovery) {
    if(route.profile!=='SIDEWALK'||!discovery?.candidates?.length)return null;
    status('歩道：単一sequence不足。近接sequenceを連結して約200枚を作成中…');
    const sourceCandidates=discovery.candidates.filter(c=>c.coverage>=1).slice(0,10);
    const chunks=[];
    for(let i=0;i<sourceCandidates.length;i++){
      try{
        const chunk=await sidewalkChunkFromHint(route,sourceCandidates[i]);
        if(chunk)chunks.push(chunk);
      }catch(error){
        if(!error?.reduceAmount)console.warn('[KyotoTestRoutes] sidewalk stitch candidate failed',error);
      }
      if(chunks.length>=6)break;
    }
    if(!chunks.length)return null;

    const chosen=[];
    const chosenSeq=new Set();
    const add=chunk=>{if(chunk&&!chosenSeq.has(chunk.sequenceId)){chosen.push(chunk);chosenSeq.add(chunk.sequenceId)}};
    const startChunk=chunks.filter(c=>c.minStop<=1).sort((a,b)=>b.score-a.score)[0];
    const endThreshold=Math.max(0,(discovery.stopCount||5)-2);
    const endChunk=chunks.filter(c=>c.maxStop>=endThreshold).sort((a,b)=>b.score-a.score)[0];
    add(startChunk);add(endChunk);

    const covered=new Set(chosen.flatMap(c=>c.stopList||[]));
    let estimated=chosen.reduce((sum,c)=>sum+c.refs.length,0);
    while((estimated<TARGET_FRAMES||covered.size<Math.min(5,discovery.stopCount||5))&&chosen.length<4){
      const next=chunks.filter(c=>!chosenSeq.has(c.sequenceId)).sort((a,b)=>{
        const newA=(a.stopList||[]).filter(x=>!covered.has(x)).length;
        const newB=(b.stopList||[]).filter(x=>!covered.has(x)).length;
        return (newB-newA)*1000+(b.coverage-a.coverage)*100+(b.score-a.score);
      })[0];
      if(!next)break;
      add(next);for(const s of next.stopList||[])covered.add(s);estimated+=next.refs.length;
    }
    if(!chosen.length)add(chunks[0]);
    chosen.sort((a,b)=>((a.minStop+a.maxStop)/2)-((b.minStop+b.maxStop)/2));

    let refs=[],seen=new Set();
    for(const chunk of chosen){
      for(const ref of chunk.refs){if(!seen.has(ref.id)){seen.add(ref.id);refs.push(ref)}}
    }
    if(refs.length<MIN_FRAMES){
      const extras=chunks.filter(c=>!chosenSeq.has(c.sequenceId)).sort((a,b)=>b.score-a.score);
      for(const chunk of extras){
        for(const ref of chunk.refs){if(!seen.has(ref.id)){seen.add(ref.id);refs.push(ref)}}
        chosenSeq.add(chunk.sequenceId);
        if(refs.length>=MIN_FRAMES)break;
      }
    }
    if(refs.length<MIN_FRAMES)return null;
    if(refs.length>TARGET_FRAMES)refs=sampleRefsExact(refs,TARGET_FRAMES);
    if(refs.length<MIN_FRAMES)return null;

    const edgeMeta=await batchMeta([refs[0].id,refs[refs.length-1].id],'id,computed_geometry',2);
    const firstCoord=coords(edgeMeta.get(refs[0].id)),lastCoord=coords(edgeMeta.get(refs[refs.length-1].id));
    return {
      sequenceId:refs[0].sequenceId,
      sequenceIds:[...new Set(refs.map(r=>r.sequenceId))],
      startImageId:refs[0].id,endImageId:refs[refs.length-1].id,
      anchorStartImageId:refs[0].id,anchorEndImageId:refs[refs.length-1].id,
      imageIds:refs.map(r=>r.id),imageRefs:refs,
      startDistanceMeters:firstCoord?distanceMeters(route.start,firstCoord):null,
      endDistanceMeters:lastCoord?distanceMeters(route.end,lastCoord):null,
      source:'sidewalk-multi-sequence-stitch'
    };
  }

  async function resolveRoute(route) {
    if(resolving.has(route.id))return resolving.get(route.id);
    const task=(async()=>{
      const cache=loadCache(),cached=cache[route.id];
      if(validFixed(cached)&&String(cached.journeyProfile||route.profile)===route.profile)return cached;

      let fixed=await resolveSeed(route),discovery=null;
      if(!fixed){
        discovery=await collectSequenceHints(route);
        const minCoverage=route.profile==='SIDEWALK'?1:2;
        const maxCandidates=route.profile==='SIDEWALK'?10:12;
        const candidates=discovery.candidates.filter(c=>c.coverage>=minCoverage).slice(0,maxCandidates);
        let fallback=null;
        for(let i=0;i<candidates.length;i++){
          const candidate=candidates[i];status(`${route.label}：候補sequence精査 ${i+1}/${candidates.length}…`);
          let value=null;
          try{value=await fixedFromSequence(route,candidate.sequenceId,`tiny-corridor-${candidate.coverage}stops`)}catch(error){if(!error?.reduceAmount)console.warn('[KyotoTestRoutes] candidate failed',error)}
          if(!value)continue;
          const endpoint=Math.max(Number(value.startDistanceMeters)||0,Number(value.endDistanceMeters)||0),rank=endpoint-candidate.coverage*70;
          if(!fallback||rank<fallback.rank)fallback={rank,value};
          if(endpoint<=route.maxEndpointM){fixed=value;break}
        }
        if(!fixed&&fallback)fixed=fallback.value;
        if(!fixed&&route.profile==='SIDEWALK')fixed=await stitchSidewalkRoute(route,discovery);
      }
      if(!fixed){
        const suffix=discovery?.reducedCells?`（密集セル${discovery.reducedCells}件は自動縮小/スキップ済み）`:'';
        throw new Error(route.profile==='SIDEWALK'?`歩道で約200枚を構成できませんでした${suffix}`:`${route.label}で約200枚続くsequenceを見つけられませんでした${suffix}`);
      }
      fixed={
        ...fixed,routeId:route.id,label:route.label,journeyProfile:route.profile,targetFrames:TARGET_FRAMES,
        resolvedAt:new Date().toISOString(),
        discovery:{method:fixed.source||'tiny-sequence-probe',reducedCells:discovery?.reducedCells||0,okCells:discovery?.okCells||0,sequenceCount:fixed.sequenceIds?.length||1}
      };
      const next=loadCache();next[route.id]=fixed;saveCache(next);return fixed;
    })().finally(()=>resolving.delete(route.id));
    resolving.set(route.id,task);return task;
  }

  async function buildPayload(route,fixed) {
    const ids=fixed.imageIds;
    const refs=Array.isArray(fixed.imageRefs)&&fixed.imageRefs.length===ids.length
      ? fixed.imageRefs.map((ref,i)=>({id:String(ref.id),sequenceId:String(ref.sequenceId||fixed.sequenceId),sequenceIndex:i,journeyProfile:route.profile}))
      : ids.map((id,i)=>({id:String(id),sequenceId:String(fixed.sequenceId),sequenceIndex:i,journeyProfile:route.profile}));
    const initialRefs=refs.slice(0,Math.min(INITIAL_FRAMES,refs.length));
    const meta=await batchMeta(initialRefs.map(ref=>ref.id));
    const frames=initialRefs.map((ref,i)=>normalizeFrame(meta.get(ref.id),ref.sequenceId,i,route.profile)).filter(Boolean);
    if(frames.length<2)throw new Error('固定ルートの初期画像URLを取得できませんでした');
    const loaded=new Set(frames.map(f=>String(f.id)));
    const missing=initialRefs.filter(ref=>!loaded.has(ref.id));
    const remaining=refs.slice(initialRefs.length);
    const sidewalk=route.profile==='SIDEWALK';
    const stitched=Array.isArray(fixed.sequenceIds)&&fixed.sequenceIds.length>1;
    return {
      version:'0.4.15-profiled-fixed-200-stitch',source:'Mapillary',provider:'Mapillary',sequenceId:fixed.sequenceId,
      sequenceIds:fixed.sequenceIds||[fixed.sequenceId],
      journeyProfile:route.profile,profileSource:'explicit-test-route',profileIsolation:true,
      presentationProfile:sidewalk?{photoCenterX:50,preferredImageTier:'1024',bootstrapFrames:8,prefetchAhead:30}:null,
      destination:{...route.end,testRouteType:route.id,testRouteLabel:route.label,journeyProfile:route.profile},
      selection:{
        strategy:stitched?'fixed-sidewalk-multi-sequence-200':(route.seedSequenceId?'fixed-confirmed-sequence-200':'fixed-test-sequence-200-low-data'),
        direction:'forward',proximityMeters:fixed.startDistanceMeters,destinationDistanceMeters:fixed.endDistanceMeters,
        searchMode:fixed.source||'fixed-resolved',candidateCount:fixed.sequenceIds?.length||1,visualOverride:false,
        startImageId:fixed.startImageId,endImageId:fixed.endImageId,totalImageIds:ids.length,journeyProfile:route.profile
      },
      frames,streamPending:[...missing,...remaining],candidateRoutes:[],
      fixedTestRoute:{
        routeId:route.id,label:route.label,name:route.name,journeyProfile:route.profile,startImageId:fixed.startImageId,endImageId:fixed.endImageId,
        anchorStartImageId:fixed.anchorStartImageId||null,anchorEndImageId:fixed.anchorEndImageId||null,frameCount:ids.length,targetFrames:TARGET_FRAMES,
        sequenceIds:fixed.sequenceIds||[fixed.sequenceId],resolvedAt:fixed.resolvedAt,discovery:fixed.discovery||null
      }
    };
  }

  async function prepare(route){const fixed=await resolveRoute(route);markButton(route.id,'ready',fixed.imageIds.length);return fixed}
  function markButton(id,state,count=null){
    const button=document.querySelector(`[data-route="${id}"]`);if(!button)return;
    button.dataset.fixedState=state;const badge=button.querySelector('em');if(!badge)return;
    badge.textContent=state==='ready'?`約${count||TARGET_FRAMES}枚固定`:state==='loading'?'準備中':state==='error'?'再試行':'タップで固定';
  }
  function setSessionPreset(route,fixed){
    const preset={id:route.id,label:route.label,name:route.name,journeyProfile:route.profile,start:{...route.start},end:{...route.end},sequenceId:fixed?.sequenceId||null,sequenceIds:fixed?.sequenceIds||null,startImageId:fixed?.startImageId||null,endImageId:fixed?.endImageId||null,frameCount:fixed?.imageIds?.length||null,registeredAt:'2026-08-31'};
    try{
      sessionStorage.setItem(TEST_KEY,JSON.stringify(preset));
      sessionStorage.setItem(DEST_KEY,JSON.stringify({lat:route.end.lat,lng:route.end.lng,name:route.end.name,testRouteType:route.id,testRouteLabel:route.label,journeyProfile:route.profile,startLat:route.start.lat,startLng:route.start.lng,startName:route.start.name}));
    }catch{}
  }
  async function startRoute(route,button){
    document.querySelectorAll('.test-route-button').forEach(x=>x.classList.toggle('is-active',x===button));
    if(!token()){status(`${route.label}：Mapillaryトークンを設定して。約200枚の固定区間を端末内に保存する。`);$('mapillarySettings')?.click();return}
    markButton(route.id,'loading');
    try{
      status(`${route.label}：${route.seedSequenceId?'確認済みsequence':'軽量探索'}から約200枚を準備中…`);
      const fixed=await prepare(route);setSessionPreset(route,fixed);
      prepared.set(route.id,buildPayload(route,fixed));
      const payload=await prepared.get(route.id);sessionStorage.setItem(ROUTE_KEY,JSON.stringify(payload));
      const sequenceLabel=fixed.sequenceIds?.length>1?`${fixed.sequenceIds.length} sequences`:`Sequence ${fixed.sequenceId}`;
      status(`${route.label}：${sequenceLabel} / ${fixed.imageIds.length}枚固定。${route.profile}専用処理で開始`);
      location.href='/journey-map.html?autostart=1';
    }catch(error){prepared.delete(route.id);markButton(route.id,'error');status(`${route.label}：${error?.message||'固定ルート準備に失敗'}`)}
  }

  function geojson(){
    const features=[];
    for(const route of routes){
      features.push({type:'Feature',properties:{id:route.id,label:route.label,name:route.name,kind:'line'},geometry:{type:'LineString',coordinates:[[route.start.lng,route.start.lat],[route.end.lng,route.end.lat]]}});
      features.push({type:'Feature',properties:{id:route.id,label:`${route.label} 出発`,kind:'point'},geometry:{type:'Point',coordinates:[route.start.lng,route.start.lat]}});
      features.push({type:'Feature',properties:{id:route.id,label:`${route.label} 到着`,kind:'point'},geometry:{type:'Point',coordinates:[route.end.lng,route.end.lat]}});
    }
    return {type:'FeatureCollection',features};
  }
  function installMapOverlay(){
    const map=window.__streetviewCoverageMap;if(!map)return setTimeout(installMapOverlay,120);
    if(!map.loaded())return map.once('load',installMapOverlay);
    if(!map.getSource(SOURCE))map.addSource(SOURCE,{type:'geojson',data:geojson()});
    if(!map.getLayer(LINE))map.addLayer({id:LINE,type:'line',source:SOURCE,filter:['==',['get','kind'],'line'],paint:{'line-color':['match',['get','id'],'road','#ffb45d','sidewalk','#69e8ff','mountain','#9dff70','rail','#ff77d7','#fff'],'line-width':4,'line-opacity':.88,'line-dasharray':[1.4,1.1]}});
    if(!map.getLayer(POINTS))map.addLayer({id:POINTS,type:'circle',source:SOURCE,filter:['==',['get','kind'],'point'],paint:{'circle-radius':6,'circle-color':'#fff','circle-stroke-width':2.5,'circle-stroke-color':['match',['get','id'],'road','#ffb45d','sidewalk','#69e8ff','mountain','#9dff70','rail','#ff77d7','#07110f']}});
    if(!map.getLayer(LABELS))map.addLayer({id:LABELS,type:'symbol',source:SOURCE,filter:['==',['get','kind'],'line'],layout:{'symbol-placement':'line','text-field':['get','label'],'text-size':11,'text-allow-overlap':false},paint:{'text-color':'#fff','text-halo-color':'#07110f','text-halo-width':2}});
  }
  function installButtons(){
    const box=$('testRouteButtons');if(!box)return;box.innerHTML='';const cache=loadCache();
    for(const route of routes){
      const fixed=cache[route.id],button=document.createElement('button');
      button.type='button';button.className='test-route-button';button.dataset.route=route.id;
      const fixedCount=Array.isArray(fixed?.imageRefs)?fixed.imageRefs.length:fixed?.imageIds?.length;
      button.innerHTML=`<strong>${route.label}</strong><span>${route.start.name} → ${route.end.name}</span><em>${validFixed(fixed)?`約${fixedCount}枚固定`:'タップで固定'}</em>`;
      button.addEventListener('click',()=>startRoute(route,button));box.appendChild(button);
    }
  }
  function refreshStatusFromCache(){
    const cache=loadCache(),ready=routes.filter(route=>validFixed(cache[route.id]));
    if(!token()){status('Mapillaryトークン保存後、各ルートをタップすると約200枚の固定区間を作る。');return}
    if(!ready.length){status('ジャンル別プロファイルを分離済み。道路・歩道は確認済みsequenceを優先する。');return}
    status(`${ready.length}/4ルート固定済み。${ready.map(route=>`${route.label}:${cache[route.id].imageIds.length}枚`).join(' / ')}`);
  }
  function waitForTokenSave(){$('saveToken')?.addEventListener('click',()=>setTimeout(refreshStatusFromCache,500))}

  installButtons();installMapOverlay();waitForTokenSave();refreshStatusFromCache();
  window.__kyotoJourneyTestRoutes={
    routes,profiles:PROFILE_BY_ID,
    resolve:id=>{const route=routes.find(x=>x.id===id);return route?resolveRoute(route):null},
    cache:loadCache,
    clear:()=>{try{localStorage.removeItem(CACHE_KEY)}catch{}prepared.clear();installButtons();refreshStatusFromCache()}
  };
})();
