/* My Tools 저장소
   두 가지 방식을 같은 모양(db, user, downloads)으로 돌려준다.
   - firebase: Google 로그인 + Firestore 클라우드 동기화 (폰·PC가 같은 데이터를 씀, 오프라인에서도 동작)
   - local   : 로그인 없이 이 기기의 브라우저에만 저장
   도구들은 허브(index.html)를 거쳐 이 모양만 보고 쓰므로, 방식이 달라도 코드는 같다. */
(function () {
  'use strict';

  var SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var MODE_KEY = 'mt-mode';
  var cfg = window.FIREBASE_CONFIG || {};
  var hasConfig = !!(cfg.apiKey && cfg.projectId && cfg.appId);
  var clone = function (o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); };

  function snap(id, exists, data, meta) {
    var body = exists ? clone(data) : undefined;
    return { id: id, exists: !!exists, metadata: meta || { fromCache: false, hasPendingWrites: false }, data: function () { return clone(body); } };
  }
  function deepMerge(a, b) {
    var out = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    Object.keys(b).forEach(function (k) {
      var x = out[k], y = b[k];
      out[k] = (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) ? deepMerge(x, y) : y;
    });
    return out;
  }
  /* 계정 전용 경로(data/users/...)는 그대로 두고, 그 밖의 공용 경로(우리집 가계부의 budget-entries 등)는
     두 사람이 함께 쓰는 칸(shared/home/)으로 옮겨 담는다. 접근은 firestore.rules의 이메일 목록으로 제한된다. 쪽수(짝/홀)는 그대로 유지된다. */
  function mapPath(uid, p) { return p.indexOf('data/users/') === 0 ? p : 'shared/home/' + p; }

  /* ---------- 이 기기 전용 ---------- */
  function localDb() {
    var subs = {};
    var key = function (p) { return 'mt:' + p; };
    function read(p) { try { var r = localStorage.getItem(key(p)); return r == null ? undefined : JSON.parse(r); } catch (e) { return undefined; } }
    function snapDoc(p) { var d = read(p); return snap(p.split('/').pop(), d !== undefined, d); }
    function snapCol(p, lim) {
      var pre = 'mt:' + p + '/', ids = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.indexOf(pre) === 0 && k.slice(pre.length).indexOf('/') < 0) ids.push(k.slice(pre.length));
      }
      ids.sort();
      if (lim) ids = ids.slice(0, lim);
      var docs = ids.map(function (id) { return snapDoc(p + '/' + id); });
      return { docs: docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false } };
    }
    function on(k, fn) { (subs[k] = subs[k] || []).push(fn); return function () { subs[k] = (subs[k] || []).filter(function (f) { return f !== fn; }); }; }
    function emit(p) {
      (subs['doc:' + p] || []).slice().forEach(function (f) { f(); });
      (subs['col:' + p.slice(0, p.lastIndexOf('/'))] || []).slice().forEach(function (f) { f(); });
    }
    function put(p, d) { try { localStorage.setItem(key(p), JSON.stringify(d)); } catch (e) { throw { code: 'quota_exceeded', message: '이 기기의 저장 공간이 가득 찼어요.' }; } emit(p); }
    function docRef(p) {
      return {
        id: p.split('/').pop(), path: p,
        get: async function () { return snapDoc(p); },
        set: async function (d) { put(p, clone(d)); },
        update: async function (d) { var cur = read(p); if (cur === undefined) throw { code: 'invalid_argument', message: 'document does not exist' }; put(p, deepMerge(cur, clone(d))); },
        'delete': async function () { localStorage.removeItem(key(p)); emit(p); },
        onSnapshot: function (next) { var un = on('doc:' + p, function () { next(snapDoc(p)); }); setTimeout(function () { next(snapDoc(p)); }, 0); return un; }
      };
    }
    function colRef(p, lim) {
      return {
        path: p,
        doc: function (id) { return docRef(p + '/' + (id || Math.random().toString(36).slice(2, 12))); },
        limit: function (n) { return colRef(p, n); },
        get: async function () { return snapCol(p, lim); },
        onSnapshot: function (next) { var un = on('col:' + p, function () { next(snapCol(p, lim)); }); setTimeout(function () { next(snapCol(p, lim)); }, 0); return un; }
      };
    }
    return { doc: docRef, collection: function (p) { return colRef(p); } };
  }

  /* ---------- Firebase ---------- */
  var fb = null;
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error('load ' + src)); };
      document.head.appendChild(s);
    });
  }
  async function fbInit() {
    if (fb) return fb;
    if (typeof firebase === 'undefined') {
      await loadScript(SDK + 'firebase-app-compat.js');
      await Promise.all([loadScript(SDK + 'firebase-auth-compat.js'), loadScript(SDK + 'firebase-firestore-compat.js')]);
    }
    var app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
    var auth = firebase.auth(), fs = firebase.firestore();
    try { await fs.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* 다른 탭이 이미 쓰는 중이거나 지원하지 않는 브라우저: 온라인 전용으로 동작 */ }
    fb = { app: app, auth: auth, fs: fs };
    return fb;
  }
  /* 문서 내용은 JSON 글자 하나로 묶어 저장한다. 도구마다 다른 모양(중첩 배열 등)의 데이터를 Firestore 제약 없이 그대로 보관하기 위해서다. */
  function fsSnap(s) {
    var d; if (s.exists) { try { d = JSON.parse(s.data().j); } catch (e) { d = undefined; } }
    return snap(s.id, s.exists && d !== undefined, d, { fromCache: !!s.metadata.fromCache, hasPendingWrites: !!s.metadata.hasPendingWrites });
  }
  function fsDb(uid) {
    var fs = fb.fs;
    var fail = function (e) { throw { code: (e && e.code) || 'unavailable', message: (e && e.message) || String(e) }; };
    function docRef(p0) {
      var p = mapPath(uid, p0), ref = fs.doc(p);
      return {
        id: p.split('/').pop(), path: p0,
        get: function () { return ref.get().then(fsSnap, fail); },
        set: function (d) { return ref.set({ j: JSON.stringify(d), t: Date.now() }).catch(fail); },
        update: function (d) {
          return ref.get().then(function (s) {
            if (!s.exists) throw { code: 'invalid_argument', message: 'document does not exist' };
            return ref.set({ j: JSON.stringify(deepMerge(JSON.parse(s.data().j), clone(d))), t: Date.now() });
          }).catch(fail);
        },
        'delete': function () { return ref.delete().catch(fail); },
        onSnapshot: function (next, err) { return ref.onSnapshot({ includeMetadataChanges: true }, function (s) { next(fsSnap(s)); }, function (e) { if (err) err({ code: e.code || 'unavailable', message: e.message }); }); }
      };
    }
    function colRef(p0, lim) {
      var p = mapPath(uid, p0);
      var q = function () { var c = fs.collection(p); return lim ? c.limit(lim) : c; };
      var wrap = function (s) { var docs = s.docs.map(fsSnap); return { docs: docs, size: docs.length, empty: !docs.length, metadata: { fromCache: !!s.metadata.fromCache } }; };
      return {
        path: p0,
        doc: function (id) { return docRef(p0 + '/' + (id || fs.collection(p).doc().id)); },
        limit: function (n) { return colRef(p0, n); },
        get: function () { return q().get().then(wrap, fail); },
        onSnapshot: function (next, err) { return q().onSnapshot({ includeMetadataChanges: true }, function (s) { next(wrap(s)); }, function (e) { if (err) err({ code: e.code || 'unavailable', message: e.message }); }); }
      };
    }
    return { doc: docRef, collection: function (p) { return colRef(p); } };
  }

  function downloads() {
    return {
      save: async function (r) {
        var blob = r.data instanceof Blob ? r.data : new Blob([r.data]);
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = r.filename || 'download';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        return { status: 'saved' };
      }
    };
  }

  window.Backend = {
    hasConfig: hasConfig,
    savedMode: function () { try { return localStorage.getItem(MODE_KEY); } catch (e) { return null; } },
    setMode: function (m) { try { if (m) localStorage.setItem(MODE_KEY, m); else localStorage.removeItem(MODE_KEY); } catch (e) {} },
    /* 이 기기 전용으로 시작 */
    localAdapters: function () {
      return { db: localDb(), user: { id: async function () { return 'local'; } }, downloads: downloads(), who: '이 기기' };
    },
    /* Firebase로 시작: 로그인 상태가 바뀔 때마다 onUser(사용자 | null) */
    startFirebase: async function (onUser) {
      var f = await fbInit();
      try { await f.auth.getRedirectResult(); } catch (e) { /* 리디렉션 로그인 오류는 아래 상태 변화로 드러난다 */ }
      f.auth.onAuthStateChanged(function (u) { onUser(u); });
    },
    firebaseAdapters: function (u) {
      return { db: fsDb(u.uid), user: { id: async function () { return u.uid; } }, downloads: downloads(), who: u.email || u.displayName || '로그인됨' };
    },
    signIn: async function () {
      var f = await fbInit(), prov = new firebase.auth.GoogleAuthProvider();
      try { await f.auth.signInWithPopup(prov); }
      catch (e) {
        if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) { await f.auth.signInWithRedirect(prov); return; }
        throw e;
      }
    },
    signOut: async function () { var f = await fbInit(); await f.auth.signOut(); }
  };
})();
