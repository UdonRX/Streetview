/* Streetview Journey temporary Phase 1.2 diagnostics */
(() => {
  const DIAG_VERSION = '0.1.17';
  const ANALYSIS_W = 80, ANALYSIS_H = 120;
  const MIN_TRACKS = 8, FB_THRESHOLD = 1.55, RANSAC_THRESHOLD = 1.75, RANSAC_ITERATIONS = 150;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rad = (v) => v * Math.PI / 180;
  const deg = (v) => v * 180 / Math.PI;
  const median = (a) => { if (!a.length) return 0; const s=[...a].sort((x,y)=>x-y), m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };
  const pct = (v) => Number.isFinite(v) ? `${Math.round(v*100)}%` : '—';
  const px = (v) => Number.isFinite(v) ? `${v.toFixed(2)}px` : '—';

  function install() {
    const viewer = $('viewer');
    if (!viewer || $('journeyDiag')) return;
    const box = document.createElement('section');
    box.id = 'journeyDiag';
    box.hidden = true;
    box.setAttribute('aria-label', 'Journey Engine 診断値');
    box.innerHTML = `<div class="jd-head"><b>PHASE 1.2 DIAG</b><span id="jdVerdict">待機中</span></div>
      <div id="jdLine1">CV — / Frame —</div>
      <div id="jdLine2">Pts — → LK — → FB —</div>
      <div id="jdLine3">RS — / Cov — / Err — / FBerr —</div>
      <div id="jdLine4">Flow 上/下 — / Engine Avg —</div>`;
    viewer.appendChild(box);
    const style = document.createElement('style');
    style.textContent = `#journeyDiag{position:absolute;z-index:8;left:14px;right:14px;bottom:calc(var(--safe-bottom) + 116px);padding:9px 11px;border:1px solid rgba(255,255,255,.20);border-radius:13px;background:rgba(4,8,12,.70);color:#fff;font:600 9px/1.42 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;letter-spacing:.01em;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);pointer-events:none;text-shadow:0 1px 4px rgba(0,0,0,.5)}#journeyDiag[hidden]{display:none!important}.jd-head{display:flex;justify-content:space-between;gap:10px;margin-bottom:4px}.jd-head b{font-size:9px;letter-spacing:.14em}.jd-head span{max-width:68%;text-align:right;color:#ffe598;font-weight:750}#journeyDiag>div:not(.jd-head){white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:rgba(255,255,255,.83)}`;
    document.head.appendChild(style);
    document.querySelector('.start-card .eyebrow')?.replaceChildren(document.createTextNode('v0.1.17 PHASE 1.2 DIAGNOSTICS'));
    const lead = document.querySelector('.start-card .lead');
    if (lead) lead.textContent = 'Similarity RANSACが成立しない原因を、特徴点・LK・Forward-Backward・inlier・視差の診断値で切り分ける一時診断版。Journey Engine本体の補正値は変更しない。';
  }

  let frames = null, fetching = null, running = false, lastIndex = -1;
  const imageCache = new Map();
  function hasCoords(f){ return Number.isFinite(f?.lat)&&Number.isFinite(f?.lng); }
  function distanceMeters(a,b){if(!hasCoords(a)||!hasCoords(b))return Infinity;const p1=rad(a.lat),p2=rad(b.lat),dp=p2-p1,dl=rad(b.lng-a.lng),s=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 12742000*Math.atan2(Math.sqrt(s),Math.sqrt(Math.max(0,1-s)));}
  function bearing(a,b){if(!hasCoords(a)||!hasCoords(b))return null;const p1=rad(a.lat),p2=rad(b.lat),dl=rad(b.lng-a.lng),y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return(deg(Math.atan2(y,x))+360)%360;}
  function angle(a,b){if(!Number.isFinite(a)||!Number.isFinite(b))return 0;return((b-a+540)%360)-180;}
  function travelBearing(i){const c=frames?.[i];if(!c)return null;let x=0,y=0,sw=0;for(let s=1;s<=8&&i+s<frames.length;s++){const n=frames[i+s],d=distanceMeters(c,n);if(!Number.isFinite(d)||d<1)continue;const br=bearing(c,n),w=Math.min(d,14)/Math.sqrt(s);x+=Math.cos(rad(br))*w;y+=Math.sin(rad(br))*w;sw+=w;if(d>=18)break;}return sw?(deg(Math.atan2(y,x))+360)%360:(Number.isFinite(c.heading)?c.heading:null);}
  function isSphere(f){return String(f?.projection||'').toUpperCase()==='SPHERE'||(Number.isFinite(f?.fieldOfView)&&f.fieldOfView>=180);}
  function anchorX(i){const f=frames[i],tr=travelBearing(i),ih=Number.isFinite(f?.heading)?f.heading:f?.projectionYaw;if(!Number.isFinite(tr)||!Number.isFinite(ih))return 50;const d=angle(ih,tr);return isSphere(f)?clamp(50+d/3.6,0,100):clamp(50+d/clamp(f.fieldOfView||100,45,170)*100,5,95);}
  async function getFrames(){
    if(frames) return frames;
    if(fetching) return fetching;
    fetching=(async()=>{
      const p=new URLSearchParams({source:'karta'});
      if($('useCoordinates')?.checked){p.set('lat',$('latInput')?.value||'');p.set('lng',$('lngInput')?.value||'');p.set('radius','1200');}
      else {p.set('sequence','6187609');p.set('index','650');}
      const r=await fetch(`/api/imagery?${p}`,{cache:'no-store'}),d=await r.json();
      frames=Array.isArray(d.frames)?d.frames:[];
      return frames;
    })().catch(()=>[]);
    return fetching;
  }
  function loadImage(url){if(!imageCache.has(url))imageCache.set(url,new Promise(res=>{const im=new Image();im.crossOrigin='anonymous';im.referrerPolicy='no-referrer';im.onload=()=>res(im);im.onerror=()=>res(null);im.src=`${url}${url.includes('?')?'&':'?'}diag=0117`;}));return imageCache.get(url);}
  function grayFromImage(cv,im,i){
    const c=document.createElement('canvas');c.width=ANALYSIS_W;c.height=ANALYSIS_H;const g=c.getContext('2d',{willReadFrequently:true});
    const ratio=Math.max(c.width/im.naturalWidth,c.height/im.naturalHeight),dw=im.naturalWidth*ratio,dh=im.naturalHeight*ratio,x=(c.width-dw)*anchorX(i)/100,y=(c.height-dh)/2;
    g.drawImage(im,x,y,dw,dh);const id=g.getImageData(0,0,c.width,c.height),rgba=cv.matFromImageData(id),gray=new cv.Mat();cv.cvtColor(rgba,gray,cv.COLOR_RGBA2GRAY);rgba.delete();return gray;
  }
  function createRng(seed){let x=((seed+1)*2654435761)>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
  function sim2(p,q){const sx=q.x0-p.x0,sy=q.y0-p.y0,tx=q.x1-p.x1,ty=q.y1-p.y1,den=sx*sx+sy*sy;if(den<100)return null;const a=(sx*tx+sy*ty)/den,b=(sx*ty-sy*tx)/den,sc=Math.hypot(a,b),rot=deg(Math.atan2(b,a));if(sc<.94||sc>1.06||Math.abs(rot)>4.5)return null;return{a,b,tx:p.x1-a*p.x0+b*p.y0,ty:p.y1-b*p.x0-a*p.y0};}
  function err(m,p){return Math.hypot(m.a*p.x0-m.b*p.y0+m.tx-p.x1,m.b*p.x0+m.a*p.y0+m.ty-p.y1);}
  function coverage(points){const cells=new Set();for(const p of points)cells.add(`${clamp(Math.floor(p.x0/(ANALYSIS_W/4)),0,3)}:${clamp(Math.floor(p.y0/(ANALYSIS_H/4)),0,3)}`);return clamp(cells.size/10,0,1);}
  function ransac(points,seed){const rng=createRng(seed);let best=null;for(let k=0;k<RANSAC_ITERATIONS;k++){const a=Math.floor(rng()*points.length);let b=Math.floor(rng()*points.length);if(a===b)b=(b+1)%points.length;const m=sim2(points[a],points[b]);if(!m)continue;const ins=[],es=[];for(const p of points){const e=err(m,p);if(e<=RANSAC_THRESHOLD){ins.push(p);es.push(e);}}if(ins.length<MIN_TRACKS)continue;const score=ins.length+coverage(ins)*3-median(es)*.45;if(!best||score>best.score)best={model:m,inliers:ins,errors:es,score};}return best;}
  function verdict(m,engine){
    if(m.cv!=='ready') return 'OpenCV未準備';
    if(m.imageFail) return '画像/CORS解析失敗';
    if(m.corners<MIN_TRACKS) return '特徴点不足';
    if(m.lkRatio<.45) return 'LK追跡が不安定';
    if(m.fbRatio<.45) return 'FB不一致が多い';
    if(!m.ransac) return m.depthRatio>1.35?'視差が強い可能性':'動体/外れ値が多い';
    if(m.inlierRatio<.45) return m.depthRatio>1.35?'Similarityでは視差不足':'動体/局所外れ値多';
    if(m.reproj>1.35) return 'Similarity残差大→Homography候補';
    if((engine?.ransacSamples||0)===0) return '診断RS成功→Engine前処理/統合を確認';
    return 'RANSAC成立';
  }
  function render(m){
    const eng=window.__journeyDiagnostics||{};
    $('journeyDiag').hidden=false;
    $('jdVerdict').textContent=verdict(m,eng);
    $('jdLine1').textContent=`CV ${m.cv} / Frame ${m.i+1}→${m.i+2} / engineRS ${eng.ransacSamples||0}`;
    $('jdLine2').textContent=`Pts ${m.corners} → LK ${m.lk} (${pct(m.lkRatio)}) → FB ${m.fb} (${pct(m.fbRatio)})`;
    $('jdLine3').textContent=`RS ${m.inliers}/${m.fb} (${pct(m.inlierRatio)}) / Cov ${pct(m.cov)} / Err ${px(m.reproj)} / FBerr ${px(m.fbErr)}`;
    $('jdLine4').textContent=`Flow 上/下 ${px(m.upperFlow)} / ${px(m.lowerFlow)} (${m.depthRatio.toFixed(2)}x) / Engine Avg ${pct(eng.averageConfidence||0)}`;
  }
  async function analyze(i){
    const cv=window.cv;
    const base={i,cv:(cv?.Mat&&cv?.calcOpticalFlowPyrLK)?'ready':(window.__journeyDiagnostics?.opencv||'loading'),corners:0,lk:0,fb:0,lkRatio:0,fbRatio:0,inliers:0,inlierRatio:0,cov:0,reproj:NaN,fbErr:NaN,upperFlow:0,lowerFlow:0,depthRatio:1,ransac:false};
    if(base.cv!=='ready') return base;
    const fs=await getFrames(); if(i<0||i+1>=fs.length)return base;
    const [ia,ib]=await Promise.all([loadImage(fs[i].url),loadImage(fs[i+1].url)]);if(!ia||!ib)return {...base,imageFail:true};
    let a,b,p0,p1,pb,st,sb,er,erb,mask;
    try{
      a=grayFromImage(cv,ia,i);b=grayFromImage(cv,ib,i+1);p0=new cv.Mat();p1=new cv.Mat();pb=new cv.Mat();st=new cv.Mat();sb=new cv.Mat();er=new cv.Mat();erb=new cv.Mat();mask=cv.Mat.zeros(ANALYSIS_H,ANALYSIS_W,cv.CV_8UC1);const roi=mask.roi(new cv.Rect(3,5,ANALYSIS_W-6,ANALYSIS_H-23));roi.setTo(new cv.Scalar(255));roi.delete();
      cv.goodFeaturesToTrack(a,p0,140,.006,3.2,mask,5,false,.04);base.corners=p0.rows||0;if(base.corners<MIN_TRACKS)return base;
      const win=new cv.Size(19,19),criteria=new cv.TermCriteria(cv.TermCriteria_COUNT+cv.TermCriteria_EPS,16,.02);cv.calcOpticalFlowPyrLK(a,b,p0,p1,st,er,win,3,criteria);cv.calcOpticalFlowPyrLK(b,a,p1,pb,sb,erb,win,3,criteria);
      const fbPoints=[];for(let n=0;n<p0.rows;n++){if(!st.data[n])continue;base.lk++;const x0=p0.data32F[n*2],y0=p0.data32F[n*2+1],x1=p1.data32F[n*2],y1=p1.data32F[n*2+1];if(![x0,y0,x1,y1].every(Number.isFinite))continue;if(!sb.data[n])continue;const xb=pb.data32F[n*2],yb=pb.data32F[n*2+1],e=Number.isFinite(er.data32F?.[n])?er.data32F[n]:0,eb=Number.isFinite(erb.data32F?.[n])?erb.data32F[n]:0,fb=Math.hypot(xb-x0,yb-y0);if(e<=85&&eb<=85&&fb<=FB_THRESHOLD&&Math.hypot(x1-x0,y1-y0)<=14&&x1>=1&&x1<ANALYSIS_W-1&&y1>=1&&y1<ANALYSIS_H-1)fbPoints.push({x0,y0,x1,y1,fb,flow:Math.hypot(x1-x0,y1-y0)});}
      base.fb=fbPoints.length;base.lkRatio=base.lk/base.corners;base.fbRatio=base.fb/Math.max(1,base.lk);base.fbErr=median(fbPoints.map(p=>p.fb));
      const upper=fbPoints.filter(p=>p.y0<ANALYSIS_H*.5).map(p=>p.flow),lower=fbPoints.filter(p=>p.y0>=ANALYSIS_H*.5).map(p=>p.flow);base.upperFlow=median(upper);base.lowerFlow=median(lower);base.depthRatio=base.upperFlow>.25?base.lowerFlow/base.upperFlow:(base.lowerFlow>.7?2:1);
      if(base.fb<MIN_TRACKS)return base;const rs=ransac(fbPoints,i*31+base.fb);if(!rs)return base;base.ransac=true;base.inliers=rs.inliers.length;base.inlierRatio=base.inliers/base.fb;base.cov=coverage(rs.inliers);base.reproj=median(rs.errors);return base;
    } catch(e){base.error=String(e?.message||e);return base;} finally {[a,b,p0,p1,pb,st,sb,er,erb,mask].forEach(m=>{try{m?.delete?.();}catch{}});}
  }
  async function tick(){
    if(running)return;const label=$('frameLabel')?.textContent||'';const match=label.match(/(\d+)\s*\/\s*(\d+)/);const journeyActive=$('startPanel')?.hidden&&match; if(!journeyActive){$('journeyDiag').hidden=true;return;}
    const idx=Math.max(0,Math.min((Number(match[1])||1)-1,(Number(match[2])||2)-2));if(idx===lastIndex)return;lastIndex=idx;running=true;try{render(await analyze(idx));}finally{running=false;}
  }
  install();
  setInterval(tick,800);
  console.info(`Streetview Journey diagnostics v${DIAG_VERSION}`);
})();
