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
    unsubRoom: null,
    room: null,
    requests: [],
    profileRequests: [],
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

  /* ---------------- 휴대폰 번호 ----------------
     숫자만 남기고 한국 번호는 하이픈을 자동으로 넣습니다.
     010-1234-5678 / 02-1234-5678 / 031-123-4567 / 1588-1234 / +82 10-1234-5678 */
  function normalizeTel(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    var plus = s.charAt(0) === '+';
    var d = s.replace(/[^0-9]/g, '');
    if (!d) return '';
    if (plus) return ('+' + d).slice(0, 20);
    d = d.slice(0, 11);
    if (d.length === 8) return d.slice(0, 4) + '-' + d.slice(4);
    if (d.charAt(0) === '0') {
      if (d.slice(0, 2) === '02') {
        if (d.length === 9) return '02-' + d.slice(2, 5) + '-' + d.slice(5);
        if (d.length === 10) return '02-' + d.slice(2, 6) + '-' + d.slice(6);
      } else if (d.length === 10) {
        return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
      } else if (d.length === 11) {
        return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
      }
    }
    return d;
  }

  /* tel: 링크에 넣을 숫자(국가번호 + 포함) */
  function telDigits(raw) {
    var d = String(raw == null ? '' : raw).replace(/[^0-9+]/g, '');
    return d;
  }

  /* 번호가 걸려 있는지(9자리 이상) */
  function telLooksValid(raw) {
    var d = String(raw == null ? '' : raw).replace(/[^0-9]/g, '');
    return d.length >= 9 && d.length <= 15;
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

  /* ---------------- 계정(로그인) ----------------
     로그인 없이(익명) 쓰던 기존 흐름은 그대로 두고, 이메일·구글 계정을 더합니다.
     Firestore 규칙은 `request.auth != null` 만 보므로 익명·이메일·구글 사용자가 같은 방을 씁니다. */

  var METHOD_LABEL = { google: '구글 로그인', email: '이메일 로그인', anonymous: '익명 기기' };

  var authStore = {
    ready: false,
    promise: null,
    info: null,
    listeners: []
  };

  function describeUser(u) {
    if (!u || u.isAnonymous) {
      return {
        signedIn: false, anonymous: true,
        uid: u ? (u.uid || '') : '',
        email: '', name: '', method: 'anonymous', methodLabel: METHOD_LABEL.anonymous, providerId: ''
      };
    }
    var pid = '';
    var list = u.providerData || [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].providerId) { pid = list[i].providerId; break; }
    }
    var method = pid === 'google.com' ? 'google' : (pid === 'password' ? 'email' : (pid ? pid.split('.')[0] : 'email'));
    return {
      signedIn: true, anonymous: false,
      uid: u.uid || '',
      email: u.email || '',
      name: u.displayName || '',
      method: method,
      methodLabel: METHOD_LABEL[method] || '로그인',
      providerId: pid
    };
  }

  function notifyAuth() {
    var user = state.auth ? state.auth.currentUser : null;
    authStore.info = describeUser(user);
    var list = authStore.listeners.slice();
    var i;
    for (i = 0; i < list.length; i++) {
      try { list[i](authStore.info); } catch (e) { /* 화면 오류가 인증을 막지 않게 */ }
    }
  }

  /* 로그인 상태 복원이 끝날 때까지 기다립니다. 이때 `start()` 가 익명으로 먼저 들어가
     이메일·구글 세션을 덮어쓰는 일을 막습니다. */
  function initAuth() {
    ensureApp();
    if (authStore.ready) return authStore.promise;
    authStore.ready = true;
    authStore.info = describeUser(state.auth.currentUser);
    authStore.promise = new Promise(function (resolve) {
      var settled = false;
      state.auth.onAuthStateChanged(function (u) {
        if (!settled) { settled = true; resolve(u || null); }
        notifyAuth();
      }, function () {
        if (!settled) { settled = true; resolve(null); }
        notifyAuth();
      });
    });
    return authStore.promise;
  }

  function authReady() {
    try { ensureApp(); } catch (e) { return Promise.resolve(null); }
    return initAuth();
  }

  /* 토큰을 미리 받아 둡니다. 로그인·로그아웃 직후에는 Firestore가 토큰을 받기 전에
     요청해 권한 오류(permission-denied)가 날 수 있어, 한 번 받아 둔 뒤 연결합니다. */
  function warmToken(user) {
    if (!user || typeof user.getIdToken !== 'function') return Promise.resolve(user);
    return user.getIdToken().then(function () { return user; }, function () { return user; });
  }

  function signIn() {
    ensureApp();
    return authReady().then(function (u) {
      if (u) return warmToken(u);
      if (state.auth.currentUser) return warmToken(state.auth.currentUser);
      return state.auth.signInAnonymously().then(function (cred) {
        return warmToken(cred && cred.user ? cred.user : state.auth.currentUser);
      });
    });
  }

  function accountInfo() {
    try {
      ensureApp();
      return describeUser(state.auth.currentUser);
    } catch (e) {
      return describeUser(null);
    }
  }

  function onAuth(cb) {
    if (typeof cb !== 'function') return function () {};
    authStore.listeners.push(cb);
    authReady().then(function () {
      try { cb(accountInfo()); } catch (e) { /* 무시 */ }
    });
    return function () {
      var i = authStore.listeners.indexOf(cb);
      if (i >= 0) authStore.listeners.splice(i, 1);
    };
  }

  function emailValue(v) { return String(v == null ? '' : v).trim(); }

  function signUpWithEmail(email, password, name) {
    ensureApp();
    var display = String(name == null ? '' : name).trim().slice(0, 20);
    return authReady().then(function () {
      return state.auth.createUserWithEmailAndPassword(emailValue(email), String(password == null ? '' : password));
    }).then(function (cred) {
      var user = cred && cred.user ? cred.user : state.auth.currentUser;
      if (!display || !user || typeof user.updateProfile !== 'function') return user;
      return user.updateProfile({ displayName: display }).then(function () { return user; });
    }).then(function (user) {
      notifyAuth();
      return describeUser(user);
    });
  }

  function signInWithEmail(email, password) {
    ensureApp();
    return authReady().then(function () {
      return state.auth.signInWithEmailAndPassword(emailValue(email), String(password == null ? '' : password));
    }).then(function (cred) {
      notifyAuth();
      return describeUser(cred && cred.user ? cred.user : state.auth.currentUser);
    });
  }

  function googleProvider() {
    var provider = new firebase.auth.GoogleAuthProvider();
    try { provider.setCustomParameters({ prompt: 'select_account' }); } catch (e) { /* 무시 */ }
    return provider;
  }

  /* 팝업 → 막히면 리디렉션. 안드로이드 앱(WebView)에서는 구글이 403 으로 막으므로
     앱에서는 이 함수를 부르지 않고 브라우저로 안내합니다(app.js). */
  function signInWithGoogle() {
    ensureApp();
    return authReady().then(function () {
      return state.auth.signInWithPopup(googleProvider());
    }).then(function (cred) {
      notifyAuth();
      return describeUser(cred && cred.user ? cred.user : state.auth.currentUser);
    });
  }

  function signInWithGoogleRedirect() {
    ensureApp();
    return authReady().then(function () {
      return state.auth.signInWithRedirect(googleProvider());
    });
  }

  /* 리디렉션으로 다녀온 로그인 결과를 마무리합니다. 없으면 null. */
  function finishRedirectSignIn() {
    try { ensureApp(); } catch (e) { return Promise.resolve(null); }
    if (typeof state.auth.getRedirectResult !== 'function') return Promise.resolve(null);
    return authReady().then(function () {
      return state.auth.getRedirectResult();
    }).then(function (result) {
      notifyAuth();
      return result && result.user ? describeUser(result.user) : null;
    }).catch(function () { return null; });
  }

  function sendPasswordReset(email) {
    ensureApp();
    return authReady().then(function () {
      return state.auth.sendPasswordResetEmail(emailValue(email));
    });
  }

  function signOutAccount() {
    ensureApp();
    if (!state.auth.currentUser) return Promise.resolve(true);
    return state.auth.signOut().then(function () {
      notifyAuth();
      return true;
    });
  }

  function setAccountName(name) {
    ensureApp();
    var user = state.auth.currentUser;
    if (!user) return Promise.reject(new Error('not-signed-in'));
    return user.updateProfile({ displayName: String(name == null ? '' : name).trim().slice(0, 20) }).then(function () {
      notifyAuth();
      return describeUser(state.auth.currentUser);
    });
  }

  /* 로그인 오류를 화면에 보여줄 한국어 문구로 */
  function authErrorHint(err) {
    var code = String((err && err.code) || '');
    var map = {
      'auth/invalid-email': '이메일 주소를 다시 확인해 주세요.',
      'auth/missing-email': '이메일 주소를 넣어 주세요.',
      'auth/user-not-found': '가입된 이메일이 없어요. 회원가입을 해 주세요.',
      'auth/wrong-password': '비밀번호가 맞지 않아요.',
      'auth/invalid-credential': '이메일 또는 비밀번호가 맞지 않아요.',
      'auth/invalid-login-credentials': '이메일 또는 비밀번호가 맞지 않아요.',
      'auth/email-already-in-use': '이미 가입된 이메일이에요. 로그인해 주세요.',
      'auth/weak-password': '비밀번호는 6자 이상으로 정해 주세요.',
      'auth/missing-password': '비밀번호를 넣어 주세요.',
      'auth/too-many-requests': '시도가 너무 많았어요. 잠시 뒤에 다시 해 주세요.',
      'auth/network-request-failed': '인터넷 연결을 확인해 주세요.',
      'auth/operation-not-allowed': '지금은 이 로그인 방식이 꺼져 있어요.',
      'auth/popup-blocked': '팝업이 막혀 있어요. 다시 한 번 눌러 주세요.',
      'auth/popup-closed-by-user': '로그인 창을 닫았어요.',
      'auth/cancelled-popup-request': '로그인 창을 닫았어요.',
      'auth/redirect-cancelled-by-user': '로그인을 취소했어요.',
      'auth/account-exists-with-different-credential': '같은 이메일로 다른 방식의 계정이 있어요. 그 방식으로 로그인해 주세요.',
      'auth/unauthorized-domain': '이 사이트 주소가 로그인 허용 목록에 없어요.',
      'auth/requires-recent-login': '보안을 위해 다시 로그인한 뒤에 해 주세요.',
      'auth/user-disabled': '사용할 수 없는 계정이에요.',
      'auth/internal-error': '잠시 뒤에 다시 시도해 주세요.',
      'auth/operation-not-supported-in-this-environment': '이 환경에서는 그 로그인을 쓸 수 없어요. 이메일 로그인을 써 주세요.'
    };
    if (map[code]) return map[code];
    if (code) return code.replace('auth/', '') + ' 오류가 났어요.';
    return (err && err.message) || '알 수 없는 오류가 났어요.';
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
      // 먼저 구독을 걸어 두면 캐시에 있던 일정이 곧바로 보입니다.
      listen();
      listenRoom();
      return roomLookup();
    }).then(function (exists) {
      if (exists === false) {
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
      }
      return { created: false };
    }).then(function (info) {
      rememberCode(clean);
      return info;
    });
  }

  /* 방 문서가 있는지 확인. 네트워크가 느리거나 끊겨 있으면 null(모름)을 돌려
     새 방을 엉겁결에 만들지 않습니다. */
  function roomLookup() {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve(null);
      }, 7000);
      state.roomRef.get().then(function (snap) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(!!snap.exists);
      }).catch(function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      });
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

  function eventPayload(data) {
    var date = String(data.date || '');
    var endDate = String(data.endDate || '');
    /* 알림 없음(null)을 0(정시)으로 바꾸지 않습니다. Number(null) === 0 이기 때문입니다. */
    var hasRemind = data.remind !== null && data.remind !== undefined && data.remind !== '' && !isNaN(Number(data.remind));
    var remind = hasRemind ? Number(data.remind) : NaN;
    return {
      title: String(data.title || '').slice(0, 80),
      date: date,
      endDate: /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate > date ? endDate : null,
      time: data.time || null,
      remind: (isFinite(remind) && remind >= 0) ? remind : null,
      members: Array.isArray(data.members) ? data.members.slice(0, 20) : [],
      category: String(data.category || 'etc'),
      memo: String(data.memo || '').slice(0, 300),
      repeat: String(data.repeat || 'none'),
      weekday: cleanWeekday(data.weekday, date),
      checklist: cleanChecklist(data.checklist),
      lunar: data.lunar || null
    };
  }

  /* 매주 반복 요일 (0=일 ~ 6=토). 없으면 날짜 요일로 채웁니다. */
  function cleanWeekday(value, date) {
    var w = Number(value);
    if (isFinite(w) && w >= 0 && w <= 6 && value !== null && value !== '' && value !== undefined) return Math.round(w);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      var p = String(date).split('-').map(Number);
      return new Date(p[0], p[1] - 1, p[2]).getDay();
    }
    return null;
  }

  /* ☑️ 준비물 체크리스트 — 항목 1개 {id, text, done}, 최대 30개 */
  function cleanChecklist(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.slice(0, 30).forEach(function (i) {
      if (!i || typeof i !== 'object') return;
      var text = String(i.text == null ? '' : i.text).trim().slice(0, 40);
      if (!text) return;
      out.push({
        id: String(i.id || '').slice(0, 24) || ('ck' + out.length),
        text: text,
        done: i.done === true
      });
    });
    return out;
  }

  function cleanPayload(data) {
    var payload = eventPayload(data);
    payload.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    return payload;
  }

  function listen() {
    if (state.unsub) { state.unsub(); state.unsub = null; }
    state.unsub = eventCollection().onSnapshot({ includeMetadataChanges: true }, function (snap) {
      var list = [];
      var photos = [];
      snap.forEach(function (doc) {
        var data = doc.data() || {};
        if (data.kind === 'photo') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) return;
          if (typeof data.photoDataUrl !== 'string' || data.photoDataUrl.indexOf('data:image/') !== 0) return;
          photos.push({
            id: doc.id,
            date: data.date,
            folder: String(data.folder || '기본').slice(0, 24),
            photo: data.photoDataUrl,
            memo: String(data.memo || '').slice(0, 120),
            createdAt: data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : 0
          });
          return;
        }
        if (typeof data.title !== 'string') return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) return;
        list.push({
          id: doc.id,
          title: data.title,
          date: data.date,
          endDate: /^\d{4}-\d{2}-\d{2}$/.test(data.endDate || '') ? data.endDate : null,
          time: data.time || null,
          remind: (data.remind === 0 || data.remind > 0) ? Number(data.remind) : null,
          members: Array.isArray(data.members) ? data.members : [],
          category: data.category || 'etc',
          memo: data.memo || '',
          repeat: data.repeat || 'none',
          weekday: (data.weekday === 0 || data.weekday > 0) ? Number(data.weekday) : null,
          checklist: cleanChecklist(data.checklist),
          lunar: data.lunar || null,
          createdAt: data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : 0
        });
      });
      if (snap.metadata.fromCache) {
        emit('onStatus', { kind: 'offline', text: '오프라인 · 연결되면 자동으로 맞춰져요' });
      } else if (snap.metadata.hasPendingWrites) {
        emit('onStatus', { kind: 'pending', text: '저장하는 중…' });
      } else {
        emit('onStatus', { kind: 'online', text: '가족 실시간 공유 중 · 일정 ' + list.length + '건' + (photos.length ? ' · 사진 ' + photos.length + '장' : '') });
      }
      emit('onData', list);
      emit('onPhotos', photos);
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

  /* ☑️ 준비물 체크만 저장 — 다른 칸(제목·날짜·메모)은 건드리지 않습니다.
     일반 구성원도 체크할 수 있고, 가족 모두의 폰에 바로 반영됩니다. */
  function saveChecklist(id, list) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    if (!id) return Promise.reject(new Error('no-event'));
    return eventCollection().doc(id).set({
      checklist: cleanChecklist(list),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  function savePhoto(data) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var url = String(data.photoDataUrl || '');
    if (url.indexOf('data:image/') !== 0) return Promise.reject(new Error('bad-photo'));
    var ref = eventCollection().doc();
    return ref.set({
      kind: 'photo',
      date: String(data.date || ''),
      folder: String(data.folder || '기본').slice(0, 24),
      photoDataUrl: url,
      memo: String(data.memo || '').slice(0, 120),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () { return ref.id; });
  }

  function deletePhoto(id) {
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

  /* ---------------- 방 문서: 구성원·관리자 PIN·등록 요청 ----------------
     요청(requests)은 방 문서 안의 맵 필드로 저장합니다. 배포된 보안 규칙이 하위
     컬렉션(rooms/{roomId}/requests) 쓰기를 막고 있어서, 이미 허용된 방 문서 필드에
     두면 규칙을 바꾸지 않아도 되고 예전 버전 앱은 이 필드를 무시합니다. */
  function listenRoom() {
    if (state.unsubRoom) { state.unsubRoom(); state.unsubRoom = null; }
    state.unsubRoom = state.roomRef.onSnapshot(function (snap) {
      var d = snap.exists ? (snap.data() || {}) : {};
      state.room = d;
      var raw = d.requests && typeof d.requests === 'object' ? d.requests : {};
      var list = [];
      Object.keys(raw).forEach(function (key) {
        var r = raw[key];
        if (!r || typeof r !== 'object' || typeof r.title !== 'string') return;
        list.push({
          id: key,
          status: r.status === 'approved' || r.status === 'rejected' ? r.status : 'pending',
          requesterId: String(r.requesterId || ''),
          requesterName: String(r.requesterName || ''),
          title: r.title,
          date: String(r.date || ''),
          endDate: /^\d{4}-\d{2}-\d{2}$/.test(r.endDate || '') ? r.endDate : null,
          time: r.time || null,
          remind: (r.remind === 0 || r.remind > 0) ? Number(r.remind) : null,
          members: Array.isArray(r.members) ? r.members : [],
          category: String(r.category || 'etc'),
          memo: String(r.memo || ''),
          repeat: String(r.repeat || 'none'),
          weekday: (r.weekday === 0 || r.weekday > 0) ? Number(r.weekday) : null,
          checklist: cleanChecklist(r.checklist),
          lunar: r.lunar || null,
          createdAt: r.createdAt && r.createdAt.toMillis ? r.createdAt.toMillis() : 0,
          decidedBy: String(r.decidedBy || ''),
          decidedByName: String(r.decidedByName || ''),
          decidedAt: r.decidedAt && r.decidedAt.toMillis ? r.decidedAt.toMillis() : 0,
          eventId: String(r.eventId || '')
        });
      });
      list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      state.requests = list;
      var profileList = parseProfileRequests(d.profileRequests);
      state.profileRequests = profileList;
      /* 내보낸 구성원의 계정(uid) — 이 uid 로는 가족 방을 열 수 없게 합니다. */
      var revoked = Array.isArray(d.revokedUids)
        ? d.revokedUids.filter(function (x) { return typeof x === 'string' && x; }).slice(0, 200) : [];
      var removed = parseRemovedMembers(d.removedMembers);
      emit('onRoom', {
        exists: snap.exists,
        members: Array.isArray(d.members) ? d.members : [],
        pins: d.pins && typeof d.pins === 'object' ? d.pins : {},
        requests: list,
        profileRequests: profileList,
        revokedUids: revoked,
        removedMembers: removed
      });
    }, function (err) {
      emit('onRoomError', err);
    });
  }

  /* 신상정보(이름·휴대폰 번호) 변경 요청 — 방 문서의 profileRequests 맵 필드
     항목: { targetId, requesterId, requesterName, prevName, prevTel, name, tel,
             status: pending|approved|rejected, createdAt, decidedBy, decidedByName, decidedAt } */
  function parseProfileRequests(raw) {
    var list = [];
    if (!raw || typeof raw !== 'object') return list;
    Object.keys(raw).forEach(function (key) {
      var r = raw[key];
      if (!r || typeof r !== 'object') return;
      var targetId = String(r.targetId || '');
      if (!targetId) return;
      var name = typeof r.name === 'string' ? r.name.slice(0, 12) : '';
      var tel = normalizeTel(r.tel == null ? '' : r.tel);
      if (!name && !tel) return;
      list.push({
        id: key,
        targetId: targetId,
        status: r.status === 'approved' || r.status === 'rejected' ? r.status : 'pending',
        requesterId: String(r.requesterId || ''),
        requesterName: String(r.requesterName || '').slice(0, 12),
        prevName: String(r.prevName || '').slice(0, 12),
        prevTel: normalizeTel(r.prevTel == null ? '' : r.prevTel),
        name: name,
        tel: tel,
        createdAt: r.createdAt && r.createdAt.toMillis ? r.createdAt.toMillis() : 0,
        decidedBy: String(r.decidedBy || ''),
        decidedByName: String(r.decidedByName || '').slice(0, 12),
        decidedAt: r.decidedAt && r.decidedAt.toMillis ? r.decidedAt.toMillis() : 0
      });
    });
    list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    return list;
  }

  /* 지금 방 문서에 있는 구성원(없으면 null) */
  function roomMember(id) {
    var list = state.room && Array.isArray(state.room.members) ? state.room.members : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id || '') === String(id || '')) return list[i];
    }
    return null;
  }

  /* 구성원에 붙은 계정(uid) 목록 — 최대 8개, 문자열만 */
  function cleanUids(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.forEach(function (u) {
      var v = String(u == null ? '' : u).trim().slice(0, 128);
      if (!v || out.indexOf(v) >= 0) return;
      if (out.length < 8) out.push(v);
    });
    return out;
  }

  function myUid() {
    try { return (state.auth && state.auth.currentUser && state.auth.currentUser.uid) || ''; } catch (e) { return ''; }
  }

  /* 이 폰의 계정(uid)을 내 프로필(구성원)에 붙여 둡니다.
     나중에 관리자가 그 구성원을 내보내면 이 uid 가 차단 목록에 올라가 다시 들어올 수 없어요. */
  function bindMemberAccount(memberId) {
    if (!state.roomRef) return Promise.resolve(false);
    var uid = myUid();
    var id = String(memberId || '');
    if (!uid || !id) return Promise.resolve(false);
    return state.db.runTransaction(function (tx) {
      return tx.get(state.roomRef).then(function (snap) {
        if (!snap.exists) return false;
        var d = snap.data() || {};
        var members = Array.isArray(d.members) ? d.members.slice() : [];
        var idx = -1, i;
        for (i = 0; i < members.length; i++) {
          if (members[i] && String(members[i].id || '') === id) { idx = i; break; }
        }
        if (idx < 0) return false;
        var cur = members[idx] || {};
        var uids = cleanUids(cur.uids);
        if (uids.indexOf(uid) >= 0) return false;
        uids.unshift(uid);
        var next = {};
        Object.keys(cur).forEach(function (k) { next[k] = cur[k]; });
        next.uids = uids.slice(0, 8);
        members[idx] = next;
        tx.update(state.roomRef, { members: members });
        return true;
      });
    }).catch(function () { return false; });
  }

  /* 내보낸 구성원 — { name, color, bg, role, tel, uids[], removedAt, removedBy } */
  function parseRemovedMembers(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (key) {
      var r = raw[key];
      if (!r || typeof r !== 'object') return;
      out[key] = {
        id: key,
        name: String(r.name || '').slice(0, 12),
        color: String(r.color || '#64748b').slice(0, 9),
        bg: String(r.bg || '').slice(0, 9),
        role: r.role === 'manager' ? 'manager' : 'member',
        tel: normalizeTel(r.tel == null ? '' : r.tel),
        uids: cleanUids(r.uids),
        removedAt: r.removedAt && r.removedAt.toMillis ? r.removedAt.toMillis() : 0,
        removedBy: String(r.removedBy || '').slice(0, 12)
      };
    });
    return out;
  }

  /* 관리자가 구성원을 내보냅니다.
     - members[] 에서 빼고 removedMembers 에 이름·번호와 함께 기록
     - 그 구성원에 붙은 계정(uid)을 revokedUids 에 올려 다시 들어오지 못하게 함
     - 일정·사진은 그대로 두므로 지난 기록은 남습니다 */
  function removeMember(memberId, me) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var id = String(memberId || '');
    if (!id) return Promise.reject(new Error('member-missing'));
    return state.db.runTransaction(function (tx) {
      return tx.get(state.roomRef).then(function (snap) {
        if (!snap.exists) throw new Error('room-missing');
        var d = snap.data() || {};
        var members = Array.isArray(d.members) ? d.members.slice() : [];
        var idx = -1, i;
        for (i = 0; i < members.length; i++) {
          if (members[i] && String(members[i].id || '') === id) { idx = i; break; }
        }
        if (idx < 0) throw new Error('member-missing');
        var gone = members[idx] || {};
        if (gone.role === 'admin') throw new Error('cannot-remove-admin');
        members.splice(idx, 1);
        var uids = cleanUids(gone.uids);
        var patch = { members: members };
        patch['removedMembers.' + id] = {
          name: String(gone.name || '').slice(0, 12),
          color: String(gone.color || '#64748b').slice(0, 9),
          bg: String(gone.bg || '#64748b1f').slice(0, 9),
          role: (gone.role === 'manager' ? 'manager' : 'member'),
          tel: normalizeTel(gone.tel == null ? '' : gone.tel),
          uids: uids,
          removedAt: new Date(),
          removedBy: String((me && me.name) || '').slice(0, 12)
        };
        /* 그 구성원 PIN 은 지웁니다(빈 필드 삭제는 무시됨) */
        patch['pins.' + id] = firebase.firestore.FieldValue.delete();
        if (uids.length) patch.revokedUids = firebase.firestore.FieldValue.arrayUnion.apply(null, uids);
        tx.update(state.roomRef, patch);
        return uids;
      });
    });
  }

  /* 잘못 내보냈을 때 되돌리기 — 구성원을 다시 넣고 그 계정의 차단을 풉니다. */
  function restoreMember(memberId) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var id = String(memberId || '');
    if (!id) return Promise.reject(new Error('member-missing'));
    return state.db.runTransaction(function (tx) {
      return tx.get(state.roomRef).then(function (snap) {
        if (!snap.exists) throw new Error('room-missing');
        var d = snap.data() || {};
        var removed = d.removedMembers && typeof d.removedMembers === 'object' ? d.removedMembers : {};
        var rec = removed[id];
        if (!rec || typeof rec !== 'object') throw new Error('member-missing');
        var members = Array.isArray(d.members) ? d.members.slice() : [];
        var name = String(rec.name || '').slice(0, 12);
        if (!name) throw new Error('member-missing');
        for (var i = 0; i < members.length; i++) {
          if (members[i] && String(members[i].name || '') === name) throw new Error('name-taken');
        }
        var back = {
          id: id,
          name: name,
          color: String(rec.color || '#64748b').slice(0, 9),
          bg: String(rec.bg || '#64748b1f').slice(0, 9),
          role: (rec.role === 'manager' ? 'manager' : 'member')
        };
        var tel = normalizeTel(rec.tel == null ? '' : rec.tel);
        if (tel) back.tel = tel;
        var uids = cleanUids(rec.uids);
        if (uids.length) back.uids = uids;
        members.push(back);
        var patch = { members: members };
        patch['removedMembers.' + id] = firebase.firestore.FieldValue.delete();
        if (uids.length) patch.revokedUids = firebase.firestore.FieldValue.arrayRemove.apply(null, uids);
        tx.update(state.roomRef, patch);
        return back;
      });
    });
  }

  /* 회원 탈퇴 — Firebase Auth 계정을 지웁니다(익명 기기는 대상 아님).
     최근 로그인이 오래되면 auth/requires-recent-login 오류가 납니다(화면에서 안내). */
  function deleteAccount() {
    ensureApp();
    return authReady().then(function () {
      var user = state.auth.currentUser;
      if (!user) return Promise.reject(new Error('not-signed-in'));
      if (user.isAnonymous) return Promise.reject(new Error('anonymous-account'));
      return user.delete().then(function () {
        notifyAuth();
        return true;
      });
    });
  }

  function cleanMember(m) {
    var photo = typeof m.photoDataUrl === 'string' && m.photoDataUrl.indexOf('data:image/') === 0
      ? m.photoDataUrl.slice(0, 90000) : '';
    var out = {
      id: String(m.id || '').slice(0, 40),
      name: String(m.name || '').slice(0, 12),
      color: String(m.color || '#64748b').slice(0, 9),
      bg: String(m.bg || '').slice(0, 9),
      role: m.role === 'admin' || m.role === 'manager' ? m.role : 'member'
    };
    var tel = normalizeTel(m.tel);
    if (tel) out.tel = tel;
    if (photo) out.photoDataUrl = photo;
    var uids = cleanUids(m.uids);
    if (uids.length) out.uids = uids;
    return out;
  }

  function saveRoomMeta(patch) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    patch.schema = 2;
    return state.roomRef.set(patch, { merge: true });
  }

  function saveMembers(members) {
    return saveRoomMeta({ members: (members || []).map(cleanMember) });
  }

  /* PIN은 평문을 저장하지 않습니다. 방 ID를 섞은 SHA-256 해시만 남습니다. */
  function pinHash(id, pin) {
    return sha256Hex('family-calendar-pin:' + state.roomId + ':' + String(id) + ':' + String(pin));
  }

  function setPin(id, pin) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var key = 'pins.' + String(id);
    var patch = {};
    if (pin === null || pin === undefined) {
      patch[key] = firebase.firestore.FieldValue.delete();
    } else {
      patch[key] = pinHash(id, pin);
    }
    return state.roomRef.update(patch);
  }

  function submitRequest(data, me) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var id = 'rq' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var payload = eventPayload(data);
    payload.status = 'pending';
    payload.requesterId = String((me && me.id) || '');
    payload.requesterName = String((me && me.name) || '').slice(0, 12);
    payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    var patch = {};
    patch['requests.' + id] = payload;
    return state.roomRef.update(patch).then(function () { return id; });
  }

  function decideRequest(req, me, approve) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var batch = state.db.batch();
    var updates = {};
    updates['requests.' + req.id + '.status'] = approve ? 'approved' : 'rejected';
    updates['requests.' + req.id + '.decidedBy'] = String((me && me.id) || '');
    updates['requests.' + req.id + '.decidedByName'] = String((me && me.name) || '').slice(0, 12);
    updates['requests.' + req.id + '.decidedAt'] = firebase.firestore.FieldValue.serverTimestamp();
    var eventDocId = '';
    if (approve) {
      var evRef = eventCollection().doc();
      eventDocId = evRef.id;
      var payload = eventPayload(req);
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      payload.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      batch.set(evRef, payload);
      updates['requests.' + req.id + '.eventId'] = eventDocId;
    }
    batch.update(state.roomRef, updates);
    return batch.commit().then(function () { return eventDocId; });
  }

  /* ---------------- 신상정보 변경 요청 --------------
     일반 구성원은 자기 이름·번호를 바로 고칠 수 없고, 요청만 남깁니다.
     요청 맵은 dot-notation(`profileRequests.<id>.<field>`)으로만 건드려 다른 대기 요청을
     덮어쓰지 않습니다. 이미 대기 중인 요청이 있으면 같은 키를 갱신합니다(사람당 1건). */
  function submitProfileRequest(data) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var meId = String((data && data.meId) || '');
    var name = String((data && data.name) || '').trim().slice(0, 12);
    var tel = normalizeTel((data && data.tel) || '');
    if (!meId) return Promise.reject(new Error('no-member'));
    if (!name) return Promise.reject(new Error('empty-name'));
    var prev = roomMember(meId) || {};
    var existing = state.profileRequests.filter(function (r) {
      return r.targetId === meId && r.status === 'pending';
    })[0];
    var id = existing ? existing.id : ('pq' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    var base = 'profileRequests.' + id + '.';
    var patch = {};
    patch[base + 'targetId'] = meId;
    patch[base + 'requesterId'] = meId;
    patch[base + 'requesterName'] = String((data && data.meName) || prev.name || '').slice(0, 12);
    patch[base + 'prevName'] = String(prev.name || '').slice(0, 12);
    patch[base + 'prevTel'] = normalizeTel(prev.tel == null ? '' : prev.tel);
    patch[base + 'name'] = name;
    patch[base + 'tel'] = tel;
    patch[base + 'status'] = 'pending';
    patch[base + 'createdAt'] = firebase.firestore.FieldValue.serverTimestamp();
    patch[base + 'decidedBy'] = firebase.firestore.FieldValue.delete();
    patch[base + 'decidedByName'] = firebase.firestore.FieldValue.delete();
    patch[base + 'decidedAt'] = firebase.firestore.FieldValue.delete();
    return state.roomRef.update(patch).then(function () { return id; });
  }

  /* 승인하면 members[] 의 그 구성원 이름·번호를 요청 값으로 바꿉니다.
     현재 문서를 트랜잭션 안에서 다시 읽어, 그 사이 다른 곳에서 저장한 내용을 지우지 않습니다. */
  function decideProfileRequest(req, me, approve) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    if (!req || !req.id) return Promise.reject(new Error('no-request'));
    var base = 'profileRequests.' + req.id + '.';
    return state.db.runTransaction(function (tx) {
      return tx.get(state.roomRef).then(function (snap) {
        var d = snap.exists ? (snap.data() || {}) : {};
        var raw = d.profileRequests && typeof d.profileRequests === 'object' ? d.profileRequests : {};
        var cur = raw[req.id];
        if (!cur || typeof cur !== 'object') throw new Error('request-missing');
        if (cur.status && cur.status !== 'pending') throw new Error('already-decided');
        var updates = {};
        updates[base + 'status'] = approve ? 'approved' : 'rejected';
        updates[base + 'decidedBy'] = String((me && me.id) || '');
        updates[base + 'decidedByName'] = String((me && me.name) || '').slice(0, 12);
        updates[base + 'decidedAt'] = firebase.firestore.FieldValue.serverTimestamp();
        if (approve) {
          var targetId = String(cur.targetId || req.targetId || '');
          var members = Array.isArray(d.members) ? d.members.slice() : [];
          var idx = -1, i;
          for (i = 0; i < members.length; i++) {
            if (members[i] && String(members[i].id || '') === targetId) { idx = i; break; }
          }
          if (idx < 0) throw new Error('member-missing');
          var next = cleanMember(members[idx]);
          var name = String(cur.name == null ? '' : cur.name).trim().slice(0, 12);
          if (name) next.name = name;
          var tel = normalizeTel(cur.tel == null ? '' : cur.tel);
          if (tel) next.tel = tel; else delete next.tel;
          for (i = 0; i < members.length; i++) {
            if (i === idx) continue;
            if (members[i] && String(members[i].name || '') === next.name) throw new Error('name-taken');
          }
          members[idx] = next;
          updates.members = members;
        }
        tx.update(state.roomRef, updates);
      });
    });
  }

  function stop() {
    if (state.unsub) { state.unsub(); state.unsub = null; }
    if (state.unsubRoom) { state.unsubRoom(); state.unsubRoom = null; }
    state.roomRef = null;
    state.roomId = '';
    state.code = '';
    state.room = null;
    state.requests = [];
    state.profileRequests = [];
  }

  window.FamilyCloud = {
    CONFIG: CONFIG,
    ensureSignedIn: signIn,
    accountInfo: accountInfo,
    onAuth: onAuth,
    signUpWithEmail: signUpWithEmail,
    signInWithEmail: signInWithEmail,
    signInWithGoogle: signInWithGoogle,
    signInWithGoogleRedirect: signInWithGoogleRedirect,
    finishRedirectSignIn: finishRedirectSignIn,
    sendPasswordReset: sendPasswordReset,
    signOutAccount: signOutAccount,
    setAccountName: setAccountName,
    authErrorHint: authErrorHint,
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
    saveChecklist: saveChecklist,
    savePhoto: savePhoto,
    deletePhoto: deletePhoto,
    deleteSamples: deleteSamples,
    saveMembers: saveMembers,
    normalizeTel: normalizeTel,
    telDigits: telDigits,
    telLooksValid: telLooksValid,
    setPin: setPin,
    pinHash: pinHash,
    submitRequest: submitRequest,
    approveRequest: function (req, me) { return decideRequest(req, me, true); },
    rejectRequest: function (req, me) { return decideRequest(req, me, false); },
    submitProfileRequest: submitProfileRequest,
    approveProfileRequest: function (req, me) { return decideProfileRequest(req, me, true); },
    rejectProfileRequest: function (req, me) { return decideProfileRequest(req, me, false); },
    parseProfileRequests: parseProfileRequests,
    bindMemberAccount: bindMemberAccount,
    removeMember: removeMember,
    restoreMember: restoreMember,
    deleteAccount: deleteAccount,
    currentUid: myUid,
    sha256Hex: sha256Hex
  };
})();
