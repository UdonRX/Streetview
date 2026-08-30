/* Journey playback diagnostics: clock/load/fallback only. */
(()=>{
  if(window.__journeyPlaybackLoggerInstalled)return;
  window.__journeyPlaybackLoggerInstalled=true;
  const VERSION='0.1.39-priority-log',MAX_EVENTS=220,POLL_MS=160,STALL_MS=650,RAF_GAP_MS=180;
  const trace={schema:'streetview-journey-playback-diagnostic-v2',version:VERSION,startedAt:null,events:[]};
  let active=false,t0=0,lastIndex=null,lastAdvance=0,lastStall=0,lastRaf=performance.now();
  const round=v=>Number.isFinite(v)?Math.round(v*10)/10:null;
  function compact(){
    const p=window.__journeyPlaybackState||{},s=window.__journeyStreamState||{},e=window.JourneyEngine?.getState?.()||{},d=window.__journeyDiagnostics||{};
    return{
      index:Number.isFinite(p.index)?p.index:(Number.isFinite(e.index)?e.index:null),
      available:Number.isFinite(p.available)?p.available:(Number.isFinite(e.available)?e.available:null),
      total:Number.isFinite(p.total)?p.total:(Number.isFinite(e.total)?e.total:null),
      streaming:!!(p.streaming??e.streaming),
      clock:{targetMs:p.targetMs??e.targetMs??80,lastDeltaMs:round(p.lastDeltaMs??e.lastDeltaMs),latenessMs:round(p.latenessMs??e.latenessMs),maxLatenessMs:round(p.maxLatenessMs??e.maxLatenessMs),deadlineMisses:p.deadlineMisses??e.deadlineMisses??0},
      path:{last:p.lastRenderPath??e.lastRenderPath??null,rawFallbacks:p.rawFallbacks??e.rawFallbacks??d.deadlineFallbacks??0,optical:p.opticalPairs??e.opticalPairs??d.opticalPairs??0},
      ahead:{rawReady:p.rawAheadReady??e.rawAheadReady??null,stabilizedReady:p.stabilizedAheadReady??e.stabilizedAheadReady??null,pairReady:p.pairAheadReady??e.pairAheadReady??null},
      loader:{queued:p.rawQueue??e.rawQueue??d.rawQueue??null,active:p.rawActive??e.rawActive??d.rawActive??null},
      cache:{raw:e.readyFrames??d.rawReady??null,frame:e.frameCache??null,pair:e.pairCache??null,tile:e.tileLayerCache??null},
      stream:{active:!!s.active,complete:!!s.complete,failed:!!s.failed,frameCount:Array.isArray(s.frames)?s.frames.length:0},
      worker:{ready:!!d.workerReady,lastPairMs:round(d.lastPairMs)}
    };
  }
  function log(name,data={}){if(!active&&name!=='playback-trace-start')return;const row={tMs:Math.round(performance.now()-t0),name,...data};trace.events.push(row);if(trace.events.length>MAX_EVENTS)trace.events.shift()}
  function start(detail={}){if(active)return;active=true;t0=performance.now();trace.startedAt=new Date().toISOString();lastIndex=null;lastAdvance=t0;lastStall=0;log('playback-trace-start',{detail,state:compact()})}
  async function copy(){const payload={...trace,exportedAt:new Date().toISOString(),current:compact()};const text=JSON.stringify(payload,null,2);try{await navigator.clipboard.writeText(text);return true}catch{}try{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();return true}catch{return false}}
  function installButton(){let btn=document.getElementById('playbackLogCopy');if(!btn){btn=document.createElement('button');btn.id='playbackLogCopy';btn.type='button';document.body.appendChild(btn)}btn.textContent='再生ログコピー';btn.style.cssText='position:fixed;z-index:31;right:10px;top:calc(env(safe-area-inset-top) + 98px);height:30px;padding:0 9px;border:1px solid rgba(255,255,255,.22);border-radius:999px;background:rgba(5,8,12,.58);color:#fff;font:700 9px/1 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);pointer-events:auto';btn.onclick=async e=>{e.preventDefault();e.stopPropagation();const ok=await copy();btn.textContent=ok?'コピー完了':'コピー失敗';setTimeout(()=>btn.textContent='再生ログコピー',1000)}}
  window.__copyJourneyPlaybackLog=copy;
  window.addEventListener('journey-playback-started',e=>start(e.detail||{}));
  window.addEventListener('journey-frame-presented',e=>{if(active)log('present',e.detail||{})});
  window.addEventListener('journey-image-wait-start',e=>{if(active)log('wait-start',e.detail||{})});
  window.addEventListener('journey-image-wait-resolved',e=>{if(active)log('wait-resolved',e.detail||{})});
  window.addEventListener('journey-playback-ended',e=>{if(active)log('ended',{detail:e.detail||null,state:compact()})});
  document.addEventListener('visibilitychange',()=>{if(active&&document.visibilityState!=='visible')log('visibility',{value:document.visibilityState})});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installButton,{once:true});else installButton();
  setInterval(()=>{if(!active)return;const now=performance.now(),s=compact(),idx=s.index;if(idx!==lastIndex){const delta=lastIndex===null?0:now-lastAdvance;lastIndex=idx;lastAdvance=now;log('advance',{index:idx,deltaMs:round(delta),latenessMs:s.clock.latenessMs,path:s.path.last,ahead:s.ahead,loader:s.loader})}const canAdvance=Number.isFinite(idx)&&Number.isFinite(s.available)&&s.available>idx+1;if(canAdvance&&now-lastAdvance>=STALL_MS&&now-lastStall>=1000){lastStall=now;log('stall',{index:idx,stalledMs:Math.round(now-lastAdvance),clock:s.clock,ahead:s.ahead,loader:s.loader,path:s.path.last})}},POLL_MS);
  function rafWatch(now){const gap=now-lastRaf;lastRaf=now;if(active&&gap>RAF_GAP_MS)log('main-thread-gap',{gapMs:Math.round(gap),index:compact().index});requestAnimationFrame(rafWatch)}requestAnimationFrame(rafWatch);
})();