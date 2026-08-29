/* Streetview Journey v0.1.30 - guarded direction-aware selection + adaptive nearby search, single Vercel Hobby Function */
const KARTA_API='https://api.openstreetcam.org/2.0';
const MAX_FRAMES=72;
const CANDIDATE_LIMIT=5;
const PAGE_SIZE=150;
const DEFAULT_RADIUS=1200;
const PREFERRED_SEQUENCE_DISTANCE=1000;
const SOFT_SEQUENCE_DISTANCE=1800;
const MAX_SEQUENCE_DISTANCE=3000;
const SEARCH_RADII=[1200,1800,3000];

function numberOrNull(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function median(values){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=a.length>>1;return a.length&1?a[m]:(a[m-1]+a[m])*.5;}
function wrap180(v){return((v+540)%360)-180;}
function extractData(json){const data=json?.result?.data;if(Array.isArray(data))return data;if(data&&Array.isArray(data.photos))return data.photos;return [];}
function sequenceIdOf(photo){return String(photo?.sequenceId??photo?.sequence?.id??'').trim();}
function imageUrlOf(photo){return photo?.fileurlLTh||photo?.fileurlTh||photo?.fileurlProc||photo?.fileurl||null;}
function normalizePhoto(photo){const url=imageUrlOf(photo);if(!url)return null;return{id:String(photo.id??photo.photoId??''),sequenceId:sequenceIdOf(photo),sequenceIndex:numberOrNull(photo.sequenceIndex),lat:numberOrNull(photo.lat??photo.matchLat),lng:numberOrNull(photo.lng??photo.matchLng),heading:numberOrNull(photo.heading),projectionYaw:numberOrNull(photo.projectionYaw),projection:photo.projection||null,fieldOfView:numberOrNull(photo.fieldOfView),width:numberOrNull(photo.width),height:numberOrNull(photo.height),url};}
function hasCoords(p){return Number.isFinite(p?.lat)&&Number.isFinite(p?.lng);}
function distanceMeters(a,b){if(!hasCoords(a)||!hasCoords(b))return Infinity;const r=Math.PI/180,p1=a.lat*r,p2=b.lat*r,dp=(b.lat-a.lat)*r,dl=(b.lng-a.lng)*r,s=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 12742000*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)));}
function bearing(a,b){if(!hasCoords(a)||!hasCoords(b))return null;const r=Math.PI/180,p1=a.lat*r,p2=b.lat*r,dl=(b.lng-a.lng)*r,y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return(Math.atan2(y,x)/r+360)%360;}
function headingOf(p){return Number.isFinite(p?.heading)?p.heading:(Number.isFinite(p?.projectionYaw)?p.projectionYaw:null);}
function distanceGuard(distance){if(!Number.isFinite(distance))return{status:'blocked',allowed:false,penalty:1};if(distance>MAX_SEQUENCE_DISTANCE)return{status:'blocked',allowed:false,penalty:1};if(distance>SOFT_SEQUENCE_DISTANCE)return{status:'far',allowed:true,penalty:clamp((distance-PREFERRED_SEQUENCE_DISTANCE)/(MAX_SEQUENCE_DISTANCE-PREFERRED_SEQUENCE_DISTANCE),0,1)};if(distance>PREFERRED_SEQUENCE_DISTANCE)return{status:'soft',allowed:true,penalty:clamp((distance-PREFERRED_SEQUENCE_DISTANCE)/(MAX_SEQUENCE_DISTANCE-PREFERRED_SEQUENCE_DISTANCE),0,1)};return{status:'ok',allowed:true,penalty:0};}

