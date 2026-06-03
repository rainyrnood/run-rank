/* 런등수 — 서비스워커 (네트워크 우선 + 오프라인 캐시 폴백)
   온라인이면 항상 최신을 받아오고, 오프라인일 때만 캐시를 사용한다.
   (개발 중 옛 버전이 계속 보이는 문제 방지) */
const CACHE = 'run-rank-v9';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg', './data.js'];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))
  )).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method !== 'GET'){ return; }
  e.respondWith(
    fetch(req).then(res=>{
      // 같은 출처 응답은 최신본으로 캐시 갱신
      if(res && res.ok && new URL(req.url).origin === self.location.origin){
        const copy = res.clone();
        caches.open(CACHE).then(c=>c.put(req, copy)).catch(()=>{});
      }
      return res;
    }).catch(()=> caches.match(req))   // 네트워크 실패 시에만 캐시
  );
});
