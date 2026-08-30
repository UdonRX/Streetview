/* Streetview Journey Phase 4 preview: destination-aware full KartaView sequence segment + Mapillary image proxy */
const KARTA_API='https://api.openstreetcam.org/2.0';
const PAGE_SIZE=150;
const MAX_PAGES=120;
const DIRECT_TAP_LIMIT=220;
const MAPILLARY_IMAGE_TIMEOUT_MS=12000;

function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function extract(j){const d=j?.result?.data;if(Array.isArray(d))return d;if(d&&Array.isArray(d.photos))return d.photos;return[];}
function sid(p){return String(p?.sequenceId??p?.sequence?.id??'').trim();}
function imageUrl(p){return p?.fileurlLTh||p?.fileurlTh||p?.fileurlProc||p?.fileurl||null;}
function norm(p){const url=imageUrl(p);if(!url)return null;return{id:String(p.id??p.photoId??''),sequenceId:sid(p),sequenceIndex:num(p.sequenceIndex),lat:num(p.lat??p.matchLat),lng:num(p.lng??p.matchLng),heading:num(p.heading),projectionYaw:num(p.projectionYaw),projection:p.projection||null,fieldOfView:num(p.fieldOfView),width:num(p.width),height:num(p.height),url,provider:'KartaView'};}
function coords(p){return Number.isFinite(p?.lat)&&Number.isFinite(p?.lng);}
function dist(a,b){if(!coords(a)||!coords(b))return Infinity;const r=Math.PI/180,p1=a.lat*r,p2=b.lat*r,dp=(b.lat-a.lat)*r,dl=(b.lng-a.lng)*r,s=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 12742000*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)));}
function dedupe(list){const seen=new Set(),out=[];for(const raw of list){const p=norm(raw)||raw;if(!p?.url)continue;const k=p.id||`${p.sequenceId}:${p.sequenceIndex}`||p.url;if(seen.has(k))continue;seen.add(k);out.push(p);}out.sort((a,b)=>(a.sequenceIndex??0)-(b.sequenceIndex??0));return out;}
async function json(url){const r=await fetch(url,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`KartaView upstream ${r.status}`);const j=await r.json();if(Number(j?.status?.httpCode)>=400)throw new Error(`KartaView API ${j?.status?.apiCode||j?.status?.httpCode}`);return j;}
async function nearby(lat,lng,z){const q=new URLSearchParams({lat:String(lat),lng:String(lng),zoomLevel:String(z),join:'sequence',orderBy:'id',orderDirection:'desc'});try{return extract(await json(`${KARTA_API}/photo/?${q}`));}catch{return[];}}
async function page(sequenceId,pageNo){const q=new URLSearchParams({sequenceId,page:String(pageNo),itemsPerPage:String(PAGE_SIZE)});return extract(await json(`${KARTA_API}/photo/?${q}`));}
async function allSequence(sequenceId){
  const first=await page(sequenceId,1);
  let all=[...first];
  if(first.length<PAGE_SIZE)return dedupe(all);
  for(let start=2;start<=MAX_PAGES;start+=4){
    const nums=[start,start+1,start+2,start+3].filter(x=>x<=MAX_PAGES);
    const chunks=await Promise.all(nums.map(p=>page(sequenceId,p).catch(()=>[])));
    chunks.forEach(c=>all.push(...c));
    if(chunks.some(c=>c.length<PAGE_SIZE))break;
  }
  return dedupe(all);
}
function nearestIndex(frames,target){let best=-1,bd=Infinity;for(let i=0;i<frames.length;i++){const d=dist(frames[i],target);if(d<bd){bd=d;best=i;}}return{index:best,distance:bd};}
function routeSegment(frames,startIndex,dest){
  if(!frames.length)return{frames:[],destinationDistanceMeters:null,startIndex:0,endIndex:0};
  const start=Math.max(0,Math.min(frames.length-1,startIndex));
  if(!dest)return{frames:frames.slice(start),destinationDistanceMeters:null,startIndex:start,endIndex:frames.length-1};
  const hit=nearestIndex(frames,dest);
  if(hit.index<0)return{frames:frames.slice(start),destinationDistanceMeters:null,startIndex:start,endIndex:frames.length-1};
  const section=hit.index>=start?frames.slice(start,hit.index+1):frames.slice(hit.index,start+1).reverse();
  return{frames:section.length>=2?section:frames.slice(start),destinationDistanceMeters:hit.distance,startIndex:start,endIndex:hit.index};
}
async function directTap(lat,lng,dest){
  const target={lat,lng};
  const raw=(await Promise.all([18,17,16,15].map(z=>nearby(lat,lng,z)))).flat();
  const seen=new Set(),hits=[];
  for(const x of raw){
    const p=norm(x),sequenceId=sid(x);
    if(!p||!sequenceId||!coords(p))continue;
    const k=p.id||`${sequenceId}:${p.sequenceIndex}`;
    if(seen.has(k))continue;seen.add(k);
    hits.push({p,sequenceId,distance:dist(target,p)});
  }
  hits.sort((a,b)=>a.distance-b.distance);
  const hit=hits[0];
  if(!hit||!Number.isFinite(hit.distance)||hit.distance>DIRECT_TAP_LIMIT)return null;
  const frames=await allSequence(hit.sequenceId);
  if(frames.length<2)return null;
  let anchor=frames.findIndex(f=>f.id===hit.p.id);
  if(anchor<0&&Number.isFinite(hit.p.sequenceIndex)){
    let bd=Infinity;
    for(let i=0;i<frames.length;i++){
      if(!Number.isFinite(frames[i].sequenceIndex))continue;
      const d=Math.abs(frames[i].sequenceIndex-hit.p.sequenceIndex);
      if(d<bd){bd=d;anchor=i;}
    }
  }
  if(anchor<0)anchor=0;
  const seg=routeSegment(frames,anchor,dest);
  if(seg.frames.length<2)return null;
  return{version:'0.4.0',source:'KartaView',provider:'KartaView',sequenceId:hit.sequenceId,anchorIndex:anchor,destination:dest||null,selection:{strategy:dest?'destination-sequence-segment':'direct-nearest-photo-full',direction:seg.endIndex>=seg.startIndex?'forward':'reverse',proximityMeters:hit.distance,destinationDistanceMeters:seg.destinationDistanceMeters,searchMode:'tap-direct-full',candidateCount:1,visualOverride:false,totalSequenceFrames:frames.length,segmentStartIndex:seg.startIndex,segmentEndIndex:seg.endIndex},frames:seg.frames,candidateRoutes:[]};
}
function mapillaryImageUrl(raw){
  if(typeof raw!=='string'||!raw||raw.length>5000)return null;
  try{const u=new URL(raw);const h=u.hostname.toLowerCase();if(u.protocol!=='https:'||!(h==='fbcdn.net'||h.endsWith('.fbcdn.net')))return null;return u;}catch{return null;}
}
async function proxyMapillaryImage(req,res){
  const target=mapillaryImageUrl(String(req.query.url||''));
  if(!target)return res.status(400).json({error:'無効なMapillary画像URLです'});
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),MAPILLARY_IMAGE_TIMEOUT_MS);
  try{
    const upstream=await fetch(target,{signal:controller.signal,redirect:'follow',headers:{Accept:'image/avif,image/webp,image/apng,image/*,*/*;q=0.8','User-Agent':'Mozilla/5.0 StreetviewJourney/1.0'}});
    const finalUrl=mapillaryImageUrl(upstream.url||target.href);
    if(!finalUrl||!upstream.ok)return res.status(502).json({error:`Mapillary画像取得失敗 ${upstream.status}`});
    const type=upstream.headers.get('content-type')||'';
    if(!type.toLowerCase().startsWith('image/'))return res.status(502).json({error:'Mapillary画像レスポンスが画像ではありません'});
    const data=Buffer.from(await upstream.arrayBuffer());
    res.statusCode=200;
    res.setHeader('Content-Type',type);
    res.setHeader('Content-Length',String(data.length));
    res.setHeader('Cache-Control','public, max-age=300, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    return res.end(data);
  }catch(e){
    if(e?.name==='AbortError')return res.status(504).json({error:'Mapillary画像取得がタイムアウトしました'});
    console.error('mapillary image proxy error',e);
    return res.status(502).json({error:'Mapillary画像を取得できませんでした'});
  }finally{clearTimeout(timer);}
}

