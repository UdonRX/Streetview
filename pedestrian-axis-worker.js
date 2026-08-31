/* Streetview Journey SIDEWALK low-texture long-baseline worker v0.1.0 */
'use strict';
const VERSION='0.1.0';
const COLS=3,ROWS=4,SEARCH_X=16,SEARCH_Y=11,SAMPLE_STEP=3;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const median=a=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!s.length)return null;const m=s.length>>1;return s.length&1?s[m]:(s[m-1]+s[m])*.5};
const mad=(a,m=median(a))=>Number.isFinite(m)?median(a.filter(Number.isFinite).map(v=>Math.abs(v-m))):null;
function preprocess(src,w,h){
  const a=new Uint8Array(src),sum=new Float64Array((w+1)*(h+1));
  for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=a[y*w+x];sum[(y+1)*(w+1)+x+1]=sum[y*(w+1)+x+1]+row}}
  const out=new Uint8Array(w*h),r=7;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const x0=Math.max(0,x-r),x1=Math.min(w-1,x+r),y0=Math.max(0,y-r),y1=Math.min(h-1,y+r),stride=w+1;
    const s=sum[(y1+1)*stride+x1+1]-sum[y0*stride+x1+1]-sum[(y1+1)*stride+x0]+sum[y0*stride+x0],n=(x1-x0+1)*(y1-y0+1),mean=s/Math.max(1,n),v=a[y*w+x];
    let gx=0,gy=0;if(x>0&&x<w-1)gx=a[y*w+x+1]-a[y*w+x-1];if(y>0&&y<h-1)gy=a[(y+1)*w+x]-a[(y-1)*w+x];
    out[y*w+x]=clamp(Math.round(128+(v-mean)*1.35+.10*Math.sign(v-mean)*(Math.abs(gx)+Math.abs(gy))),0,255);
  }
  return out;
}
function regionSad(a,b,w,h,cx,cy,halfW,halfH,dx,dy){let sum=0,n=0;for(let oy=-halfH;oy<=halfH;oy+=SAMPLE_STEP){const y=cy+oy,yy=y+dy;if(y<1||y>=h-1||yy<1||yy>=h-1)continue;for(let ox=-halfW;ox<=halfW;ox+=SAMPLE_STEP){const x=cx+ox,xx=x+dx;if(x<1||x>=w-1||xx<1||xx>=w-1)continue;sum+=Math.abs(a[y*w+x]-b[yy*w+xx]);n++}}return n?sum/n:1e9}
function tileFlow(a,b,w,h){const out=[],tw=w/COLS,th=h/ROWS,halfW=Math.max(9,Math.floor(tw*.34)),halfH=Math.max(8,Math.floor(th*.34));for(let row=0;row<ROWS;row++)for(let col=0;col<COLS;col++){
  const cx=Math.round((col+.5)*tw),cy=Math.round((row+.5)*th),base=regionSad(a,b,w,h,cx,cy,halfW,halfH,0,0);let best={dx:0,dy:0,score:base},second=1e9;
  for(let dy=-SEARCH_Y;dy<=SEARCH_Y;dy++)for(let dx=-SEARCH_X;dx<=SEARCH_X;dx++){if(!dx&&!dy)continue;const score=regionSad(a,b,w,h,cx,cy,halfW,halfH,dx,dy);if(score<best.score){second=best.score;best={dx,dy,score}}else if(score<second)second=score}
  const improvement=clamp((base-best.score)/Math.max(8,base),0,1),uniqueness=clamp((second-best.score)/Math.max(5,second),0,1),mag=Math.hypot(best.dx,best.dy),confidence=clamp(.72*improvement+.28*uniqueness,0,1);
  if(confidence>=.035&&mag>=.45)out.push({x:cx,y:cy,dx:best.dx,dy:best.dy,mag,confidence,row,col});
}return out}
function lineIntersection(a,b){const det=a.dx*b.dy-a.dy*b.dx,am=Math.hypot(a.dx,a.dy),bm=Math.hypot(b.dx,b.dy);if(am<.4||bm<.4||Math.abs(det)/Math.max(.001,am*bm)<.08)return null;const qx=b.x-a.x,qy=b.y-a.y,t=(qx*b.dy-qy*b.dx)/det;return{x:a.x+t*a.dx,y:a.y+t*a.dy}}
function fitFoe(vectors,w,h){const pts=[];for(let i=0;i<vectors.length;i++)for(let j=i+1;j<vectors.length;j++){const p=lineIntersection(vectors[i],vectors[j]);if(p&&p.x>-w&&p.x<2*w&&p.y>-h&&p.y<2*h)pts.push(p)}if(pts.length<4)return null;const mx=median(pts.map(p=>p.x)),my=median(pts.map(p=>p.y)),ds=pts.map(p=>Math.hypot(p.x-mx,p.y-my)),md=median(ds),gate=Math.max(7,(md||0)+2.4*1.4826*(mad(ds,md)||0)),ins=pts.filter((p,i)=>ds[i]<=gate);if(ins.length<3)return null;const x=median(ins.map(p=>p.x)),y=median(ins.map(p=>p.y)),spread=median(ins.map(p=>Math.hypot(p.x-x,p.y-y)))/Math.max(w,h);return{x:x/w,y:y/h,spread,intersections:ins.length,totalIntersections:pts.length}}
function analyze(m){const w=+m.width,h=+m.height,a0=m.grayA,b0=m.grayB;if(!a0||!b0||w<60||h<50)return{kind:'invalid',confidence:0,vectors:0};const a=preprocess(a0,w,h),b=preprocess(b0,w,h),v=tileFlow(a,b,w,h);if(v.length<3)return{kind:'low-texture',confidence:0,vectors:v.length};const dx=median(v.map(x=>x.dx))||0,dy=median(v.map(x=>x.dy))||0,angles=v.map(x=>Math.atan2(x.dy,x.dx)),sx=angles.reduce((s,t)=>s+Math.cos(t),0),sy=angles.reduce((s,t)=>s+Math.sin(t),0),coherence=Math.hypot(sx,sy)/v.length,avgConf=v.reduce((s,x)=>s+x.confidence,0)/v.length,foe=fitFoe(v,w,h),foeQuality=foe?clamp(1-(foe.spread||0)/.45,0,1):0,coverage=clamp(v.length/(COLS*ROWS),0,1),confidence=clamp(.38*avgConf+.25*coverage+.17*coherence+.20*foeQuality,0,1);return{kind:foe?'LOW_TEXTURE_FLOW_FOE':'LOW_TEXTURE_FLOW',confidence,vectors:v.length,coverage,coherence,medianDx:dx,medianDy:dy,flowAngleDeg:Math.atan2(dy,dx)*180/Math.PI,foeX:foe?.x??null,foeY:foe?.y??null,foeSpread:foe?.spread??null,grid:`${COLS}x${ROWS}`,baselineMeters:Number(m.baselineMeters)||null,targetIndex:Number.isFinite(+m.targetIndex)?+m.targetIndex:null}}
self.onmessage=e=>{const m=e.data||{};if(m.type!=='analyze')return;const started=performance.now();let result;try{result=analyze(m)}catch(error){result={kind:'safe-error',confidence:0,vectors:0,error:String(error?.message||error)}}result.requestId=m.requestId;result.frame=m.frame;result.generation=m.generation;result.ms=performance.now()-started;self.postMessage({type:'result',result})};
self.postMessage({type:'ready',profile:'SIDEWALK',build:VERSION,grid:`${COLS}x${ROWS}`});
