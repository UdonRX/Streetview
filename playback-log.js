/* Playback logger compatibility bootstrap + exact ROAD 1024 alignment. */
(()=>{
  'use strict';
  if(window.__journeyPlaybackBootstrapInstalled)return;
  window.__journeyPlaybackBootstrapInstalled=true;

  const CORE='/playback-log-core.js?v=0.1.55';
  const ANALYSIS_W=80,ANALYSIS_H=120,FOREGROUND_OVERSCAN=1.16;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function installExact1024Alignment(){
    if(window.__journeyExact1024AlignmentInstalled)return;
    window.__journeyExact1024AlignmentInstalled=true;

    function axisDecision(index){
      try{return window.__journeyTravelAxis?.decisionForFrame?.(index)||null}catch{return null}
    }
    function axisLocked(decision){
      return !!decision&&decision.centerMode!=='UNKNOWN'&&decision.centerFallbackReason!=='FRAME_MISSING'&&Number.isFinite(Number(decision.anchor));
    }
    function anchorFor(index){
      const d=axisDecision(index);
      if(axisLocked(d))return clamp(Number(d.anchor)*100,2,98);
      const legacy=Number(window.__journeyPlaybackState?.roadAnchorX);
      return Number.isFinite(legacy)?clamp(legacy,2,98):50;
    }
    function stabilizedFrame(index){
      const b=window.__journeyOpticalBridge;
      if(!b?.getPreparedPair)return null;
      const current=b.getPreparedPair(index);
      if(current?.a?.index===index)return current.a;
      if(index>0){const prev=b.getPreparedPair(index-1);if(prev?.b?.index===index)return prev.b}
      return null;
    }
    function isRoad(){
      const r=window.__journeySelectedRoute;
      const direct=String(r?.journeyProfile||r?.routeProfile||r?.profile||'').toUpperCase();
      if(direct==='ROAD')return true;
      const test=String(r?.fixedTestRoute?.routeId||r?.destination?.testRouteType||'').toLowerCase();
      if(test==='road')return true;
      const t=String(window.JourneyTransportClassifier?.state?.()?.transportMode||'').toUpperCase();
      return t==='CAR';
    }
    async function repaint(index,attempt=0){
      if(!isRoad())return;
      const i=Number(index),api=window.__journeyHybridQuality;
      if(!Number.isFinite(i)||i<0||typeof api?.ensure1024!=='function'){
        if(attempt<8)setTimeout(()=>repaint(i,attempt+1),25);
        return;
      }
      let im;
      try{im=await api.ensure1024(i)}catch{return}
      if(!im?.naturalWidth||!im?.naturalHeight)return;
      const now=Number(window.__journeyPlaybackState?.index);
      if(Number.isFinite(now)&&now!==i)return;
      const canvas=document.getElementById('journeyPersistent1024Canvas');
      const shell=document.getElementById('journeyPersistent1024Shell');
      if(!canvas||!shell){if(attempt<8)setTimeout(()=>repaint(i,attempt+1),25);return}
      const w=Math.max(1,canvas.width||Math.round(shell.clientWidth||innerWidth*1.12));
      const h=Math.max(1,canvas.height||Math.round(shell.clientHeight||innerHeight*1.12));
      if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
      const g=canvas.getContext('2d',{alpha:false});if(!g)return;
      const d=axisDecision(i),locked=axisLocked(d),a=anchorFor(i);
      const baseScale=Math.max(w/im.naturalWidth,h/im.naturalHeight);
      const dw=im.naturalWidth*baseScale,dh=im.naturalHeight*baseScale;
      const dx=(w-dw)*(a/100),dy=(h-dh)*.5;
      const path=String(window.__journeyPlaybackState?.lastRenderPath||'');
      const st=(path==='stabilized'||path==='optical-ready-frame')?stabilizedFrame(i):null;
      const rotation=st?(Number(st.roll)||0):0;
      const renderScale=st?FOREGROUND_OVERSCAN*(Number(st.pose?.scale)||1):1;
      const px=st&&!locked?(Number(st.pose?.x)||0)*w/ANALYSIS_W:0;
      const py=st&&!locked?(Number(st.pose?.y)||0)*h/ANALYSIS_H:0;

      g.save();
      g.setTransform(1,0,0,1,0,0);
      g.globalAlpha=1;g.globalCompositeOperation='copy';g.fillStyle='#05070a';g.fillRect(0,0,w,h);
      g.globalCompositeOperation='source-over';g.imageSmoothingEnabled=true;
      try{g.imageSmoothingQuality='high'}catch{}
      g.translate(px,py);
      g.translate(w*.5,h*.5);
      g.rotate(rotation*Math.PI/180);
      g.scale(renderScale,renderScale);
      g.translate(-w*.5,-h*.5);
      g.drawImage(im,dx,dy,dw,dh);
      g.restore();
      canvas.style.transform='translate3d(0,0,0)';
      canvas.style.filter='brightness(.9) contrast(1.08) saturate(.94)';
      shell.style.opacity='1';
    }
    function sync(index){const i=Number(index);if(!Number.isFinite(i))return;queueMicrotask(()=>repaint(i));requestAnimationFrame(()=>repaint(i))}
    window.addEventListener('journey-playback-started',e=>sync(e.detail?.index??0));
    window.addEventListener('journey-frame-presented',e=>sync(e.detail?.index));
    window.addEventListener('journey-hybrid-quality',()=>sync(window.__journeyPlaybackState?.index));
    window.addEventListener('resize',()=>sync(window.__journeyPlaybackState?.index));
  }

  function waitForCore(n=0){
    if(window.__journeyPlaybackLoggerInstalled){installExact1024Alignment();return}
    if(n<160)setTimeout(()=>waitForCore(n+1),25);
  }

  if(document.readyState==='loading'){
    document.write(`<script src="/mountain-axis-fix.js?v=0.1.0"><\/script><script src="${CORE}"><\/script>`);
    waitForCore();
    return;
  }
  const load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.async=false;s.onload=resolve;s.onerror=reject;document.head.appendChild(s)});
  load('/mountain-axis-fix.js?v=0.1.0').finally(()=>load(CORE).then(installExact1024Alignment).catch(()=>{}));
})();