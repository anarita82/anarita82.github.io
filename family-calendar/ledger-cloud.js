/* 💰 금전출납부 — 사장님(본인)만 쓰는 비공개 Firebase 계층
   - 가족 달력(cloud.js)·매장 달력(store-cloud.js)과 방 ID 소금(salt)이 달라
     같은 Firestore 안에서도 자료가 절대 섞이지 않습니다.
   - 방 문서 rooms/{ledgerRoomId}: { schema, kind:'ledger', name, createdAt, pinHash }
   - 내역 rooms/{ledgerRoomId}/events/{id}: { kind:'ledger', type, area, category, amount, date, method, memo, repeatMonthly }
   - 배포된 보안 규칙(방 문서 get/create/update, events CRUD)을 그대로 쓰므로 규칙 변경이 없습니다.
   - PIN은 평문을 저장하지 않고 방 ID를 섞은 SHA-256 해시만 저장합니다.
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

  /* 이 방은 가족·매장 방과 다른 소금을 쓰고, 코드도 화면에 노출하지 않습니다.
     코드는 이 기기에서 무작위로 만들어 기기에만 저장합니다(서버·저장소에 상수로 두지 않음). */
  var CODE_KEY = 'family-calendar.ledger.code.v1';
  var ROOM_SALT = 'family-calendar-ledger-room:';
  var PIN_SALT = 'family-calendar-ledger-pin:';
  var CODE_PREFIX = 'lg-';
  var CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

  /* 80비트 난수 — 코드를 추측할 수 없게 crypto 로 만듭니다. */
  function generateCode() {
    var out = '';
    var buf = null;
    var idx = 0;
    if (window.crypto && window.crypto.getRandomValues) {
      buf = new Uint8Array(32);
      window.crypto.getRandomValues(buf);
    }
    while (out.length < 16) {
      if (buf && idx >= buf.length) { window.crypto.getRandomValues(buf); idx = 0; }
      var n = buf ? buf[idx++] : Math.floor(Math.random() * 31);
      if (buf && n >= 248) continue;            /* 247 이후 값은 버려 치우침을 없앱니다 */
      out += CODE_ALPHABET.charAt(n % 31);
    }
    return CODE_PREFIX + out;
  }

  function storedCode() {
    try { return localStorage.getItem(CODE_KEY) || ''; } catch (e) { return ''; }
  }
  function rememberCode(code) {
    try { localStorage.setItem(CODE_KEY, String(code || '')); } catch (e) { /* 저장 못해도 이번엔 동작 */ }
  }
  function forgetCode() {
    try { localStorage.removeItem(CODE_KEY); } catch (e) { /* 무시 */ }
  }

  function myUid() {
    try { return (state.auth && state.auth.currentUser && state.auth.currentUser.uid) || ''; } catch (e) { return ''; }
  }

  var state = {
    auth: null,
    db: null,
    roomRef: null,
    roomId: '',
    room: null,
    entries: [],
    unsub: null,
    unsubRoom: null,
    handlers: {},
    connecting: null,
    connected: false,
    freshCode: false,
    code: ''
  };

  function sha256(str) {
    if (window.FamilyCloud && typeof window.FamilyCloud.sha256Hex === 'function') {
      return window.FamilyCloud.sha256Hex(str);
    }
    if (window.StoreCloud && typeof window.StoreCloud.sha256 === 'function') {
      return window.StoreCloud.sha256(str);
    }
    return '';
  }

  function ensureApp() {
    if (typeof window.firebase === 'undefined' || !window.firebase.initializeApp) {
      throw new Error('firebase-sdk-missing');
    }
    if (!window.firebase.apps.length) window.firebase.initializeApp(CONFIG);
    if (!state.db) state.db = window.firebase.firestore();
    if (!state.auth) state.auth = window.firebase.auth();
    return state.auth;
  }

  function signIn() {
    ensureApp();
    if (state.auth.currentUser) return Promise.resolve(state.auth.currentUser);
    return state.auth.signInAnonymously().then(function (cred) {
      return cred && cred.user;
    });
  }

  function roomIdFor(code) {
    return sha256(ROOM_SALT + code).slice(0, 32);
  }

  function pinHash(pin) {
    return sha256(PIN_SALT + state.roomId + ':' + String(pin));
  }

  function emit(name, payload) {
    var fn = state.handlers && state.handlers[name];
    if (typeof fn === 'function') {
      try { fn(payload); } catch (e) { /* 무시 */ }
    }
  }

  function cleanAmount(v) {
    var n = Math.round(Number(v) || 0);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.min(n, 999999999);
  }

  function cleanDate(v) {
    var s = String(v || '');
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  function entryPayload(d) {
    var type = d.type === 'income' ? 'income' : 'expense';
    var area = d.area === 'store' ? 'store' : 'personal';
    var method = d.method === 'account' ? 'account' : (d.method === 'cash' ? 'cash' : 'card');
    return {
      kind: 'ledger',
      type: type,
      area: area,
      category: String(d.category || 'etc').slice(0, 20),
      amount: cleanAmount(d.amount),
      date: cleanDate(d.date),
      method: method,
      memo: String(d.memo || '').slice(0, 120),
      repeatMonthly: !!d.repeatMonthly,
      source: String(d.source || 'manual').slice(0, 12),
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
    };
  }

  function toEntry(id, data) {
    var d = data || {};
    return {
      id: id,
      kind: 'ledger',
      type: d.type === 'income' ? 'income' : 'expense',
      area: d.area === 'store' ? 'store' : 'personal',
      category: String(d.category || 'etc'),
      amount: Math.round(Number(d.amount) || 0),
      date: String(d.date || ''),
      method: d.method === 'account' ? 'account' : (d.method === 'cash' ? 'cash' : 'card'),
      memo: String(d.memo || ''),
      repeatMonthly: !!d.repeatMonthly,
      source: String(d.source || 'manual')
    };
  }

  function entriesRef() {
    return state.roomRef.collection('events');
  }

  function listenEntries() {
    if (state.unsub) { try { state.unsub(); } catch (e) { /* 무시 */ } }
    state.unsub = entriesRef().onSnapshot(function (snap) {
      var list = [];
      snap.forEach(function (doc) {
        var d = doc.data() || {};
        if (d.kind && d.kind !== 'ledger') return;
        list.push(toEntry(doc.id, d));
      });
      list.sort(function (a, b) { return a.date === b.date ? (a.amount - b.amount) : (a.date < b.date ? -1 : 1); });
      state.entries = list;
      state.connected = true;
      emit('onEntries', list.slice());
    }, function (err) {
      emit('onStatus', { kind: 'error', text: '출납부를 읽지 못했어요 · ' + (err && err.code ? err.code : 'error') });
    });
  }

  function listenRoom() {
    if (state.unsubRoom) { try { state.unsubRoom(); } catch (e) { /* 무시 */ } }
    state.unsubRoom = state.roomRef.onSnapshot(function (snap) {
      state.room = snap.exists ? (snap.data() || {}) : null;
      emit('onRoom', state.room);
    }, function () { /* 규칙상 방 문서를 못 읽어도 내역은 계속 씁니다 */ });
  }

  function roomLookup() {
    return state.roomRef.get().then(function (snap) {
      return !!snap.exists;
    }).catch(function () { return null; });
  }

  /* 방을 엽니다. 코드를 가진 기기는 스스로 허용 목록에 들어갈 수 있습니다(autoJoin). */
  function openRoom() {
    return state.roomRef.get().then(function (snap) {
      return { exists: !!snap.exists };
    }, function (err) {
      var code = (err && err.code) || '';
      if (code !== 'permission-denied') throw err;
      var uid = myUid();
      if (!uid) throw new Error('not-signed-in');
      return state.roomRef.update({
        allowedUids: window.firebase.firestore.FieldValue.arrayUnion(uid)
      }).then(function () { return { exists: true, joined: true }; }, function () { return { exists: true, denied: true }; });
    });
  }

  function createRoom() {
    var uid = myUid();
    return state.roomRef.set({
      schema: 8,
      kind: 'ledger',
      name: '금전출납부',
      createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      allowedUids: uid ? [uid] : [],
      adminUids: uid ? [uid] : [],
      autoJoin: true
    }).then(function () { return { created: true }; });
  }

  /* 연결(한 번만). 이미 연결돼 있으면 같은 약속을 돌려줍니다. */
  function start(handlers) {
    if (handlers) state.handlers = handlers;
    if (state.connecting) return state.connecting;

    emit('onStatus', { kind: 'pending', text: '출납부 방에 연결하는 중…' });
    state.connecting = Promise.resolve().then(function () {
      ensureApp();
      var code = storedCode();
      if (!code) { code = generateCode(); rememberCode(code); state.freshCode = true; }
      state.code = code;
      state.roomId = roomIdFor(code);
      state.roomRef = state.db.collection('rooms').doc(state.roomId);
      return signIn();
    }).then(function () {
      listenEntries();
      listenRoom();
      return openRoom();
    }).then(function (res) {
      if (!res.exists) return createRoom().then(function (r) { return { exists: false, created: r.created }; });
      if (res.denied) {
        emit('onStatus', { kind: 'error', text: '출납부 방에 들어갈 수 없어요 · 코드를 확인해 주세요' });
        return { exists: true, denied: true };
      }
      emit('onStatus', { kind: 'online', text: '출납부 공유 중' });
      return { exists: true };
    }).catch(function (err) {
      state.connecting = null;
      emit('onStatus', { kind: 'error', text: '출납부 연결 실패 · ' + (err && (err.code || err.message) || 'error') });
      throw err;
    });
    return state.connecting;
  }

  function stop() {
    if (state.unsub) { try { state.unsub(); } catch (e) { /* 무시 */ } }
    if (state.unsubRoom) { try { state.unsubRoom(); } catch (e) { /* 무시 */ } }
    state.unsub = null;
    state.unsubRoom = null;
    state.connected = false;
    state.connecting = null;
  }

  function addEntry(d) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var payload = entryPayload(d);
    if (!payload.amount || !payload.date) return Promise.reject(new Error('bad-entry'));
    return entriesRef().add(payload).then(function (ref) { return ref.id; });
  }

  function updateEntry(id, d) {
    if (!state.roomRef || !id) return Promise.reject(new Error('not-connected'));
    var payload = entryPayload(d);
    if (!payload.amount || !payload.date) return Promise.reject(new Error('bad-entry'));
    return entriesRef().doc(id).set(payload, { merge: true });
  }

  function deleteEntry(id) {
    if (!state.roomRef || !id) return Promise.reject(new Error('not-connected'));
    return entriesRef().doc(id).delete();
  }

  function savePin(pin) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    return state.roomRef.set({ pinHash: pinHash(pin) }, { merge: true }).then(function () { return true; });
  }

  function storedPinHash() {
    return state.room ? String(state.room.pinHash || '') : '';
  }

  function verifyPin(pin) {
    var stored = storedPinHash();
    if (!stored) return false;
    return stored === pinHash(pin);
  }

  /* 방 문서가 아직 안 왔을 때를 대비해 한 번 더 읽어 봅니다. */
  function fetchPinHash() {
    if (!state.roomRef) return Promise.resolve('');
    return state.roomRef.get().then(function (snap) {
      state.room = snap.exists ? (snap.data() || {}) : null;
      return storedPinHash();
    }).catch(function () { return storedPinHash(); });
  }

  window.LedgerCloud = {
    start: start,
    stop: stop,
    addEntry: addEntry,
    updateEntry: updateEntry,
    deleteEntry: deleteEntry,
    savePin: savePin,
    verifyPin: verifyPin,
    pinHash: pinHash,
    fetchPinHash: fetchPinHash,
    hasPin: function () { return !!storedPinHash(); },
    entries: function () { return state.entries.slice(); },
    isConnected: function () { return state.connected; },
    roomId: function () { return state.roomId; },
    currentCode: function () { return state.code; },
    storedCode: storedCode,
    rememberCode: rememberCode,
    forgetCode: forgetCode,
    generateCode: generateCode,
    freshCode: function () { return !!state.freshCode; },
    clearFresh: function () { state.freshCode = false; }
  };
})();