module.exports=async function handler(req,res){
  try{
    if(req.query.mode==='mapillary-image')return proxyMapillaryImage(req,res);
    res.setHeader('Cache-Control','public, s-maxage=60, stale-while-revalidate=300');
    res.setHeader('Content-Type','application/json; charset=utf-8');
    if((req.query.source||'karta')!=='karta')return res.status(400).json({error:'KartaViewルートのみこのAPIで扱います'});
    if(req.query.mode==='nearest'){
      const lat=Number(req.query.lat),lng=Number(req.query.lng);
      if(!Number.isFinite(lat)||!Number.isFinite(lng))return res.status(400).json({error:'有効な緯度・経度が必要です'});
      const dl=Number(req.query.destLat),dn=Number(req.query.destLng);
      const dest=Number.isFinite(dl)&&Number.isFinite(dn)?{lat:dl,lng:dn}:null;
      const route=await directTap(lat,lng,dest);
      if(!route)return res.status(404).json({error:`タップ地点から${DIRECT_TAP_LIMIT}m以内に直接選択できるKartaView sequenceが見つかりませんでした`});
      return res.status(200).json(route);
    }
    const sequenceId=String(req.query.sequence||'').trim();
    if(sequenceId){
      const frames=await allSequence(sequenceId);
      if(frames.length<2)return res.status(404).json({error:'再生可能な画像が不足しています'});
      return res.status(200).json({version:'0.4.0',source:'KartaView',provider:'KartaView',sequenceId,selection:{strategy:'full-sequence',totalSequenceFrames:frames.length},frames,candidateRoutes:[]});
    }
    return res.status(400).json({error:'Phase 4 previewでは地図上の撮影ルートを直接タップしてください'});
  }catch(e){
    console.error('imagery route error',e);
    return res.status(502).json({error:'KartaViewからルートを取得できませんでした'});
  }
};