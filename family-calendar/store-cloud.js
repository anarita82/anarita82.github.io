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
    unsubJoins: null,
    gatePoll: null,
    joins: [],
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

  /* 휴대폰 번호 정리(숫자/하이픈) — 가족 달력 cloud.js와 같은 규칙을 씁니다. */
  function normTel(v) {
    if (window.FamilyCloud && typeof window.FamilyCloud.normalizeTel === 'function') {
      return window.FamilyCloud.normalizeTel(v);
    }
    return String(v == null ? '' : v).trim().slice(0, 20);
  }

  function telDigits(v) {
    if (window.FamilyCloud && typeof window.FamilyCloud.telDigits === 'function') {
      return window.FamilyCloud.telDigits(v);
    }
    return String(v == null ? '' : v).replace(/[^0-9+]/g, '');
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
    if (window.FamilyCloud && typeof window.FamilyCloud.ensureSignedIn === 'function') {
      return window.FamilyCloud.ensureSignedIn();
    }
    if (state.auth.currentUser) return Promise.resolve(state.auth.currentUser);
    return state.auth.signInAnonymously().then(function (cred) { return cred.user; });
  }

  /* ---------------- 방 접근 게이트 ----------------
     규칙이 "승인된 기기(allowedUids)"만 방을 읽게 바꿔 두었습니다.
       1) 방 읽기 → 성공하면 구성원
       2) 거부 → 승인 목록이 없는 이전 방이면 이 기기를 사장님 기기로 등록
       3) 그래도 거부 → 내 입장 요청 상태(없음 / 대기 / 거절) */
  var ROOM_SCHEMA = 7;
  var GATE_POLL_MS = 8000;

  function joinRef(uid) {
    return state.roomRef.collection('joinRequests').doc(uid);
  }

  function probeRoom() {
    return state.roomRef.get().then(function (snap) {
      if (!snap.exists) return { state: 'missing' };
      return { state: 'member', data: snap.data() || {} };
    }, function (err) {
      var code = (err && err.code) || '';
      if (code !== 'permission-denied') throw err;
      /* 읽기가 막힌 기기 — 승인 기록은 있는데 방을 못 읽는다면 퇴사·내보내기로 차단된 것입니다.
         (denied 표시는 store.js 가 '차단' 화면을 띄우는 데 씁니다) */
      return claimFirstDevice().then(function (res) {
        res = res || {};
        res.denied = true;
        return res;
      });
    });
  }

  function claimFirstDevice() {
    var uid = myUid();
    if (!uid) return Promise.resolve({ state: 'need-request' });
    return state.roomRef.update({
      allowedUids: [uid],
      adminUids: [uid],
      schema: ROOM_SCHEMA
    }).then(function () {
      return state.roomRef.get().then(function (snap) {
        return { state: 'claimed', data: snap.exists ? (snap.data() || {}) : {} };
      }, function () { return { state: 'claimed', data: {} }; });
    }, function () {
      return readMyJoinRequest();
    });
  }

  function readMyJoinRequest() {
    var uid = myUid();
    if (!uid) return Promise.resolve({ state: 'need-request' });
    return joinRef(uid).get().then(function (snap) {
      if (!snap.exists) return { state: 'need-request' };
      var d = snap.data() || {};
      if (d.status === 'approved') return { state: 'approved', data: d };
      if (d.status === 'rejected') return { state: 'rejected', data: d };
      return { state: 'pending', data: d };
    }, function () { return { state: 'need-request' }; });
  }

  function watchGate() {
    if (state.gatePoll) return;
    state.gatePoll = setInterval(function () {
      if (!state.roomRef) { clearInterval(state.gatePoll); state.gatePoll = null; return; }
      probeRoom().then(function (res) {
        if (!state.roomRef) return;
        if (res.state === 'member' || res.state === 'claimed') {
          clearInterval(state.gatePoll);
          state.gatePoll = null;
          begin();
          emit('onGate', { state: 'member', data: res.data || {} });
          return;
        }
        if (res.state === 'rejected') emit('onGate', res);
      }, function () { /* 다음 차례에 다시 */ });
    }, GATE_POLL_MS);
  }

  function begin() {
    listenShifts();
    listenRoom();
    listenJoins();
  }

  /* ---------------- 연결 ---------------- */
  function start(code, handlers) {
    var clean = normalizeCode(code);
    if (!clean) return Promise.reject(new Error('empty-code'));
    state.handlers = handlers || {};
    state.code = clean;
    state.roomId = roomIdForCode(clean);
    emit('onStatus', { kind: 'pending', text: '매장 방에 연결하는 중…' });

    try { ensureApp(); } catch (err) { return Promise.reject(err); }

    return signIn().then(function () {
      state.roomRef = state.db.collection('rooms').doc(state.roomId);
      return probeRoom();
    }).then(function (res) {
      rememberCode(clean);
      if (res.state === 'missing') return { exists: false, gate: 'missing' };
      if (res.state === 'approved' && res.denied) {
        /* 입장은 승인됐지만 방을 못 읽는 기기 = 퇴사(내보내기)로 차단된 기기 */
        return { exists: true, denied: true, gate: 'denied' };
      }
      if (res.state === 'member' || res.state === 'claimed' || res.state === 'approved') {
        begin();
        return { exists: true, claimed: res.state === 'claimed' };
      }
      watchGate();
      emit('onGate', res);
      return { exists: true, gate: res.state };
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
        var uid = myUid();
        return ref.set({
          schema: ROOM_SCHEMA,
          kind: 'store',
          name: '우리 매장',
          storeName: '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          allowedUids: uid ? [uid] : [],
          adminUids: uid ? [uid] : [],
          staff: [],
          joinRequests: {},
          storePins: {},
          /* 주휴수당 자동 포함이 기본값입니다(사장님이 ⚙️ 설정에서 끄면 기본급만 계산). */
          payrollSettings: { taxMode: 'none', taxRate: 3.3, weeklyAllowance: true, payDay: 10, weeklyHours: 15 }
        }).then(function () { return { created: true }; });
      });
    });
  }

  function shiftCollection() {
    return state.roomRef.collection('events');
  }

  /* 근무 구분(오전알바·오후알바·야간알바·주말알바) — 달력 칸에 '오전알바(성함)'으로 표시합니다.
     비워 두면 근무자 관리의 기본 구분 → 시간·요일 자동 순서로 정해집니다. */
  var PERIOD_CODES = ['morning', 'afternoon', 'night', 'weekend', 'custom'];

  function shiftPayload(d) {
    var name = String(d.staffName || '').slice(0, 20);
    var period = PERIOD_CODES.indexOf(String(d.period || '')) >= 0 ? String(d.period) : '';
    var periodLabel = period === 'custom' ? String(d.periodLabel || '').slice(0, 8) : '';
    return {
      title: (name || '알바') + ' 근무',
      date: String(d.date || ''),
      staffId: String(d.staffId || ''),
      staffName: name,
      start: String(d.start || ''),
      end: String(d.end || ''),
      breakMin: Math.max(0, Math.min(600, Number(d.breakMin) || 0)),
      wage: Math.max(0, Math.round(Number(d.wage) || 0)),
      period: period,
      periodLabel: periodLabel,
      status: (d.status === 'done' || d.status === 'absent' || d.status === 'canceled') ? d.status : 'planned',
      actualStart: cleanHM(d.actualStart),
      actualEnd: cleanHM(d.actualEnd),
      memo: String(d.memo || '').slice(0, 200)
    };
  }

  /* 출퇴근 실제 시각 "HH:MM" */
  function cleanHM(value) {
    var v = String(value == null ? '' : value);
    return /^\d{2}:\d{2}$/.test(v) ? v : null;
  }

  function listenShifts() {
    if (state.unsub) { state.unsub(); state.unsub = null; }
    state.unsub = shiftCollection().onSnapshot({ includeMetadataChanges: true }, function (snap) {
      var list = [];
      var handovers = [];
      snap.forEach(function (doc) {
        var d = doc.data() || {};
        /* 📝 교대 인수인계 메모 — 같은 events 컬렉션에 kind='handover'로 둡니다 */
        if (d.kind === 'handover') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) return;
          if (typeof d.text !== 'string' || !d.text) return;
          handovers.push({
            id: doc.id,
            date: d.date,
            text: String(d.text).slice(0, 80),
            done: d.done === true,
            author: String(d.author || '').slice(0, 20),
            authorId: String(d.authorId || '').slice(0, 40),
            createdAt: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0
          });
          return;
        }
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
          period: PERIOD_CODES.indexOf(String(d.period || '')) >= 0 ? String(d.period) : '',
          periodLabel: String(d.periodLabel || '').slice(0, 8),
          wage: Number(d.wage) || 0,
          status: (d.status === 'done' || d.status === 'absent' || d.status === 'canceled') ? d.status : 'planned',
          actualStart: cleanHM(d.actualStart),
          actualEnd: cleanHM(d.actualEnd),
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
      emit('onHandovers', handovers);
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
            /* 기본 근무 구분(오전·오후·야간·주말) — 상단 근무자 칩과 달력에 '오전알바(민지)'로 쓰입니다. */
            period: ['morning', 'afternoon', 'night', 'weekend', 'custom'].indexOf(String(m.period || '')) >= 0 ? String(m.period) : '',
            /* 급여 공제 방식 — 없으면(예전 근무자) 화면에서 방 설정을 따릅니다. */
            taxType: ['none', '3.3', '4ins'].indexOf(String(m.taxType || '')) >= 0 ? String(m.taxType) : '',
            tel: normTel(m.tel),
            uid: String(m.uid || '').slice(0, 128),
            deviceId: String(m.deviceId || '').slice(0, 60),
            retired: m.retired === true,
            retiredAt: m.retiredAt && m.retiredAt.toMillis ? m.retiredAt.toMillis() : 0,
            joinedAt: m.joinedAt && m.joinedAt.toMillis ? m.joinedAt.toMillis() : 0,
            active: m.active === false ? false : true,
            photoDataUrl: typeof m.photoDataUrl === 'string' && m.photoDataUrl.indexOf('data:image/') === 0 ? m.photoDataUrl.slice(0, 90000) : ''
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
          tel: normTel(r.tel),
          deviceId: String(r.deviceId || ''),
          uid: String(r.uid || '').slice(0, 128),
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
        taxMode: (ps.taxMode === '3.3' || ps.taxMode === 'custom' || ps.taxMode === '4ins') ? ps.taxMode : 'none',
        taxRate: ps.taxRate === undefined || ps.taxRate === null ? 3.3 : Number(ps.taxRate) || 0,
        /* 값이 없는 예전 방은 켜진 것으로 봅니다 — 기본 ON. */
        weeklyAllowance: ps.weeklyAllowance !== false,
        payDay: Math.min(31, Math.max(1, Number(ps.payDay) || 10)),
        weeklyHours: Math.max(0, Number(ps.weeklyHours) || 15)
      };

      emit('onRoom', {
        exists: snap.exists,
        moved: d.moved === true,
        staff: staff,
        joinRequests: joins,
        profileRequests: parseProfileRequests(d.profileRequests),
        shiftRequests: parseShiftRequests(d.shiftRequests),
        pins: d.storePins && typeof d.storePins === 'object' ? d.storePins : {},
        payrollSettings: settings,
        storeName: String(d.storeName || ''),
        revokedUids: Array.isArray(d.revokedUids) ? d.revokedUids.filter(function (x) { return typeof x === 'string' && x; }).slice(0, 200) : [],
        revokedDevices: Array.isArray(d.revokedDevices) ? d.revokedDevices.filter(function (x) { return typeof x === 'string' && x; }).slice(0, 200) : [],
        /* 📢 매장 공지 — 방 문서의 notices 배열 */
        notices: (window.NoticeCloud && typeof NoticeCloud.parse === 'function') ? NoticeCloud.parse(d.notices) : []
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

  /* 여러 근무를 묶음(batch)으로 한 번에 저장 — 평일·주말 일괄 등록용.
     450건씩 나눠 커밋하고, 묶음 쓰기가 안 되는 환경에서는 한 건씩 저장합니다. */
  function saveShifts(list) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var items = (list || []).filter(Boolean);
    if (!items.length) return Promise.resolve([]);
    var col = shiftCollection();
    var db = state.db;
    if (!db || typeof db.batch !== 'function') {
      return Promise.all(items.map(function (d) { return saveShift(null, d); }));
    }
    var ids = [];
    var chain = Promise.resolve();
    for (var i = 0; i < items.length; i += 450) {
      (function (chunk) {
        chain = chain.then(function () {
          var batch = db.batch();
          chunk.forEach(function (d) {
            var ref = col.doc();
            var payload = shiftPayload(d);
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            batch.set(ref, payload);
            ids.push(ref.id);
          });
          return batch.commit();
        });
      })(items.slice(i, i + 450));
    }
    return chain.then(function () { return ids; });
  }

  function deleteShift(id) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    return shiftCollection().doc(id).delete();
  }

  /* 여러 근무를 묶음(batch)으로 한 번에 삭제 — 근무 일괄 삭제용.
     450건씩 나눠 커밋하고, 묶음 삭제가 안 되는 환경에서는 한 건씩 지웁니다. */
  function deleteShifts(ids) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var list = (ids || []).filter(Boolean);
    if (!list.length) return Promise.resolve(0);
    var col = shiftCollection();
    var db = state.db;
    if (!db || typeof db.batch !== 'function') {
      return Promise.all(list.map(function (id) { return col.doc(id).delete(); }))
        .then(function () { return list.length; });
    }
    var chain = Promise.resolve();
    for (var i = 0; i < list.length; i += 450) {
      (function (chunk) {
        chain = chain.then(function () {
          var batch = db.batch();
          chunk.forEach(function (id) { batch.delete(col.doc(id)); });
          return batch.commit();
        });
      })(list.slice(i, i + 450));
    }
    return chain.then(function () { return list.length; });
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

  /* 방 문서 필드만 원자적으로 고칩니다(update).
     `joinRequests.<id>.status` 처럼 점을 쓴 경로를 넣을 수 있어 다른 대기 요청을 덮어쓰지 않습니다. */
  function updateRoom(fields) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    return state.roomRef.update(fields || {});
  }

  /* ---------------- 📢 매장 공지 ----------------
     가족과 같은 방식 — 방 문서(rooms/{roomId})의 notices 배열에 담아
     firestore.rules 를 바꾸지 않고 기존 구성원 쓰기 권한 그대로 씁니다. */
  function saveNotice(input) {
    if (!window.NoticeCloud) return Promise.reject(new Error('notice-module-missing'));
    return NoticeCloud.save(state.roomRef, state.db, input);
  }
  function deleteNotice(id) {
    if (!window.NoticeCloud) return Promise.reject(new Error('notice-module-missing'));
    return NoticeCloud.remove(state.roomRef, state.db, id);
  }
  function checkNotice(id, on, me) {
    if (!window.NoticeCloud) return Promise.reject(new Error('notice-module-missing'));
    var who = {
      uid: myUid() || String((me && me.uid) || ''),
      id: String((me && me.id) || ''),
      name: String((me && me.name) || '')
    };
    return NoticeCloud.check(state.roomRef, state.db, id, on, who);
  }

  /* 입장 요청 한 건 — 아직 구성원이 아닌 기기는 자기 요청만 만들고 볼 수 있습니다.
     (방 문서 자체는 승인된 기기만 읽을 수 있어 joinRequests 맵이 아니라 하위 컬렉션을 씁니다) */
  function submitJoinRequest(data) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var uid = myUid();
    if (!uid) return Promise.reject(new Error('not-signed-in'));
    var rec = {
      uid: uid,
      name: String((data && data.name) || '').trim().slice(0, 20),
      tel: normTel(data && data.tel),
      device: String((data && data.deviceId) || '').slice(0, 60),
      status: 'pending',
      requestedAt: new Date()
    };
    if (!rec.name) return Promise.reject(new Error('empty-name'));
    return joinRef(uid).set(rec).then(function () {
      watchGate();
      return uid;
    });
  }

  /* 입장 요청 목록 — 사장님(구성원)만 볼 수 있습니다. */
  function listenJoins() {
    if (state.unsubJoins) { state.unsubJoins(); state.unsubJoins = null; }
    state.unsubJoins = state.roomRef.collection('joinRequests').onSnapshot(function (snap) {
      var list = [];
      snap.forEach(function (doc) {
        var d = doc.data() || {};
        if (typeof d.name !== 'string') return;
        list.push({
          id: doc.id,
          uid: String(d.uid || doc.id),
          name: String(d.name).slice(0, 20),
          tel: normTel(d.tel),
          deviceId: String(d.device || ''),
          status: d.status === 'approved' || d.status === 'rejected' ? d.status : 'pending',
          staffId: String(d.staffId || ''),
          requestedAt: d.requestedAt && d.requestedAt.toMillis ? d.requestedAt.toMillis() : 0,
          decidedAt: d.decidedAt && d.decidedAt.toMillis ? d.decidedAt.toMillis() : 0
        });
      });
      list.sort(function (a, b) { return (b.requestedAt || 0) - (a.requestedAt || 0); });
      state.joins = list;
      emit('onJoins', list);
    }, function () { /* 구성원이 아니면 목록을 볼 수 없습니다 */ });
  }

  /* 입장 요청 승인·보류 — 상태를 바꾸고, 승인이면 그 기기를 허용 목록에 넣습니다. */
  function decideJoinRequest(uid, fields) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var id = String(uid || '');
    if (!id) return Promise.reject(new Error('no-request'));
    var payload = {};
    Object.keys(fields || {}).forEach(function (key) { payload[key] = fields[key]; });
    if (!payload.status) payload.status = 'approved';
    payload.decidedBy = myUid();
    return joinRef(id).set(payload, { merge: true }).then(function () {
      if (payload.status !== 'approved') return true;
      return state.db.runTransaction(function (tx) {
        return tx.get(state.roomRef).then(function (snap) {
          if (!snap.exists) throw new Error('room-missing');
          tx.update(state.roomRef, {
            allowedUids: firebase.firestore.FieldValue.arrayUnion(id),
            revokedUids: firebase.firestore.FieldValue.arrayRemove(id)
          });
        });
      });
    });
  }

  /* ---------------- 신상정보(이름·휴대폰 번호) 변경 요청 ----------------
     알바생 본인이 이름·번호를 고치면 바로 staff[] 를 바꾸지 않고 profileRequests 에 남깁니다.
     사장님이 [승인]해야 staff[] 에 반영됩니다. 점 경로 업데이트로 다른 요청을 지우지 않습니다. */
  function parseProfileRequests(raw) {
    var list = [];
    if (!raw || typeof raw !== 'object') return list;
    Object.keys(raw).forEach(function (key) {
      var r = raw[key];
      if (!r || typeof r !== 'object') return;
      var targetId = String(r.targetId || '');
      if (!targetId) return;
      var name = typeof r.name === 'string' ? r.name.slice(0, 12) : '';
      var tel = normTel(r.tel == null ? '' : r.tel);
      if (!name && !tel) return;
      list.push({
        id: key,
        targetId: targetId,
        status: r.status === 'approved' || r.status === 'rejected' ? r.status : 'pending',
        requesterId: String(r.requesterId || ''),
        requesterName: String(r.requesterName || '').slice(0, 12),
        prevName: String(r.prevName || '').slice(0, 12),
        prevTel: normTel(r.prevTel == null ? '' : r.prevTel),
        name: name,
        tel: tel,
        createdAt: r.createdAt && r.createdAt.toMillis ? r.createdAt.toMillis() : 0,
        decidedByName: String(r.decidedByName || '').slice(0, 12),
        decidedAt: r.decidedAt && r.decidedAt.toMillis ? r.decidedAt.toMillis() : 0
      });
    });
    list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    return list;
  }

  function submitProfileRequest(data) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var staffId = String((data && data.staffId) || '');
    var name = String((data && data.name) || '').trim().slice(0, 12);
    var tel = normTel(data && data.tel);
    if (!staffId) return Promise.reject(new Error('no-member'));
    if (!name) return Promise.reject(new Error('empty-name'));
    var prev = null;
    var list = state.room && Array.isArray(state.room.staff) ? state.room.staff : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id || '') === staffId) { prev = list[i]; break; }
    }
    prev = prev || {};
    var mine = parseProfileRequests(state.room && state.room.profileRequests).filter(function (r) {
      return r.targetId === staffId && r.status === 'pending';
    })[0];
    var id = mine ? mine.id : ('pq' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    var patch = {};
    var base = 'profileRequests.' + id + '.';
    patch[base + 'targetId'] = staffId;
    patch[base + 'requesterId'] = staffId;
    patch[base + 'requesterName'] = String(prev.name || (data && data.staffName) || '').slice(0, 12);
    patch[base + 'prevName'] = String(prev.name || '').slice(0, 12);
    patch[base + 'prevTel'] = normTel(prev.tel == null ? '' : prev.tel);
    patch[base + 'name'] = name;
    patch[base + 'tel'] = tel;
    patch[base + 'status'] = 'pending';
    patch[base + 'createdAt'] = firebase.firestore.FieldValue.serverTimestamp();
    patch[base + 'decidedByName'] = firebase.firestore.FieldValue.delete();
    patch[base + 'decidedAt'] = firebase.firestore.FieldValue.delete();
    return updateRoom(patch).then(function () { return id; });
  }

  /* 승인하면 staff[] 의 그 알바생 이름·번호를 바뀝니다. 입사일 등 나머지 값은 그대로 둡니다. */
  function decideProfileRequest(req, approve, ownerName) {
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
        updates[base + 'decidedByName'] = String(ownerName || '').slice(0, 12);
        updates[base + 'decidedAt'] = firebase.firestore.FieldValue.serverTimestamp();
        if (approve) {
          var targetId = String(cur.targetId || req.targetId || '');
          var list = Array.isArray(d.staff) ? d.staff.slice() : [];
          var idx = -1, i;
          for (i = 0; i < list.length; i++) {
            if (list[i] && String(list[i].id || '') === targetId) { idx = i; break; }
          }
          if (idx < 0) throw new Error('member-missing');
          var next = {};
          var src = list[idx] || {};
          Object.keys(src).forEach(function (k) { next[k] = src[k]; });
          var name = String(cur.name == null ? '' : cur.name).trim().slice(0, 12);
          if (name) next.name = name;
          var tel = normTel(cur.tel == null ? '' : cur.tel);
          if (tel) next.tel = tel; else delete next.tel;
          for (i = 0; i < list.length; i++) {
            if (i === idx) continue;
            if (list[i] && String(list[i].name || '') === next.name) throw new Error('name-taken');
          }
          list[idx] = next;
          updates.staff = list;
        }
        tx.update(state.roomRef, updates);
      });
    });
  }

  /* ---------------- 🙋 근무 변경·대타 요청 --------------
     알바생이 올린 요청은 방 문서의 shiftRequests 맵에 둡니다(점 경로 업데이트라 다른 요청 보존).
     사장님이 [승인]하면 같은 배치로 근무(events) 도큐먼트를 바꿉니다. */
  function parseShiftRequests(raw) {
    var list = [];
    if (!raw || typeof raw !== 'object') return list;
    Object.keys(raw).forEach(function (key) {
      var r = raw[key];
      if (!r || typeof r !== 'object') return;
      if (!r.shiftId) return;
      list.push({
        id: key,
        shiftId: String(r.shiftId || ''),
        kind: r.kind === 'leave' ? 'leave' : 'shift',
        date: String(r.date || ''),
        staffId: String(r.staffId || ''),
        staffName: String(r.staffName || '').slice(0, 20),
        reqStart: cleanHM(r.reqStart) || '',
        reqEnd: cleanHM(r.reqEnd) || '',
        wantStaffId: String(r.wantStaffId || ''),
        wantStaffName: String(r.wantStaffName || '').slice(0, 20),
        reason: String(r.reason || '').slice(0, 120),
        status: r.status === 'approved' || r.status === 'rejected' ? r.status : 'pending',
        createdAt: r.createdAt && r.createdAt.toMillis ? r.createdAt.toMillis() : 0,
        decidedByName: String(r.decidedByName || '').slice(0, 12),
        decidedAt: r.decidedAt && r.decidedAt.toMillis ? r.decidedAt.toMillis() : 0
      });
    });
    list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    return list;
  }

  function submitShiftRequest(data) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    if (!data || !data.shiftId) return Promise.reject(new Error('no-shift'));
    var id = 'sr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    var patch = {};
    patch['shiftRequests.' + id] = {
      shiftId: String(data.shiftId || '').slice(0, 60),
      /* leave = 휴무 요청(승인 시 근무 삭제), shift = 교대·대타 요청(승인 시 근무자·시간 변경) */
      kind: data.kind === 'leave' ? 'leave' : 'shift',
      date: String(data.date || ''),
      staffId: String(data.staffId || '').slice(0, 40),
      staffName: String(data.staffName || '').slice(0, 20),
      reqStart: cleanHM(data.reqStart) || '',
      reqEnd: cleanHM(data.reqEnd) || '',
      wantStaffId: String(data.wantStaffId || '').slice(0, 40),
      wantStaffName: String(data.wantStaffName || '').slice(0, 20),
      reason: String(data.reason || '').slice(0, 120),
      status: 'pending',
      createdAt: new Date()
    };
    return updateRoom(patch).then(function () { return id; });
  }

  /* 사장님 승인·거절 — 승인 시 근무(events) 도큐먼트를 같은 배치로 바꿉니다. */
  function decideShiftRequest(req, approve, opts) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    if (!req || !req.id) return Promise.reject(new Error('no-request'));
    var base = 'shiftRequests.' + req.id + '.';
    var patch = {};
    patch[base + 'status'] = approve ? 'approved' : 'rejected';
    patch[base + 'decidedByName'] = String((opts && opts.ownerName) || '사장님').slice(0, 12);
    patch[base + 'decidedAt'] = new Date();
    var batch = state.db.batch();
    batch.update(state.roomRef, patch);
    if (approve) {
      if (!req.shiftId) return Promise.reject(new Error('no-shift'));
      if (opts && opts.deleteShift) {
        /* 휴무 요청 승인 — 그 근무를 달력에서 뺍니다(급여 계산에서도 즉시 빠짐). */
        batch.delete(shiftCollection().doc(req.shiftId));
      } else {
        var shiftPatch = (opts && opts.shiftPatch) || {};
        shiftPatch.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
        batch.set(shiftCollection().doc(req.shiftId), shiftPatch, { merge: true });
      }
    }
    return batch.commit();
  }

  /* ---------------- 📝 교대 인수인계 메모 ---------------- */
  function saveHandover(data) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var text = String((data && data.text) || '').trim().slice(0, 80);
    var date = String((data && data.date) || '');
    if (!text) return Promise.reject(new Error('empty-text'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Promise.reject(new Error('bad-date'));
    var ref = shiftCollection().doc();
    return ref.set({
      kind: 'handover',
      date: date,
      text: text,
      done: false,
      author: String((data && data.author) || '').slice(0, 20),
      authorId: String((data && data.authorId) || '').slice(0, 40),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () { return ref.id; });
  }

  function updateHandover(id, patch) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    if (!id) return Promise.reject(new Error('no-handover'));
    var fields = {};
    if (patch && typeof patch.done === 'boolean') fields.done = patch.done;
    if (patch && typeof patch.text === 'string' && patch.text.trim()) fields.text = patch.text.trim().slice(0, 80);
    return shiftCollection().doc(id).set(fields, { merge: true });
  }

  function deleteHandover(id) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    return shiftCollection().doc(id).delete();
  }

  /* 출퇴근 실제 시각 — 그 근무 도큐먼트의 두 칸만 고칩니다. */
  function updateShift(id, patch) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    if (!id) return Promise.reject(new Error('no-shift'));
    var fields = {};
    if (patch && 'actualStart' in patch) fields.actualStart = cleanHM(patch.actualStart);
    if (patch && 'actualEnd' in patch) fields.actualEnd = cleanHM(patch.actualEnd);
    fields.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    return shiftCollection().doc(id).set(fields, { merge: true });
  }

  /* ---------------- 🚪 퇴사(강제 탈퇴) · 복직 · 완전 삭제 ----------------
     퇴사는 staff[] 항목을 지우지 않고 retired:true 로 남겨 과거 근무·급여명세서를
     그대로 보존합니다. 동시에 그 직원의 계정(uid)과 기기(deviceId)를 차단 목록에
     올려 매장 일정·인수인계·급여 화면을 열 수 없게 합니다. */
  function myUid() {
    try { return (state.auth && state.auth.currentUser && state.auth.currentUser.uid) || ''; } catch (e) { return ''; }
  }

  function retireStaff(staffId, opts) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var id = String(staffId || '');
    if (!id) return Promise.reject(new Error('member-missing'));
    return state.db.runTransaction(function (tx) {
      return tx.get(state.roomRef).then(function (snap) {
        if (!snap.exists) throw new Error('room-missing');
        var d = snap.data() || {};
        var list = Array.isArray(d.staff) ? d.staff.slice() : [];
        var idx = -1, i;
        for (i = 0; i < list.length; i++) {
          if (list[i] && String(list[i].id || '') === id) { idx = i; break; }
        }
        if (idx < 0) throw new Error('member-missing');
        var cur = list[idx] || {};
        var next = {};
        Object.keys(cur).forEach(function (k) { next[k] = cur[k]; });
        next.retired = true;
        next.retiredAt = new Date();
        list[idx] = next;
        var uid = String(cur.uid || (opts && opts.uid) || '');
        var dev = String(cur.deviceId || (opts && opts.deviceId) || '');
        var patch = { staff: list };
        if (uid) patch.revokedUids = firebase.firestore.FieldValue.arrayUnion(uid);
        if (uid) patch.allowedUids = firebase.firestore.FieldValue.arrayRemove(uid);
        if (uid) patch.adminUids = firebase.firestore.FieldValue.arrayRemove(uid);
        if (dev) patch.revokedDevices = firebase.firestore.FieldValue.arrayUnion(dev);
        tx.update(state.roomRef, patch);
        return { uid: uid, deviceId: dev };
      });
    });
  }

  /* 다시 일하게 되면 복직 — 퇴사 표시를 지우고 차단도 풉니다. */
  function restoreStaff(staffId) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var id = String(staffId || '');
    if (!id) return Promise.reject(new Error('member-missing'));
    return state.db.runTransaction(function (tx) {
      return tx.get(state.roomRef).then(function (snap) {
        if (!snap.exists) throw new Error('room-missing');
        var d = snap.data() || {};
        var list = Array.isArray(d.staff) ? d.staff.slice() : [];
        var idx = -1, i;
        for (i = 0; i < list.length; i++) {
          if (list[i] && String(list[i].id || '') === id) { idx = i; break; }
        }
        if (idx < 0) throw new Error('member-missing');
        var cur = list[idx] || {};
        var next = {};
        Object.keys(cur).forEach(function (k) { next[k] = cur[k]; });
        next.retired = false;
        delete next.retiredAt;
        list[idx] = next;
        var uid = String(cur.uid || '');
        var dev = String(cur.deviceId || '');
        var patch = { staff: list };
        if (uid) patch.revokedUids = firebase.firestore.FieldValue.arrayRemove(uid);
        if (uid) patch.allowedUids = firebase.firestore.FieldValue.arrayUnion(uid);
        if (dev) patch.revokedDevices = firebase.firestore.FieldValue.arrayRemove(dev);
        tx.update(state.roomRef, patch);
        return true;
      });
    });
  }

  /* 목록에서 완전 삭제 — 근무(events) 기록은 남고 이름 매핑만 사라집니다.
     차단 목록은 그대로 두어 다시 들어오지 못하게 합니다. */
  function purgeStaff(staffId) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var id = String(staffId || '');
    if (!id) return Promise.reject(new Error('member-missing'));
    return state.db.runTransaction(function (tx) {
      return tx.get(state.roomRef).then(function (snap) {
        if (!snap.exists) throw new Error('room-missing');
        var d = snap.data() || {};
        var list = Array.isArray(d.staff) ? d.staff.slice() : [];
        var next = list.filter(function (m) { return !(m && String(m.id || '') === id); });
        if (next.length === list.length) throw new Error('member-missing');
        tx.update(state.roomRef, { staff: next });
        return true;
      });
    });
  }

  function stop() {
    if (state.unsubJoins) { try { state.unsubJoins(); } catch (e) { /* 무시 */ } }
    if (state.gatePoll) { clearInterval(state.gatePoll); state.gatePoll = null; }
    state.unsubJoins = null;
    state.joins = [];
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
    normalizeTel: normTel,
    telDigits: telDigits,
    roomIdForCode: roomIdForCode,
    generateCode: generateCode,
    storedCode: storedCode,
    rememberCode: rememberCode,
    forgetCode: forgetCode,
    start: start,
    stop: stop,
    createRoom: createRoom,
    saveShift: saveShift,
    saveShifts: saveShifts,
    deleteShift: deleteShift,
    deleteShifts: deleteShifts,
    saveRoom: saveRoom,
    updateRoom: updateRoom,
    saveNotice: saveNotice,
    deleteNotice: deleteNotice,
    checkNotice: checkNotice,
    submitJoinRequest: submitJoinRequest,
    decideJoinRequest: decideJoinRequest,
    myJoinRequest: readMyJoinRequest,
    submitShiftRequest: submitShiftRequest,
    decideShiftRequest: decideShiftRequest,
    parseShiftRequests: parseShiftRequests,
    saveHandover: saveHandover,
    updateHandover: updateHandover,
    deleteHandover: deleteHandover,
    updateShift: updateShift,
    submitProfileRequest: submitProfileRequest,
    approveProfileRequest: function (req, ownerName) { return decideProfileRequest(req, true, ownerName); },
    rejectProfileRequest: function (req, ownerName) { return decideProfileRequest(req, false, ownerName); },
    parseProfileRequests: parseProfileRequests,
    retireStaff: retireStaff,
    restoreStaff: restoreStaff,
    purgeStaff: purgeStaff,
    currentUid: myUid,
    pinHash: pinHash,
    isAdmin: function () {
      var uid = myUid();
      var list = state.room && Array.isArray(state.room.adminUids) ? state.room.adminUids : [];
      return !!uid && list.indexOf(uid) >= 0;
    },
    currentRoomId: function () { return state.roomId; },
    currentCode: function () { return state.code; }
  };
})();
