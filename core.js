'use strict';
const VERSION='mapillaryjs-endpoints-first-v8';
const TOKEN_KEY='streetview:mapillary-token';
const ROUTE_CACHE_KEY='streetview:mapillary-route-cache-v4';
const GRAPH='https://graph.mapillary.com';
const OVERPASS='https://overpass-api.de/api/interpreter';
const ELEVATION_API='https://api.open-meteo.com/v1/elevation';
const NOMINATIM='https://nominatim.openstreetmap.org/search';
const TARGET_FRAMES=50;
const DEFAULT_CADENCE=800;
const ENDPOINT_SEARCH_RADII=[80,200,450];
const ENDPOINT_SEARCH_LIMIT=100;
const ENDPOINT_LIMIT=560;
const ROUTE_CANDIDATE_MAX=2;
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
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={
  stage:'goal',pendingGoal:null,goal:null,start:null,selectedPlace:null,
  map:null,goalMarker:null,startMarker:null,poiMarkers:[],poiCacheKey:'',poiRequestId:0,
  route:null,provider:null,providerStats:null,routeCacheHit:false,routeResolveMs:null,
  routeSearchMs:null,routeSearchApiRequests:0,routeSearchRadiusM:0,routeSearchCandidates:0,graphRequestCount:0,
  viewer:null,cursor:0,playing:false,moveToken:0,successfulFrames:0,skippedFrames:0,consecutiveMoveErrors:0,
  transitionTimes:[],cadenceTimes:[],lastDisplayAt:null,lastTransitionMs:null,lastCadenceMs:null,
  currentProgress:null,currentRouteDistance:null,currentTravelHeading:null,currentViewHeading:null,userViewOffset:0,heldOffset:0,currentProjection:'—',pointerActive:false,correcting:false,
  maxProgressSeen:null,regressionStreak:0,reverseEvents:0,viewJumps:0,stopReason:'not-started',logs:[],initialDisplayMs:null,setupMs:null,
  preloadGeneration:0,preloaded:new Set(),preloadTimes:[],preloadTarget:0,preloadReadyAtOpen:0,preloadRateFps:null,preloadWallMs:null,preloadFailures:0,
  backgroundWarming:false,deadlineMisses:0,
  elevationLoading:false,elevationError:null,departureTime:null,arrivalTime:null,durationSec:null,totalDistanceM:null,totalAscentM:0,totalDescentM:0,
  seekWasPlaying:false,completed:false,tripClockTimer:null
};
function token(){try{return localStorage.getItem(TOKEN_KEY)||''}catch{return''}}
function setStatus(t){if($('status'))$('status').textContent=t}
function distanceMeters(a,b){const r=Math.PI/180,p1=a.lat*r,p2=b.lat*r,dp=(b.lat-a.lat)*r,dl=(b.lng-a.lng)*r,q=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 12742000*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)))}
function bearing(a,b){const r=Math.PI/180,p1=a.lat*r,p2=b.lat*r,dl=(b.lng-a.lng)*r,y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return norm360(Math.atan2(y,x)*180/Math.PI)}
function pointBbox(p,radiusM=120){const latPad=radiusM/111320,lngPad=radiusM/(111320*Math.max(.2,Math.cos(p.lat*Math.PI/180)));return`${p.lng-lngPad},${p.lat-latPad},${p.lng+lngPad},${p.lat+latPad}`}
function pointOf(meta){const c=meta?.computed_geometry?.coordinates;return Array.isArray(c)&&c.length>=2?{lat:Number(c[1]),lng:Number(c[0])}:null}
function sequenceOf(v){return String(v?.id??v??'').trim()}
function routeCacheSignature(){if(!state.start||!state.goal)return'';const q=p=>`${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;return`${q(state.start)}>${q(state.goal)}`}
function loadRouteCache(){try{const all=JSON.parse(localStorage.getItem(ROUTE_CACHE_KEY)||'{}'),hit=all[routeCacheSignature()];if(!hit||Date.now()-hit.savedAt>7*86400000||!Array.isArray(hit.route?.frames)||hit.route.frames.length<6)return null;return hit.route}catch{return null}}
function saveRouteCache(route){try{const all=JSON.parse(localStorage.getItem(ROUTE_CACHE_KEY)||'{}');all[routeCacheSignature()]={savedAt:Date.now(),route};const keys=Object.keys(all).sort((a,b)=>all[b].savedAt-all[a].savedAt);for(const k of keys.slice(12))delete all[k];localStorage.setItem(ROUTE_CACHE_KEY,JSON.stringify(all))}catch{}}
function resetTripTiming(){state.departureTime=new Date();state.durationSec=estimateDurationSec(state.totalDistanceM||0,state.totalAscentM||0);state.arrivalTime=new Date(state.departureTime.getTime()+state.durationSec*1000)}
function estimateDurationSec(distanceM,ascentM=0){const flat=(Math.max(0,distanceM)/1000/WALK_KMH)*3600,climb=(Math.max(0,ascentM)/600)*3600;return Math.max(60,Math.round(flat+climb))}
