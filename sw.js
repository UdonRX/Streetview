/* Streetview Journey Phase 4 playback continuity / cache-ready shell */
const SHELL_CACHE='streetview-shell-phase4-playbackfix-v10';
const IMAGE_CACHE='streetview-images-v0.1.0';
const SHELL=[
  '/','/index.html','/map.css','/phase3.css?v=0.3.1','/phase3-fast.js?v=0.3.1','/map.js?v=0.3.1',
  '/phase4-route.js?v=0.4.10','/journey.html','/journey-map.html','/playback-log.js?v=0.1.43',
  '/raw-runtime.js?v=0.1.47','/styles.css?v=0.1.6','/travel-axis.js?v=0.1.30','/travel-axis-worker.js?v=0.1.30',
  '/app.js?v=0.1.47','/diagnostics.js?v=0.1.30','/motion-worker.js?v=0.1.25','/manifest.webmanifest'
];
const IMAGE_LIMIT=160;
const PASSTHROUGH_HOSTS=new Set(['tiles.openfreemap.org','api.openstreetcam.org','tiles.mapillary.com','graph.mapillary.com','overpass-api.de','ja.wikipedia.org','wikimedia.org','upload.wikimedia.org']);
function isMapillaryImageHost(hostname){return hostname==='fbcdn.net'||hostname.endsWith('.fbcdn.net')}
self.addEventListener('install',event=>{event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>![SHELL_CACHE,IMAGE_CACHE].includes(k)).map(k=>caches.delete(k)));await self.clients.claim();})());});
async function trimImages(cache){const keys=await cache.keys();while(keys.length>IMAGE_LIMIT)await cache.delete(keys.shift());}
function textResponse(response,text,type){const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');headers.delete('etag');headers.set('content-type',type);headers.set('cache-control','no-store');return new Response(text,{status:response.status,statusText:response.statusText,headers});}
async function sourceResponse(request,fallbackPath=null){try{return await fetch(request,{cache:'no-store'});}catch{if(!fallbackPath)throw new Error('source-fetch-failed');const hit=await(await caches.open(SHELL_CACHE)).match(fallbackPath);if(hit)return hit;throw new Error('source-fetch-failed');}}

function patchJourneyMapSource(text){
  let out=text;
  out=out.replace("version:'0.1.41-loadsplit'","version:'0.1.47-cache-ready'");
  out=out.replace(
    "const out=new Array(refs.length).fill(null),fields='id,sequence,captured_at,computed_geometry,compass_angle,thumb_2048_url,is_pano';",
    "const out=new Array(refs.length).fill(null),fields='id,sequence,captured_at,computed_geometry,compass_angle,computed_compass_angle,thumb_256_url,thumb_1024_url,thumb_2048_url,is_pano';"
  );
  out=out.replace(
    "function frame(m,r){const c=m?.computed_geometry?.coordinates,source=m?.thumb_2048_url;if(!Array.isArray(c)||c.length<2||!source)return null;return{id:String(m.id),sequenceId:String(r.sequenceId),sequenceIndex:r.sequenceIndex,lat:+c[1],lng:+c[0],heading:Number.isFinite(+m.compass_angle)?+m.compass_angle:null,projection:m.is_pano?'SPHERE':'RECTILINEAR',fieldOfView:m.is_pano?360:100,sourceUrl:source,url:proxyUrl(source),provider:'Mapillary',capturedAt:m.captured_at||null}}",
    "function frame(m,r){const c=m?.computed_geometry?.coordinates,source=m?.thumb_2048_url||m?.thumb_1024_url||m?.thumb_256_url;if(!Array.isArray(c)||c.length<2||!source)return null;return{id:String(m.id),sequenceId:String(r.sequenceId),sequenceIndex:r.sequenceIndex,lat:+c[1],lng:+c[0],heading:Number.isFinite(+m.computed_compass_angle)?+m.computed_compass_angle:(Number.isFinite(+m.compass_angle)?+m.compass_angle:null),headingSource:Number.isFinite(+m.computed_compass_angle)?'sfm-computed':'exif',exifHeading:Number.isFinite(+m.compass_angle)?+m.compass_angle:null,computedHeading:Number.isFinite(+m.computed_compass_angle)?+m.computed_compass_angle:null,projection:m.is_pano?'SPHERE':'RECTILINEAR',fieldOfView:m.is_pano?360:100,sourceUrl:source,raw256Url:m?.thumb_256_url||null,raw1024Url:m?.thumb_1024_url||null,url:proxyUrl(source),provider:'Mapillary',capturedAt:m.captured_at||null}}"
  );
  out=out.replace("heading:Number.isFinite(f?.heading)?f.heading:null,url:safeUrl(f?.url)","heading:Number.isFinite(f?.heading)?f.heading:null,headingSource:f?.headingSource||null,url:safeUrl(f?.url)");
  out=out.replace('/raw-runtime.js?v=0.1.42','/raw-runtime.js?v=0.1.47').replace('/app.js?v=0.1.42','/app.js?v=0.1.47');
  return out;
}
async function journeyMapWithPlaybackLog(request){const response=await sourceResponse(request,'/journey-map.html');let text=patchJourneyMapSource(await response.text());text=text.includes('/playback-log.js?v=0.1.43')?text:text.replace('</body>','<script src="/playback-log.js?v=0.1.43"></script></body>');return textResponse(response,text,'text/html; charset=utf-8');}

function patchPhase4RouteSource(text){
  let out=text;
  out=out.replace("const fields = 'id,sequence,captured_at,computed_geometry,compass_angle,thumb_256_url,thumb_1024_url,thumb_2048_url,is_pano';","const fields = 'id,sequence,captured_at,computed_geometry,compass_angle,computed_compass_angle,thumb_256_url,thumb_1024_url,thumb_2048_url,is_pano';");
  out=out.replace("heading: Number.isFinite(+meta.compass_angle) ? +meta.compass_angle : null,","heading: Number.isFinite(+meta.computed_compass_angle) ? +meta.computed_compass_angle : (Number.isFinite(+meta.compass_angle) ? +meta.compass_angle : null),\n      headingSource: Number.isFinite(+meta.computed_compass_angle) ? 'sfm-computed' : 'exif',\n      exifHeading: Number.isFinite(+meta.compass_angle) ? +meta.compass_angle : null,\n      computedHeading: Number.isFinite(+meta.computed_compass_angle) ? +meta.computed_compass_angle : null,");
  return out;
}
async function phase4RouteWithRoadHeading(request){const response=await sourceResponse(request,'/phase4-route.js?v=0.4.10');const patched=patchPhase4RouteSource(await response.text());return textResponse(response,patched,'application/javascript; charset=utf-8');}

function patchRawRuntimeSource(text){
  let out=text;
  out=out.replace('/* Streetview Journey raw/analysis transport split v0.1.46 */','/* Streetview Journey raw/analysis transport split v0.1.47 cache-ready */').replace("const VERSION='0.1.46';","const VERSION='0.1.47';");
  out=out.replace(
    "function rawAhead(){const contiguous=contiguousRawAhead();if(contiguous||readyRawIndices.has(currentIndex()+1))return contiguous;return Number(window.__journeyPlaybackState?.rawAheadReady??window.__journeyDiagnostics?.rawAheadReady??0)}",
    "function rawAhead(){const i=currentIndex(),actual=Number(window.JourneyEngine?.contiguousRenderableAhead?.(i,64));if(Number.isFinite(actual))return actual;const contiguous=contiguousRawAhead();if(contiguous||readyRawIndices.has(i+1))return contiguous;return Number(window.__journeyPlaybackState?.rawAheadReady??window.__journeyDiagnostics?.rawAheadReady??0)}"
  );
  out=out.replace(/  function rawVariantFor\(raw,index\)\{[\s\S]*?\n  \}\n\n  function taskKey/,`  function rawVariantFor(raw,index){
    ensureRouteGeneration();
    const f=Number.isFinite(index)?frameAt(index):null,id=String(f?.id||''),offset=Number.isFinite(index)?index-currentIndex():99;
    const u256=id?light256Urls.get(id):null,u1024=id?light1024Urls.get(id):null;
    const ready256=id&&u256&&variantReady(index,'256')&&!variantFailed(id,'256-continuity');
    const ready1024=id&&u1024&&variantReady(index,'1024')&&!variantFailed(id,'1024');
    if(ready256&&ready1024)return{url:u1024,variant:'1024'};
    if(id&&u256&&!variantFailed(id,'256-continuity'))return{url:u256,variant:'256-continuity'};
    if(ready1024)return{url:u1024,variant:'1024'};
    if(id&&u1024&&contiguousVariantAhead('256',QUALITY_ENABLE_AT)>=QUALITY_ENABLE_AT&&!variantFailed(id,'1024'))return{url:u1024,variant:'1024'};
    if(id&&!lightDisabled&&!lightMisses.has(id))refreshLightUrls();
    if(!id||!variantFailed(id,'source'))return{url:raw,variant:'source'};
    rawVariantFailures.delete(id);return{url:raw,variant:'source'};
  }

  function taskKey`);
  out=out.replace("if(Number.isFinite(meta.index))readyRawIndices.delete(meta.index)","if(Number.isFinite(meta.index)&&!window.JourneyEngine?.hasRenderableFrame?.(meta.index))readyRawIndices.delete(meta.index)");
  out=out.replace("if(Number.isFinite(index))readyRawIndices.delete(index);emit('timeout'","if(Number.isFinite(index)&&!window.JourneyEngine?.hasRenderableFrame?.(index))readyRawIndices.delete(index);emit('timeout'");
  out=out.replace("get contiguousRawAhead(){return contiguousRawAhead()},get continuity256Ahead", "get contiguousRawAhead(){return rawAhead()},get internalContiguousRawAhead(){return contiguousRawAhead()},get continuity256Ahead");
  out=out.replace("rawVariant:'256 continuity lane + 1024 quality lane + source fallback'","rawVariant:'256 continuity first + 1024 quality after continuity + source fallback'");
  return out;
}
async function rawRuntimeWithContinuityPatch(request){const response=await sourceResponse(request,'/raw-runtime.js?v=0.1.47');const patched=patchRawRuntimeSource(await response.text());return textResponse(response,patched,'application/javascript; charset=utf-8');}

function patchAppSource(text){
  let out=text;
  out=out.replace('/* Streetview Journey v0.1.42 raw-first analysis hysteresis scheduler */','/* Streetview Journey v0.1.47 road-center cache-ready scheduler */').replace("const VERSION='0.1.42';","const VERSION='0.1.47-roadcenter-cache-ready';");
  out=out.replace('const URL_WINDOW_AHEAD=48,INITIAL_RAW_BUFFER=16,RAW_PRELOAD_AHEAD=18,RAW_CRITICAL_AHEAD=10,RAW_PRELOAD_CONCURRENCY=4,HEAVY_PRELOAD_AHEAD=3,PAIR_PRELOAD_AHEAD=2;','const URL_WINDOW_AHEAD=48,INITIAL_RAW_BUFFER=16,RAW_PRELOAD_AHEAD=18,RAW_CRITICAL_AHEAD=10,RAW_PRELOAD_CONCURRENCY=4,RAW_EMERGENCY_AHEAD=2,RAW_EMERGENCY_SLOTS=2,RAW_BORROW_AT=14,HEAVY_PRELOAD_AHEAD=3,PAIR_PRELOAD_AHEAD=2;');
  out=out.replace('const ANCHOR_WINDOW_RADIUS=2,CAMERA_WINDOW_RADIUS=3,CAMERA_MIN_TRACKS=8;','const ANCHOR_WINDOW_RADIUS=4,CAMERA_WINDOW_RADIUS=3,CAMERA_MIN_TRACKS=8;');
  out=out.replace("if(card){card.querySelector('.eyebrow').textContent='v0.1.40 ROLLING RAW BUFFER';card.querySelector('h1').textContent='0.08秒を最優先。実画像を先に貯めて途切れを防ぐ。';card.querySelector('.lead').textContent='URLは約48枚先まで、実画像は10〜18枚先を維持。4本のスライディングロードで1枚終わるたび次を補給する。'}","if(card){card.querySelector('.eyebrow').textContent='v0.1.47 CACHE READY';card.querySelector('h1').textContent='256連続画像を最優先し、実キャッシュで再生を判定する。';card.querySelector('.lead').textContent='道路中央補正と80ms再生は維持したまま、256 continuity・1024 quality・stream同期を一本化する。'}");
  out=out.replace(
    "const diag=window.__journeyDiagnostics={version:VERSION,worker:'starting',workerReady:false,lastWorkerPair:null,lastPairMs:0,frameCacheHits:0,tileCacheHits:0,pairCacheHits:0,deadlineFallbacks:0,opticalPairs:0,rawReady:0,targetMs:80,lastDeltaMs:0,latenessMs:0,maxLatenessMs:0,deadlineMisses:0,lastRenderPath:null,rawFallbacks:0,rawAheadReady:0,stabilizedAheadReady:0,pairAheadReady:0,rawQueue:0,rawActive:0,initialRawTarget:INITIAL_RAW_BUFFER,urlWindowAhead:URL_WINDOW_AHEAD};\n  let rawQueue=[],rawQueued=new Map(),rawWaiters=new Map(),rawActive=0,rawQueueGeneration=0,currentPlaybackIndex=0,heavyScheduled=false;",
    "const diag=window.__journeyDiagnostics={version:VERSION,centerMode:'sfm-heading+road-tangent-v1',worker:'starting',workerReady:false,lastWorkerPair:null,lastPairMs:0,frameCacheHits:0,tileCacheHits:0,pairCacheHits:0,deadlineFallbacks:0,opticalPairs:0,rawReady:0,targetMs:80,lastDeltaMs:0,latenessMs:0,maxLatenessMs:0,deadlineMisses:0,lastRenderPath:null,rawFallbacks:0,rawAheadReady:0,rawAheadTotalReady:0,stabilizedAheadReady:0,pairAheadReady:0,rawQueue:0,rawActive:0,rawEmergencyActive:0,rawBackgroundActive:0,initialRawTarget:INITIAL_RAW_BUFFER,urlWindowAhead:URL_WINDOW_AHEAD};\n  let rawQueue=[],rawQueued=new Map(),rawWaiters=new Map(),rawActive=0,rawEmergencyActive=0,rawBackgroundActive=0,rawQueueGeneration=0,currentPlaybackIndex=0,heavyScheduled=false;"
  );
  out=out.replace(
    "const stabilizedFrameCache=new Map(),stabilizedFrameReadyCache=new Map(),tileLayerCache=new Map(),preparedPairCache=new Map(),preparedPairReadyCache=new Map(),rollCommittedCache=new Map();",
    `const stabilizedFrameCache=new Map(),stabilizedFrameReadyCache=new Map(),tileLayerCache=new Map(),preparedPairCache=new Map(),preparedPairReadyCache=new Map(),rollCommittedCache=new Map();
  const renderableByIndex=new Map();
  let recoverableImageError=false;
  function frameCacheKey(i){const f=route[i];return f?String(f.id||f.sequenceId+':'+(f.sequenceIndex??i)||i):String(i)}
  function rememberRenderable(i,im){if(Number.isFinite(i)&&im&&im.naturalWidth>0)renderableByIndex.set(frameCacheKey(i),im);return im}
  function renderableFrame(i){if(!Number.isFinite(i)||i<0||i>=route.length)return null;const key=frameCacheKey(i),byIndex=renderableByIndex.get(key);if(byIndex?.naturalWidth>0)return byIndex;const url=route[i]?.url,byUrl=url?renderReadyCache.get(url):null;if(byUrl?.naturalWidth>0){rememberRenderable(i,byUrl);return byUrl}return null}
  function hasRenderableFrame(i){return !!renderableFrame(i)}
  function recoverPlaybackUI(){if(!recoverableImageError)return;recoverableImageError=false;if(ui.error)ui.error.hidden=true;if(ui.canvas)ui.canvas.style.opacity='1';if(ui.back)ui.back.hidden=false}`
  );
  out=out.replace(/  function travelBearing\(i\)\{[\s\S]*?\n  function geoAlignment\(i\)/,`  function sameSequence(a,b){const aa=String(a?.sequenceId||''),bb=String(b?.sequenceId||'');return !aa||!bb||aa===bb}
  function travelBearing(i){const c=route[i];if(!c)return null;let x=0,y=0,w=0;for(let s=1;s<=12&&i+s<route.length;s++){const n=route[i+s];if(!sameSequence(c,n))break;const d=distanceMeters(c,n);if(!Number.isFinite(d)||d<.8)continue;const br=bearing(c,n),ww=Math.min(d,22)/Math.pow(s,.55);x+=Math.cos(rad(br))*ww;y+=Math.sin(rad(br))*ww;w+=ww;if(d>=28)break}if(!w){for(let s=1;s<=8&&i-s>=0;s++){const p=route[i-s];if(!sameSequence(c,p))break;const d=distanceMeters(p,c);if(!Number.isFinite(d)||d<.8)continue;const br=bearing(p,c),ww=Math.min(d,18)/Math.pow(s,.6);x+=Math.cos(rad(br))*ww;y+=Math.sin(rad(br))*ww;w+=ww;if(d>=22)break}}return w?(deg(Math.atan2(y,x))+360)%360:(Number.isFinite(c.heading)?c.heading:null)}
  function isSphere(f){return String(f?.projection||'').toUpperCase()==='SPHERE'||(Number.isFinite(f?.fieldOfView)&&f.fieldOfView>=180)}
  function rawAnchorX(i){const f=route[i];if(!f)return 50;const tr=travelBearing(i),ih=Number.isFinite(f.heading)?f.heading:f.projectionYaw;if(!Number.isFinite(tr)||!Number.isFinite(ih))return 50;let d=angle(ih,tr);if(!isSphere(f))d=clamp(d,-42,42);return isSphere(f)?clamp(50+d/3.6,0,100):clamp(50+d/clamp(f.fieldOfView||100,55,150)*100,8,92)}
  function anchorX(i){if(anchorCache.has(i))return anchorCache.get(i);const base=rawAnchorX(i),sph=isSphere(route[i]);let sum=0,sw=0;for(let k=Math.max(0,i-ANCHOR_WINDOW_RADIUS);k<=Math.min(route.length-1,i+ANCHOR_WINDOW_RADIUS);k++){if(k!==i&&!sameSequence(route[i],route[k]))continue;let v=rawAnchorX(k);if(sph||isSphere(route[k])){let dd=v-base;if(dd>50)dd-=100;if(dd<-50)dd+=100;v=base+dd}else if(k!==i&&Math.abs(v-base)>26)continue;const d=Math.abs(k-i),ww=d===0?8:d===1?5:d===2?3:d===3?2:1;sum+=v*ww;sw+=ww}let v=sw?sum/sw:base;const prev=anchorCache.get(i-1);if(Number.isFinite(prev)&&sameSequence(route[i-1],route[i])){let dd=v-prev;if(sph){if(dd>50)dd-=100;if(dd<-50)dd+=100}v=prev+clamp(dd,-4.5,4.5)}if(sph)v=((v%100)+100)%100;else v=clamp(v,8,92);anchorCache.set(i,v);return v}
  function geoAlignment(i)`);
  out=out.replace(/  function rawPriority\(offset\)\{[\s\S]*?\n  function ensureRaw\(i,priority=-100\)/,`  function rawPriority(offset){return offset===1?-2000:offset===2?-1900:20+offset}
  function contiguousRawAhead(i,limit=RAW_PRELOAD_AHEAD){let ready=0;for(let k=i+1;k<=Math.min(route.length-1,i+limit);k++){if(!hasRenderableFrame(k))break;ready++}return ready}
  function settleRawWaiters(i,error,image){const list=rawWaiters.get(i);if(!list)return;rawWaiters.delete(i);for(const w of list){if(error)w.reject(error);else w.resolve(image)}}
  function isEmergencyRaw(item){return item.i>currentPlaybackIndex&&item.i<=currentPlaybackIndex+RAW_EMERGENCY_AHEAD}
  function nextRawQueueItem(){rawQueue.sort((a,b)=>a.priority-b.priority||a.i-b.i);const urgentIndex=rawQueue.findIndex(item=>item.generation===rawQueueGeneration&&isEmergencyRaw(item));if(urgentIndex>=0)return rawQueue.splice(urgentIndex,1)[0];const contiguous=contiguousRawAhead(currentPlaybackIndex);const backgroundCap=contiguous>=RAW_BORROW_AT?RAW_PRELOAD_CONCURRENCY:Math.max(1,RAW_PRELOAD_CONCURRENCY-RAW_EMERGENCY_SLOTS);if(rawBackgroundActive>=backgroundCap)return null;const idx=rawQueue.findIndex(item=>item.generation===rawQueueGeneration);return idx>=0?rawQueue.splice(idx,1)[0]:null}
  function pumpRawQueue(){let progressed=true;while(rawActive<RAW_PRELOAD_CONCURRENCY&&rawQueue.length&&progressed){progressed=false;const item=nextRawQueueItem();if(!item)break;progressed=true;rawQueued.delete(item.i);if(item.generation!==rawQueueGeneration)continue;const url=route[item.i]?.url;if(!url){settleRawWaiters(item.i,new Error('画像URLがありません'));continue}const renderable=renderableFrame(item.i);if(renderable){settleRawWaiters(item.i,null,renderable);continue}if(renderCache.has(url)){renderCache.get(url).then(im=>{rememberRenderable(item.i,im);recoverPlaybackUI();settleRawWaiters(item.i,null,im)}).catch(e=>settleRawWaiters(item.i,e));continue}const emergency=isEmergencyRaw(item);rawActive++;if(emergency)rawEmergencyActive++;else rawBackgroundActive++;Object.assign(diag,{rawActive,rawEmergencyActive,rawBackgroundActive});loadRender(url).then(im=>{rememberRenderable(item.i,im);recoverPlaybackUI();settleRawWaiters(item.i,null,im)}).catch(e=>settleRawWaiters(item.i,e)).finally(()=>{rawActive=Math.max(0,rawActive-1);if(emergency)rawEmergencyActive=Math.max(0,rawEmergencyActive-1);else rawBackgroundActive=Math.max(0,rawBackgroundActive-1);Object.assign(diag,{rawActive,rawEmergencyActive,rawBackgroundActive,rawQueue:rawQueue.length});pumpRawQueue();if(item.generation===rawQueueGeneration){warmAhead(currentPlaybackIndex);scheduleHeavy(currentPlaybackIndex)}})}diag.rawQueue=rawQueue.length}
  function enqueueRaw(i,priority=99){if(i<0||i>=route.length)return;const url=route[i]?.url;if(!url||hasRenderableFrame(i)||renderCache.has(url))return;const offset=i-currentPlaybackIndex,urgent=offset>=1&&offset<=RAW_EMERGENCY_AHEAD,p=urgent?rawPriority(offset):priority,existing=rawQueued.get(i);if(existing){existing.priority=Math.min(existing.priority,p);rawQueue.sort((a,b)=>a.priority-b.priority||a.i-b.i);return}const item={i,priority:p,generation:rawQueueGeneration};rawQueued.set(i,item);rawQueue.push(item);diag.rawQueue=rawQueue.length;pumpRawQueue()}
  function ensureRaw(i,priority=-100)`);
  out=out.replace(/  function ensureRaw\(i,priority=-100\)\{[\s\S]*?\n  function loadCors\(url\)/,`  function ensureRaw(i,priority=-100){const url=route[i]?.url;if(!url)return Promise.reject(new Error('画像URLがありません'));const actual=renderableFrame(i);if(actual)return Promise.resolve(actual);const active=renderCache.get(url);if(active)return active.then(im=>rememberRenderable(i,im));enqueueRaw(i,priority);const after=renderCache.get(url);if(after)return after.then(im=>rememberRenderable(i,im));return new Promise((resolve,reject)=>{const list=rawWaiters.get(i)||[];list.push({resolve:image=>resolve(rememberRenderable(i,image)),reject});rawWaiters.set(i,list);pumpRawQueue()})}
  function loadCors(url)`);
  out=out.replace(/  function streamState\(\)\{return window\.__journeyStreamState\|\|null\}\n  function syncStreamFrames\(\)\{[\s\S]*?\n  function aheadCounts\(i\)/,`  function streamState(){return window.__journeyStreamState||null}
  function syncPlaybackAvailability(){const s=streamState(),total=Math.max(route.length,Number(s?.total)||0),p=window.__journeyPlaybackState;if(p){p.available=route.length;p.total=total;p.streaming=!!s?.active}}
  function syncStreamFrames(){const s=streamState();if(!s||!Array.isArray(s.frames)){syncPlaybackAvailability();return 0}const limit=Math.min(s.frames.length,currentPlaybackIndex+1+URL_WINDOW_AHEAD),seen=new Set(route.map(f=>String(f?.id||f?.url||'')));let added=0;for(const f of s.frames){if(route.length>=limit)break;const k=String(f?.id||f?.url||'');if(!k||seen.has(k))continue;seen.add(k);route.push(f);added++}syncPlaybackAvailability();return added}
  function aheadCounts(i)`);
  out=out.replace(/  function aheadCounts\(i\)\{[\s\S]*?\n  function scheduleHeavy\(i\)/,`  function aheadCounts(i){let totalRaw=0,st=0,pair=0;for(let k=i+1;k<=Math.min(route.length-1,i+RAW_PRELOAD_AHEAD);k++)if(hasRenderableFrame(k))totalRaw++;const raw=contiguousRawAhead(i);for(let k=i+1;k<=Math.min(route.length-1,i+RAW_PRELOAD_AHEAD);k++)if(stabilizedFrameReadyCache.has(k))st++;for(let k=i;k<Math.min(route.length-1,i+PAIR_PRELOAD_AHEAD);k++)if(preparedPairReadyCache.has(k))pair++;diag.rawAheadReady=raw;diag.rawAheadTotalReady=totalRaw;diag.stabilizedAheadReady=st;diag.pairAheadReady=pair;return{raw,rawTotal:totalRaw,st,pair}}
  function criticalRawReady(i){return contiguousRawAhead(i,RAW_CRITICAL_AHEAD)>=Math.min(RAW_CRITICAL_AHEAD,Math.max(0,route.length-i-1))}
  function scheduleHeavy(i)`);
  out=out.replace("function trimJourneyCaches(i){const cut=Math.max(0,i-CACHE_BEHIND);for(let k=0;k<cut;k++){const u=route[k]?.url;","function trimJourneyCaches(i){const cut=Math.max(0,i-CACHE_BEHIND);for(let k=0;k<cut;k++){renderableByIndex.delete(frameCacheKey(k));const u=route[k]?.url;");
  out=out.replace('window.__journeyPlaybackState={index:i,available:','window.__journeyPlaybackState={index:i,centerMode:diag.centerMode,roadAnchorX:Math.round(anchorX(i)*10)/10,roadBearing:Number.isFinite(travelBearing(i))?Math.round(travelBearing(i)*10)/10:null,viewHeading:Number.isFinite(route[i]?.heading)?Math.round(route[i].heading*10)/10:null,headingSource:route[i]?.headingSource||null,available:');
  out=out.replace('rawQueue:diag.rawQueue,rawActive:diag.rawActive,initialRawTarget:INITIAL_RAW_BUFFER,urlWindowAhead:URL_WINDOW_AHEAD};ui.num.textContent=','rawQueue:diag.rawQueue,rawActive:diag.rawActive,rawEmergencyActive:diag.rawEmergencyActive,rawBackgroundActive:diag.rawBackgroundActive,rawAheadTotalReady:ahead.rawTotal,initialRawTarget:INITIAL_RAW_BUFFER,urlWindowAhead:URL_WINDOW_AHEAD};ui.num.textContent=');
  out=out.replace("st=stabilizedFrameReadyCache.get(i),im=renderReadyCache.get(route[i]?.url);","st=stabilizedFrameReadyCache.get(i),im=renderableFrame(i);");
  out=out.replace("path,ahead:aheadCounts(i)}","path,anchorX:Math.round(anchorX(i)*10)/10,roadBearing:Number.isFinite(travelBearing(i))?Math.round(travelBearing(i)*10)/10:null,viewHeading:Number.isFinite(route[i]?.heading)?Math.round(route[i].heading*10)/10:null,headingSource:route[i]?.headingSource||null,ahead:aheadCounts(i)}");
  out=out.replace("diag.lastRenderPath=path;try{window.dispatchEvent(new CustomEvent('journey-frame-presented'","diag.lastRenderPath=path;recoverPlaybackUI();try{window.dispatchEvent(new CustomEvent('journey-frame-presented'");
  out=out.replace("const im=renderReadyCache.get(f.url)||await loadRender(f.url);drawRaw(0,im);","const im=renderableFrame(0)||renderReadyCache.get(f.url)||await loadRender(f.url);rememberRenderable(0,im);recoverPlaybackUI();drawRaw(0,im);");
  out=out.replace("function clearJourneyCaches(){rawQueueGeneration++;rawQueue=[];rawQueued.clear();rawWaiters.clear();heavyScheduled=false;currentPlaybackIndex=0;","function clearJourneyCaches(){rawQueueGeneration++;rawQueue=[];rawQueued.clear();rawWaiters.clear();rawActive=0;rawEmergencyActive=0;rawBackgroundActive=0;heavyScheduled=false;currentPlaybackIndex=0;");
  out=out.replace("].forEach(c=>c.clear());Object.assign(diag,", "].forEach(c=>c.clear());renderableByIndex.clear();recoverableImageError=false;Object.assign(diag,");
  out=out.replace("rawAheadReady:0,stabilizedAheadReady:0,pairAheadReady:0,rawQueue:0,rawActive})}","rawAheadReady:0,rawAheadTotalReady:0,stabilizedAheadReady:0,pairAheadReady:0,rawQueue:0,rawActive,rawEmergencyActive,rawBackgroundActive})}");
  out=out.replace(/  async function waitForRawFrame\(index,pt\)\{[\s\S]*?\n  async function play\(frames\)/,`  async function waitForRawFrame(index,pt){const initialUrl=route[index]?.url;if(!initialUrl)throw new Error('画像URLがありません');const first=renderableFrame(index);if(first)return{image:first,waitedMs:0};const started=performance.now();try{window.dispatchEvent(new CustomEvent('journey-image-wait-start',{detail:{index,ahead:aheadCounts(Math.max(0,index-1))}}))}catch{}let lastError=null;for(let attempt=0;attempt<4&&pt===token;attempt++){const ready=renderableFrame(index);if(ready){recoverPlaybackUI();const waitedMs=performance.now()-started;try{window.dispatchEvent(new CustomEvent('journey-image-wait-resolved',{detail:{index,waitedMs:Math.round(waitedMs),attempt,ahead:aheadCounts(Math.max(0,index-1))}}))}catch{}return{image:ready,waitedMs}}const url=route[index]?.url;if(!url)throw new Error('画像URLがありません');try{const image=await ensureRaw(index,-3000-attempt);if(pt!==token)throw new Error('playback-cancelled');rememberRenderable(index,image);recoverPlaybackUI();const waitedMs=performance.now()-started;try{window.dispatchEvent(new CustomEvent('journey-image-wait-resolved',{detail:{index,waitedMs:Math.round(waitedMs),attempt,ahead:aheadCounts(Math.max(0,index-1))}}))}catch{}return{image,waitedMs}}catch(error){lastError=error;if(pt!==token)throw error;renderCache.delete(url);renderReadyCache.delete(url);enqueueRaw(index,-4000-attempt);await sleep(20)}}const late=renderableFrame(index);if(late){recoverPlaybackUI();return{image:late,waitedMs:performance.now()-started}}throw lastError||new Error('画像を読み込めませんでした')}
  async function play(frames)`);
  out=out.replace("if(!renderReadyCache.has(route[target]?.url)){await waitForRawFrame(target,pt);","if(!hasRenderableFrame(target)){await waitForRawFrame(target,pt);");
  out=out.replace("function showStartError(e){ui.canvas.style.opacity='0';ui.back.hidden=true;ui.err.textContent=e?.message||'不明なエラーが発生しました';","function showStartError(e){const message=e?.message||'不明なエラーが発生しました';recoverableImageError=/画像|タイムアウト/.test(message);ui.canvas.style.opacity='0';ui.back.hidden=true;ui.err.textContent=message;");
  out=out.replace("window.JourneyEngine={startFrames,reset,getState:()=>({...window.__journeyPlaybackState,routeLength:route.length,version:VERSION,","window.JourneyEngine={startFrames,reset,getState:()=>({...window.__journeyPlaybackState,available:route.length,total:Math.max(route.length,streamState()?.total||0),streaming:!!streamState()?.active,routeLength:route.length,actualRenderableAhead:contiguousRawAhead(currentPlaybackIndex),version:VERSION,");
  out=out.replace("rawQueue:diag.rawQueue,rawActive:diag.rawActive,initialRawTarget:INITIAL_RAW_BUFFER,urlWindowAhead:URL_WINDOW_AHEAD})};","rawQueue:diag.rawQueue,rawActive:diag.rawActive,rawEmergencyActive:diag.rawEmergencyActive,rawBackgroundActive:diag.rawBackgroundActive,rawAheadTotalReady:diag.rawAheadTotalReady,initialRawTarget:INITIAL_RAW_BUFFER,urlWindowAhead:URL_WINDOW_AHEAD}),hasRenderableFrame:i=>hasRenderableFrame(Number(i)),contiguousRenderableAhead:(i=currentPlaybackIndex,limit=RAW_PRELOAD_AHEAD)=>contiguousRawAhead(Number.isFinite(Number(i))?Number(i):currentPlaybackIndex,Number(limit)||RAW_PRELOAD_AHEAD)};");
  out=out.replace("try{window.dispatchEvent(new CustomEvent('journey-engine-ready'","window.addEventListener('journey-image-load',e=>{const d=e.detail||{};if(d.purpose==='raw'&&d.phase==='complete')recoverPlaybackUI()});\n  try{window.dispatchEvent(new CustomEvent('journey-engine-ready'");
  return out;
}
async function appWithSchedulerPatch(request){const response=await sourceResponse(request,'/app.js?v=0.1.47');const patched=patchAppSource(await response.text());return textResponse(response,patched,'application/javascript; charset=utf-8');}

self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;const url=new URL(request.url);
  if(url.origin===self.location.origin&&url.pathname==='/journey-map.html'){event.respondWith(journeyMapWithPlaybackLog(request));return;}
  if(url.origin===self.location.origin&&url.pathname==='/app.js'){event.respondWith(appWithSchedulerPatch(request));return;}
  if(url.origin===self.location.origin&&url.pathname==='/raw-runtime.js'){event.respondWith(rawRuntimeWithContinuityPatch(request));return;}
  if(url.origin===self.location.origin&&url.pathname==='/phase4-route.js'){event.respondWith(phase4RouteWithRoadHeading(request));return;}
  if(PASSTHROUGH_HOSTS.has(url.hostname)||isMapillaryImageHost(url.hostname)){event.respondWith(fetch(request));return;}
  if(request.destination==='image'&&url.origin!==self.location.origin){if(request.mode==='cors'){event.respondWith(fetch(request));return;}event.respondWith((async()=>{const cache=await caches.open(IMAGE_CACHE),hit=await cache.match(request);if(hit)return hit;const response=await fetch(request);if(response.ok||response.type==='opaque'){event.waitUntil(cache.put(request,response.clone()).then(()=>trimImages(cache)).catch(()=>{}));}return response;})());return;}
  if(url.origin===self.location.origin&&!url.pathname.startsWith('/api/')){event.respondWith((async()=>{const cache=await caches.open(SHELL_CACHE);try{const response=await fetch(request,{cache:'no-store'});if(response.ok)await cache.put(request,response.clone());return response;}catch(error){const hit=await cache.match(request);if(hit)return hit;throw error;}})());}
});
