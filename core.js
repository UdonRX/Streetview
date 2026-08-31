'use strict';
const VERSION='mapillaryjs-main-v5';
const TOKEN_KEY='streetview:mapillary-token';
const ROUTE_CACHE_KEY='streetview:mapillary-route-cache-v1';
const GRAPH='https://graph.mapillary.com';
const TARGET_FRAMES=50;
const DEFAULT_CADENCE=800;
const MAX_ROUTE_DISTANCE=55;
const ENDPOINT_LIMIT=180;
const PRELOAD_SAMPLE=4;
const PRELOAD_MIN=6;
const PRELOAD_MAX=18;
const PRELOAD_WAIT_MAX_MS=14000;
const PRELOAD_CONCURRENCY=4;
const BACKGROUND_AHEAD=8;
const REGRESSION_SOFT=.018;
const REGRESSION_HARD=.08;
const REGRESSION_STREAK_LIMIT=3;
const CACHE_DEPTH={sequence:4,spherical:0,step:0,turn:0};
const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const average=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const norm360=v=>(Number(v)%360+360)%360;
const angleDiff=(a,b)=>{let d=norm360(a)-norm360(b);if(d>180)d-=360;if(d<-180)d+=360;return d};
const fmt=(v,d=0,u='')=>Number.isFinite(v)?`${Number(v).toFixed(d)}${u}`:'—';
const coordLabel=p=>p?`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`:'—';
const state={
  stage:'goal',goal:null,start:null,map:null,goalMarker:null,startMarker:null,route:null,provider:null,providerStats:null,
  viewer:null,cursor:0,playing:false,moveToken:0,successfulFrames:0,transitionTimes:[],cadenceTimes:[],lastDisplayAt:null,lastTransitionMs:null,lastCadenceMs:null,
  currentProgress:null,currentRouteDistance:null,currentTravelHeading:null,currentViewHeading:null,userViewOffset:0,heldOffset:0,currentProjection:'—',pointerActive:false,correcting:false,
  maxProgressSeen:null,regressionStreak:0,reverseEvents:0,viewJumps:0,stopReason:'not-started',logs:[],initialDisplayMs:null,setupMs:null,
  preloadGeneration:0,preloaded:new Set(),preloadTimes:[],preloadTarget:0,preloadReadyAtOpen:0,preloadRateFps:null,preloadWallMs:null,preloadFailures:0,
  backgroundWarming:false,deadlineMisses:0,routeCacheHit:false,routeResolveMs:null
};
function token(){try{return localStorage.getItem(TOKEN_KEY)||''}catch{return''}}
function setStatus(t){$('status').textContent=t}
function distanceMeters(a,b){const r=Math.PI/180,p1=a.lat*r,p2=b.lat*r,dp=(b.lat-a.lat)*r,dl=(b.lng-a.lng)*r,q=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 12742000*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)))}
function bearing(a,b){const r=Math.PI/180,p1=a.lat*r,p2=b.lat*r,dl=(b.lng-a.lng)*r,y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return norm360(Math.atan2(y,x)*180/Math.PI)}
function interpolate(a,b,t){return{lat:a.lat+(b.lat-a.lat)*t,lng:a.lng+(b.lng-a.lng)*t}}
function routeMetrics(p,start=state.start,goal=state.goal){const lat0=(start.lat+goal.lat)*.5*Math.PI/180,c=Math.cos(lat0),mx=111320*c,my=111320,vx=(goal.lng-start.lng)*mx,vy=(goal.lat-start.lat)*my,px=(p.lng-start.lng)*mx,py=(p.lat-start.lat)*my,den=vx*vx+vy*vy,t=den?(px*vx+py*vy)/den:0,tc=clamp(t,0,1);return{progress:t,distance:Math.hypot(px-vx*tc,py-vy*tc)}}
function pointBbox(p,radiusM=45){const latPad=radiusM/111320,lngPad=radiusM/(111320*Math.max(.2,Math.cos(p.lat*Math.PI/180)));return`${p.lng-lngPad},${p.lat-latPad},${p.lng+lngPad},${p.lat+latPad}`}
function pointOf(meta){const c=meta?.computed_geometry?.coordinates;return Array.isArray(c)&&c.length>=2?{lat:Number(c[1]),lng:Number(c[0])}:null}
function sequenceOf(v){return String(v?.id??v??'').trim()}
function routeCacheSignature(){if(!state.start||!state.goal)return'';const q=p=>`${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;return`${q(state.start)}>${q(state.goal)}`}
function loadRouteCache(){try{const all=JSON.parse(localStorage.getItem(ROUTE_CACHE_KEY)||'{}'),hit=all[routeCacheSignature()];if(!hit||Date.now()-hit.savedAt>7*86400000||!Array.isArray(hit.frames)||hit.frames.length<10)return null;return hit.route}catch{return null}}
function saveRouteCache(route){try{const all=JSON.parse(localStorage.getItem(ROUTE_CACHE_KEY)||'{}');all[routeCacheSignature()]={savedAt:Date.now(),route};const keys=Object.keys(all).sort((a,b)=>all[b].savedAt-all[a].savedAt);for(const k of keys.slice(8))delete all[k];localStorage.setItem(ROUTE_CACHE_KEY,JSON.stringify(all))}catch{}}