function normalizeList(photos){const seen=new Set();const out=[];for(const raw of photos){const p=normalizePhoto(raw)||raw;if(!p?.url)continue;const key=p.id||p.url||`${p.sequenceId}:${p.sequenceIndex}`;if(seen.has(key))continue;seen.add(key);out.push(p);}out.sort((a,b)=>(a.sequenceIndex??0)-(b.sequenceIndex??0));return out;}
function anchorPosition(photos,anchorIndex){if(!photos.length)return 0;if(Number.isFinite(anchorIndex)){let exact=photos.findIndex(p=>Number.isFinite(p.sequenceIndex)&&p.sequenceIndex>=anchorIndex);if(exact>=0)return exact;exact=photos.findIndex(p=>Number.isFinite(p.sequenceIndex)&&Math.abs(p.sequenceIndex-anchorIndex)<=2);if(exact>=0)return exact;}return 0;}
function evaluationWindow(photos,anchorIndex){const normalized=normalizeList(photos);if(normalized.length<=MAX_FRAMES)return normalized;const at=anchorPosition(normalized,anchorIndex),start=clamp(at-Math.floor(MAX_FRAMES*.35),0,normalized.length-MAX_FRAMES);return normalized.slice(start,start+MAX_FRAMES);}
function playbackWindow(photos,anchorIndex,direction){const normalized=normalizeList(photos);if(!normalized.length)return[];const at=anchorPosition(normalized,anchorIndex);if(direction==='reverse'){let end=Math.min(normalized.length,at+1),start=Math.max(0,end-MAX_FRAMES);if(end-start<2){end=normalized.length;start=Math.max(0,end-MAX_FRAMES);}return normalized.slice(start,end).reverse();}let start=Math.min(Math.max(0,at),Math.max(0,normalized.length-1)),end=Math.min(normalized.length,start+MAX_FRAMES);if(end-start<2){start=Math.max(0,normalized.length-MAX_FRAMES);end=normalized.length;}return normalized.slice(start,end);}

function localBearing(frames,i){const a=frames[i];if(!a)return null;let sx=0,sy=0,sw=0;for(let s=1;s<=7&&i+s<frames.length;s++){const b=frames[i+s],d=distanceMeters(a,b);if(!Number.isFinite(d)||d<.8)continue;const br=bearing(a,b),w=Math.min(d,18)/(1+.35*(s-1));sx+=Math.cos(br*Math.PI/180)*w;sy+=Math.sin(br*Math.PI/180)*w;sw+=w;if(d>=20)break;}if(!sw)return null;return(Math.atan2(sy,sx)*180/Math.PI+360)%360;}
function alignmentStats(frames){
  const fwd=[],rev=[],stepDistances=[];let headingSamples=0,geometrySamples=0;
  for(let i=0;i<frames.length-1;i++){
    const d=distanceMeters(frames[i],frames[i+1]);if(Number.isFinite(d)&&d<80)stepDistances.push(d);
    const br=localBearing(frames,i);if(!Number.isFinite(br))continue;geometrySamples++;
    const hd=headingOf(frames[i]);if(!Number.isFinite(hd))continue;headingSamples++;
    fwd.push(Math.abs(wrap180(hd-br)));rev.push(Math.abs(wrap180(hd-((br+180)%360))));
  }
  const fwdErr=median(fwd),revErr=median(rev),hasHeading=Number.isFinite(fwdErr)&&Number.isFinite(revErr),direction=hasHeading&&revErr+7<fwdErr?'reverse':'forward',error=hasHeading?(direction==='reverse'?revErr:fwdErr):null,headingCoverage=geometrySamples?headingSamples/geometrySamples:0,medianStep=median(stepDistances),moving=stepDistances.filter(d=>d>=.35&&d<=45).length/Math.max(1,stepDistances.length),orientationScore=hasHeading?clamp(1-error/95,0,1):.46,continuityScore=clamp((frames.length-18)/54,0,1)*.55+clamp(moving,0,1)*.45;
  return{direction,alignmentErrorDeg:error,forwardErrorDeg:fwdErr,reverseErrorDeg:revErr,headingCoverage,orientationScore,continuityScore,medianStepMeters:medianStep,geometrySamples,headingSamples};
}

