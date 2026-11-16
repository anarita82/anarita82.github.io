/* 🏪 매장 달력 — Firebase(Cloud Firestore) 실시간 공유 계층
   - 가족 달력(cloud.js)과 방 ID 계산 소금(salt)이 달라서 같은 Firestore 안에서도
     데이터가 절대 섞이지 않습니다.
   - 매장 방 문서(rooms/{storeRoomId}) 필드: staff[], joinRequests{}, storePins{}, payrollSettings{}, storeName
   - 알바 근무 일정: rooms/{storeRoomId}/events/{eventId}
   - 배포된 보안 규칙(방 문서 get/create/update, events CRUD)을 그대로 쓰므로 규칙 변경이 필요 없습니다.
*/
(function () {
  'use strict';

  var CODE_KEY = 'family-calendar.store.room.v1';
  var ROOM_SALT = 'family-calendar-store-room:';
  var PIN_SALT = 'family-calendar-store-pin:';
  var CODE_PREFIX = 'store-';
  var CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

  var state = {
    auth: null,
    db: null,
    roomRef: null,
    roomId: '',
    code: '',
    unsub: null,
    unsubRoom: null,
    room: null,
    handlers: {}
  };

  function sha256(str) {
    if (window.FamilyCloud && typeof window.FamilyCloud.sha256Hex === 'function') {
      return window.FamilyCloud.sha256Hex(str);
    }
    return '';
  }

  function normalizeCode(raw) {
    var code = String(raw == null ? '' : raw).trim();
    if (code && code.normalize) code = code.normalize('NFC');
    return code.toLowerCase().replace(/\s+/g, '');
  }

  function roomIdForCode(code) {
    return sha256(ROOM_SALT + normalizeCode(code)).slice(0, 32);
  }

  function generateCode() {
    var out = '';
    for (var i = 0; i < 5; i++) {
      out += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
    }
    return CODE_PREFIX + out;
  }

  function storedCode() {
    try { return normalizeCode(localStorage.getItem(CODE_KEY) || ''); } catch (e) { return ''; }
  }
  function rememberCode(code) {
    try { localStorage.setItem(CODE_KEY, normalizeCode(code)); } catch (e) { /* 무시 */ }
  }
  function forgetCode() {
    try { localStorage.removeItem(CODE_KEY); } catch (e) { /* 무시 */ }
  }

  function emit(name, payload) {
    var fn = state.handlers[name];
    if (typeof fn === 'function') {
      try { fn(payload); } catch (e) { /* 화면 오류로 연결이 끊기지 않게 */ }
    }
  }

  function ensureApp() {
    if (!window.firebase) throw new Error('firebase-sdk-missing');
    if (!state.db) {
      var cfg = (window.FamilyCloud && window.FamilyCloud.CONFIG) || null;
      if (!cfg) throw new Error('firebase-config-missing');
      var app = (firebase.apps && firebase.apps.length) ? firebase.apps[0] : firebase.initializeApp(cfg);
      state.auth = firebase.auth();
      state.db = firebase.firestore();
      try { state.db.settings({ ignoreUndefinedProperties: true }); } catch (e) { /* 이미 설정됨 */ }
      try { state.db.enablePersistence({ synchronizeTabs: true }).catch(function () { /* 캐시 없이도 동작 */ }); } catch (e) { /* 무시 */ }
    }
    return state.db;
  }

  function signIn() {
    ensureApp();
    if (state.auth.currentUser) return Promise.resolve(state.auth.currentUser);
    return state.auth.signInAnonymously().then(function (cred) { return cred.user; });
  }

  /* ---------------- 연결 ---------------- */
  function start(code, handlers) {
    var clean = normalizeCode(code);
    if (!clean) return Promise.reject(new Error('empty-code'));
    state.handlers = handlers || {};
    state.code = clean;
    emit('onStatus', { kind: 'pending', text: '매장 방에 연결하는 중…' });

    try { ensureApp(); } catch (err) { return Promise.reject(err); }

    return signIn().then(function () {
      state.roomId = roomIdForCode(clean);
      state.roomRef = state.db.collection('rooms').doc(state.roomId);
      listenShifts();
      listenRoom();
      return roomLookup();
    }).then(function (exists) {
      rememberCode(clean);
      return { exists: exists };
    });
  }

  /* 방 문서가 있는지 확인. 네트워크가 느리면 null(모름)을 돌려 엉뚱한 생성을 막습니다. */
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

  function createRoom(code) {
    var clean = normalizeCode(code);
    if (!clean) return Promise.reject(new Error('empty-code'));
    try { ensureApp(); } catch (err) { return Promise.reject(err); }
    return signIn().then(function () {
      var ref = state.db.collection('rooms').doc(roomIdForCode(clean));
      return ref.get().then(function (snap) {
        if (snap.exists) return { created: false };
        return ref.set({
          schema: 3,
          kind: 'store',
          name: '우리 매장',
          storeName: '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          staff: [],
          joinRequests: {},
          storePins: {},
          payrollSettings: { taxMode: 'none', taxRate: 3.3, weeklyAllowance: false, payDay: 10, weeklyHours: 15 }
        }).then(function () { return { created: true }; });
      });
    });
  }

  function shiftCollection() {
    return state.roomRef.collection('events');
  }

  function shiftPayload(d) {
    var name = String(d.staffName || '').slice(0, 20);
    return {
      title: (name || '알바') + ' 근무',
      date: String(d.date || ''),
      staffId: String(d.staffId || ''),
      staffName: name,
      start: String(d.start || ''),
      end: String(d.end || ''),
      breakMin: Math.max(0, Math.min(600, Number(d.breakMin) || 0)),
      wage: Math.max(0, Math.round(Number(d.wage) || 0)),
      status: (d.status === 'done' || d.status === 'absent' || d.status === 'canceled') ? d.status : 'planned',
      memo: String(d.memo || '').slice(0, 200)
    };
  }

  function listenShifts() {
    if (state.unsub) { state.unsub(); state.unsub = null; }
    state.unsub = shiftCollection().onSnapshot({ includeMetadataChanges: true }, function (snap) {
      var list = [];
      snap.forEach(function (doc) {
        var d = doc.data() || {};
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) return;
        if (!d.staffId && !d.staffName) return;
        list.push({
          id: doc.id,
          date: d.date,
          staffId: String(d.staffId || ''),
          staffName: String(d.staffName || ''),
          start: String(d.start || ''),
          end: String(d.end || ''),
          breakMin: Number(d.breakMin) || 0,
          wage: Number(d.wage) || 0,
          status: (d.status === 'done' || d.status === 'absent' || d.status === 'canceled') ? d.status : 'planned',
          memo: String(d.memo || '')
        });
      });
      if (snap.metadata.fromCache) {
        emit('onStatus', { kind: 'offline', text: '오프라인 · 연결되면 자동으로 맞춰져요' });
      } else if (snap.metadata.hasPendingWrites) {
        emit('onStatus', { kind: 'pending', text: '저장하는 중…' });
      } else {
        emit('onStatus', { kind: 'online', text: '매장 실시간 공유 중 · 근무 ' + list.length + '건' });
      }
      emit('onShifts', list);
    }, function (err) {
      var code = (err && err.code) || '';
      if (code === 'permission-denied') {
        emit('onStatus', { kind: 'error', text: '매장 방에 들어갈 수 없어요 (매장 코드를 확인해 주세요)' });
      } else if (code === 'unavailable') {
        emit('onStatus', { kind: 'offline', text: '연결을 기다리는 중이에요' });
      } else {
        emit('onStatus', { kind: 'error', text: '공유 연결 오류' + (code ? ' (' + code + ')' : '') });
      }
    });
  }

  function listenRoom() {
    if (state.unsubRoom) { state.unsubRoom(); state.unsubRoom = null; }
    state.unsubRoom = state.roomRef.onSnapshot(function (snap) {
      var d = snap.exists ? (snap.data() || {}) : {};
      state.room = d;

      var staff = [];
      if (Array.isArray(d.staff)) {
        d.staff.forEach(function (m) {
          if (!m || typeof m.name !== 'string' || !m.name) return;
          if (!m.id) return;
          staff.push({
            id: String(m.id).slice(0, 40),
            name: m.name.slice(0, 20),
            color: /^#[0-9a-fA-F]{3,8}$/.test(m.color || '') ? m.color : '#0d9488',
            bg: /^#[0-9a-fA-F]{3,8}$/.test(m.bg || '') ? m.bg : '#e6fffb',
            hourly: Math.max(0, Math.round(Number(m.hourly) || 0)),
            joinedAt: m.joinedAt && m.joinedAt.toMillis ? m.joinedAt.toMillis() : 0,
            active: m.active === false ? false : true
          });
        });
      }

      var joins = [];
      var raw = d.joinRequests && typeof d.joinRequests === 'object' ? d.joinRequests : {};
      Object.keys(raw).forEach(function (key) {
        var r = raw[key];
        if (!r || typeof r !== 'object' || typeof r.name !== 'string') return;
        joins.push({
          id: key,
          name: String(r.name).slice(0, 20),
          deviceId: String(r.deviceId || ''),
          status: r.status === 'approved' || r.status === 'rejected' ? r.status : 'pending',
          hourly: Math.max(0, Math.round(Number(r.hourly) || 0)),
          staffId: String(r.staffId || ''),
          requestedAt: r.requestedAt && r.requestedAt.toMillis ? r.requestedAt.toMillis() : 0,
          decidedAt: r.decidedAt && r.decidedAt.toMillis ? r.decidedAt.toMillis() : 0
        });
      });
      joins.sort(function (a, b) { return (b.requestedAt || 0) - (a.requestedAt || 0); });

      var ps = d.payrollSettings && typeof d.payrollSettings === 'object' ? d.payrollSettings : {};
      var settings = {
        taxMode: (ps.taxMode === '3.3' || ps.taxMode === 'custom') ? ps.taxMode : 'none',
        taxRate: ps.taxRate === undefined || ps.taxRate === null ? 3.3 : Number(ps.taxRate) || 0,
        weeklyAllowance: ps.weeklyAllowance === true,
        payDay: Math.min(31, Math.max(1, Number(ps.payDay) || 10)),
        weeklyHours: Math.max(0, Number(ps.weeklyHours) || 15)
      };

      emit('onRoom', {
        exists: snap.exists,
        staff: staff,
        joinRequests: joins,
        pins: d.storePins && typeof d.storePins === 'object' ? d.storePins : {},
        payrollSettings: settings,
        storeName: String(d.storeName || '')
      });
    }, function (err) {
      emit('onRoomError', err);
    });
  }

  /* ---------------- 쓰기 ---------------- */
  function saveShift(id, data) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var payload = shiftPayload(data);
    if (id) {
      return shiftCollection().doc(id).set(payload, { merge: true }).then(function () { return id; });
    }
    var ref = shiftCollection().doc();
    payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    return ref.set(payload).then(function () { return ref.id; });
  }

  function deleteShift(id) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    return shiftCollection().doc(id).delete();
  }

  /* 방 문서 병합 저장 (staff[], joinRequests{...}, payrollSettings{...}, storeName 등) */
  function saveRoom(patch) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var payload = patch || {};
    payload.schema = 3;
    payload.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    return state.roomRef.set(payload, { merge: true });
  }

  /* PIN은 평문을 저장하지 않습니다. 방 ID·역할을 섞은 SHA-256 해시만 남깁니다. */
  function pinHash(pin) {
    return sha256(PIN_SALT + state.roomId + ':owner:' + String(pin));
  }

  function stop() {
    if (state.unsub) { state.unsub(); state.unsub = null; }
    if (state.unsubRoom) { state.unsubRoom(); state.unsubRoom = null; }
    state.roomRef = null;
    state.roomId = '';
    state.code = '';
    state.room = null;
  }

  window.StoreCloud = {
    CODE_KEY: CODE_KEY,
    normalizeCode: normalizeCode,
    roomIdForCode: roomIdForCode,
    generateCode: generateCode,
    storedCode: storedCode,
    rememberCode: rememberCode,
    forgetCode: forgetCode,
    start: start,
    stop: stop,
    createRoom: createRoom,
    saveShift: saveShift,
    deleteShift: deleteShift,
    saveRoom: saveRoom,
    pinHash: pinHash,
    currentRoomId: function () { return state.roomId; },
    currentCode: function () { return state.code; }
  };
})();
