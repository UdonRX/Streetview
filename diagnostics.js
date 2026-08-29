/* Streetview Journey v0.1.23 diagnostics + session logger */
(()=>{
  const DIAG_VERSION='0.1.23';
  const $=id=>document.getElementById(id);
  const pairs=new Map();
  let lastSignature='',lastActive=false,sessionStartedAt=new Date().toISOString();

  function install(){
    const viewer=$('viewer');if(!viewer||$('journeyDiag'))return;
    const eyebrow=document.querySelector('.start-card .eyebrow');
    if(eyebrow)eyebrow.textContent='v0.1.23 PHASE 1.3.3 ROBUST RESCUE + LOG';
    const title=document.querySelector('.start-card h1');if(title)title.textContent='0.08秒のまま、崩れる区間だけ賢く救済する。';
    const lead=document.querySelector('.start-card .lead');if(lead)lead.textContent='全体・遠景・低動作・Forward救済の複数モデルを場面ごとに選択し、視差やFB崩壊時の傾き・中心ジャンプを抑える。全ペア診断ログも端末内に保存。';
    const preset=document.querySelector('.preset-title');
    if(preset)preset.textContent='Phase 1.3.3 Adaptive Motion Rescue';

    const box=document.createElement('section');
    box.id='journeyDiag';box.hidden=true;box.setAttribute('aria-label','Journey Engine 診断値');
    box.innerHTML=`
      <div class="jd-head"><b>PHASE 1.3.3 DIAG</b><span id="jdVerdict">待機中</span></div>
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
  }

  const pct=v=>Number.isFinite(v)?`${Math.round(v*100)}%`:'—';
  const px=v=>Number.isFinite(v)?`${v.toFixed(2)}px`:'—';
  const pf=p=>Number.isFinite(p?.parallaxFactor)?p.parallaxFactor:(Number.isFinite(p?.depthRatio)&&p.depthRatio>0?Math.max(p.depthRatio,1/p.depthRatio):1);

  function verdict(d,p){
    if(d.worker==='fallback')return'Worker失敗→Far-field継続';
    if(!d.workerReady)return'Worker準備中';
    if(!p)return'解析ジョブ待機';
    if(p.source==='worker-error')return`解析エラー:${p.stage||'unknown'}`;
    if((p.corners||0)<8)return'特徴点不足';
    if((p.lkRatio||0)<.45)return'LK追跡を改善余地';
    if(p.rescueUsed&&p.source==='ransac')return pf(p)>1.45?'Forward救済＋視差回避':'Forward救済RANSAC';
    if(p.source!=='ransac')return(p.fbRatio||0)<.22?'FB追跡不足':pf(p)>1.45?'視差強→背景モデル不足':'RANSAC未成立';
    if(pf(p)>1.45&&(p.modelKind==='background'||p.modelKind==='lowmotion'))return'遠景/低動作RANSACで視差回避';
    if((p.domainInlierRatio||0)>.72&&(p.coverage||0)>.55)return'RANSAC安定';
    if((p.domainInlierRatio||0)<.45)return'RANSAC成立・外れ値あり';
    return'RANSAC成立';
  }

  function normalizedPair(p,d){
    const keys=['frame','frameIndex','source','reason','modelKind','rescueUsed','ms','detected','corners','lk','lkRatio','fb','fbRatio','fbThreshold','forwardTracks','forwardCoherentTracks','inliers','inlierRatio','domainTracks','domainInliers','domainInlierRatio','coverage','globalCoverage','reprojection','fbMedian','flowMedian','flowLimit','upperFlow','lowerFlow','depthRatio','parallaxFactor','confidence','dx','dy','roll','logScale','modelScore','coherentTracks','backgroundTracks','lowMotionTracks','jobsReceived','jobsCompleted','jobsErrored'];
    const out={};for(const k of keys)if(p[k]!==undefined)out[k]=p[k];
    out.engineAverageConfidence=d.averageConfidence||0;
    out.capturedAt=new Date().toISOString();
    return out;
  }

  function summary(){
    const arr=[...pairs.values()].sort((a,b)=>(a.frame??999)-(b.frame??999));
    if(!arr.length)return{count:0};
    const mean=k=>{const v=arr.map(x=>x[k]).filter(Number.isFinite);return v.length?v.reduce((a,b)=>a+b,0)/v.length:0;};
    const models={};for(const p of arr){const k=p.modelKind||p.source||'unknown';models[k]=(models[k]||0)+1;}
    const bad=arr.filter(p=>p.source!=='ransac'||(p.confidence||0)<.35).map(p=>p.frame).filter(Number.isFinite);
    const parallax=arr.filter(p=>pf(p)>1.45).length;
    const rescue=arr.filter(p=>p.rescueUsed).length;
    return{
      count:arr.length,
      avgConfidence:mean('confidence'),
      avgLK:mean('lkRatio'),
      avgFB:mean('fbRatio'),
      avgDomainInlier:mean('domainInlierRatio'),
      avgReprojection:mean('reprojection'),
      avgParallaxFactor:mean('parallaxFactor'),
      ransacPairs:arr.filter(p=>p.source==='ransac').length,
      rescuePairs:rescue,
      parallaxPairs:parallax,
      weakPairs:bad.length,
      weakFrames:bad,
      models
    };
  }

  function exportObject(){
    const d=window.__journeyDiagnostics||{};
    return{
      schema:'streetview-journey-diagnostics-v1',
      diagnosticVersion:DIAG_VERSION,
      sessionStartedAt,
      exportedAt:new Date().toISOString(),
      environment:{
        userAgent:navigator.userAgent,
        language:navigator.language,
        viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio||1},
        online:navigator.onLine,
        engine:d.engine||null,
        worker:d.worker||null,
        workerReady:!!d.workerReady
      },
      summary:summary(),
      pairs:[...pairs.values()].sort((a,b)=>(a.frame??999)-(b.frame??999))
    };
  }

  function persist(){
    try{localStorage.setItem('streetview:lastDiagnosticLog',JSON.stringify(exportObject()));}catch{}
    window.__journeySessionLog=exportObject();
  }

  async function copyLog(){
    const text=JSON.stringify(exportObject(),null,2);
    let ok=false;
    try{await navigator.clipboard.writeText(text);ok=true;}catch{}
    if(!ok){
      const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();
      try{ok=document.execCommand('copy');}catch{}ta.remove();
    }
    const b=$('jdCopy');if(b){const old=b.textContent;b.textContent=ok?'コピー完了':'コピー失敗';setTimeout(()=>b.textContent=old,1400);}
  }

  function maybeCapture(d,p){
    if(!p||!Number.isFinite(p.frame))return;
    const sig=[p.frame,p.jobsCompleted,p.source,p.modelKind,p.confidence,p.fb,p.inliers].join(':');
    if(sig===lastSignature)return;lastSignature=sig;
    pairs.set(p.frame,normalizedPair(p,d));
    persist();
  }

  function render(){
    const box=$('journeyDiag'),d=window.__journeyDiagnostics||{};if(!box)return;
    const active=!!$('startPanel')?.hidden;
    if(active&&!lastActive&&pairs.size===0)sessionStartedAt=new Date().toISOString();
    lastActive=active;
    if(!active){box.hidden=true;return;}
    box.hidden=false;
    const p=d.lastWorkerPair;maybeCapture(d,p);
    $('jdVerdict').textContent=verdict(d,p);
    const jobs=p?`${p.jobsCompleted??'—'}/${p.jobsReceived??'—'}`:'—';
    $('jdLine0').textContent=`Worker ${d.workerReady?'Ready':d.worker||'—'} / jsfeat / Jobs ${jobs}${p?.jobsErrored?` / errors ${p.jobsErrored}`:''}`;
    $('jdLine1').textContent=`Frame ${p?`${p.frame+1}→${p.frame+2}`:'—'} / ${p?.source||'—'} / ${p?.modelKind||'—'} / ${Number.isFinite(p?.ms)?`${p.ms.toFixed(1)}ms`:'—'} / ${p?.reason||'—'}`;
    $('jdLine2').textContent=`Pts ${p?.detected??'—'}→${p?.corners??'—'} / LK ${p?.lk??'—'} (${pct(p?.lkRatio)}) → FB ${p?.fb??'—'} (${pct(p?.fbRatio)}) / gate ${px(p?.fbThreshold)}`;
    $('jdLine3').textContent=`RS ${p?.domainInliers??p?.inliers??0}/${p?.domainTracks??p?.fb??0} (${pct(p?.domainInlierRatio??p?.inlierRatio)}) / global ${pct(p?.inlierRatio)} / Cov ${pct(p?.coverage)} / Err ${px(p?.reprojection)}`;
    $('jdLine4').textContent=`Flow 上/下 ${px(p?.upperFlow)} / ${px(p?.lowerFlow)} (${Number.isFinite(pf(p))?pf(p).toFixed(2):'—'}x) / Avg ${pct(d.averageConfidence||0)}`;
    const sm=summary(),target=Math.max(1,(Number(($('frameLabel')?.textContent||'').split('/')[1])||72)-1);
    $('jdLine5').textContent=`Log ${sm.count}/${target} / RS ${sm.count?Math.round(sm.ransacPairs/sm.count*100):0}% / Rescue ${sm.rescuePairs||0} / 弱 ${sm.weakPairs||0}`;
  }

  install();
  try{
    const saved=JSON.parse(localStorage.getItem('streetview:lastDiagnosticLog')||'null');
    if(saved?.pairs?.length)window.__journeyPreviousSessionLog=saved;
  }catch{}
  if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js?v=0.1.23').catch(()=>{});
  setInterval(render,300);
  console.info('Streetview Journey diagnostics v0.1.23');
})();