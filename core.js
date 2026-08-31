'use strict';
const VERSION='mapillaryjs-route-fast-ui-v7';
const TOKEN_KEY='streetview:mapillary-token';
const ROUTE_CACHE_KEY='streetview:mapillary-route-cache-v3';
const GRAPH='https://graph.mapillary.com';
const OVERPASS='https://overpass-api.de/api/interpreter';
const ELEVATION_API='https://api.open-meteo.com/v1/elevation';
const NOMINATIM='https://nominatim.openstreetmap.org/search';
const TARGET_FRAMES=50;
const DEFAULT_CADENCE=800;
const MAX_ROUTE_DISTANCE=70;
const ENDPOINT_LIMIT=520;
const GOAL_SEARCH_RADII=[90,240,480];
const GOAL_SEARCH_LIMIT=120;
const CANDIDATE_MAX=5;
const PRELOAD_SAMPLE=4;
const PRELOAD_MIN=6;
const PRELOAD_MAX=18;
const PRELOAD_WAIT_MAX_MS=12000;
const PRELOAD_CONCURRENCY=4;
const BACKGROUND_AHEAD=10;
const REGRESSION_SOFT=.018;
const REGRESSION_HARD=.08;
const CACHE_DEPTH={sequence:4,spherical:0,step:0,turn:0};
const WALK_KMH=4.8;
const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const average=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const norm360=v=>(Number(v)%360+360)%360;
const angleDiff=(a,b)=>{let d=norm360(a)-norm360(b);if(d>180)d-=360;if(d<-180)d+=360;return d};
const fmt=(v,d=0,u='')=>Number.isFinite(v)?`${Number(v).toFixed(d)}${u}`:'—';
const coordLabel=p=>p?`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`:'—';
const timeLabel=d=>d instanceof Date&&!Number.isNaN(d)?d.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'—';
const distanceLabel=m=>!Number.isFinite(m)?'—':m>=1000?`${(m/1000).toFixed(m>=10000?0:2)} km`:`${Math.max(0,Math.round(m))} m`;
const escapeHtml=s=>String(s??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));
const state={stage:'goal',goal:null,start:null,pendingStart:null,selectedPlace:null,map:null,goalMarker:null,startMarker:null,pendingMarker:null,poiMarkers:[],poiCacheKey:'',candidateRoutes:[],selectedCandidateId:null,selectedCandidateDirection:null,selectedStartImageId:null,selectedGoalImageId:null,selectedSegmentDistanceM:null,candidateSearchMs:null,candidateApiRequests:0,candidateDeepLookups:0,destinationSearchRadiusM:0,graphRequestCount:0,route:null,provider:null,providerStats:null,viewer:null,cursor:0,playing:false,moveToken:0,successfulFrames:0,skippedFrames:0,consecutiveMoveErrors:0,transitionTimes:[],cadenceTimes:[],lastDisplayAt:null,lastTransitionMs:null,lastCadenceMs:null,currentProgress:null,currentRouteDistance:null,currentTravelHeading:null,currentViewHeading:null,userViewOffset:0,heldOffset:0,currentProjection:'—',pointerActive:false,correcting:false,maxProgressSeen:null,regressionStreak:0,reverseEvents:0,viewJumps:0,stopReason:'not-started',logs:[],initialDisplayMs:null,setupMs:null,preloadGeneration:0,preloaded:new Set(),preloadTimes:[],preloadTarget:0,preloadReadyAtOpen:0,preloadRateFps:null,preloadWallMs:null,preloadFailures:0,backgroundWarming:false,deadlineMisses:0,routeCacheHit:false,routeResolveMs:null,elevationLoading:false,elevationError:null,departureTime:null,arrivalTime:null,durationSec:null,totalDistanceM:null,totalAscentM:0,totalDescentM:0,seekWasPlaying:false,completed:false,tripClockTimer:null,poiRequestId:0};
function token(){try{return localStorage.getItem(TOKEN_KEY)||''}catch{return''}}
function setStatus(t){if($('status'))$('status').textContent=t}
function distanceMeters(a,b){const r=Math.PI/180,p1=a.lat*r,p2=b.lat*r,dp=(b.lat-a.lat)*r,dl=(b.lng-a.lng)*r,q=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 12742000*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)))}
function bearing(a,b){const r=Math.PI/180,p1=a.lat*r,p2=b.lat*r,dl=(b.lng-a.lng)*r,y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return norm360(Math.atan2(y,x)*180/Math.PI)}
function routeMetrics(p,start=state.start,goal=state.goal){if(!start||!goal)return{progress:0,distance:0};const lat0=(start.lat+goal.lat)*.5*Math.PI/180,c=Math.cos(lat0),mx=111320*c,my=111320,vx=(goal.lng-start.lng)*mx,vy=(goal.lat-start.lat)*my,px=(p.lng-start.lng)*mx,py=(p.lat-start.lat)*my,den=vx*vx+vy*vy,t=den?(px*vx+py*vy)/den:0,tc=clamp(t,0,1);return{progress:t,distance:Math.hypot(px-vx*tc,py-vy*tc)}}
function pointBbox(p,radiusM=120){const latPad=radiusM/111320,lngPad=radiusM/(111320*Math.max(.2,Math.cos(p.lat*Math.PI/180)));return`${p.lng-lngPad},${p.lat-latPad},${p.lng+lngPad},${p.lat+latPad}`}
function pointOf(meta){const c=meta?.computed_geometry?.coordinates;return Array.isArray(c)&&c.length>=2?{lat:Number(c[1]),lng:Number(c[0])}:null}
function sequenceOf(v){return String(v?.id??v??'').trim()}
function routeCacheSignature(){if(!state.start||!state.goal)return'';const q=p=>`${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;return`${state.selectedCandidateId||'auto'}:${state.selectedStartImageId||''}:${state.selectedGoalImageId||''}:${q(state.start)}>${q(state.goal)}`}
function loadRouteCache(){try{const all=JSON.parse(localStorage.getItem(ROUTE_CACHE_KEY)||'{}'),hit=all[routeCacheSignature()];if(!hit||Date.now()-hit.savedAt>7*86400000||!Array.isArray(hit.route?.frames)||hit.route.frames.length<8)return null;return hit.route}catch{return null}}
function saveRouteCache(route){try{const all=JSON.parse(localStorage.getItem(ROUTE_CACHE_KEY)||'{}');all[routeCacheSignature()]={savedAt:Date.now(),route};const keys=Object.keys(all).sort((a,b)=>all[b].savedAt-all[a].savedAt);for(const k of keys.slice(12))delete all[k];localStorage.setItem(ROUTE_CACHE_KEY,JSON.stringify(all))}catch{}}
function nearestPointOnLine(lngLat,coords){if(!coords?.length)return null;const p={lat:lngLat.lat,lng:lngLat.lng},lat0=p.lat*Math.PI/180,mx=111320*Math.cos(lat0),my=111320;let best=null,bestD=Infinity;for(let i=0;i<coords.length-1;i++){const a={lng:coords[i][0],lat:coords[i][1]},b={lng:coords[i+1][0],lat:coords[i+1][1]},ax=(a.lng-p.lng)*mx,ay=(a.lat-p.lat)*my,bx=(b.lng-p.lng)*mx,by=(b.lat-p.lat)*my,vx=bx-ax,vy=by-ay,den=vx*vx+vy*vy,t=den?clamp(-(ax*vx+ay*vy)/den,0,1):0,x=ax+vx*t,y=ay+vy*t,d=Math.hypot(x,y);if(d<bestD){bestD=d;best={lng:p.lng+x/mx,lat:p.lat+y/my,distance:d,segment:i,t}}}return best}
function lineDistance(coords){let total=0;for(let i=1;i<(coords?.length||0);i++)total+=distanceMeters({lng:coords[i-1][0],lat:coords[i-1][1]},{lng:coords[i][0],lat:coords[i][1]});return total}
function resetTripTiming(){state.departureTime=new Date();state.durationSec=estimateDurationSec(state.totalDistanceM||0,state.totalAscentM||0);state.arrivalTime=new Date(state.departureTime.getTime()+state.durationSec*1000)}
function estimateDurationSec(distanceM,ascentM=0){const flat=(Math.max(0,distanceM)/1000/WALK_KMH)*3600,climb=(Math.max(0,ascentM)/600)*3600;return Math.max(60,Math.round(flat+climb))}
