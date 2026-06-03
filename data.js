/* ============================================================
   런등수 — 가상 러너 데이터 + 페이싱 곡선 생성 모델
   ------------------------------------------------------------
   [완주시간 분포] 한국 일반인 5km·10km 통계(혼성 추정)를 100명 표준화.
     출처: RunRepeat(2,300만건), Outside(220만건,2024), parkrun, 국내 plusblog/runstory/e-마라톤.
     혼성(남녀 50:50) 백분위→완주시간(초) 앵커표 → p=0.5..99.5 보간.
   [페이싱 곡선] 각 러너를 등속이 아니라 '구간별 페이스 곡선'으로 생성 → 추월/역전 발생.
     실제 러너 문헌(마라톤 기반)으로 보정한 합성 모델. research.md 참조.
       - 후반 감속폭 S: 느린 러너일수록 큼 (Deaner 2015: 마라톤 5.6%→22.7%, 방향 차용·5K/10K로 축소)
       - 페이스 변동 CV: 느린 러너일수록 큼 (Haney&Mercer: 마라톤 12%→22%, 축소)
       - 빠른 러너는 고르게/약한 네거티브 스플릿 (Swain 2020)
     주의: 위 크기는 마라톤 수치라 5K/10K엔 그대로 못 씀 → '방향'만 쓰고 크기 축소. 완전 실측 아님.
   ============================================================ */

// [백분위 %, 완주시간 초] — 혼성 일반인 추정
const ANCHORS = {
  5000:  [[1,1110],[5,1260],[10,1380],[25,1620],[50,1980],[75,2340],[90,2700],[95,2910],[99,3300]],
  10000: [[1,2280],[5,2580],[10,2790],[25,3090],[50,3450],[75,3900],[90,4380],[95,4680],[99,5280]]
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

// 시드 고정 난수(필드 재현성)
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function gauss(rng){let u=0,v=0;while(u===0)u=rng();while(v===0)v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}

// 종목별 목표 완주시간(초) n개
function finishTimes(dist, n){
  const a = ANCHORS[dist], out=[];
  if(a){ for(let i=0;i<n;i++) out.push(interpSeconds(a,(i+0.5)/n*100)); return out; }
  // 하프·풀: 통계 미확보 → 임시 정규분포 placeholder(초/km)
  const cfg={21097:{m:420,s:80}, 42195:{m:480,s:95}};
  const c=cfg[dist]||{m:420,s:80}, rng=mulberry32(dist);
  for(let i=0;i<n;i++){ let pace=c.m+gauss(rng)*c.s; pace=Math.max(240,Math.min(600,pace)); out.push(pace*dist/1000); }
  out.sort((x,y)=>x-y);
  return out;
}

// 능력 q(0 빠름 ~ 1 느림)별 페이싱 파라미터 — 마라톤 문헌을 5K/10K로 축소 보정
function pacingParams(dist, q){
  const lerp=(a,b)=>a+(b-a)*q;
  if(dist<=5000)  return {S:lerp(-0.01,0.08), cv:lerp(0.03,0.09)};  // 5K: 후반감속 -1%~+8%, 변동 3~9%
  if(dist<=10000) return {S:lerp(-0.02,0.12), cv:lerp(0.04,0.11)};  // 10K: -2%~+12%, 4~11%
  if(dist<=21097) return {S:lerp( 0.00,0.16), cv:lerp(0.05,0.14)};  // 하프
  return            {S:lerp( 0.02,0.22), cv:lerp(0.06,0.18)};        // 풀(마라톤 문헌에 근접)
}

// 한 러너의 구간 페이스 곡선 → distance(t) 객체
function makeRunner(dist, T, q, seed){
  const K=24, segLen=dist/K, rng=mulberry32(seed);
  const {S,cv}=pacingParams(dist,q);
  const segRel=new Float64Array(K); let totalRel=0;
  for(let i=0;i<K;i++){
    const x=(i+0.5)/K;
    const trend=1 + S*(x-0.5)*2;                       // 후반 감속(양수 S일수록 후반이 느림)
    let noise=1 + gauss(rng)*cv; noise=Math.max(0.7,Math.min(1.4,noise));
    const paceRel=Math.max(0.5, trend*noise);          // 상대 페이스(절대값은 정규화로 결정)
    segRel[i]=paceRel*segLen; totalRel+=segRel[i];
  }
  const scale=T/totalRel;                              // 합이 정확히 T가 되도록 정규화
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

// 종목 거리(m) → 가상 러너 n명(기본 99, 나 더해 100). 통계+페이싱 곡선.
function buildRunners(dist, n){
  n=n||99;
  const Ts=finishTimes(dist,n);
  // 능력 q는 완주시간 순위 기반(빠를수록 q 작음)
  const order=Ts.map((t,i)=>[t,i]).sort((a,b)=>a[0]-b[0]);
  const qOf=new Array(n);
  order.forEach((pair,rank)=>{ qOf[pair[1]] = (n>1)? rank/(n-1) : 0; });
  const runners=[];
  for(let i=0;i<n;i++) runners.push(makeRunner(dist, Ts[i], qOf[i], dist*7919 + i*101 + 13));
  return runners;
}

window.RUN_STATS = {
  ANCHORS,
  finishSeconds:(d,p)=>interpSeconds(ANCHORS[d], p),
  buildRunners
};
