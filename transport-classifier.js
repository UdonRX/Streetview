/* Streetview Journey transport classifier — OSM corridor + sequence hysteresis */
(()=>{
  'use strict';
  if(window.__journeyTransportClassifierInstalled)return;
  window.__journeyTransportClassifierInstalled=true;

  const VERSION='0.1.0';
  const CACHE_PREFIX='streetview:transport-classifier:v1:';
  const CACHE_TTL_MS=6*60*60*1000;
  const SAMPLE_POINTS=7;
  const TRANSITION_CONFIRM_FRAMES=3;
  const TYPES=new Set(['CAR','WALK','TRAIL','BIKE','TRAIN','UNKNOWN']);
  const state={version:VERSION,transportMode:'UNKNOWN',sequenceModes:{},cacheHits:0,requests:0,errors:0,last:null};

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const rad=v=>v*Math.PI/180;
  function hasCoords(f){return Number.isFinite(Number(f?.lat))&&Number.isFinite(Number(f?.lng))}
  function distanceMeters(a,b){if(!hasCoords(a)||!hasCoords(b))return NaN;const p1=rad(Number(a.lat)),p2=rad(Number(b.lat)),dp=p2-p1,dl=rad(Number(b.lng)-Number(a.lng)),s=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 12742000*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)))}
  function median(values){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return NaN;const m=a.length>>1;return a.length&1?a[m]:(a[m-1]+a[m])*.5}
  function timestampMs(v){if(v==null)return NaN;const n=Number(v);if(Number.isFinite(n))return n>1e12?n:n*1000;const d=Date.parse(String(v));return Number.isFinite(d)?d:NaN}
  function sequenceSpeed(frames){const speeds=[];for(let i=1;i<frames.length;i++){const a=frames[i-1],b=frames[i];if(String(a?.sequenceId||'')!==String(b?.sequenceId||''))continue;const dt=(timestampMs(b?.capturedAt)-timestampMs(a?.capturedAt))/1000,d=distanceMeters(a,b);if(Number.isFinite(dt)&&dt>.15&&dt<90&&Number.isFinite(d)&&d<250)speeds.push(d/dt)}return median(speeds)}
  function sampleFrames(frames,count=SAMPLE_POINTS){const good=frames.filter(hasCoords);if(good.length<=count)return good;const out=[];for(let i=0;i<count;i++)out.push(good[Math.round(i*(good.length-1)/(count-1))]);return out}
  function cacheKey(sequenceId,frames){const sample=sampleFrames(frames,1)[0]||frames[0]||{},lat=Number(sample.lat),lng=Number(sample.lng);return `${CACHE_PREFIX}${String(sequenceId||'unknown')}:${Number.isFinite(lat)?lat.toFixed(3):'x'}:${Number.isFinite(lng)?lng.toFixed(3):'x'}`}
  function readCache(key){try{const row=JSON.parse(localStorage.getItem(key)||'null');if(row&&Date.now()-Number(row.savedAt||0)<CACHE_TTL_MS)return row.value||null}catch{}return null}
  function writeCache(key,value){try{localStorage.setItem(key,JSON.stringify({savedAt:Date.now(),value}))}catch{}}
  function onFootRatio(frames){let yes=0,known=0;for(const f of frames){const v=f?.onFoot??f?.on_foot;if(v===true||v===1||v==='1'){yes++;known++}else if(v===false||v===0||v==='0')known++}return known?yes/known:NaN}
  function scoreFromOsm(osm,speed,onFoot){
    const c=osm?.counts||{...(osm?.highway||{}),...(osm?.railway||{})},scores={CAR:0,WALK:0,TRAIL:0,BIKE:0,TRAIN:0,UNKNOWN:0};
    scores.TRAIN+=(c.rail||0)*7+(c.tram||0)*6+(c.subway||0)*6+(c.light_rail||0)*6;
    scores.WALK+=(c.footway||0)*5+(c.pedestrian||0)*5+(c.steps||0)*6;
    scores.TRAIL+=(c.path||0)*5+(c.track||0)*5+(c.bridleway||0)*5;
    scores.BIKE+=(c.cycleway||0)*6;
    scores.CAR+=(c.motorway||0)*7+(c.trunk||0)*6+(c.primary||0)*5+(c.secondary||0)*4+(c.tertiary||0)*3+(c.residential||0)*2+(c.service||0)*1.5;
    if(Number.isFinite(onFoot)){if(onFoot>=.55){scores.WALK+=6;scores.TRAIL+=3;scores.CAR-=4}else if(onFoot<=.15)scores.CAR+=1}
    if(Number.isFinite(speed)){
      if(speed>=10)scores.CAR+=6;
      else if(speed>=5.5){scores.CAR+=4;scores.BIKE+=2}
      else if(speed>=2.2){scores.BIKE+=3;scores.WALK+=1}
      else if(speed<2.2){scores.WALK+=3;scores.TRAIL+=2}
    }
    if(scores.TRAIN>0&&scores.TRAIN>=Math.max(scores.CAR,scores.WALK,scores.TRAIL,scores.BIKE)*.85)return{type:'TRAIN',scores};
    const order=['WALK','TRAIL','BIKE','CAR','TRAIN'];let best='UNKNOWN',bestScore=0;for(const t of order){if(scores[t]>bestScore){best=t;bestScore=scores[t]}}
    if(bestScore<2)return{type:'UNKNOWN',scores};
    if(best==='TRAIL'&&Number.isFinite(speed)&&speed>8&&scores.CAR>=scores.TRAIL*.55)best='CAR';
    if(best==='WALK'&&(c.path||c.track||c.bridleway)&&!(c.footway||c.pedestrian||c.steps))best='TRAIL';
    return{type:best,scores};
  }
  async function osmForSequence(sequenceId,frames){
    const key=cacheKey(sequenceId,frames),cached=readCache(key);if(cached){state.cacheHits++;return cached}
    const points=sampleFrames(frames).map(f=>`${Number(f.lat).toFixed(6)},${Number(f.lng).toFixed(6)}`).join(';');
    if(!points)return{counts:{},ways:[],primaryType:'UNKNOWN',cached:false};
    state.requests++;
    try{
      const r=await fetch(`/api/imagery?mode=osm-transport&points=${encodeURIComponent(points)}`,{cache:'force-cache'}),j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error||`OSM ${r.status}`);writeCache(key,j);return j;
    }catch(error){state.errors++;return{counts:{},ways:[],primaryType:'UNKNOWN',error:String(error?.message||error)}}
  }
  function groups(frames){const m=new Map();for(const f of frames){const id=String(f?.sequenceId||'unknown');if(!m.has(id))m.set(id,[]);m.get(id).push(f)}return m}
  function routeMajority(frames){const weights={CAR:0,WALK:0,TRAIL:0,BIKE:0,TRAIN:0,UNKNOWN:0};for(const f of frames){const t=TYPES.has(f?.transportType)?f.transportType:'UNKNOWN';weights[t]++}let best='UNKNOWN',n=0;for(const [t,v] of Object.entries(weights))if(t!=='UNKNOWN'&&v>n){best=t;n=v}return best}
  function applyHysteresis(frames,sequenceModes){
    let active='UNKNOWN',candidate='UNKNOWN',run=0;
    for(const f of frames){const desired=sequenceModes[String(f?.sequenceId||'unknown')]||'UNKNOWN';if(active==='UNKNOWN'){active=desired;candidate=desired;run=TRANSITION_CONFIRM_FRAMES}else if(desired===active){candidate=desired;run=0}else if(desired===candidate){run++;if(run>=TRANSITION_CONFIRM_FRAMES){active=desired;run=0}}else{candidate=desired;run=1}f.transportType=TYPES.has(active)?active:'UNKNOWN'}
  }
  async function classifyRoute(frames){
    const list=Array.isArray(frames)?frames:[];if(!list.length)return{transportMode:'UNKNOWN',sequenceModes:{}};
    const sequenceModes={},details={};
    for(const [sequenceId,seqFrames] of groups(list)){
      const [osm]=await Promise.all([osmForSequence(sequenceId,seqFrames)]),speed=sequenceSpeed(seqFrames),foot=onFootRatio(seqFrames),decision=scoreFromOsm(osm,speed,foot);
      sequenceModes[sequenceId]=decision.type;details[sequenceId]={type:decision.type,speedMps:Number.isFinite(speed)?Math.round(speed*100)/100:null,onFootRatio:Number.isFinite(foot)?Math.round(foot*100)/100:null,osmCounts:osm?.counts||{...(osm?.highway||{}),...(osm?.railway||{})},scores:decision.scores,cache:!!osm?.cached,error:osm?.error||null};
    }
    applyHysteresis(list,sequenceModes);const transportMode=routeMajority(list);Object.assign(state,{transportMode,sequenceModes,details,last:{at:new Date().toISOString(),transportMode,sequenceModes,details}});
    try{window.dispatchEvent(new CustomEvent('journey-transport-classified',{detail:state.last}))}catch{}
    return state.last;
  }

  window.JourneyTransportClassifier={version:VERSION,classifyRoute,state:()=>JSON.parse(JSON.stringify(state)),test:{scoreFromOsm,sequenceSpeed,applyHysteresis}};
})();
