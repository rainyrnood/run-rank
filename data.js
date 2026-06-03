/* ============================================================
   런등수 — 가상 러너 데이터 + 페이싱 곡선 모델 (성별 분리 · 거리 일관)
   ------------------------------------------------------------
   [기준 분포] 우리가 모은 실주자 통계에서 '5K 완주시간 분포'를 남(M)·여(F)·혼성(X)으로 종합.
     - RunRepeat 2,300만건: 5K 중앙값 남 31:18 / 여 36:24
     - Outside 220만건(2024) 30대: 남 P50 30:32·P75 25:45·P90 22:13·P95 20:19 / 여 P50 36:34·P75 31:05·P90 27:07·P95 24:56
     - parkrun 전체 평균 34:18 (캐주얼·워킹 포함 = 일반인 대표성↑)
     → 위 실측 백분위로 5K 앵커표 구성(인위적 반올림 없이). X = (M,F) 평균.
   [거리 환산] 같은 사람의 거리 간 기록을 일관되게: Riegel 피로식 T2 = T1·(D2/D1)^1.06
     - 일반인 지수 k=1.06 (research.md F8). 10K = 5K × 2^1.06 ≈ 5K×2.085 → 10K은 항상 5K의 2배 이상(논리 일관).
     - 하프/풀도 5K 기준 환산(풀은 Riegel이 다소 낙관적일 수 있음 — research.md).
   [페이싱 곡선] 등속이 아니라 구간별 v(t). 능력 낮을수록 후반 감속·변동 큼(Deaner·Haney&Mercer),
     여성은 후반감속 다소 작게. 마라톤 수치는 '방향'만 쓰고 5K/10K로 크기 축소.
   주의: 한국 단독 정밀분포가 아니라 글로벌+국내 5K 자료 종합 추정. 완전 실측 아님.
   ============================================================ */

// 5K 완주시간(초) 앵커 — [백분위 %(낮을수록 빠름), 초]. 거리는 Riegel로 환산.
const ANCHORS = {
  M: [[1,1080],[5,1219],[10,1333],[25,1545],[50,1832],[75,2160],[90,2460],[95,2640],[99,3000]],
  F: [[1,1380],[5,1496],[10,1627],[25,1865],[50,2194],[75,2580],[90,2940],[95,3150],[99,3540]],
  X: [[1,1230],[5,1358],[10,1480],[25,1705],[50,2013],[75,2370],[90,2700],[95,2895],[99,3270]]
};
const K_RIEGEL = 1.06;                              // 일반인 거리-시간 지수
function riegelFactor(dist){ return Math.pow(dist/5000, K_RIEGEL); }  // 5K 대비 환산 배수

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

// 시드 고정 난수
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function gauss(rng){let u=0,v=0;while(u===0)u=rng();while(v===0)v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}

// 종목 거리(m)·성별 → 5K 기준 완주시간을 Riegel로 환산. 백분위 p의 완주시간(초).
function finishSeconds(dist, p, gender){
  const a = ANCHORS[gender||'X']; if(!a) return null;
  return interpSeconds(a, p) * riegelFactor(dist);
}
// n명 목표 완주시간(초)
function finishTimes(dist, n, gender){
  const a = ANCHORS[gender||'X'], f = riegelFactor(dist), out=[];
  for(let i=0;i<n;i++) out.push(interpSeconds(a, (i+0.5)/n*100) * f);
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
    const trend=1 + S*(x-0.5)*2;
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
  const gseed = gender==='M'?1:gender==='F'?2:3;
  const runners=[];
  for(let i=0;i<n;i++) runners.push(makeRunner(dist, Ts[i], qOf[i], dist*7919 + i*101 + gseed*100003 + 13, gender));
  return runners;
}

window.RUN_STATS = { ANCHORS, K_RIEGEL, finishSeconds, buildRunners };
