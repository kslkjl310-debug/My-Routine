/* 오프라인에서도 열리도록 앱 파일을 보관한다.
   같은 주소의 파일은 "네트워크 먼저, 안 되면 보관본" 이라서, 새로 올린 버전이 바로 반영된다. */
const V = 'my-tools-v1';
const CORE = ['./', 'index.html', 'backend.js', 'firebase-config.js', 'routine.html', 'bible.html', 'reading.html', 'planner.html', 'opic.html', 'budget.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  // 버전이 주소에 들어 있는 외부 파일(로그인 도구, AI 음성 모델 실행 파일)은 보관본을 먼저 쓴다
  const sdk = (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) ||
              (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith('/npm/'));
  if (!sameOrigin && !sdk) return; // 로그인·데이터 요청은 건드리지 않는다
  if (sdk) { // 로그인 도구 파일은 버전이 주소에 들어 있어서 보관본을 먼저 쓴다
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(V).then((c) => c.put(req, copy)); return res; })));
    return;
  }
  e.respondWith(
    fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(V).then((c) => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
