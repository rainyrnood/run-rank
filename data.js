/* ============================================================
   런등수 — 가상 러너 데이터 + 페이싱 곡선 모델 (성별 분리)
   ------------------------------------------------------------
   [완주시간 분포] 한국 일반인 5km·10km 통계를 남(M)·여(F)·혼성(X) 각각 100명 표준화.
     출처: RunRepeat(2,300만건, 5K 남 31:18·여 36:24), Outside(220만건,2024, 30대 남 P50 30:32·여 36:34),
           parkrun(2018 남 35:22·여 41:21·전체 39:02), 국내 plusblog/runstory/e-마라톤(10K 남 46~57·여 54~69).
     혼성(X)은 남녀 분포를 종합한 기존 추정. M/F는 위 성별 수치로 보정. (M·F의 50:50 블렌드 ≈ X)
   [페이싱 곡선] 등속이 아니라 '구간별 페이스 곡선'으로 생성 → 추월/역전 발생.
     실제 러너 문헌(마라톤 기반)으로 보정한 합성. research.md 참조.
       - 후반 감속 S: 느릴수록 큼 (Deaner 2015: 남 5.6→22.7%, 여 5.0→16.5% → 여성이 덜 무너짐 반영)
       - 페이스 변동 CV: 느릴수록 큼 (Haney&Mercer 12→22%; 성별 데이터 없어 공통)
     주의: 마라톤 수치는 '방향'만 쓰고 5K/10K로 크기 축소. 완전 실측 아님.
   ============================================================ */

// [백분위 %(낮을수록 빠름), 완주시간 초] — 거리 → 성별(M/F/X)
const ANCHORS = {
  5000: {
    M: [[1,1020],[5,1140],[10,1230],[25,1440],[50,1800],[75,2130],[90,2430],[95,2610],[99,2940]],
    F: [[1,1230],[5,1380],[10,1500],[25,1800],[50,2160],[75,2520],[90,2880],[95,3090],[99,3480]],
    X: [[1,1110],[5,1260],[10,1380],[25,1620],[50,1980],[75,2340],[90,2700],[95,2910],[99,3300]]
  },
  10000: {
    M: [[1,2040],[5,2310],[10,2520],[25,2790],[50,3120],[75,3540],[90,3990],[95,4260],[99,4800]],
    F: [[1,2460],[5,2790],[10,3030],[25,3390],[50,3750],[75,4230],[90,4740],[95,5070],[99,5700]],
    X: [[1,2280],[5,2580],[10,2790],[25,3090],[50,3450],[75,3900],[90,4380],[95,4680],[99,5280]]
  }
};

function interpSeconds(anchors, p){
  if(p <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length-1];
  if(p >= last[0]) return last[1];
  for(let i=1;i<anchors.length;i++){
    if(p <= anchors[i][0]){
      const [p0,t0]=anchors[i-1], [p1,t1]=anchors[i];
      return t0 + (t1-t0)*(p-p0)/(p1-p0);
    }
  }
  return last[1];
}
function gtab(dist, gender){ const d=ANCHORS[dist]; return d ? d[gender||'X'] : null; }

// 시드 고정 난수
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function gauss(rng){let u=0,v=0;while(u===0)u=rng();while(v===0)v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}

// 종목·성별 목표 완주시간(초) n개
function finishTimes(dist, n, gender){
  const a = gtab(dist, gender), out=[];
  if(a){ for(let i=0;i<n;i++) out.push(interpSeconds(a,(i+0.5)/n*100)); return out; }
  // 하프·풀: 통계 미확보 → 임시 정규분포 placeholder(성별 무관)
  const cfg={21097:{m:420,s:80}, 42195:{m:480,s:95}};
  const c=cfg[dist]||{m:420,s:80}, rng=mulberry32(dist);
  for(let i=0;i<n;i++){ let pace=c.m+gauss(rng)*c.s; pace=Math.max(240,Math.min(600,pace)); out.push(pace*dist/1000); }
  out.sort((x,y)=>x-y);
  return out;
}

// 능력 q(0 빠름~1 느림)·성별별 페이싱 파라미터. 여성은 후반감속(S) 다소 작게(Deaner).
function pacingParams(dist, q, gender){
  const lerp=(a,b)=>a+(b-a)*q;
  let S, cv;
  if(dist<=5000)      { S=lerp(-0.01,0.08); cv=lerp(0.03,0.09); }
  else if(dist<=10000){ S=lerp(-0.02,0.12); cv=lerp(0.04,0.11); }
  else if(dist<=21097){ S=lerp( 0.00,0.16); cv=lerp(0.05,0.14); }
  else                { S=lerp( 0.02,0.22); cv=lerp(0.06,0.18); }
  const Sf = gender==='M' ? 1.10 : gender==='F' ? 0.85 : 1.00;
  return {S:S*Sf, cv};
}

// 한 러너의 구간 페이스 곡선 → distance(t) 객체
function makeRunner(dist, T, q, seed, gender){
  const K=24, segLen=dist/K, rng=mulberry32(seed);
  const {S,cv}=pacingParams(dist,q,gender);
  const segRel=new Float64Array(K); let totalRel=0;
  for(let i=0;i<K;i++){
    const x=(i+0.5)/K;
    const trend=1 + S*(x-0.5)*2;                       // 후반 감속
    let noise=1 + gauss(rng)*cv; noise=Math.max(0.7,Math.min(1.4,noise));
    const paceRel=Math.max(0.5, trend*noise);
    segRel[i]=paceRel*segLen; totalRel+=segRel[i];
  }
  const scale=T/totalRel;
  const cumTime=new Float64Array(K+1);
  for(let i=0;i<K;i++) cumTime[i+1]=cumTime[i]+segRel[i]*scale;
  return {
    finish:T,
    distanceAt(t){
      if(t<=0) return 0;
      if(t>=cumTime[K]) return dist;
      let i=0; while(i<K && cumTime[i+1]<=t) i++;
      const frac=(t-cumTime[i])/(cumTime[i+1]-cumTime[i]);
      return (i+frac)*segLen;
    }
  };
}

// 종목·성별 → 가상 러너 n명(기본 99, 나 더해 100)
function buildRunners(dist, n, gender){
  n=n||99; gender=gender||'X';
  const Ts=finishTimes(dist,n,gender);
  const order=Ts.map((t,i)=>[t,i]).sort((a,b)=>a[0]-b[0]);
  const qOf=new Array(n);
  order.forEach((pair,rank)=>{ qOf[pair[1]] = (n>1)? rank/(n-1) : 0; });
  const runners=[];
  const gseed = gender==='M'?1:gender==='F'?2:3;
  for(let i=0;i<n;i++) runners.push(makeRunner(dist, Ts[i], qOf[i], dist*7919 + i*101 + gseed*100003 + 13, gender));
  return runners;
}

window.RUN_STATS = {
  ANCHORS,
  finishSeconds:(d,p,g)=>{ const a=gtab(d,g); return a? interpSeconds(a,p): null; },
  buildRunners
};