async function fetchJson(url){const response=await fetch(url,{headers:{Accept:'application/json'}});if(!response.ok)throw new Error(`KartaView upstream ${response.status}`);return response.json();}
async function nearbyRaw(lat,lng,radius){
  const common={lat:String(lat),lng:String(lng),join:'sequence',orderBy:'id',orderDirection:'desc',page:'1',itemsPerPage:'100'};
  const byRadius=new URLSearchParams({...common,radius:String(radius)});let raw=[];
  try{raw=extractData(await fetchJson(`${KARTA_API}/photo/?${byRadius}`));}catch{}
  if(raw.length)return raw;
  const zoomLevel=radius<=1300?'15':radius<=2200?'14':'13',byZoom=new URLSearchParams({...common,zoomLevel});
  try{return extractData(await fetchJson(`${KARTA_API}/photo/?${byZoom}`));}catch{return[];}
}
async function nearbyCandidates(lat,lng,requestedRadius){
  const target={lat,lng},bySeq=new Map(),radii=[...new Set([requestedRadius,...SEARCH_RADII].map(r=>clamp(Math.round(r),100,MAX_SEQUENCE_DISTANCE)).sort((a,b)=>a-b))];let usedRadius=radii[0]||requestedRadius;
  for(const radius of radii){usedRadius=radius;const raw=await nearbyRaw(lat,lng,radius);for(const photo of raw){const sequenceId=sequenceIdOf(photo);if(!sequenceId)continue;const p=normalizePhoto(photo);if(!p)continue;const dist=distanceMeters(target,p),guard=distanceGuard(dist);if(!guard.allowed||dist>radius*1.12)continue;const prev=bySeq.get(sequenceId);if(!prev||dist<prev.distance)bySeq.set(sequenceId,{sequenceId,sequenceIndex:p.sequenceIndex,distance:dist,photo:p,searchRadius:radius,distanceGuard:guard});}if(bySeq.size>=3)break;}
  return{candidates:[...bySeq.values()].sort((a,b)=>a.distance-b.distance).slice(0,CANDIDATE_LIMIT),searchRadius:usedRadius};
}
async function sequencePage(sequenceId,page){const params=new URLSearchParams({sequenceId,page:String(Math.max(1,page)),itemsPerPage:String(PAGE_SIZE)}),json=await fetchJson(`${KARTA_API}/photo/?${params}`);return extractData(json);}
async function sequenceWindow(sequenceId,sequenceIndex){
  const page=Number.isFinite(sequenceIndex)?Math.floor(Math.max(0,sequenceIndex)/PAGE_SIZE)+1:1,pages=[page];
  if(Number.isFinite(sequenceIndex)){const offset=((sequenceIndex%PAGE_SIZE)+PAGE_SIZE)%PAGE_SIZE;if(offset<54&&page>1)pages.unshift(page-1);if(offset>PAGE_SIZE-55)pages.push(page+1);}
  let chunks=await Promise.all(pages.map(p=>sequencePage(sequenceId,p).catch(()=>[]))),photos=normalizeList(chunks.flat());
  const nearAnchor=!Number.isFinite(sequenceIndex)||photos.some(p=>Number.isFinite(p.sequenceIndex)&&Math.abs(p.sequenceIndex-sequenceIndex)<=8);
  if((photos.length<2||!nearAnchor)&&page!==1){const fallback=await sequencePage(sequenceId,1).catch(()=>[]);photos=normalizeList([...photos,...fallback]);}
  if(photos.length<2&&page===1){const fallback=await sequencePage(sequenceId,2).catch(()=>[]);photos=normalizeList([...photos,...fallback]);}
  return photos;
}
async function evaluateCandidate(candidate,radius){
  try{
    const guard=distanceGuard(candidate.distance);if(!guard.allowed)return null;
    const photos=await sequenceWindow(candidate.sequenceId,candidate.sequenceIndex),evalFrames=evaluationWindow(photos,candidate.sequenceIndex);if(evalFrames.length<2)return null;
    const alignment=alignmentStats(evalFrames),proximityScore=clamp(1-candidate.distance/Math.max(radius,1),0,1),headingReliability=clamp(alignment.headingCoverage/.55,0,1),directionScore=alignment.orientationScore*(.55+.45*headingReliability),distancePenalty=guard.penalty;
    const score=.48*directionScore+.22*proximityScore+.20*alignment.continuityScore+.10*clamp(evalFrames.length/MAX_FRAMES,0,1)-.18*distancePenalty,frames=playbackWindow(photos,candidate.sequenceIndex,alignment.direction);
    return{...candidate,photos,frames,alignment,score,proximityScore,distanceGuard:guard};
  }catch{return null;}
}
async function selectNearbyRoute(lat,lng,radius){
  const nearby=await nearbyCandidates(lat,lng,radius),candidates=nearby.candidates;if(!candidates.length)return null;
  const evaluated=(await Promise.all(candidates.map(c=>evaluateCandidate(c,Math.max(radius,nearby.searchRadius))))).filter(Boolean).filter(c=>c.frames.length>=2);if(!evaluated.length)return null;
  evaluated.sort((a,b)=>b.score-a.score);const best=evaluated[0],guard=distanceGuard(best.distance);
  const candidateRoutes=evaluated.slice(0,3).map(c=>({sequenceId:c.sequenceId,anchorIndex:c.sequenceIndex,direction:c.alignment.direction,score:c.score,alignmentErrorDeg:c.alignment.alignmentErrorDeg,forwardErrorDeg:c.alignment.forwardErrorDeg,reverseErrorDeg:c.alignment.reverseErrorDeg,proximityMeters:c.distance,distanceGuard:c.distanceGuard?.status||'ok',frames:c.frames}));
  return{sequenceId:best.sequenceId,anchorIndex:best.sequenceIndex,frames:best.frames,candidateRoutes,selection:{strategy:'direction-aware-distance-guard',direction:best.alignment.direction,alignmentErrorDeg:best.alignment.alignmentErrorDeg,forwardErrorDeg:best.alignment.forwardErrorDeg,reverseErrorDeg:best.alignment.reverseErrorDeg,headingCoverage:best.alignment.headingCoverage,medianStepMeters:best.alignment.medianStepMeters,score:best.score,proximityMeters:best.distance,searchRadiusMeters:nearby.searchRadius,distanceGuard:{status:guard.status,preferredMeters:PREFERRED_SEQUENCE_DISTANCE,softMeters:SOFT_SEQUENCE_DISTANCE,hardLimitMeters:MAX_SEQUENCE_DISTANCE},candidateCount:evaluated.length,candidates:evaluated.slice(0,5).map(c=>({sequenceId:c.sequenceId,direction:c.alignment.direction,alignmentErrorDeg:c.alignment.alignmentErrorDeg,forwardErrorDeg:c.alignment.forwardErrorDeg,reverseErrorDeg:c.alignment.reverseErrorDeg,headingCoverage:c.alignment.headingCoverage,score:c.score,proximityMeters:c.distance,distanceGuard:c.distanceGuard?.status||'ok',frames:c.frames.length}))}};
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','public, s-maxage=300, stale-while-revalidate=1800');res.setHeader('Content-Type','application/json; charset=utf-8');
  try{
    if((req.query.source||'karta')!=='karta')return res.status(400).json({error:'v0.1ではKartaViewのみ有効です'});
    let sequenceId=String(req.query.sequence||'').trim(),anchorIndex=numberOrNull(req.query.index),frames=null,candidateRoutes=[],selection={strategy:'fixed',direction:'forward',alignmentErrorDeg:null,headingCoverage:0,score:null,candidateCount:1};
    if(!sequenceId){
      const lat=Number(req.query.lat),lng=Number(req.query.lng),radius=Math.min(MAX_SEQUENCE_DISTANCE,Math.max(100,Number(req.query.radius)||DEFAULT_RADIUS));
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return res.status(400).json({error:'有効な緯度・経度が必要です'});
      const nearby=await selectNearbyRoute(lat,lng,radius);if(!nearby)return res.status(404).json({error:`この周辺${MAX_SEQUENCE_DISTANCE}m以内では再生できるKartaViewの連続写真が見つかりませんでした`});
      sequenceId=nearby.sequenceId;anchorIndex=nearby.anchorIndex;frames=nearby.frames;selection=nearby.selection;candidateRoutes=nearby.candidateRoutes||[];
    }else{
      const photos=await sequenceWindow(sequenceId,anchorIndex);frames=playbackWindow(photos,anchorIndex,'forward');
    }
    if(!Array.isArray(frames)||frames.length<2)return res.status(404).json({error:'再生可能な画像が不足しています'});
    return res.status(200).json({version:'0.1.30',source:'KartaView',sequenceId,anchorIndex,selection,frames,candidateRoutes});
  }catch(error){console.error('imagery route error',error);return res.status(502).json({error:'KartaViewからルートを取得できませんでした'});}
};
