/* 오프라인에서도 열리도록 앱 파일을 보관한다.
   같은 주소의 파일은 "네트워크 먼저, 안 되면 보관본" 이다. 이때 브라우저가 몇 분간 들고 있는 예전 파일을 쓰지 않고
   매번 서버에 새 파일이 있는지 확인하므로(cache: 'no-cache'), 새로 올린 버전이 바로 반영된다. */
// 버전이 바뀌면(version.js) 보관본 이름도 바뀌어서 새 파일을 새로 받는다. version.js가 없어도 설치는 멈추지 않는다.
try { importScripts('version.js'); } catch (e) {}
const V = 'my-tools-v' + (self.APP_VERSION || '2');
const CORE = ['./', 'version.js', 'index.html', 'backend.js', 'firebase-config.js', 'routine.html', 'bible.html', 'prayer.html', 'verse.html', 'reading.html', 'running.html','planner.html', 'opic.html', 'budget.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'splash.png'];

self.addEventListener('install', (e) => {
  // 아직 올리지 않은 파일이 있어도 설치가 멈추지 않게, 파일마다 따로 받아 둔다
  e.waitUntil(caches.open(V).then((c) => Promise.all(CORE.map((u) =>
    fetch(new Request(u, { cache: 'reload' })).then((r) => { if (r.ok) return c.put(u, r); }).catch(() => {})
  ))).then(() => self.skipWaiting()));
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
    fetch(req, { cache: 'no-cache' }).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(V).then((c) => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
