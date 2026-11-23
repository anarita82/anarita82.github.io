/* 📢 공지 — 저장 계층 (가족 달력 cloud.js · 매장 달력 store-cloud.js 공용)
   - 방 문서(rooms/{roomId})의 notices 배열에 담습니다.
     → firestore.rules 를 바꾸지 않고 기존 "구성원(canRead) 쓰기" 권한만으로 실시간 공유됩니다.
   - 가족 방과 매장 방은 서버 방 자체가 달라 공지도 서로 섞이지 않습니다.
   - 항목: { id, title, body, pinned, authorId, authorName, authorUid,
            createdAt(ms), updatedAt(ms|0), checks: [{ uid, name, at }] }
   - 배열 안에는 serverTimestamp 를 넣을 수 없어 숫자(ms)로 저장합니다.
*/
(function () {
  'use strict';

  var MAX_NOTICES = 40;   /* 방 문서 한 개에 담는 공지 수 — 1MB 한도 안에서 넉넉합니다 */
  var MAX_CHECKS = 100;   /* 공지 한 건에 남기는 확인 인원 */
  var MAX_TITLE = 60;
  var MAX_BODY = 1000;
  var MAX_NAME = 12;

  function str(v, max) { return String(v == null ? '' : v).slice(0, max); }
  function ms(v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.round(n) : 0; }

  function cleanChecks(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var uid = str(c.uid, 128);
      if (!uid) return;
      for (var i = 0; i < out.length; i++) if (out[i].uid === uid) return;
      out.push({ uid: uid, name: str(c.name, MAX_NAME), at: ms(c.at) });
    });
    return out.slice(0, MAX_CHECKS);
  }

  function clean(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = str(raw.id, 40);
    var title = str(raw.title, MAX_TITLE).trim();
    var body = str(raw.body, MAX_BODY).trim();
    if (!title && !body) return null;
    return {
      id: id,
      title: title,
      body: body,
      pinned: raw.pinned === true,
      authorId: str(raw.authorId, 40),
      authorName: str(raw.authorName, MAX_NAME),
      authorUid: str(raw.authorUid, 128),
      createdAt: ms(raw.createdAt),
      updatedAt: ms(raw.updatedAt),
      checks: cleanChecks(raw.checks)
    };
  }

  /* 저장된 순서와 무관하게 화면과 같은 순서(고정 먼저, 최신 먼저)로 맞춥니다. */
  function sortList(list) {
    list.sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
    return list;
  }

  function trim(list) {
    sortList(list);
    var out = [];
    var extra = 0;
    list.forEach(function (n) {
      if (n.pinned || extra < MAX_NOTICES) { out.push(n); if (!n.pinned) extra++; }
    });
    return out;
  }

  function parse(raw) {
    var out = [];
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (r) {
      var n = clean(r);
      if (!n || !n.id) return;
      for (var i = 0; i < out.length; i++) if (out[i].id === n.id) return;
      out.push(n);
    });
    return trim(out);
  }

  function indexOf(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return i;
    return -1;
  }

  function mergeChecks(base, add) {
    var out = cleanChecks(base);
    (add || []).forEach(function (c) {
      var found = -1;
      for (var i = 0; i < out.length; i++) if (out[i].uid === c.uid) { found = i; break; }
      if (found < 0) out.push(c);
    });
    return out.slice(0, MAX_CHECKS);
  }

  /* 만들기/수정 — 같은 id 가 있으면 그 공지를 고치고, 없으면 새로 넣습니다.
     읽고-고쳐-쓰기를 트랜잭션으로 묶어 두 사람이 동시에 써도 공지가 사라지지 않습니다. */
  function save(ref, db, input) {
    if (!ref || !db) return Promise.reject(new Error('not-connected'));
    var now = Date.now();
    var rec = clean(input);
    if (!rec) return Promise.reject(new Error('empty-notice'));
    var wanted = rec.id || ('nt' + now.toString(36) + Math.random().toString(36).slice(2, 6));
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        if (!snap.exists) throw new Error('room-missing');
        var list = parse((snap.data() || {}).notices);
        var idx = indexOf(list, wanted);
        if (idx >= 0) {
          var prev = list[idx];
          rec.id = prev.id;
          rec.authorId = prev.authorId;
          rec.authorName = prev.authorName;
          rec.authorUid = prev.authorUid;
          rec.createdAt = prev.createdAt;
          rec.checks = mergeChecks(prev.checks, rec.checks);
          rec.updatedAt = now;
          list[idx] = rec;
        } else {
          rec.id = wanted;
          rec.createdAt = now;
          rec.updatedAt = 0;
          list.push(rec);
        }
        tx.update(ref, { notices: trim(list) });
        return wanted;
      });
    });
  }

  function remove(ref, db, id) {
    if (!ref || !db) return Promise.reject(new Error('not-connected'));
    var key = str(id, 40);
    if (!key) return Promise.reject(new Error('notice-missing'));
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        if (!snap.exists) throw new Error('room-missing');
        var list = parse((snap.data() || {}).notices);
        var idx = indexOf(list, key);
        if (idx < 0) return false;
        list.splice(idx, 1);
        tx.update(ref, { notices: list });
        return true;
      });
    });
  }

  /* 확인했어요 / 확인 취소 — 기기(계정) 하나당 한 줄. 취소하면 목록에서 뺍니다. */
  function check(ref, db, id, on, me) {
    if (!ref || !db) return Promise.reject(new Error('not-connected'));
    var key = str((me && (me.uid || me.id)) || '', 128);
    var alt = str((me && me.id) || '', 128);
    if (!key) return Promise.reject(new Error('no-me'));
    var now = Date.now();
    return db.runTransaction(function (tx) {
      return tx.get(ref).then(function (snap) {
        if (!snap.exists) throw new Error('room-missing');
        var list = parse((snap.data() || {}).notices);
        var idx = indexOf(list, str(id, 40));
        if (idx < 0) throw new Error('notice-missing');
        var n = list[idx];
        /* 같은 사람이 오프라인에서 남긴 기록(구성원 id)과 계정(uid) 기록을 함께 지웁니다. */
        var checks = n.checks.filter(function (c) { return c.uid !== key && (!alt || c.uid !== alt); });
        if (on) checks.unshift({ uid: key, name: str(me && me.name, MAX_NAME), at: now });
        n.checks = checks.slice(0, MAX_CHECKS);
        list[idx] = n;
        tx.update(ref, { notices: trim(list) });
        return true;
      });
    });
  }

  window.NoticeCloud = {
    parse: parse,
    save: save,
    remove: remove,
    check: check,
    MAX_TITLE: MAX_TITLE,
    MAX_BODY: MAX_BODY,
    MAX_NOTICES: MAX_NOTICES
  };
})();
