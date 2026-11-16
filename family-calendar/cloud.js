/* 우리 가족 달력 — Firebase(Cloud Firestore) 실시간 공유 계층
   - 가족 코드 → 방 ID(SHA-256) 로 바꿔 rooms/{roomId}/events 에 저장
   - 익명 로그인 + 보안 규칙으로 로그인한 클라이언트만 접근
   - onSnapshot 으로 가족 폰에 즉시 반영
*/
(function () {
  'use strict';

  var CONFIG = {
    apiKey: 'AIzaSyCutf-64Bl3sXtm-xZtr5vRZUqwpkNI6NY',
    authDomain: 'family-calendar-woo.firebaseapp.com',
    projectId: 'family-calendar-woo',
    storageBucket: 'family-calendar-woo.firebasestorage.app',
    messagingSenderId: '819610372929',
    appId: '1:819610372929:web:f250787e0e73d87fe32fc0'
  };

  var CODE_KEY = 'family-calendar.room.v2';
  var ROOM_SALT = 'family-calendar-room:';

  var state = {
    auth: null,
    db: null,
    roomRef: null,
    roomId: '',
    code: '',
    unsub: null,
    handlers: {}
  };

  /* ---------------- SHA-256 (순수 JS — 모든 기기에서 같은 방 ID가 나오도록) ---------------- */
  var SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(str) {
    var out = [], i, c, c2, cp;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c < 0xd800 || c >= 0xe000) { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
      else {
        i++; c2 = str.charCodeAt(i);
        cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
    }
    return out;
  }

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256Hex(str) {
    var bytes = utf8Bytes(String(str));
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    bytes.push(0, 0, 0, 0);
    bytes.push((bitLen >>> 24) & 255, (bitLen >>> 16) & 255, (bitLen >>> 8) & 255, bitLen & 255);

    var w = new Array(64), i, off;
    for (off = 0; off < bytes.length; off += 64) {
      for (i = 0; i < 16; i++) {
        w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      }
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA_K[i] + w[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var hex = '';
    for (var k = 0; k < 8; k++) hex += ('00000000' + (H[k] >>> 0).toString(16)).slice(-8);
    return hex;
  }

  /* ---------------- 가족 코드 / 방 ID ---------------- */
  function normalizeCode(raw) {
    var code = String(raw == null ? '' : raw).trim();
    if (code && code.normalize) code = code.normalize('NFC');
    return code.toLowerCase().replace(/\s+/g, '');
  }

  function roomIdForCode(code) {
    return sha256Hex(ROOM_SALT + normalizeCode(code)).slice(0, 32);
  }

  function storedCode() {
    try { return normalizeCode(localStorage.getItem(CODE_KEY) || ''); } catch (e) { return ''; }
  }
  function urlCode() {
    try {
      var v = new URLSearchParams(location.search).get('code');
      return v ? normalizeCode(v) : '';
    } catch (e) { return ''; }
  }
  function initialCode() { return urlCode() || storedCode(); }
  function rememberCode(code) {
    try { localStorage.setItem(CODE_KEY, normalizeCode(code)); } catch (e) { /* 저장 못해도 이번엔 동작 */ }
  }
  function forgetCode() {
    try { localStorage.removeItem(CODE_KEY); } catch (e) { /* 무시 */ }
  }

  /* ---------------- 연결 ---------------- */
  function emit(name, payload) {
    var fn = state.handlers[name];
    if (typeof fn === 'function') {
      try { fn(payload); } catch (e) { /* 화면 오류로 연결이 끊기지 않게 */ }
    }
  }

  function ensureApp() {
    if (!window.firebase) throw new Error('firebase-sdk-missing');
    if (!state.db) {
      var app = (firebase.apps && firebase.apps.length) ? firebase.apps[0] : firebase.initializeApp(CONFIG);
      state.auth = firebase.auth();
      state.db = firebase.firestore();
      try { state.db.settings({ ignoreUndefinedProperties: true }); } catch (e) { /* 구버전 무시 */ }
      state.db.enablePersistence({ synchronizeTabs: true }).catch(function () { /* 캐시 없이도 동작 */ });
    }
    return state.db;
  }

  function signIn() {
    ensureApp();
    if (state.auth.currentUser) return Promise.resolve(state.auth.currentUser);
    return state.auth.signInAnonymously().then(function (cred) { return cred.user; });
  }

  function start(code, handlers) {
    var clean = normalizeCode(code);
    if (!clean) return Promise.reject(new Error('empty-code'));
    state.handlers = handlers || {};
    state.code = clean;
    emit('onStatus', { kind: 'pending', text: '가족 방에 연결하는 중…' });

    try { ensureApp(); } catch (err) { return Promise.reject(err); }

    return signIn().then(function () {
      state.roomId = roomIdForCode(clean);
      state.roomRef = state.db.collection('rooms').doc(state.roomId);
      return state.roomRef.get();
    }).then(function (snap) {
      if (snap.exists) return { created: false };
      if (typeof state.handlers.confirmCreate === 'function' && !state.handlers.confirmCreate(clean)) {
        return Promise.reject(new Error('cancelled'));
      }
      return state.roomRef.set({
        schema: 1,
        name: '우리 가족',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(function () {
        return seedRoom();
      }).then(function () { return { created: true }; });
    }).then(function (info) {
      rememberCode(clean);
      listen();
      return info;
    });
  }

  function seedRoom() {
    var seeds = typeof state.handlers.seedEvents === 'function' ? state.handlers.seedEvents() : [];
    if (!seeds || !seeds.length) return Promise.resolve(0);
    var batch = state.db.batch();
    seeds.forEach(function (data) {
      batch.set(eventCollection().doc(), cleanPayload(data));
    });
    return batch.commit().then(function () { return seeds.length; });
  }

  function eventCollection() {
    return state.roomRef.collection('events');
  }

  function cleanPayload(data) {
    return {
      title: String(data.title || '').slice(0, 80),
      date: String(data.date || ''),
      time: data.time || null,
      members: Array.isArray(data.members) ? data.members.slice(0, 10) : [],
      category: String(data.category || 'etc'),
      memo: String(data.memo || '').slice(0, 300),
      repeat: String(data.repeat || 'none'),
      lunar: data.lunar || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
  }

  function listen() {
    if (state.unsub) { state.unsub(); state.unsub = null; }
    state.unsub = eventCollection().onSnapshot(function (snap) {
      var list = [];
      snap.forEach(function (doc) {
        var data = doc.data() || {};
        if (typeof data.title !== 'string') return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) return;
        list.push({
          id: doc.id,
          title: data.title,
          date: data.date,
          time: data.time || null,
          members: Array.isArray(data.members) ? data.members : [],
          category: data.category || 'etc',
          memo: data.memo || '',
          repeat: data.repeat || 'none',
          lunar: data.lunar || null
        });
      });
      if (snap.metadata.fromCache) {
        emit('onStatus', { kind: 'offline', text: '오프라인 · 연결되면 자동으로 맞춰져요' });
      } else {
        emit('onStatus', { kind: 'online', text: '가족 실시간 공유 중 · ' + list.length + '건' });
      }
      emit('onData', list);
    }, function (err) {
      var code = (err && err.code) || '';
      if (code === 'permission-denied') {
        emit('onStatus', { kind: 'error', text: '가족 방에 들어갈 수 없어요 (코드를 확인해 주세요)' });
      } else if (code === 'unavailable') {
        emit('onStatus', { kind: 'offline', text: '연결을 기다리는 중이에요' });
      } else {
        emit('onStatus', { kind: 'error', text: '공유 연결 오류' + (code ? ' (' + code + ')' : '') });
      }
    });
  }

  /* ---------------- 읽기/쓰기 ---------------- */
  function saveEvent(id, data) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var payload = cleanPayload(data);
    if (id) {
      var ref = eventCollection().doc(id);
      return ref.set(payload, { merge: true }).then(function () { return id; });
    }
    var newRef = eventCollection().doc();
    payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    return newRef.set(payload).then(function () { return newRef.id; });
  }

  function deleteEvent(id) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    return eventCollection().doc(id).delete();
  }

  function deleteSamples() {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    return eventCollection().get().then(function (snap) {
      var batch = state.db.batch(), n = 0;
      snap.forEach(function (doc) {
        var title = (doc.data() || {}).title || '';
        if (title.indexOf('[샘플]') === 0) { batch.delete(doc.ref); n++; }
      });
      if (!n) return 0;
      return batch.commit().then(function () { return n; });
    });
  }

  function stop() {
    if (state.unsub) { state.unsub(); state.unsub = null; }
    state.roomRef = null;
    state.roomId = '';
    state.code = '';
  }

  window.FamilyCloud = {
    CONFIG: CONFIG,
    normalizeCode: normalizeCode,
    roomIdForCode: roomIdForCode,
    initialCode: initialCode,
    storedCode: storedCode,
    rememberCode: rememberCode,
    forgetCode: forgetCode,
    start: start,
    stop: stop,
    saveEvent: saveEvent,
    deleteEvent: deleteEvent,
    deleteSamples: deleteSamples,
    sha256Hex: sha256Hex
  };
})();
