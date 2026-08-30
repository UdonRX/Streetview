/* Streetview Journey Quality + Feathered Center v0.2.0 — Phase A */
(()=>{
  'use strict';
  if(window.__journeyHybridQualityInstalled)return;
  window.__journeyHybridQualityInstalled=true;

  const VERSION='0.2.0-phase-a';
  const GRAPH='https://graph.mapillary.com';
  const TOKEN_KEY='streetview:mapillary-token';
  const MIN_RAW_AHEAD=5,FULL_RATE_RAW_AHEAD=9,PREFETCH_FROM=1,PREFETCH_TO=14;
  const PREFETCH_ORDER=[3,4,5,2,1,6,7,8,9,10,11,12,13,14];
  const EXPECTED_LONG_EDGE=900,MAX_QUALITY_INFLIGHT=3,MAX_HOLD_AGE=1;
  const VERTICAL_MIN_CONF=.16,VERTICAL_RADIUS=6,VERTICAL_MAX_SHIFT=.12,VERTICAL_GAIN=.86;
  const QUALITY_WEIGHTS=Object.freeze({image:.40,direction:.20,spacing:.15,roll:.15,resolution:.10});
  const QUALITY_THRESHOLDS=Object.freeze({preferred:.70,normal:.55,conditional:.40,maxRejectRatio:.18,minJourneyScore:42});
  const MAX_BRIDGE_METERS=24,MAX_BRIDGE_HEADING_DEG=58,MAX_BRIDGE_TIME_MS=12000;
  const QUALITY_BATCH=35;
  const QUALITY_FIELDS_FULL='id,sequence,captured_at,computed_geometry,compass_angle,computed_compass_angle,thumb_256_url,thumb_1024_url,thumb_2048_url,is_pano,width,height,on_foot,quality_score';
  const QUALITY_FIELDS_NO_SCORE='id,sequence,captured_at,computed_geometry,compass_angle,computed_compass_angle,thumb_256_url,thumb_1024_url,thumb_2048_url,is_pano,width,height,on_foot';
  const QUALITY_FIELDS_CORE='id,sequence,captured_at,computed_geometry,compass_angle,thumb_256_url,thumb_1024_url,thumb_2048_url,is_pano';

  const cache=new Map(),inflight=new Map(),rejected=new Set(),verticalSamples=new Map(),urlFrameCache=new Map(),meta1024=new Map(),meta1024Inflight=new Map();
  const qualityById=new Map(),sequenceQuality=new Map(),qualityRejectedIds=new Set(),qualityKeptForContinuity=new Set();
  let shell=null,vertical=null,layer=null,currentKey=-1,loads=0,errors=0,resolutionMismatches=0,decodeErrors=0,exactHits=0,heldHits=0,misses=0,lastStride=null,lowAheadSkips=0,directBypassLoads=0,sourceFallbackHits=0,verticalApplied=0,metadataLoads=0,metadataErrors=0;
  let qualityScoreFieldAvailable=null,qualityPreparationDone=false,qualityPreparationError=null,qualityRejectedFrames=0,qualityUnknownFrames=0,qualityMedian=0,qualityAverage=0;

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const median=a=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!s.length)return null;const m=s.length>>1;return s.length&1?s[m]:(s[m-1]+s[m])*.5};
  const average=a=>{const s=a.filter(Number.isFinite);return s.length?s.reduce((x,y)=>x+y,0)/s.length:null};
  const emit=(phase,detail={})=>{try{window.dispatchEvent(new CustomEvent('journey-hybrid-quality',{detail:{phase,version:VERSION,...detail}}))}catch{}};
  const runtime=()=>window.__journeyRawRuntime||{};
  const playback=()=>window.__journeyPlaybackState||{};
  const engine=()=>window.JourneyEngine?.getState?.()||{};
  const currentIndex=()=>{const p=playback(),e=engine();return Number.isFinite(p.index)?p.index:(Number.isFinite(e.index)?e.index:0)};
  const rawAhead=()=>{const r=runtime(),p=playback(),e=engine();const v=Number.isFinite(r.contiguousRawAhead)?r.contiguousRawAhead:(p.rawAheadReady??e.actualRenderableAhead??e.rawAheadReady??0);return Math.max(0,Number(v)||0)};
  const frames=()=>window.__journeyStreamState?.frames||window.__journeySelectedRoute?.frames||[];
  const remainingAhead=()=>Math.max(0,frames().length-currentIndex()-1);
  const requiredRawAhead=()=>Math.min(MIN_RAW_AHEAD,remainingAhead());
  const norm=value=>{try{const u=new URL(String(value||''),location.href);u.searchParams.delete('analysis');u.searchParams.delete('axisv');return u.href}catch{return String(value||'')}};
  const token=()=>{try{return localStorage.getItem(TOKEN_KEY)||''}catch{return''}};
  const hasCoords=f=>Number.isFinite(Number(f?.lat))&&Number.isFinite(Number(f?.lng));
  const rad=v=>v*Math.PI/180,deg=v=>v*180/Math.PI;
  const angle=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?((b-a+540)%360)-180:null;
  function distanceMeters(a,b){if(!hasCoords(a)||!hasCoords(b))return null;const p1=rad(Number(a.lat)),p2=rad(Number(b.lat)),dp=p2-p1,dl=rad(Number(b.lng)-Number(a.lng)),s=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 12742000*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)))}
  function bearing(a,b){if(!hasCoords(a)||!hasCoords(b))return null;const p1=rad(Number(a.lat)),p2=rad(Number(b.lat)),dl=rad(Number(b.lng)-Number(a.lng)),y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return(deg(Math.atan2(y,x))+360)%360}
  function capturedMs(f){const v=f?.capturedAt??f?.captured_at;if(v==null)return null;if(Number.isFinite(Number(v))){const n=Number(v);return n<1e12?n*1000:n}const n=Date.parse(String(v));return Number.isFinite(n)?n:null}
  function metaCoords(m){const c=m?.computed_geometry?.coordinates;return Array.isArray(c)&&c.length>=2?{lat:Number(c[1]),lng:Number(c[0])}:null}
  function mapillaryScore(f){const q=Number(f?.mapillaryQualityScore??f?.quality_score);return Number.isFinite(q)&&q>0&&q<=1?q:null}
  function frameHeading(f){const a=Number(f?.computedHeading??f?.computed_compass_angle),b=Number(f?.heading??f?.compass_angle);return Number.isFinite(a)?a:(Number.isFinite(b)?b:null)}
  function longEdge(f){const w=Number(f?.width),h=Number(f?.height);if(Number.isFinite(w)&&Number.isFinite(h)&&w>0&&h>0)return Math.max(w,h);if(f?.sourceUrl||f?.thumb_2048_url)return 2048;if(f?.raw1024Url||f?.thumb_1024_url)return 1024;if(f?.raw256Url||f?.thumb_256_url)return 256;return 0}
  function aspectScore(f){const w=Number(f?.width),h=Number(f?.height);if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)return 85;const r=w/h;if(r>4.5||r<.22)return 18;if(r>3.1||r<.32)return 48;if(r>2.5||r<.40)return 72;return 100}
  function resolutionScore(f){const l=longEdge(f);if(l>=1900)return 100;if(l>=1000)return 82;if(l>=700)return 64;if(l>=500)return 48;if(l>=250)return 30;return 15}
  function travelBearingFor(list,i){const c=list[i];if(!c)return null;let x=0,y=0,w=0;for(let s=1;s<=8&&i+s<list.length;s++){const n=list[i+s];if(String(c.sequenceId||'')&&String(n.sequenceId||'')&&String(c.sequenceId)!==String(n.sequenceId))break;const d=distanceMeters(c,n);if(!Number.isFinite(d)||d<.7)continue;const br=bearing(c,n),ww=Math.min(d,20)/Math.pow(s,.55);x+=Math.cos(rad(br))*ww;y+=Math.sin(rad(br))*ww;w+=ww;if(d>=25)break}if(!w&&i>0){const p=list[i-1];if(!String(c.sequenceId||'')||!String(p.sequenceId||'')||String(c.sequenceId)===String(p.sequenceId)){const br=bearing(p,c),d=distanceMeters(p,c);if(Number.isFinite(br)&&Number.isFinite(d)&&d>.7)return br}}return w?(deg(Math.atan2(y,x))+360)%360:frameHeading(c)}
  function localSpacing(list,i){const ds=[];if(i>0){const d=distanceMeters(list[i-1],list[i]);if(Number.isFinite(d))ds.push(d)}if(i+1<list.length){const d=distanceMeters(list[i],list[i+1]);if(Number.isFinite(d))ds.push(d)}return average(ds)}
  function scoreFrame(list,i,medianSpacing){
    const f=list[i],mq=mapillaryScore(f),res=resolutionScore(f),aspect=aspectScore(f),imageBase=mq!=null?mq*100:clamp(res*.58+aspect*.27+80*.15,0,100);
    const tr=travelBearingFor(list,i),hd=frameHeading(f),diff=Number.isFinite(tr)&&Number.isFinite(hd)?Math.abs(angle(hd,tr)):null,direction=diff==null?72:clamp(100-diff/95*100,0,100);
    const spacing=localSpacing(list,i),spacingScore=Number.isFinite(spacing)&&Number.isFinite(medianSpacing)&&medianSpacing>.2?clamp(100-Math.abs(spacing-medianSpacing)/Math.max(medianSpacing,1)*55,15,100):72;
    const rollValue=Math.abs(Number(f?.rollDeg??f?.roll??0)),rollKnown=Number.isFinite(Number(f?.rollDeg??f?.roll)),rollScore=rollKnown?clamp(100-rollValue/5*100,0,100):72;
    const score=clamp(imageBase*QUALITY_WEIGHTS.image+direction*QUALITY_WEIGHTS.direction+spacingScore*QUALITY_WEIGHTS.spacing+rollScore*QUALITY_WEIGHTS.roll+res*QUALITY_WEIGHTS.resolution,0,100);
    return{journeyQualityScore:Math.round(score*10)/10,mapillaryQualityScore:mq,imageScore:Math.round(imageBase*10)/10,directionScore:Math.round(direction*10)/10,spacingScore:Math.round(spacingScore*10)/10,rollScore:Math.round(rollScore*10)/10,resolutionScore:res,headingDeltaDeg:diff==null?null:Math.round(diff*10)/10,localSpacingMeters:Number.isFinite(spacing)?Math.round(spacing*10)/10:null};
  }
  function canBridge(list,i,medianSpacing,medianInterval){
    if(i<=0||i>=list.length-1)return false;const a=list[i-1],b=list[i+1],c=list[i];
    if(String(a?.sequenceId||'')!==String(c?.sequenceId||'')||String(b?.sequenceId||'')!==String(c?.sequenceId||''))return false;
    const d=distanceMeters(a,b),limit=Math.max(MAX_BRIDGE_METERS,Number.isFinite(medianSpacing)?Math.min(48,medianSpacing*3.25):0);if(!Number.isFinite(d)||d>limit)return false;
    const local=bearing(a,b),before=bearing(a,c),after=bearing(c,b),turn=Math.max(Math.abs(angle(before,local)||0),Math.abs(angle(local,after)||0));if(turn>MAX_BRIDGE_HEADING_DEG)return false;
    const ta=capturedMs(a),tb=capturedMs(b),dt=Number.isFinite(ta)&&Number.isFinite(tb)?Math.abs(tb-ta):null,timeLimit=Math.max(MAX_BRIDGE_TIME_MS,Number.isFinite(medianInterval)?Math.min(20000,medianInterval*3.5):0);if(Number.isFinite(dt)&&dt>timeLimit)return false;
    return true;
  }
  function qualityBand(q){if(q==null)return'unknown';if(q>=QUALITY_THRESHOLDS.preferred)return'preferred';if(q>=QUALITY_THRESHOLDS.normal)return'normal';if(q>=QUALITY_THRESHOLDS.conditional)return'conditional';return'reject'}
  function qualityDecision(list,i,stats,rejectCount){
    const f=list[i],q=mapillaryScore(f),s=f.journeyQualityScore,band=qualityBand(q),candidate=band==='reject'||(band==='conditional'&&s<55)||(q==null&&s<QUALITY_THRESHOLDS.minJourneyScore);
    if(!candidate)return{reject:false,band,reason:'usable'};
    const maxReject=Math.max(1,Math.floor(list.length*QUALITY_THRESHOLDS.maxRejectRatio));if(rejectCount>=maxReject)return{reject:false,band,reason:'sequence-reject-cap'};
    if(i<=0||i>=list.length-1)return{reject:false,band,reason:'sequence-endpoint'};
    if(list[i-1]?._qualityRejected||list[i+1]?._qualityRejected)return{reject:false,band,reason:'avoid-adjacent-drop'};
    if(!canBridge(list,i,stats.medianSpacing,stats.medianInterval))return{reject:false,band,reason:'continuity-override'};
    return{reject:true,band,reason:q!=null?`mapillary-${band}`:'journey-score'};
  }
  function sequenceStats(list){
    const distances=[],intervals=[],headings=[],qs=[];for(let i=0;i<list.length;i++){const q=mapillaryScore(list[i]);if(q!=null)qs.push(q);const h=frameHeading(list[i]);if(Number.isFinite(h))headings.push(h);if(i){const d=distanceMeters(list[i-1],list[i]);if(Number.isFinite(d))distances.push(d);const a=capturedMs(list[i-1]),b=capturedMs(list[i]);if(Number.isFinite(a)&&Number.isFinite(b)&&b>a)intervals.push(b-a)}}
    const headingD=[];for(let i=1;i<headings.length;i++)headingD.push(Math.abs(angle(headings[i-1],headings[i])));
    return{medianQuality:median(qs),medianSpacing:median(distances),meanSpacing:average(distances),medianInterval:median(intervals),headingStabilityDeg:median(headingD),qualitySamples:qs.length};
  }
  function applyQualityToSequence(list){
    const stats=sequenceStats(list);for(let i=0;i<list.length;i++)Object.assign(list[i],scoreFrame(list,i,stats.medianSpacing));let rejectCount=0;
    for(let i=0;i<list.length;i++){const d=qualityDecision(list,i,stats,rejectCount);list[i].qualityBand=d.band;list[i].qualityDecision=d.reason;list[i]._qualityRejected=!!d.reject;if(d.reject)rejectCount++;else if(d.reason==='continuity-override')qualityKeptForContinuity.add(String(list[i].id||''))}
    const scores=list.map(f=>f.journeyQualityScore).filter(Number.isFinite);return{...stats,medianJourneyQualityScore:median(scores),meanJourneyQualityScore:average(scores),badFrameRatio:list.length?rejectCount/list.length:0,rejectedFrames:rejectCount,totalFrames:list.length};
  }

  async function graphBatch(ids,fields){const t=token();if(!t)throw new Error('Mapillary token missing');const url=`${GRAPH}/images?image_ids=${encodeURIComponent(ids.join(','))}&fields=${encodeURIComponent(fields)}`;const r=await fetch(url,{headers:{Authorization:`OAuth ${t}`},cache:'no-store'}),j=await r.json().catch(()=>({}));if(!r.ok||j?.error)throw Object.assign(new Error(j?.error?.message||`Mapillary API ${r.status}`),{status:r.status});return j?.data||[]}
  async function fetchQualityMeta(ids){
    if(!ids.length||!token())return new Map();const out=new Map();
    for(let s=0;s<ids.length;s+=QUALITY_BATCH){const part=ids.slice(s,s+QUALITY_BATCH);let rows=null;
      if(qualityScoreFieldAvailable!==false){try{rows=await graphBatch(part,QUALITY_FIELDS_FULL);qualityScoreFieldAvailable=true}catch(e){if(e?.status===400)qualityScoreFieldAvailable=false;else throw e}}
      if(!rows){try{rows=await graphBatch(part,QUALITY_FIELDS_NO_SCORE)}catch{rows=await graphBatch(part,QUALITY_FIELDS_CORE)}}
      for(const row of rows||[])out.set(String(row.id),row);
    }
    return out;
  }
  function mergeMeta(target,m){if(!target||!m)return target;const c=metaCoords(m);if(c){target.lat=c.lat;target.lng=c.lng}if(m.sequence!=null)target.sequenceId=String(m.sequence?.id??m.sequence);if(m.captured_at!=null)target.capturedAt=m.captured_at;const ch=Number(m.computed_compass_angle),eh=Number(m.compass_angle);if(Number.isFinite(ch)){target.heading=ch;target.headingSource='sfm-computed';target.computedHeading=ch}else if(Number.isFinite(eh)){target.heading=eh;target.headingSource=target.headingSource||'exif'}if(Number.isFinite(eh))target.exifHeading=eh;if(m.thumb_256_url){target.raw256Url=m.thumb_256_url;target.thumb_256_url=m.thumb_256_url}if(m.thumb_1024_url){target.raw1024Url=m.thumb_1024_url;target.thumb_1024_url=m.thumb_1024_url}if(m.thumb_2048_url){target.sourceUrl=target.sourceUrl||m.thumb_2048_url;target.raw2048Url=m.thumb_2048_url;target.thumb_2048_url=m.thumb_2048_url}if(Number.isFinite(Number(m.width)))target.width=Number(m.width);if(Number.isFinite(Number(m.height)))target.height=Number(m.height);if(typeof m.on_foot==='boolean')target.onFoot=m.on_foot;const q=Number(m.quality_score);if(Number.isFinite(q)&&q>0&&q<=1)target.mapillaryQualityScore=q;target.qualityScoreAvailable=qualityScoreFieldAvailable===true;return target}
  function fullRouteRecords(meta){
    const selected=window.__journeySelectedRoute;if(!selected)return[];const initial=Array.isArray(selected.frames)?selected.frames:[],pending=Array.isArray(selected.streamPending)?selected.streamPending:[],all=[];
    for(const f of initial){const copy=f;mergeMeta(copy,meta.get(String(copy.id||'')));all.push(copy)}
    for(const ref of pending){const copy={...ref,provider:'Mapillary'};mergeMeta(copy,meta.get(String(copy.id||'')));all.push(copy)}
    return all;
  }
  function computeAndApplyQuality(all){
    qualityById.clear();sequenceQuality.clear();qualityRejectedIds.clear();qualityKeptForContinuity.clear();
    const groups=[];let current=[];for(const f of all){if(current.length&&String(current[0].sequenceId||'')!==String(f.sequenceId||'')){groups.push(current);current=[]}current.push(f)}if(current.length)groups.push(current);
    for(const group of groups){const stats=applyQualityToSequence(group);sequenceQuality.set(String(group[0]?.sequenceId||'unknown'),stats);for(const f of group){qualityById.set(String(f.id||''),f);if(f._qualityRejected)qualityRejectedIds.add(String(f.id||''))}}
    const selected=window.__journeySelectedRoute;if(selected){
      const live=Array.isArray(selected.frames)?selected.frames:[];const keep=live.filter(f=>!qualityRejectedIds.has(String(f.id||'')));if(keep.length>=2){live.splice(0,live.length,...keep)}
      if(Array.isArray(selected.streamPending)){selected.streamPending=selected.streamPending.filter(r=>!qualityRejectedIds.has(String(r.id||'')))}
      const total=(selected.frames?.length||0)+(selected.streamPending?.length||0);if(selected.selection)selected.selection.totalImageIds=total;
      try{sessionStorage.setItem('streetview:journey-route',JSON.stringify(selected))}catch{}
    }
    const stream=window.__journeyStreamState;if(stream&&selected){stream.frames=selected.frames;stream.total=(selected.frames?.length||0)+(selected.streamPending?.length||0)}
    qualityRejectedFrames=qualityRejectedIds.size;const scores=[...qualityById.values()].map(f=>f.journeyQualityScore).filter(Number.isFinite);qualityMedian=median(scores)||0;qualityAverage=average(scores)||0;qualityUnknownFrames=[...qualityById.values()].filter(f=>mapillaryScore(f)==null).length;
  }
  function applyDecisionsToLiveFrames(){for(const f of frames()){const q=qualityById.get(String(f?.id||''));if(q)for(const k of ['journeyQualityScore','mapillaryQualityScore','qualityBand','qualityDecision','qualityScoreAvailable','width','height','onFoot'])if(q[k]!=null)f[k]=q[k]}}
  async function prepareQuality(){
    const selected=window.__journeySelectedRoute;if(!selected||selected.provider!=='Mapillary'){qualityPreparationDone=true;return}
    try{const ids=[...(selected.frames||[]),...(selected.streamPending||[])].map(x=>String(x?.id||'')).filter(Boolean),unique=[...new Set(ids)];const meta=await fetchQualityMeta(unique);const all=fullRouteRecords(meta);computeAndApplyQuality(all);applyDecisionsToLiveFrames();qualityPreparationDone=true;emit('quality-prepared',{qualityScoreFieldAvailable,total:all.length,rejected:qualityRejectedFrames,continuityOverrides:qualityKeptForContinuity.size,medianJourneyQualityScore:qualityMedian,sequenceStats:Object.fromEntries(sequenceQuality)})}catch(e){qualityPreparationError=String(e?.message||e);qualityPreparationDone=true;emit('quality-preparation-error',{message:qualityPreparationError})}
  }
  window.__journeyQualityReady=prepareQuality();

  function local1024(i){const f=frames()[i];if(!f)return'';return String(f.raw1024Url||f.thumb_1024_url||'')}
  function hasQualitySource(i){const f=frames()[i];return !!(local1024(i)||(f?.provider==='Mapillary'&&f?.id&&token()))}
  async function resolve1024(i){
    const f=frames()[i];if(!f)return null;const local=local1024(i);if(local)return{url:local,tier:'1024'};const id=String(f.id||'');if(!id||f.provider!=='Mapillary')return null;
    if(meta1024.has(id)){const u=meta1024.get(id);return u?{url:u,tier:'1024'}:null}if(meta1024Inflight.has(id)){const u=await meta1024Inflight.get(id);return u?{url:u,tier:'1024'}:null}const t=token();if(!t)return null;
    const p=(async()=>{try{const r=await fetch(`${GRAPH}/${encodeURIComponent(id)}?fields=thumb_1024_url`,{headers:{Authorization:`OAuth ${t}`},cache:'force-cache'}),j=await r.json().catch(()=>({})),u=r.ok&&!j?.error?String(j?.thumb_1024_url||''):'';meta1024.set(id,u);metadataLoads++;if(u){f.raw1024Url=u;f.thumb_1024_url=u}return u}catch{metadataErrors++;meta1024.set(id,'');return''}finally{meta1024Inflight.delete(id)}})();meta1024Inflight.set(id,p);const u=await p;return u?{url:u,tier:'1024'}:null;
  }
  function strideFor(ahead){if(ahead>=FULL_RATE_RAW_AHEAD)return 1;if(ahead>=MIN_RAW_AHEAD)return 1;return Infinity}
  function setDirectSrc(im,url){directBypassLoads++;im.setAttribute('src',String(url||''))}
  function rebuildUrlFrameCache(){urlFrameCache.clear();const list=frames();for(let i=0;i<list.length;i++)for(const u of [list[i]?.url,list[i]?.sourceUrl,list[i]?.raw256Url,list[i]?.raw1024Url,list[i]?.thumb_256_url,list[i]?.thumb_1024_url])if(u)urlFrameCache.set(norm(u),i)}
  function frameForImage(image){if(!(image instanceof HTMLImageElement))return null;const key=norm(image.currentSrc||image.src);let v=urlFrameCache.get(key);if(Number.isFinite(v))return v;rebuildUrlFrameCache();v=urlFrameCache.get(key);return Number.isFinite(v)?v:null}
  function verticalCorrection(frame){const items=[];for(let k=Math.max(0,frame-VERTICAL_RADIUS);k<=frame+VERTICAL_RADIUS;k++){const r=verticalSamples.get(k);if(!r)continue;const d=Math.abs(k-frame),w=r.confidence/(1+d*.55);items.push({v:r.centerY-.5,w})}if(!items.length)return{shift:0,confidence:0,samples:0};items.sort((a,b)=>a.v-b.v);const total=items.reduce((s,x)=>s+x.w,0);let acc=0,med=items[0].v;for(const x of items){acc+=x.w;if(acc>=total*.5){med=x.v;break}}const confidence=clamp(total/2.2,0,1),shift=clamp(-med*VERTICAL_GAIN,-VERTICAL_MAX_SHIFT,VERTICAL_MAX_SHIFT)*clamp((confidence-.08)/.42,.28,1);return{shift,confidence,samples:items.length}}
  window.addEventListener('journey-travel-axis',e=>{const r=e.detail||{},frame=Number(r.frame),cy=Number(r.centerY),conf=Number(r.confidence),kind=String(r.kind||'');if(!Number.isFinite(frame)||!Number.isFinite(cy)||!Number.isFinite(conf)||conf<VERTICAL_MIN_CONF||kind.startsWith('side-flow')||cy<-.25||cy>1.25)return;verticalSamples.set(frame,{centerY:cy,confidence:conf,kind});for(const k of verticalSamples.keys())if(k<currentIndex()-30||k>currentIndex()+60)verticalSamples.delete(k)});

  const priorDrawImage=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(image,...args){try{if(args.length===4&&this.canvas&&this.canvas.width>160&&this.canvas.height>220){const frame=frameForImage(image);if(Number.isFinite(frame)){let[x,y,w,h]=args;if([x,y,w,h].every(Number.isFinite)&&h>this.canvas.height*.92){const v=verticalCorrection(frame),ch=this.canvas.height,margin=Math.min(ch*.012,5),minY=ch-h+margin,maxY=-margin,safeMin=minY<=maxY?minY:ch-h,safeMax=minY<=maxY?maxY:0;if(Math.abs(v.shift)>.001){y=clamp(y+v.shift*ch,safeMin,safeMax);args=[x,y,w,h];verticalApplied++}window.__journeyVerticalCenter={version:VERSION,frame,shift:v.shift,anchorY:50-v.shift*100,confidence:v.confidence,samples:v.samples}}}}}catch{}return priorDrawImage.call(this,image,...args)};

  function ensureLayer(){if(layer?.isConnected)return layer;const viewer=document.getElementById('viewer');if(!viewer)return null;const oldA=document.getElementById('journeyQualityLayer');if(oldA)oldA.style.display='none';const oldB=document.getElementById('journeyHybridQualityLayer');if(oldB)oldB.style.display='none';shell=document.createElement('div');shell.id='journeyHybridQualityShell';shell.style.cssText='position:absolute;inset:0;z-index:3;pointer-events:none;opacity:0;transform:translateZ(0);backface-visibility:hidden;-webkit-mask-image:linear-gradient(to right,transparent 2%,rgba(0,0,0,.12) 7%,rgba(0,0,0,.38) 13%,rgba(0,0,0,.72) 19%,#000 25%,#000 75%,rgba(0,0,0,.72) 81%,rgba(0,0,0,.38) 87%,rgba(0,0,0,.12) 93%,transparent 98%);mask-image:linear-gradient(to right,transparent 2%,rgba(0,0,0,.12) 7%,rgba(0,0,0,.38) 13%,rgba(0,0,0,.72) 19%,#000 25%,#000 75%,rgba(0,0,0,.72) 81%,rgba(0,0,0,.38) 87%,rgba(0,0,0,.12) 93%,transparent 98%);will-change:opacity';vertical=document.createElement('div');vertical.style.cssText='position:absolute;inset:0;-webkit-mask-image:linear-gradient(to bottom,transparent 1%,rgba(0,0,0,.12) 6%,rgba(0,0,0,.38) 12%,rgba(0,0,0,.72) 18%,#000 23%,#000 81%,rgba(0,0,0,.72) 86%,rgba(0,0,0,.38) 91%,rgba(0,0,0,.12) 96%,transparent 99%);mask-image:linear-gradient(to bottom,transparent 1%,rgba(0,0,0,.12) 6%,rgba(0,0,0,.38) 12%,rgba(0,0,0,.72) 18%,#000 23%,#000 81%,rgba(0,0,0,.72) 86%,rgba(0,0,0,.38) 91%,rgba(0,0,0,.12) 96%,transparent 99%)';layer=document.createElement('img');layer.id='journeyHybridQualityLayer';layer.alt='';layer.decoding='sync';layer.draggable=false;layer.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;pointer-events:none;opacity:1;filter:none;mix-blend-mode:normal;transform:translate3d(0,0,0);backface-visibility:hidden;will-change:transform';vertical.appendChild(layer);shell.appendChild(vertical);viewer.appendChild(shell);return layer}
  function loadCandidate(im,source){return new Promise(resolve=>{let settled=false;const done=ok=>{if(settled)return;settled=true;im.onload=null;im.onerror=null;resolve(ok)};im.onload=()=>done(true);im.onerror=()=>done(false);setDirectSrc(im,source.url)})}
  function decodeImage(im){return typeof im.decode==='function'?im.decode().then(()=>true).catch(()=>false):Promise.resolve(true)}
  function loadQuality(index){if(rejected.has(index))return Promise.resolve(null);if(cache.has(index)||inflight.has(index))return inflight.get(index)||Promise.resolve(cache.get(index));const aheadAtStart=rawAhead(),required=requiredRawAhead();if(aheadAtStart<required){lowAheadSkips++;return Promise.resolve(null)}const promise=(async()=>{const started=performance.now(),source=await resolve1024(index);let lastSize={width:0,height:0,longEdge:0};if(!source)return null;emit('load-start',{index,requestedTier:'1024-only-center',rawAhead:aheadAtStart,requiredRawAhead:required,directBypass:true,prefetchDistance:index-currentIndex()});const im=document.createElement('img');im.decoding='async';im.referrerPolicy='no-referrer';const ok=await loadCandidate(im,source);if(!ok)return null;const decoded=await decodeImage(im),width=im.naturalWidth||0,height=im.naturalHeight||0,longEdge=Math.max(width,height);lastSize={width,height,longEdge};if(decoded&&longEdge>=EXPECTED_LONG_EDGE){cache.set(index,im);loads++;emit('load-complete',{index,elapsedMs:Math.round(performance.now()-started),width,height,longEdge,qualityTier:'1024-center-source',decoded:true,directBypass:true,sourceAttempt:1,rawAhead:rawAhead(),rawAheadAtStart:aheadAtStart,requiredRawAhead:required});return im}if(!decoded&&longEdge>=EXPECTED_LONG_EDGE)decodeErrors++;resolutionMismatches++;rejected.add(index);emit('resolution-mismatch',{index,...lastSize,directBypass:true,attemptedSources:['1024']});return null})().catch(()=>{errors++;rejected.add(index);emit('load-error',{index,directBypass:true});return null}).finally(()=>inflight.delete(index));inflight.set(index,promise);return promise}
  function prune(nowIndex){for(const k of cache.keys())if(k<nowIndex-1||k>nowIndex+15)cache.delete(k);for(const k of rejected)if(k<nowIndex-1||k>nowIndex+15)rejected.delete(k)}
  function schedule(){applyDecisionsToLiveFrames();const base=currentIndex(),ahead=rawAhead(),required=requiredRawAhead(),remaining=remainingAhead();let stride=strideFor(ahead);if(remaining<MIN_RAW_AHEAD&&ahead>=required)stride=1;lastStride=Number.isFinite(stride)?stride:null;if(ahead<required){lowAheadSkips++;return}if(!Number.isFinite(stride)||inflight.size>=MAX_QUALITY_INFLIGHT)return;let started=0;for(const offset of PREFETCH_ORDER){if(offset<PREFETCH_FROM||offset>PREFETCH_TO)continue;const i=base+offset;if(i>=frames().length)continue;if(!hasQualitySource(i)||cache.has(i)||inflight.has(i)||rejected.has(i))continue;loadQuality(i);started++;if(started>=MAX_QUALITY_INFLIGHT||inflight.size>=MAX_QUALITY_INFLIGHT)break}}
  function alignQualityLayer(index){if(!layer)return;const v=verticalCorrection(index),x=window.__journeyTravelAxis?.anchorForFrame?.(index,50),shiftY=v.shift*100;if(Number.isFinite(x))layer.style.objectPosition=`${clamp(x,2,98)}% 50%`;layer.style.transform=`translate3d(0,${shiftY.toFixed(2)}%,0)`}
  function showImage(image,index,age){const src=String(image?.currentSrc||image?.getAttribute?.('src')||'');if(!src)return false;const current=String(layer?.currentSrc||layer?.getAttribute?.('src')||'');if(current!==src)setDirectSrc(layer,src);alignQualityLayer(index);if(shell)shell.style.opacity='1';currentKey=index;const width=image.naturalWidth||0,height=image.naturalHeight||0,longEdge=Math.max(width,height),v=verticalCorrection(index);emit(age===0?'present-exact':'present-held',{index,keyIndex:index-age,age,rawAhead:rawAhead(),requiredRawAhead:requiredRawAhead(),stride:lastStride,width,height,longEdge,qualityTier:'1024-center',decoded:true,directBypass:true,fullFrameHighRes:false,centerHighRes:true,baseTier:'256',exactFrameOnly:age===0,renderMode:'feathered-center-1024-over-256',brightnessPreserved:true,verticalShift:v.shift,verticalConfidence:v.confidence});return true}
  function hideQuality(index,reason){if(shell)shell.style.opacity='0';currentKey=-1;misses++;emit('present-base-continuity',{index,reason,rawAhead:rawAhead(),requiredRawAhead:requiredRawAhead(),stride:lastStride,centerHighRes:false,baseTier:'256'})}
  function present(index){ensureLayer();if(!layer)return;prune(index);schedule();const exact=cache.get(index);if(exact&&showImage(exact,index,0)){exactHits++;return}for(let age=1;age<=MAX_HOLD_AGE;age++){const held=cache.get(index-age);if(held&&showImage(held,index,age)){heldHits++;return}}hideQuality(index,'center-quality-not-ready')}

  window.addEventListener('journey-frame-presented',e=>{const i=Number(e.detail?.index);if(Number.isFinite(i))present(i)});
  window.addEventListener('journey-playback-started',()=>{rebuildUrlFrameCache();ensureLayer();setTimeout(schedule,10)});
  window.addEventListener('journey-stream-updated',()=>{rebuildUrlFrameCache();applyDecisionsToLiveFrames();schedule()});
  setInterval(schedule,45);

  window.__journeyHybridQuality={version:VERSION,state:()=>({
    version:VERSION,mode:'feathered-center-1024-over-256',renderMode:'feathered-center-1024-over-256',exactFrameOnly:false,
    journeyQualityScore:qualityMedian,journeyQualityAverage:qualityAverage,qualityRejectedFrames,qualityUnknownFrames,qualityScoreFieldAvailable,qualityPreparationDone,qualityPreparationError,qualityWeights:QUALITY_WEIGHTS,qualityThresholds:QUALITY_THRESHOLDS,qualityContinuityOverrides:qualityKeptForContinuity.size,sequenceQuality:Object.fromEntries(sequenceQuality),
    rawAhead:rawAhead(),requiredRawAhead:requiredRawAhead(),remainingAhead:remainingAhead(),stride:lastStride,minRawAhead:MIN_RAW_AHEAD,fullRateRawAhead:FULL_RATE_RAW_AHEAD,maxInflight:MAX_QUALITY_INFLIGHT,
    prefetchFrom:PREFETCH_FROM,prefetchTo:PREFETCH_TO,prefetchOrder:PREFETCH_ORDER,cache:cache.size,inflight:inflight.size,rejected:rejected.size,loads,errors,resolutionMismatches,decodeErrors,exactHits,heldHits,misses,lowAheadSkips,directBypassLoads,sourceFallbackHits,currentKey,
    currentLongEdge:currentKey>=0?Math.max(cache.get(currentKey)?.naturalWidth||cache.get(currentKey-1)?.naturalWidth||0,cache.get(currentKey)?.naturalHeight||cache.get(currentKey-1)?.naturalHeight||0):0,
    currentTier:currentKey>=0?'1024-center':null,fullFrameHighRes:false,centerHighRes:currentKey>=0,brightnessPreserved:true,centerOpaqueWidthPercent:50,centerOpaqueHeightPercent:58,sourceCropSupported:false,
    verticalCenter:{samples:verticalSamples.size,applied:verticalApplied,maxShiftPercent:VERTICAL_MAX_SHIFT*100,current:window.__journeyVerticalCenter||null},metadata1024:{cache:meta1024.size,inflight:meta1024Inflight.size,loads:metadataLoads,errors:metadataErrors},
    qualityNote:'Phase A: Mapillary quality_score when available + configurable JourneyQualityScore. Low quality is removed only when the same sequence can bridge the gap; center 1024 overlay behavior remains intact.'
  }),test:{scoreFrame,sequenceStats,applyQualityToSequence,canBridge,qualityBand,qualityDecision}};
  emit('ready',{mode:'feathered-center-1024-over-256',phase:'A',qualityWeights:QUALITY_WEIGHTS,qualityThresholds:QUALITY_THRESHOLDS,minRawAhead:MIN_RAW_AHEAD,fullRateRawAhead:FULL_RATE_RAW_AHEAD,prefetchFrom:PREFETCH_FROM,prefetchTo:PREFETCH_TO,prefetchOrder:PREFETCH_ORDER,maxInflight:MAX_QUALITY_INFLIGHT,maxHoldAge:MAX_HOLD_AGE,directBypass:true,brightnessPreserved:true,verticalCentering:true,sourceFallback:false,qualityTier:'1024-only'});
})();
