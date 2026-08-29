/* Streetview Journey v0.1.28 Travel Axis Worker - pure JS tile-flow axis */
'use strict';

const COLS=5,ROWS=6,SEARCH_X=8,SEARCH_Y=6,PATCH=4,STEP=2;
const MIN_VECTOR_CONF=.025,MIN_VECTOR_MAG=.28,MIN_FOE_VECTORS=7,RANSAC_ITERS=150;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const median=a=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!s.length)return 0;const m=s.length>>1;return s.length&1?s[m]:(s[m-1]+s[m])*.5;};
const mad=(a,m=median(a))=>median(a.map(v=>Math.abs(v-m)));
function rng(seed){let x=((seed+17)*2654435761)>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}

function patchSad(a,b,w,h,cx,cy,dx,dy){let sum=0,n=0;for(let oy=-PATCH;oy<=PATCH;oy+=STEP){const y=cy+oy,yy=y+dy;if(y<1||y>=h-1||yy<1||yy>=h-1)continue;for(let ox=-PATCH;ox<=PATCH;ox+=STEP){const x=cx+ox,xx=x+dx;if(x<1||x>=w-1||xx<1||xx>=w-1)continue;sum+=Math.abs(a[y*w+x]-b[yy*w+xx]);n++;}}return n?sum/n:1e9;}
function tileFlow(a,b,w,h){
  const out=[];for(let row=0;row<ROWS;row++)for(let col=0;col<COLS;col++){
    const cx=Math.round((col+.5)*w/COLS),cy=Math.round((row+.5)*h/ROWS);const base=patchSad(a,b,w,h,cx,cy,0,0);let best={dx:0,dy:0,score:base};
    for(let dy=-SEARCH_Y;dy<=SEARCH_Y;dy++)for(let dx=-SEARCH_X;dx<=SEARCH_X;dx++){if(!dx&&!dy)continue;const score=patchSad(a,b,w,h,cx,cy,dx,dy);if(score<best.score)best={dx,dy,score};}
    const confidence=clamp((base-best.score)/Math.max(base,6),0,1),mag=Math.hypot(best.dx,best.dy);if(confidence>=MIN_VECTOR_CONF&&mag>=MIN_VECTOR_MAG)out.push({x:cx,y:cy,dx:best.dx,dy:best.dy,mag,confidence,row,col});
  }return out;
}
function lineIntersection(a,b){const det=a.dx*b.dy-a.dy*b.dx,am=Math.hypot(a.dx,a.dy),bm=Math.hypot(b.dx,b.dy);if(am<MIN_VECTOR_MAG||bm<MIN_VECTOR_MAG||Math.abs(det)/(am*bm)<.11)return null;const qx=b.x-a.x,qy=b.y-a.y,t=(qx*b.dy-qy*b.dx)/det;return{x:a.x+t*a.dx,y:a.y+t*a.dy};}
function lineDistance(p,c){const m=Math.hypot(p.dx,p.dy)||1;return Math.abs(p.dx*(c.y-p.y)-p.dy*(c.x-p.x))/m;}
function signCoherence(points,c){if(!points.length)return 0;let pos=0,neg=0;for(const p of points){const s=p.dx*(p.x-c.x)+p.dy*(p.y-c.y);if(s>=0)pos++;else neg++;}return Math.max(pos,neg)/points.length;}
function coverage(points){const cells=new Set(points.map(p=>`${p.col}:${p.row}`));return clamp(cells.size/(COLS*ROWS*.55),0,1);}
function refineCenter(points){let a00=0,a01=0,a11=0,b0=0,b1=0;for(const p of points){const m=Math.hypot(p.dx,p.dy)||1,nx=-p.dy/m,ny=p.dx/m,rhs=nx*p.x+ny*p.y,wt=.35+.65*(p.confidence||.5);a00+=wt*nx*nx;a01+=wt*nx*ny;a11+=wt*ny*ny;b0+=wt*nx*rhs;b1+=wt*ny*rhs;}const det=a00*a11-a01*a01;if(Math.abs(det)<1e-5)return null;return{x:(b0*a11-b1*a01)/det,y:(a00*b1-a01*b0)/det};}
function fitFOE(points,w,h,seed){
  if(points.length<MIN_FOE_VECTORS)return null;const random=rng(seed);let best=null;
  for(let k=0;k<RANSAC_ITERS;k++){
    const a=points[Math.floor(random()*points.length)],b=points[Math.floor(random()*points.length)];if(a===b)continue;const c=lineIntersection(a,b);if(!c||c.x<-1.0*w||c.x>2.0*w||c.y<-.65*h||c.y>1.55*h)continue;
    const ds=points.map(p=>lineDistance(p,c)),med=median(ds),gate=clamp(med+2.6*1.4826*mad(ds,med),2.0,6.5),ins=points.filter((p,i)=>ds[i]<=gate);if(ins.length<MIN_FOE_VECTORS)continue;
    const coh=signCoherence(ins,c),cov=coverage(ins),err=median(ins.map(p=>lineDistance(p,c))),score=ins.length+cov*5+coh*4-err*.7;if(!best||score>best.score)best={c,ins,coh,cov,err,score};
  }
  if(!best)return null;const c=refineCenter(best.ins)||best.c,err=median(best.ins.map(p=>lineDistance(p,c))),ratio=best.ins.length/points.length,coh=signCoherence(best.ins,c),cov=coverage(best.ins),confidence=clamp(.38*ratio+.24*coh+.22*cov+.16*clamp(1-err/5,0,1),0,1);return{x:c.x,y:c.y,confidence,inlierRatio:ratio,signRatio:coh,coverage:cov,medErr:err,kind:'tile-foe'};
}
function sideFlow(points,w,h){if(points.length<6)return null;const mdx=median(points.map(p=>p.dx)),mdy=median(points.map(p=>p.dy)),mx=median(points.map(p=>Math.abs(p.dx))),my=median(points.map(p=>Math.abs(p.dy)));if(mx<1.5||mx<my*1.25)return null;const same=points.filter(p=>Math.sign(p.dx)===Math.sign(mdx)&&Math.abs(p.dx)>=.7),coh=same.length/points.length;if(coh<.62)return null;const strength=clamp((mx-1.5)/6.5,0,1),x=mdx<0?w*(1.03+.20*strength):w*(-.03-.20*strength),confidence=clamp(.18+.30*coh+.12*strength,0,.58);return{x,y:h*.48,confidence,inlierRatio:coh,signRatio:coh,coverage:coverage(same),medErr:0,kind:'side-flow'};}
function analyze(msg){
  const {width:w,height:h,grayA,grayB,frame=0,generation=0,seed=1}=msg;if(!grayA||!grayB||!w||!h)return{frame,generation,centerX:.5,centerY:.5,confidence:0,vectors:0,kind:'invalid'};
  const a=new Uint8Array(grayA),b=new Uint8Array(grayB);if(a.length!==w*h||b.length!==w*h)return{frame,generation,centerX:.5,centerY:.5,confidence:0,vectors:0,kind:'size'};
  const vectors=tileFlow(a,b,w,h);if(vectors.length<5)return{frame,generation,centerX:.5,centerY:.5,confidence:0,vectors:vectors.length,kind:'low-texture'};
  const mdx=median(vectors.map(p=>p.dx)),mdy=median(vectors.map(p=>p.dy));const residual=vectors.map(p=>({...p,dx:p.dx-mdx,dy:p.dy-mdy})).filter(p=>Math.hypot(p.dx,p.dy)>=.35);
  let result=fitFOE(residual,w,h,seed+frame*97)||fitFOE(vectors,w,h,seed+frame*131)||sideFlow(vectors,w,h);if(!result)return{frame,generation,centerX:.5,centerY:.5,confidence:0,vectors:vectors.length,residualVectors:residual.length,kind:'none',medianDx:mdx,medianDy:mdy};
  const centerX=clamp(result.x/w,-.45,1.45),centerY=clamp(result.y/h,-.45,1.45),edgePenalty=centerX<-.30||centerX>1.30?.82:1;
  return{frame,generation,centerX,centerY,confidence:clamp(result.confidence*edgePenalty,0,1),vectors:vectors.length,residualVectors:residual.length,kind:result.kind,inlierRatio:result.inlierRatio,signRatio:result.signRatio,coverage:result.coverage,medErr:result.medErr,medianDx:mdx,medianDy:mdy};
}
self.onmessage=e=>{const m=e.data||{};if(m.type==='reset')return;if(m.type!=='axis')return;const started=performance.now();let result;try{result=analyze(m);}catch(error){result={frame:m.frame,generation:m.generation,centerX:.5,centerY:.5,confidence:0,vectors:0,kind:'safe-error',error:String(error?.message||error)};}result.ms=performance.now()-started;self.postMessage({type:'axis-result',result});};
self.postMessage({type:'axis-ready',engine:'tile-flow',build:'0.1.28'});
