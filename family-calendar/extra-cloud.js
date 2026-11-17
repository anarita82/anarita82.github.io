/* ➕ 추가 캘린더 — 사용자가 직접 만든 캘린더의 Firebase(Cloud Firestore) 공유 계층
   - 가족(family-calendar-room:)·매장(family-calendar-store-room:)·출납부(family-calendar-ledger-room:)와
     방 ID 계산 소금(salt)이 달라서, 같은 Firestore 안에서도 데이터가 절대 섞이지 않습니다.
   - 방 문서 rooms/{roomId}: kind:'custom', calType:'general'|'store', name, icon, pinHash, staff[]
   - 일정·근무: rooms/{roomId}/events/{docId}
       일반형  { kind:'event', title, date, time, memo, by }
       근무형  { kind:'shift', title, date, staffId, staffName, start, end, breakMin, wage, status, actualStart, actualEnd, memo }
   - 배포된 보안 규칙(방 문서 get/create/update, events CRUD)을 그대로 쓰므로 규칙 변경이 필요 없습니다.
*/
(function () {
  'use strict';

  var ROOM_SALT = 'family-calendar-custom-room:';
  var PIN_SALT = 'family-calendar-custom-pin:';
  var CODE_PREFIX = 'cal-';
  var CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

  var state = {
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
    return code.toLowerCase().replace(/[\s]+/g, '');
  }

  function roomIdForCode(code) {
    return sha256(ROOM_SALT + normalizeCode(code)).slice(0, 32);
  }

  function generateCode() {
    var out = '';
    var buf = null;
    var idx = 0;
    if (window.crypto && window.crypto.getRandomValues) {
      buf = new Uint8Array(32);
      window.crypto.getRandomValues(buf);
    }
    while (out.length < 12) {
      if (buf && idx >= buf.length) { window.crypto.getRandomValues(buf); idx = 0; }
      var n = buf ? buf[idx++] : Math.floor(Math.random() * 31);
      if (buf && n >= 248) continue;
      out += CODE_ALPHABET.charAt(n % 31);
    }
    return CODE_PREFIX + out;
  }

  function db() {
    if (!window.firebase) throw new Error('firebase-sdk-missing');
    if (!firebase.apps || !firebase.apps.length) throw new Error('firebase-sdk-missing');
    return firebase.firestore();
  }

  function signedIn() {
    if (window.FamilyCloud && typeof window.FamilyCloud.ensureSignedIn === 'function') {
      return window.FamilyCloud.ensureSignedIn();
    }
    return Promise.reject(new Error('auth-missing'));
  }

  function emit(name, payload) {
    var fn = state.handlers[name];
    if (typeof fn !== 'function') return;
    try { fn(payload); } catch (e) { /* 화면 오류로 연결이 끊기지 않게 */ }
  }

  /* ---------------- 직원(근무형) ---------------- */
  var STAFF_COLORS = [
    { c: '#0d9488', bg: '#e6fffb' }, { c: '#2563eb', bg: '#e8f1fe' },
    { c: '#db2777', bg: '#fdeaf3' }, { c: '#d97706', bg: '#fef3e2' },
    { c: '#7c3aed', bg: '#f0e9fe' }, { c: '#059669', bg: '#e6f7f0' },
    { c: '#dc2626', bg: '#feeaea' }, { c: '#0891b2', bg: '#e2f6fa' }
  ];

  function cleanStaff(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.slice(0, 30).forEach(function (s) {
      if (!s || typeof s !== 'object') return;
      var name = String(s.name == null ? '' : s.name).trim().slice(0, 12);
      if (!name) return;
      var color = String(s.color || '').slice(0, 9) || STAFF_COLORS[out.length % STAFF_COLORS.length].c;
      out.push({
        id: String(s.id || '').slice(0, 32) || ('st' + out.length + Date.now().toString(36).slice(-3)),
        name: name,
        color: color,
        bg: String(s.bg || '').slice(0, 9),
        hourly: Math.max(0, Math.round(Number(s.hourly) || 0))
      });
    });
    return out;
  }

  function parseRoom(d) {
    var staff = cleanStaff(d.staff);
    return {
      exists: true,
      name: String(d.name || '').slice(0, 16),
      icon: String(d.icon || '📅').slice(0, 8),
      calType: d.calType === 'store' ? 'store' : 'general',
      pinHash: String(d.pinHash || ''),
      staff: staff,
      createdAt: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0
    };
  }

  /* ---------------- 방 조회·생성 ---------------- */
  function fetchRoom(code) {
    var clean = normalizeCode(code);
    if (!clean) return Promise.reject(new Error('empty-code'));
    try { db(); } catch (err) { return Promise.reject(err); }
    return signedIn().then(function () {
      return db().collection('rooms').doc(roomIdForCode(clean)).get();
    }).then(function (snap) {
      if (!snap || !snap.exists) return { exists: false };
      var info = parseRoom(snap.data() || {});
      info.code = clean;
      return info;
    }, function (err) {
      /* 아직 구성원이 아닌 기기 — 코드는 맞지만 방 문서는 읽을 수 없습니다. */
      if (((err && err.code) || '') === 'permission-denied') return { exists: true, joined: false, code: clean };
      throw err;
    });
  }

  function pinHashFor(roomId, pin) {
    return sha256(PIN_SALT + roomId + ':' + String(pin));
  }

  function create(code, data) {
    var clean = normalizeCode(code);
    if (!clean) return Promise.reject(new Error('empty-code'));
    var name = String((data && data.name) || '').trim().slice(0, 16);
    if (!name) return Promise.reject(new Error('empty-name'));
    try { db(); } catch (err) { return Promise.reject(err); }
    var roomId = roomIdForCode(clean);
    return signedIn().then(function () {
      return db().collection('rooms').doc(roomId).get();
    }).then(function (snap) {
      if (snap && snap.exists) return Promise.reject(new Error('code-taken'));
      var uid = myUid();
      var rec = {
        schema: 9,
        kind: 'custom',
        calType: (data && data.type === 'store') ? 'store' : 'general',
        name: name,
        icon: String((data && data.icon) || '📅').slice(0, 8),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        allowedUids: uid ? [uid] : [],
        adminUids: uid ? [uid] : [],
        autoJoin: true,
        staff: []
      };
      if (data && data.pin) rec.pinHash = pinHashFor(roomId, data.pin);
      return db().collection('rooms').doc(roomId).set(rec).then(function () { return { code: clean, roomId: roomId }; });
    });
  }

  function checkPin(code, pin) {
    return fetchRoom(code).then(function (info) {
      if (!info.exists) return false;
      if (!info.pinHash) return true;      // PIN을 정하지 않은 캘린더
      return PIN_SALT && pinHashFor(roomIdForCode(code), pin) === info.pinHash;
    });
  }

  function myUid() {
    if (window.FamilyCloud && typeof window.FamilyCloud.currentUid === 'function') return window.FamilyCloud.currentUid();
    try { return (firebase.auth().currentUser && firebase.auth().currentUser.uid) || ''; } catch (e) { return ''; }
  }

  /* 방 열기 — 코드를 가진 기기는 스스로 허용 목록에 들어갑니다(autoJoin),
     이전 버전 방(승인 목록 없음)은 이 기기를 방장으로 올립니다. */
  function openRoom() {
    return state.roomRef.get().then(function (snap) {
      return { exists: !!snap.exists };
    }, function (err) {
      var code = (err && err.code) || '';
      if (code !== 'permission-denied') throw err;
      var uid = myUid();
      if (!uid) return { exists: true, denied: true };
      return state.roomRef.update({
        allowedUids: firebase.firestore.FieldValue.arrayUnion(uid)
      }).then(function () {
        return { exists: true, joined: true };
      }, function () {
        return state.roomRef.update({
          allowedUids: [uid],
          adminUids: [uid],
          schema: 9
        }).then(function () { return { exists: true, joined: true }; }, function () {
          return { exists: true, denied: true };
        });
      });
    });
  }

  /* ---------------- 연결 ---------------- */
  function start(code, handlers) {
    var clean = normalizeCode(code);
    if (!clean) return Promise.reject(new Error('empty-code'));
    state.handlers = handlers || {};
    state.code = clean;
    emit('onStatus', { kind: 'pending', text: '캘린더를 연결하는 중…' });

    try { db(); } catch (err) { return Promise.reject(err); }

    return signedIn().then(function () {
      state.roomId = roomIdForCode(clean);
      state.roomRef = db().collection('rooms').doc(state.roomId);
      return openRoom();
    }).then(function (res) {
      if (!res.exists) return { exists: false };
      listenEvents();
      listenRoom();
      return { exists: true, joined: !!res.joined, denied: !!res.denied };
    });
  }

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

  function eventCollection() {
    return state.roomRef.collection('events');
  }

  function listenRoom() {
    if (state.unsubRoom) { state.unsubRoom(); state.unsubRoom = null; }
    state.unsubRoom = state.roomRef.onSnapshot(function (snap) {
      var d = snap.exists ? (snap.data() || {}) : {};
      state.room = d;
      if (snap.exists) {
        emit('onRoom', parseRoom(d));
      } else {
        emit('onRoom', { exists: false });
      }
    }, function (err) {
      emit('onRoomError', err);
    });
  }

  var cleanHM = function (v) {
    var s = String(v == null ? '' : v);
    return /^\d{2}:\d{2}$/.test(s) ? s : null;
  };

  function listenEvents() {
    if (state.unsub) { state.unsub(); state.unsub = null; }
    state.unsub = eventCollection().onSnapshot({ includeMetadataChanges: true }, function (snap) {
      var list = [];
      snap.forEach(function (doc) {
        var d = doc.data() || {};
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) return;
        if (d.kind === 'shift') {
          if (!d.staffId && !d.staffName) return;
          list.push({
            id: doc.id,
            kind: 'shift',
            date: d.date,
            staffId: String(d.staffId || ''),
            staffName: String(d.staffName || '').slice(0, 12),
            start: String(d.start || ''),
            end: String(d.end || ''),
            breakMin: Math.max(0, Number(d.breakMin) || 0),
            wage: Math.max(0, Math.round(Number(d.wage) || 0)),
            status: (d.status === 'done' || d.status === 'absent' || d.status === 'canceled') ? d.status : 'planned',
            actualStart: cleanHM(d.actualStart),
            actualEnd: cleanHM(d.actualEnd),
            memo: String(d.memo || '').slice(0, 200),
            createdAt: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0
          });
          return;
        }
        if (typeof d.title !== 'string' || !d.title) return;
        list.push({
          id: doc.id,
          kind: 'event',
          title: d.title.slice(0, 80),
          date: d.date,
          time: cleanHM(d.time),
          memo: String(d.memo || '').slice(0, 300),
          by: String(d.by || '').slice(0, 12),
          createdAt: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0
        });
      });
      emit('onEvents', list);
      if (snap.metadata.fromCache) {
        emit('onStatus', { kind: 'offline', text: '오프라인 · 연결되면 자동으로 맞춰져요' });
      } else if (snap.metadata.hasPendingWrites) {
        emit('onStatus', { kind: 'pending', text: '저장하는 중…' });
      } else {
        emit('onStatus', { kind: 'online', text: '실시간 공유 중 · ' + list.length + '건' });
      }
    }, function (err) {
      var c = (err && err.code) || '';
      emit('onStatus', {
        kind: 'error',
        text: c === 'permission-denied' ? '이 캘린더에 들어갈 수 없어요' : '공유 연결 오류' + (c ? ' (' + c + ')' : '')
      });
    });
  }

  /* ---------------- 저장 ---------------- */
  function saveEvent(id, data) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    var d = data || {};
    var payload;
    if (d.kind === 'shift') {
      payload = {
        kind: 'shift',
        title: String(d.staffName || '알바') + ' 근무',
        date: String(d.date || ''),
        staffId: String(d.staffId || ''),
        staffName: String(d.staffName || '').slice(0, 12),
        start: cleanHM(d.start) || '',
        end: cleanHM(d.end) || '',
        breakMin: Math.max(0, Math.min(600, Number(d.breakMin) || 0)),
        wage: Math.max(0, Math.round(Number(d.wage) || 0)),
        status: (d.status === 'done' || d.status === 'absent' || d.status === 'canceled') ? d.status : 'planned',
        memo: String(d.memo || '').slice(0, 200)
      };
      if (d.actualStart !== undefined) payload.actualStart = cleanHM(d.actualStart);
      if (d.actualEnd !== undefined) payload.actualEnd = cleanHM(d.actualEnd);
    } else {
      payload = {
        kind: 'event',
        title: String(d.title || '').trim().slice(0, 80),
        date: String(d.date || ''),
        time: cleanHM(d.time),
        memo: String(d.memo || '').slice(0, 300),
        by: String(d.by || '').slice(0, 12)
      };
    }
    payload.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    if (id) {
      return eventCollection().doc(id).set(payload, { merge: true }).then(function () { return id; });
    }
    var ref = eventCollection().doc();
    payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    return ref.set(payload).then(function () { return ref.id; });
  }

  function deleteEvent(id) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    if (!id) return Promise.reject(new Error('no-event'));
    return eventCollection().doc(id).delete();
  }

  function saveRoom(patch) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    return state.roomRef.set(patch || {}, { merge: true });
  }

  function saveStaff(list) {
    return saveRoom({ staff: cleanStaff(list) });
  }

  function setPin(pin) {
    if (!state.roomRef) return Promise.reject(new Error('not-connected'));
    return state.roomRef.set({ pinHash: pinHashFor(state.roomId, pin) }, { merge: true });
  }

  function stop() {
    if (state.unsub) { state.unsub(); state.unsub = null; }
    if (state.unsubRoom) { state.unsubRoom(); state.unsubRoom = null; }
    state.roomRef = null;
    state.roomId = '';
    state.code = '';
    state.room = null;
  }

  window.ExtraCloud = {
    ROOM_SALT: ROOM_SALT,
    normalizeCode: normalizeCode,
    roomIdForCode: roomIdForCode,
    generateCode: generateCode,
    fetchRoom: fetchRoom,
    create: create,
    checkPin: checkPin,
    start: start,
    stop: stop,
    saveEvent: saveEvent,
    deleteEvent: deleteEvent,
    saveRoom: saveRoom,
    saveStaff: saveStaff,
    setPin: setPin,
    cleanStaff: cleanStaff,
    currentCode: function () { return state.code; },
    currentRoomId: function () { return state.roomId; }
  };
})();
