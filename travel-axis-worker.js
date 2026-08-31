/* Streetview Journey v0.1.50 Travel Axis Worker - guarded Motion FOE + Static VP */
'use strict';

const COLS=5,ROWS=6,PATCH=4,STEP=2;
const MIN_VECTOR_CONF=.025,MIN_VECTOR_MAG=.28,MIN_FOE_VECTORS=7,RANSAC_ITERS=180;
const STATIC_RANSAC_ITERS=240,STATIC_MIN_SEGMENTS=8,STATIC_EDGE_STEP=2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const median=a=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!s.length)return 0;const m=s.length>>1;return s.length&1?s[m]:(s[m-1]+s[m])*.5;};
const mad=(a,m=median(a))=>median(a.map(v=>Math.abs(v-m)));
function rng(seed){let x=((seed+17)*2654435761)>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}

function patchSad(a,b,w,h,cx,cy,dx,dy){let sum=0,n=0;for(let oy=-PATCH;oy<=PATCH;oy+=STEP){const y=cy+oy,yy=y+dy;if(y<1||y>=h-1||yy<1||yy>=h-1)continue;for(let ox=-PATCH;ox<=PATCH;ox+=STEP){const x=cx+ox,xx=x+dx;if(x<1||x>=w-1||xx<1||xx>=w-1)continue;sum+=Math.abs(a[y*w+x]-b[yy*w+xx]);n++;}}return n?sum/n:1e9;}
function tileFlow(a,b,w,h){
  const out=[],searchX=w>=120?12:8,searchY=w>=120?7:6;
  for(let row=0;row<ROWS;row++)for(let col=0;col<COLS;col++){
    const cx=Math.round((col+.5)*w/COLS),cy=Math.round((row+.5)*h/ROWS),base=patchSad(a,b,w,h,cx,cy,0,0);let best={dx:0,dy:0,score:base};
    for(let dy=-searchY;dy<=searchY;dy++)for(let dx=-searchX;dx<=searchX;dx++){if(!dx&&!dy)continue;const score=patchSad(a,b,w,h,cx,cy,dx,dy);if(score<best.score)best={dx,dy,score};}
    const confidence=clamp((base-best.score)/Math.max(base,6),0,1),mag=Math.hypot(best.dx,best.dy);if(confidence>=MIN_VECTOR_CONF&&mag>=MIN_VECTOR_MAG)out.push({x:cx,y:cy,dx:best.dx,dy:best.dy,mag,confidence,row,col});
  }
  return out;
}
function lineIntersection(a,b){const det=a.dx*b.dy-a.dy*b.dx,am=Math.hypot(a.dx,a.dy),bm=Math.hypot(b.dx,b.dy);if(am<MIN_VECTOR_MAG||bm<MIN_VECTOR_MAG||Math.abs(det)/(am*bm)<.10)return null;const qx=b.x-a.x,qy=b.y-a.y,t=(qx*b.dy-qy*b.dx)/det;return{x:a.x+t*a.dx,y:a.y+t*a.dy};}
function lineDistance(p,c){const m=Math.hypot(p.dx,p.dy)||1;return Math.abs(p.dx*(c.y-p.y)-p.dy*(c.x-p.x))/m;}
function signCoherence(points,c){if(!points.length)return 0;let pos=0,neg=0;for(const p of points){const s=p.dx*(p.x-c.x)+p.dy*(p.y-c.y);if(s>=0)pos++;else neg++;}return Math.max(pos,neg)/points.length;}
function coverage(points){const cells=new Set(points.map(p=>`${p.col}:${p.row}`));return clamp(cells.size/(COLS*ROWS*.55),0,1);}
function refineCenter(points){let a00=0,a01=0,a11=0,b0=0,b1=0;for(const p of points){const m=Math.hypot(p.dx,p.dy)||1,nx=-p.dy/m,ny=p.dx/m,rhs=nx*p.x+ny*p.y,wt=.35+.65*(p.confidence||.5);a00+=wt*nx*nx;a01+=wt*nx*ny;a11+=wt*ny*ny;b0+=wt*nx*rhs;b1+=wt*ny*rhs;}const det=a00*a11-a01*a01;if(Math.abs(det)<1e-5)return null;return{x:(b0*a11-b1*a01)/det,y:(a00*b1-a01*b0)/det};}
function fitFOE(points,w,h,seed,kind='tile-foe'){
  if(points.length<MIN_FOE_VECTORS)return null;const random=rng(seed);let best=null;
  for(let k=0;k<RANSAC_ITERS;k++){
    const a=points[Math.floor(random()*points.length)],b=points[Math.floor(random()*points.length)];if(a===b)continue;const c=lineIntersection(a,b);if(!c||c.x<-1.2*w||c.x>2.2*w||c.y<-.8*h||c.y>1.7*h)continue;
    const ds=points.map(p=>lineDistance(p,c)),med=median(ds),gate=clamp(med+2.6*1.4826*mad(ds,med),2.0,6.8),ins=points.filter((p,i)=>ds[i]<=gate);if(ins.length<MIN_FOE_VECTORS)continue;
    const coh=signCoherence(ins,c),cov=coverage(ins),err=median(ins.map(p=>lineDistance(p,c))),score=ins.length+cov*5+coh*4-err*.7;if(!best||score>best.score)best={c,ins,coh,cov,err,score};
  }
  if(!best)return null;const c=refineCenter(best.ins)||best.c,err=median(best.ins.map(p=>lineDistance(p,c))),ratio=best.ins.length/points.length,coh=signCoherence(best.ins,c),cov=coverage(best.ins),confidence=clamp(.36*ratio+.25*coh+.22*cov+.17*clamp(1-err/5,0,1),0,1);return{x:c.x,y:c.y,confidence,inlierRatio:ratio,signRatio:coh,coverage:cov,medErr:err,kind};
}
function sideFlow(points,w,h){
  if(points.length<6)return null;const mdx=median(points.map(p=>p.dx)),mdy=median(points.map(p=>p.dy)),mx=median(points.map(p=>Math.abs(p.dx))),my=median(points.map(p=>Math.abs(p.dy)));if(mx<1.35||mx<my*1.18)return null;
  const same=points.filter(p=>Math.sign(p.dx)===Math.sign(mdx)&&Math.abs(p.dx)>=.7),coh=same.length/points.length;if(coh<.60)return null;const strength=clamp((mx-1.35)/7.5,0,1),x=mdx<0?w*(1.02+.28*strength):w*(-.02-.28*strength),confidence=clamp(.18+.30*coh+.14*strength,0,.60);return{x,y:h*.48,confidence,inlierRatio:coh,signRatio:coh,coverage:coverage(same),medErr:0,kind:'side-flow'};
}
function resultScore(r){if(!r)return-1;return r.confidence+.10*(r.coverage||0)+.06*(r.signRatio||0)-.025*(r.medErr||0);}
function analyzeMotion(msg){
  const {width:w,height:h,grayA,grayB,frame=0,generation=0,seed=1,space='render-crop'}=msg;if(!grayA||!grayB||!w||!h)return{frame,generation,space,centerX:.5,centerY:.5,confidence:0,vectors:0,kind:'invalid'};
  const a=new Uint8Array(grayA),b=new Uint8Array(grayB);if(a.length!==w*h||b.length!==w*h)return{frame,generation,space,centerX:.5,centerY:.5,confidence:0,vectors:0,kind:'size'};
  const vectors=tileFlow(a,b,w,h);if(vectors.length<5)return{frame,generation,space,centerX:.5,centerY:.5,confidence:0,vectors:vectors.length,kind:'low-texture'};
  const mdx=median(vectors.map(p=>p.dx)),mdy=median(vectors.map(p=>p.dy)),globalMag=Math.hypot(mdx,mdy),residual=vectors.map(p=>({...p,dx:p.dx-mdx,dy:p.dy-mdy})).filter(p=>Math.hypot(p.dx,p.dy)>=.35),residualMag=median(residual.map(p=>Math.hypot(p.dx,p.dy))),translationDominance=globalMag/Math.max(.45,residualMag);
  const residualFit=fitFOE(residual,w,h,seed+frame*97,'tile-foe-residual'),fullFit=fitFOE(vectors,w,h,seed+frame*131,'tile-foe-full'),side=sideFlow(vectors,w,h);
  let result=null,agreement=null;if(residualFit&&fullFit)agreement=Math.abs(residualFit.x-fullFit.x)/w;
  const sideDominant=side&&translationDominance>1.35&&Math.abs(mdx)>Math.abs(mdy)*1.18;
  if(space!=='render-crop'){
    if(sideDominant&&(!fullFit||resultScore(side)>resultScore(fullFit)-.06||(Number.isFinite(agreement)&&agreement>.30)))result=side;else result=fullFit||residualFit||side;
    if(result&&fullFit&&residualFit&&agreement>.28)result={...result,confidence:result.confidence*.86,kind:`${result.kind}-disagree`};
  }else{
    if(sideDominant&&(!fullFit||resultScore(side)>resultScore(fullFit)-.03||(Number.isFinite(agreement)&&agreement>.25)))result=side;
    else if(residualFit&&fullFit){const disagree=agreement>.24;result=resultScore(fullFit)+(disagree?.055:0)>=resultScore(residualFit)?fullFit:residualFit;if(disagree)result={...result,confidence:result.confidence*.82,kind:`${result.kind}-disagree`};}
    else result=residualFit||fullFit||side;
  }
  if(!result)return{frame,generation,space,centerX:.5,centerY:.5,confidence:0,vectors:vectors.length,residualVectors:residual.length,kind:'none',medianDx:mdx,medianDy:mdy,translationDominance};
  const centerX=clamp(result.x/w,-.45,1.45),centerY=clamp(result.y/h,-.45,1.45),edgePenalty=centerX<-.35||centerX>1.35?.78:1,agreementPenalty=Number.isFinite(agreement)?clamp(1-Math.max(0,agreement-.10)*.65,.68,1):1;
  return{frame,generation,space,centerX,centerY,confidence:clamp(result.confidence*edgePenalty*agreementPenalty,0,1),vectors:vectors.length,residualVectors:residual.length,kind:result.kind,inlierRatio:result.inlierRatio,signRatio:result.signRatio,coverage:result.coverage,medErr:result.medErr,medianDx:mdx,medianDy:mdy,translationDominance,modelAgreement:Number.isFinite(agreement)?agreement:null,residualCenterX:residualFit?residualFit.x/w:null,fullCenterX:fullFit?fullFit.x/w:null,sideCenterX:side?side.x/w:null};
}

