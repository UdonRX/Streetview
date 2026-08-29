/* Streetview Journey v0.1.25 diagnostics + worst-pair safety logging */
(()=>{
  const DIAG_VERSION='0.1.25';
  const $=id=>document.getElementById(id);
  const pairs=new Map();
  const workerResultCache=new Map();
  const tapStats={realWorkerJobs:0,cacheHits:0,results:0,errors:0};
  let lastSignature='',lastActive=false,sessionStartedAt=new Date().toISOString(),persistTimer=0;

  const NativeWorker=window.Worker;
  if(NativeWorker&&!window.__journeyWorkerTapInstalled){
    window.__journeyWorkerTapInstalled=true;
    const WrappedWorker=function(url,options){
      const isMotion=String(url||'').includes('motion-worker.js');
      const actualUrl=isMotion?'/motion-worker.js?v=0.1.25':url;
      const worker=new NativeWorker(actualUrl,options);
      if(!isMotion)return worker;
      const nativePost=worker.postMessage.bind(worker);
      worker.addEventListener('message',event=>{
        const m=event.data||{};
        if(m.type==='result'&&m.result){
          const r=m.result;
          const frame=Number.isFinite(r.frameIndex)?r.frameIndex:null;
          if(frame!==null&&!r.cacheHit)workerResultCache.set(frame,{...r});
          tapStats.results++;
          if(r.source==='worker-error')tapStats.errors++;
          window.dispatchEvent(new CustomEvent('journey-worker-result',{detail:{...r,frame:frame??r.frame}}));
        }
      });
      worker.postMessage=(message,transfer)=>{
        if(message?.type==='analyze'){
          const inferred=Number.isFinite(message.frameIndex)
            ?message.frameIndex
            :Math.round((((message.seed||0)-(message.width||0)*(message.height||0))/31));
          const msg={...message,frameIndex:inferred};
          const cached=workerResultCache.get(inferred);
          if(cached){
            tapStats.cacheHits++;
            queueMicrotask(()=>worker.dispatchEvent(new MessageEvent('message',{data:{type:'result',id:msg.id,result:{...cached,frameIndex:inferred,cacheHit:true}}})));
            return;
          }
          tapStats.realWorkerJobs++;
          return nativePost(msg,transfer);
        }
        return nativePost(message,transfer);
      };
      return worker;
    };
    WrappedWorker.prototype=NativeWorker.prototype;
    window.Worker=WrappedWorker;
  }
  window.__journeyWorkerTapStats=tapStats;

  function getTargetPairs(){
    const n=Number((($('frameLabel')?.textContent||'').split('/')[1]||'').trim());
    return Number.isFinite(n)&&n>1?n-1:71;
  }
  function resetSession(){
    pairs.clear();workerResultCache.clear();lastSignature='';sessionStartedAt=new Date().toISOString();
    Object.assign(tapStats,{realWorkerJobs:0,cacheHits:0,results:0,errors:0});
    schedulePersist();
  }

  function install(){
    const viewer=$('viewer');if(!viewer||$('journeyDiag'))return;
    const eyebrow=document.querySelector('.start-card .eyebrow');if(eyebrow)eyebrow.textContent='v0.1.25 PHASE 1.3.5 WORST-PAIR SAFETY';
    const title=document.querySelector('.start-card h1');if(title)title.textContent='0.08秒のまま、最悪フレームだけ安全側へ逃がす。';
    const lead=document.querySelector('.start-card .lead');if(lead)lead.textContent='RANSACは維持しつつ、Coverage・Global Inlier・再投影誤差・強視差をSafety Gateで再評価。危険な推定だけBlend/Far-fieldへ逃がす。';
    const preset=document.querySelector('.preset-title');if(preset)preset.textContent='Phase 1.3.5 Worst-pair Safety Gate';

    const box=document.createElement('section');
    box.id='journeyDiag';box.hidden=true;box.setAttribute('aria-label','Journey Engine 診断値');
    box.innerHTML=`
      <div class="jd-head"><b>PHASE 1.3.5 DIAG</b><span id="jdVerdict">待機中</span></div>
      <div id="jdLine0">Worker —</div>
      <div id="jdLine1">Frame — / Source —</div>
      <div id="jdLine2">Pts — → LK — → FB —</div>
      <div id="jdLine3">RS — / Model — / Cov — / Err —</div>
      <div id="jdLine4">Flow 上/下 — / Engine Avg —</div>
      <div class="jd-log"><span id="jdLine5">Log 0/71</span><button id="jdCopy" type="button">ログコピー</button></div>`;
    viewer.appendChild(box);

    const s=document.createElement('style');
    s.textContent=`#journeyDiag{position:absolute;z-index:8;left:14px;right:14px;bottom:calc(var(--safe-bottom) + 116px);padding:9px 11px;border:1px solid rgba(255,255,255,.20);border-radius:13px;background:rgba(4,8,12,.76);color:#fff;font:600 9px/1.42 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;letter-spacing:.01em;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);pointer-events:none;text-shadow:0 1px 4px rgba(0,0,0,.5)}#journeyDiag[hidden]{display:none!important}.jd-head{display:flex;justify-content:space-between;gap:10px;margin-bottom:4px}.jd-head b{font-size:9px;letter-spacing:.14em}.jd-head span{max-width:68%;text-align:right;color:#ffe598;font-weight:750}#journeyDiag>div:not(.jd-head):not(.jd-log){white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:rgba(255,255,255,.83)}#jdLine0{color:rgba(171,224,255,.95)!important}.jd-log{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,255,255,.10);color:rgba(255,255,255,.70)}#jdCopy{pointer-events:auto;border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:4px 8px;background:rgba(255,255,255,.10);color:#fff;font:700 9px/1 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif}`;
    document.head.appendChild(s);
    $('jdCopy')?.addEventListener('click',copyLog);
    $('startButton')?.addEventListener('click',resetSession,{capture:true});
  }

  const pct=v=>Number.isFinite(v)?`${Math.round(v*100)}%`:'—';
  const px=v=>Number.isFinite(v)?`${v.toFixed(2)}px`:'—';
  const pf=p=>Number.isFinite(p?.parallaxFactor)?p.parallaxFactor:(Number.isFinite(p?.depthRatio)&&p.depthRatio>0?Math.max(p.depthRatio,1/p.depthRatio):1);
  const quantile=(arr,q)=>{const a=arr.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return 0;const p=(a.length-1)*q,l=Math.floor(p),h=Math.ceil(p);return a[l]+(a[h]-a[l])*(p-l);};

  function verdict(d,p){
    if(d.worker==='fallback')return'Worker失敗→Far-field継続';
    if(!d.workerReady)return'Worker準備中';
    if(!p)return'解析ジョブ待機';
    if(p.source==='worker-error')return`解析エラー:${p.stage||'unknown'}`;
    if((p.corners||0)<8)return'特徴点不足';
    if((p.lkRatio||0)<.45)return'LK追跡を改善余地';
    if((p.safetyFactor??1)<.95)return`Safety Gate ${pct(p.safetyFactor)} → Blend/Far`;
    if(String(p.modelKind||'').startsWith('translation'))return pf(p)>1.45?'Translation救済＋視差回避':'Translation救済';
    if(p.rescueUsed&&p.source==='ransac')return pf(p)>1.45?'Forward救済＋視差回避':'Forward救済RANSAC';
    if(p.source!=='ransac')return(p.fbRatio||0)<.22?'FB追跡不足':pf(p)>1.45?'視差強→背景モデル不足':'RANSAC未成立';
    if(pf(p)>1.45&&(p.modelKind==='background'||p.modelKind==='lowmotion'))return'遠景/低動作RANSACで視差回避';
    if((p.domainInlierRatio||0)>.72&&(p.coverage||0)>.55)return'RANSAC安定';
    if((p.domainInlierRatio||0)<.45)return'RANSAC成立・外れ値あり';
    return'RANSAC成立';
  }

  function normalizedPair(p,d){
    const keys=['frame','frameIndex','source','reason','modelKind','rescueUsed','cacheHit','ms','detected','corners','lk','lkRatio','fb','fbRatio','fbThreshold','forwardTracks','forwardCoherentTracks','inliers','inlierRatio','domainTracks','domainInliers','domainInlierRatio','coverage','globalCoverage','reprojection','fbMedian','flowMedian','flowLimit','upperFlow','lowerFlow','depthRatio','parallaxFactor','confidence','rawConfidence','safetyFactor','safetyFlags','dx','dy','roll','logScale','modelScore','coherentTracks','backgroundTracks','lowMotionTracks','translationGate','jobsReceived','jobsCompleted','jobsErrored'];
    const out={};for(const k of keys)if(p[k]!==undefined)out[k]=p[k];
    out.frame=Number.isFinite(p.frame)?p.frame:p.frameIndex;
    out.engineAverageConfidence=d.averageConfidence||0;
    out.capturedAt=new Date().toISOString();
    return out;
  }

  function summary(){
    const arr=[...pairs.values()].sort((a,b)=>(a.frame??999)-(b.frame??999));
    const expected=getTargetPairs();
    if(!arr.length)return{count:0,expectedPairs:expected,complete:false,missingFrames:Array.from({length:expected},(_,i)=>i)};
    const mean=k=>{const v=arr.map(x=>x[k]).filter(Number.isFinite);return v.length?v.reduce((a,b)=>a+b,0)/v.length:0;};
    const models={};for(const p of arr){const k=p.modelKind||p.source||'unknown';models[k]=(models[k]||0)+1;}
    const bad=arr.filter(p=>p.source!=='ransac'||(p.confidence||0)<.45||(p.coverage||0)<.20).map(p=>p.frame).filter(Number.isFinite);
    const guarded=arr.filter(p=>(p.safetyFactor??1)<.95);
    const frames=new Set(arr.map(p=>p.frame).filter(Number.isFinite));
    const missing=[];for(let i=0;i<expected;i++)if(!frames.has(i))missing.push(i);
    const conf=arr.map(p=>p.confidence),rep=arr.map(p=>p.reprojection),ms=arr.map(p=>p.ms),para=arr.map(p=>pf(p));
    return{
      count:arr.length,expectedPairs:expected,complete:missing.length===0,missingFrames:missing,
      avgConfidence:mean('confidence'),p10Confidence:quantile(conf,.10),avgRawConfidence:mean('rawConfidence'),
      avgLK:mean('lkRatio'),avgFB:mean('fbRatio'),avgDomainInlier:mean('domainInlierRatio'),
      avgReprojection:mean('reprojection'),p90Reprojection:quantile(rep,.90),
      avgWorkerMs:mean('ms'),p90WorkerMs:quantile(ms,.90),
      avgParallaxFactor:para.length?para.reduce((a,b)=>a+b,0)/para.length:0,maxParallaxFactor:para.length?Math.max(...para):0,
      ransacPairs:arr.filter(p=>p.source==='ransac').length,
      rescuePairs:arr.filter(p=>p.rescueUsed).length,
      translationRescuePairs:arr.filter(p=>String(p.modelKind||'').startsWith('translation')).length,
      safetyGuardPairs:guarded.length,safetyGuardFrames:guarded.map(p=>p.frame).filter(Number.isFinite),
      parallaxPairs:arr.filter(p=>pf(p)>1.45).length,
      weakPairs:bad.length,weakFrames:bad,models,
      realWorkerJobs:tapStats.realWorkerJobs,workerCacheHits:tapStats.cacheHits,workerResults:tapStats.results,workerErrors:tapStats.errors
    };
  }

  function exportObject(){
    const d=window.__journeyDiagnostics||{};
    return{
      schema:'streetview-journey-diagnostics-v2',diagnosticVersion:DIAG_VERSION,
      sessionStartedAt,exportedAt:new Date().toISOString(),
      environment:{userAgent:navigator.userAgent,language:navigator.language,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio||1},online:navigator.onLine,engine:d.engine||null,worker:d.worker||null,workerReady:!!d.workerReady},
      summary:summary(),pairs:[...pairs.values()].sort((a,b)=>(a.frame??999)-(b.frame??999))
    };
  }

  function schedulePersist(){
    if(persistTimer)return;
    persistTimer=setTimeout(()=>{persistTimer=0;try{localStorage.setItem('streetview:lastDiagnosticLog',JSON.stringify(exportObject()));}catch{}window.__journeySessionLog=exportObject();},350);
  }

  async function copyLog(){
    const text=JSON.stringify(exportObject(),null,2);let ok=false;
    try{await navigator.clipboard.writeText(text);ok=true;}catch{}
    if(!ok){const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();try{ok=document.execCommand('copy');}catch{}ta.remove();}
    const b=$('jdCopy');if(b){const old=b.textContent;b.textContent=ok?'コピー完了':'コピー失敗';setTimeout(()=>b.textContent=old,1400);}
  }

  function capture(p){
    if(!p)return;const frame=Number.isFinite(p.frame)?p.frame:p.frameIndex;if(!Number.isFinite(frame))return;
    const d=window.__journeyDiagnostics||{};const normalized=normalizedPair({...p,frame},d);
    pairs.set(frame,normalized);lastSignature=[frame,p.source,p.modelKind,p.confidence,p.fb,p.inliers,p.cacheHit].join(':');
    schedulePersist();
  }
  window.addEventListener('journey-worker-result',e=>capture(e.detail));

  function render(){
    const box=$('journeyDiag'),d=window.__journeyDiagnostics||{};if(!box)return;
    const active=!!$('startPanel')?.hidden;
    if(active&&!lastActive&&pairs.size===0)sessionStartedAt=new Date().toISOString();
    lastActive=active;if(!active){box.hidden=true;return;}box.hidden=false;
    const p=d.lastWorkerPair;
    if(p){const sig=[p.frame,p.jobsCompleted,p.source,p.modelKind,p.confidence,p.fb,p.inliers].join(':');if(sig!==lastSignature)capture(p);}
    $('jdVerdict').textContent=verdict(d,p);
    const jobs=p?`${p.jobsCompleted??'—'}/${p.jobsReceived??'—'}`:'—';
    $('jdLine0').textContent=`Worker ${d.workerReady?'Ready':d.worker||'—'} / jsfeat / Jobs ${jobs} / real ${tapStats.realWorkerJobs} cache ${tapStats.cacheHits}`;
    $('jdLine1').textContent=`Frame ${p?`${p.frame+1}→${p.frame+2}`:'—'} / ${p?.source||'—'} / ${p?.modelKind||'—'} / ${Number.isFinite(p?.ms)?`${p.ms.toFixed(1)}ms`:'—'} / ${p?.reason||'—'}`;
    $('jdLine2').textContent=`Pts ${p?.detected??'—'}→${p?.corners??'—'} / LK ${p?.lk??'—'} (${pct(p?.lkRatio)}) → FB ${p?.fb??'—'} (${pct(p?.fbRatio)}) / gate ${px(p?.fbThreshold)}`;
    $('jdLine3').textContent=`RS ${p?.domainInliers??p?.inliers??0}/${p?.domainTracks??p?.fb??0} (${pct(p?.domainInlierRatio??p?.inlierRatio)}) / global ${pct(p?.inlierRatio)} / Cov ${pct(p?.coverage)} / Safe ${pct(p?.safetyFactor??1)}`;
    $('jdLine4').textContent=`Flow 上/下 ${px(p?.upperFlow)} / ${px(p?.lowerFlow)} (${Number.isFinite(pf(p))?pf(p).toFixed(2):'—'}x) / Err ${px(p?.reprojection)} / Avg ${pct(d.averageConfidence||0)}`;
    const sm=summary();$('jdLine5').textContent=`Log ${sm.count}/${sm.expectedPairs} / RS ${sm.count?Math.round(sm.ransacPairs/sm.count*100):0}% / Guard ${sm.safetyGuardPairs||0} / 弱 ${sm.weakPairs||0}`;
  }

  try{const saved=JSON.parse(localStorage.getItem('streetview:lastDiagnosticLog')||'null');if(saved?.pairs?.length)window.__journeyPreviousSessionLog=saved;}catch{}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else setTimeout(install,0);
  if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js?v=0.1.25').catch(()=>{});
  setInterval(render,250);
  console.info('Streetview Journey diagnostics v0.1.25');
})();