function sobel(gray,w,x,y){const i=y*w+x,gx=-gray[i-w-1]-2*gray[i-1]-gray[i+w-1]+gray[i-w+1]+2*gray[i+1]+gray[i+w+1],gy=-gray[i-w-1]-2*gray[i-w]-gray[i-w+1]+gray[i+w-1]+2*gray[i+w]+gray[i+w+1];return{gx,gy,mag:Math.hypot(gx,gy)};}
function edgeThreshold(gray,w,h){const mags=[];for(let y=3;y<h-3;y+=4)for(let x=3;x<w-3;x+=4)mags.push(sobel(gray,w,x,y).mag);const m=median(mags),sigma=1.4826*mad(mags,m);return clamp(m+sigma*.85,30,110);}
function tangentAt(gray,w,h,x,y,threshold){if(x<2||x>=w-2||y<2||y>=h-2)return null;const g=sobel(gray,w,x,y);if(g.mag<threshold)return null;return{tx:-g.gy/g.mag,ty:g.gx/g.mag,mag:g.mag};}
function traceDirection(gray,w,h,x,y,tx,ty,threshold,sign){let length=0,miss=0;for(let s=2;s<=18;s+=2){const xx=Math.round(x+tx*s*sign),yy=Math.round(y+ty*s*sign),t=tangentAt(gray,w,h,xx,yy,threshold*.52);if(!t){if(++miss>1)break;continue;}const coh=Math.abs(t.tx*tx+t.ty*ty);if(coh<.80){if(++miss>1)break;continue;}miss=0;length=s;}return length;}
function staticSegments(gray,w,h){
  const threshold=edgeThreshold(gray,w,h),buckets=new Map();
  for(let y=4;y<h-4;y+=STATIC_EDGE_STEP)for(let x=4;x<w-4;x+=STATIC_EDGE_STEP){const t=tangentAt(gray,w,h,x,y,threshold);if(!t)continue;const ax=Math.abs(t.tx),ay=Math.abs(t.ty);if(ay<.12)continue;const l0=traceDirection(gray,w,h,x,y,t.tx,t.ty,threshold,-1),l1=traceDirection(gray,w,h,x,y,t.tx,t.ty,threshold,1),len=l0+l1;if(len<9)continue;const verticalGain=ax<.12?.58:1,horizontalGain=ay<.22?.62:1,bottomGain=y>h*.50?1.25:1,edgeGain=x<w*.08||x>w*.92?.62:1,targetY=h*.44,xAt=Math.abs(t.ty)>.08?x+t.tx/t.ty*(targetY-y):x,centerGain=clamp(1-Math.abs(xAt-w*.5)/(w*.72),.28,1.18),weight=Math.min(2.2,(len/18))*(.45+.55*clamp(t.mag/150,0,1))*verticalGain*horizontalGain*bottomGain*edgeGain*(.7+.3*centerGain),side=x<w*.45?-1:x>w*.55?1:0,angleBin=Math.round(Math.atan2(t.ty,t.tx)*12/Math.PI),key=`${Math.floor(x/10)}:${Math.floor(y/10)}:${angleBin}`;const seg={x,y,dx:t.tx,dy:t.ty,len,weight,side};const prev=buckets.get(key);if(!prev||seg.weight>prev.weight)buckets.set(key,seg);}
  return[...buckets.values()].sort((a,b)=>b.weight-a.weight).slice(0,72);
}
function staticLineIntersection(a,b){const det=a.dx*b.dy-a.dy*b.dx;if(Math.abs(det)<.12)return null;const qx=b.x-a.x,qy=b.y-a.y,t=(qx*b.dy-qy*b.dx)/det;return{x:a.x+t*a.dx,y:a.y+t*a.dy};}
function staticLineDistance(s,c){return Math.abs(s.dx*(c.y-s.y)-s.dy*(c.x-s.x));}
function refineStatic(lines){let a00=0,a01=0,a11=0,b0=0,b1=0;for(const s of lines){const nx=-s.dy,ny=s.dx,rhs=nx*s.x+ny*s.y,wt=Math.max(.15,s.weight);a00+=wt*nx*nx;a01+=wt*nx*ny;a11+=wt*ny*ny;b0+=wt*nx*rhs;b1+=wt*ny*rhs;}const det=a00*a11-a01*a01;if(Math.abs(det)<1e-5)return null;return{x:(b0*a11-b1*a01)/det,y:(a00*b1-a01*b0)/det};}
function staticSpread(lines,c,w){const xs=[];for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length&&j<i+9;j++){const p=staticLineIntersection(lines[i],lines[j]);if(p&&Number.isFinite(p.x)&&Math.abs(p.x-c.x)<w*.7)xs.push(p.x);if(xs.length>=80)break;}if(xs.length<4)return 1;return clamp(1.4826*mad(xs,median(xs))/w,0,1);}
function fitStaticVP(lines,w,h,seed){
  if(lines.length<STATIC_MIN_SEGMENTS)return null;const random=rng(seed+7331);let best=null;
  for(let k=0;k<STATIC_RANSAC_ITERS;k++){
    const a=lines[Math.floor(random()*lines.length)],b=lines[Math.floor(random()*lines.length)];if(a===b)continue;if(a.side&&b.side&&a.side===b.side&&random()<.72)continue;const c=staticLineIntersection(a,b);if(!c||c.x<-.35*w||c.x>1.35*w||c.y<-.35*h||c.y>1.05*h)continue;const ds=lines.map(s=>staticLineDistance(s,c)),med=median(ds),gate=clamp(med+2.2*1.4826*mad(ds,med),2.0,5.5),ins=lines.filter((s,i)=>ds[i]<=gate);if(ins.length<STATIC_MIN_SEGMENTS)continue;const left=ins.filter(s=>s.side<0).length,right=ins.filter(s=>s.side>0).length,bilateral=Math.min(left,right)/Math.max(1,Math.max(left,right)),weight=ins.reduce((n,s)=>n+s.weight,0),err=median(ins.map(s=>staticLineDistance(s,c))),score=weight+ins.length*.35+bilateral*5-err*.75;if(!best||score>best.score)best={c,ins,bilateral,err,score};
  }
  if(!best)return null;const c=refineStatic(best.ins)||best.c,err=median(best.ins.map(s=>staticLineDistance(s,c))),ratio=best.ins.length/lines.length,left=best.ins.filter(s=>s.side<0).length,right=best.ins.filter(s=>s.side>0).length,bilateral=Math.min(left,right)/Math.max(1,Math.max(left,right)),spread=staticSpread(best.ins,c,w),countScore=clamp((best.ins.length-6)/22,0,1),errScore=clamp(1-err/4.5,0,1),spreadScore=clamp(1-spread/.16,0,1),confidence=clamp(.32*ratio+.20*bilateral+.18*countScore+.16*errScore+.14*spreadScore,0,1);return{x:c.x,y:c.y,confidence,inlierRatio:ratio,spread,lineCount:lines.length,inlierCount:best.ins.length,medErr:err,bilateral,kind:'static-vp'};
}
function analyzeStatic(msg){
  const {width:w,height:h,gray,frame=0,generation=0,seed=1}=msg;if(!gray||!w||!h)return{frame,generation,staticVpX:.5,staticVpY:.5,confidence:0,lineCount:0,inlierRatio:0,spread:1,kind:'invalid'};const data=new Uint8Array(gray);if(data.length!==w*h)return{frame,generation,staticVpX:.5,staticVpY:.5,confidence:0,lineCount:0,inlierRatio:0,spread:1,kind:'size'};const lines=staticSegments(data,w,h);if(lines.length<STATIC_MIN_SEGMENTS)return{frame,generation,staticVpX:.5,staticVpY:.5,confidence:0,lineCount:lines.length,inlierRatio:0,spread:1,kind:'low-lines'};const fit=fitStaticVP(lines,w,h,seed);if(!fit)return{frame,generation,staticVpX:.5,staticVpY:.5,confidence:0,lineCount:lines.length,inlierRatio:0,spread:1,kind:'no-consensus'};return{frame,generation,staticVpX:clamp(fit.x/w,-.25,1.25),staticVpY:clamp(fit.y/h,-.25,1.25),confidence:fit.confidence,lineCount:fit.lineCount,inlierCount:fit.inlierCount,inlierRatio:fit.inlierRatio,spread:fit.spread,medErr:fit.medErr,bilateral:fit.bilateral,kind:fit.kind};
}

self.onmessage=e=>{const m=e.data||{};if(m.type==='reset')return;const started=performance.now();try{if(m.type==='static'){const result=analyzeStatic(m);result.ms=performance.now()-started;if(m.requestId!==undefined)result.requestId=m.requestId;self.postMessage({type:'static-result',result});return;}if(m.type!=='axis')return;const result=analyzeMotion(m);result.ms=performance.now()-started;if(m.requestId!==undefined)result.requestId=m.requestId;self.postMessage({type:'axis-result',result});}catch(error){const base={frame:m.frame,generation:m.generation,confidence:0,error:String(error?.message||error),ms:performance.now()-started};if(m.type==='static')self.postMessage({type:'static-result',result:{...base,staticVpX:.5,staticVpY:.5,lineCount:0,inlierRatio:0,spread:1,kind:'safe-error'}});else self.postMessage({type:'axis-result',result:{...base,space:m.space||'render-crop',centerX:.5,centerY:.5,vectors:0,kind:'safe-error'}});}};
self.postMessage({type:'axis-ready',engine:'tile-flow+static-vp',build:'0.1.50'});
