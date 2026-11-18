/* ➕ 추가 캘린더 — 사용자가 직접 만든 캘린더의 화면·동작
   - 상단 탭 [＋ 추가] → 새 캘린더 만들기 / 초대 코드로 참여
   - 일반형(모임·일정) 과 근무형(알바·인건비·출퇴근) 두 가지
   - 가족(app.js)·매장(store.js)·출납부(ledger.js)와 저장 방이 달라 데이터가 섞이지 않습니다.
   - 이 기기에서 추가·참여한 캘린더 목록은 localStorage 에, 일정·근무는 Firestore 방에 저장합니다.
*/
(function () {
  'use strict';

  var LIST_KEY = 'family-calendar.custom.list.v1';
  var LAST_KEY = 'family-calendar.custom.last.v1';
  var ME_KEY = 'family-calendar.custom.me.v1';
  var MODE_KEY = 'family-calendar.mode.v1';
  var ICONS = ['📅', '💼', '🏪', '⚽', '🎓', '✈️', '🏠', '🎯', '🎵', '🍽️', '🚗', '🐶'];
  var STATUS_LABEL = { planned: '예정', done: '근무완료', absent: '결근', canceled: '취소' };
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  var S = {
    active: false,
    code: '',
    connectedCode: '',
    connected: false,
    connecting: false,
    exists: true,
    name: '',
    icon: '📅',
    type: 'general',
    pinHash: '',
    staff: [],
    events: [],
    year: 0,
    month: 0,
    selected: '',
    editingId: null,
    editingShift: null,
    shiftStaffId: '',
    shiftStatus: 'planned',
    newIcon: '📅',
    newType: 'general',
    setIcon: '📅',
    found: null,
    foundCode: '',
    lastStatus: { kind: 'pending', text: '' }
  };

  var el = {};
  var toastTimer = null;
  var pasteUI = null;

  function $(id) { return document.getElementById(id); }
  function val(id) { var n = $(id); return n ? String(n.value == null ? '' : n.value) : ''; }
  function num(id) { return Math.max(0, Math.round(Number(String(val(id)).replace(/[^0-9]/g, '')) || 0)); }

  /* ---------------- 저장소 ---------------- */
  function ls(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function lsSet(key, v) {
    try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key); } catch (e) { /* 무시 */ }
  }

  function cleanEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var code = String(raw.code || '').trim();
    if (!code) return null;
    return {
      code: code,
      name: String(raw.name || '').slice(0, 16) || '내 캘린더',
      icon: String(raw.icon || '📅').slice(0, 8),
      type: raw.type === 'store' ? 'store' : 'general',
      owner: raw.owner === true
    };
  }

  function readList() {
    var raw;
    try { raw = JSON.parse(ls(LIST_KEY) || '[]'); } catch (e) { return []; }
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.forEach(function (r) {
      var e = cleanEntry(r);
      if (e && !out.some(function (x) { return x.code === e.code; })) out.push(e);
    });
    return out;
  }

  function writeList(list) {
    try { localStorage.setItem(LIST_KEY, JSON.stringify(list || [])); } catch (e) { /* 무시 */ }
  }

  function entryOf(code) {
    var c = String(code || '');
    var list = readList();
    for (var i = 0; i < list.length; i++) if (list[i].code === c) return list[i];
    return null;
  }

  /* 목록에 넣거나 고칩니다. owner(이 기기에서 만든 캘린더) 표시는 덮어쓰지 않습니다. */
  function upsertEntry(patch) {
    if (!patch || !patch.code) return readList();
    var list = readList();
    var idx = -1, i;
    for (i = 0; i < list.length; i++) if (list[i].code === patch.code) { idx = i; break; }
    if (idx >= 0) {
      var cur = list[idx];
      list[idx] = {
        code: cur.code,
        name: patch.name || cur.name,
        icon: patch.icon || cur.icon,
        type: patch.type || cur.type,
        owner: patch.owner === true ? true : cur.owner
      };
    } else {
      list.push(cleanEntry(patch));
    }
    writeList(list);
    return list;
  }

  function dropEntry(code) {
    writeList(readList().filter(function (e) { return e.code !== code; }));
    var map = readMe();
    delete map[code];
    writeMe(map);
    if (ls(LAST_KEY) === code) lsSet(LAST_KEY, '');
  }

  function readMe() {
    try {
      var m = JSON.parse(ls(ME_KEY) || '{}');
      return (m && typeof m === 'object') ? m : {};
    } catch (e) { return {}; }
  }
  function writeMe(map) {
    try { localStorage.setItem(ME_KEY, JSON.stringify(map || {})); } catch (e) { /* 무시 */ }
  }
  function meOf(code) {
    var map = readMe();
    var v = map[String(code || '')];
    return (v && typeof v === 'object') ? v : {};
  }
  function setMe(code, patch) {
    var map = readMe();
    var cur = (map[code] && typeof map[code] === 'object') ? map[code] : {};
    var next = {};
    Object.keys(cur).forEach(function (k) { next[k] = cur[k]; });
    Object.keys(patch || {}).forEach(function (k) {
      if (patch[k] === undefined) return;
      next[k] = patch[k];
    });
    map[code] = next;
    writeMe(map);
    return next;
  }
  function myName() { return String(meOf(S.code).name || ''); }
  function isManager() { return meOf(S.code).mgr === true; }
  function myStaffId() { return String(meOf(S.code).staffId || ''); }

  /* ---------------- 날짜·시간 도우미 ---------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function isoOfDate(d) { return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function parseISO(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
    var p = String(s).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function todayISO() { return isoOfDate(new Date()); }
  function addDaysISO(base, n) {
    var d = parseISO(base);
    if (!d) return base;
    d.setDate(d.getDate() + n);
    return isoOfDate(d);
  }
  function dayDiff(a, b) {
    var d1 = parseISO(a), d2 = parseISO(b);
    if (!d1 || !d2) return 0;
    return Math.round((d2 - d1) / 86400000);
  }
  function fmtMD(dateISO) {
    var d = parseISO(dateISO);
    if (!d) return dateISO;
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }
  function nowHM() {
    var d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function hmToMin(hm) {
    if (!/^\d{2}:\d{2}$/.test(String(hm || ''))) return null;
    var p = String(hm).split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  }
  function shiftMinutes(s) {
    var a = hmToMin(s && s.start), b = hmToMin(s && s.end);
    if (a === null || b === null) return 0;
    if (b <= a) b += 24 * 60;
    var m = b - a - (Number(s.breakMin) || 0);
    return m > 0 ? m : 0;
  }
  function hoursText(min) {
    var m = Math.max(0, Math.round(Number(min) || 0));
    var h = Math.floor(m / 60);
    var r = m % 60;
    if (!h) return r + '분';
    return h + '시간' + (r ? ' ' + r + '분' : '');
  }
  function money(n) { return Math.round(Number(n) || 0).toLocaleString('ko-KR') + '원'; }
  function shiftWage(s) { return Math.round(shiftMinutes(s) / 60 * (Number(s.wage) || 0)); }

  /* ---------------- 안내·토스트 ---------------- */
  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2400);
  }

  function setNote(text, kind) {
    S.lastStatus = { kind: kind || 'pending', text: text || '' };
    if (!S.active) return;
    if (el.note) el.note.textContent = text || '';
    var bar = $('appBarNote');
    if (bar) bar.textContent = text || '';
    var pill = $('statusPill');
    if (pill) {
      var label = (kind === 'online') ? '공유 중' : (kind === 'offline') ? '오프라인' : (kind === 'error') ? '확인 필요' : '연결 중';
      pill.textContent = label;
      pill.className = 'app-bar__status app-bar__status--' + (kind === 'online' ? 'online' : (kind === 'offline' ? 'offline' : (kind === 'error' ? 'error' : 'pending')));
    }
  }

  function err(id, msg) {
    var n = $(id);
    if (!n) return;
    n.textContent = msg || '';
    n.hidden = !msg;
  }
  function hideErr(id) { err(id, ''); }

  function hintOf(e) {
    if (!e) return '알 수 없는 오류가 났어요';
    if (e.code === 'permission-denied') return '이 캘린더에 쓸 권한이 없어요. 초대 코드를 확인해 주세요.';
    if (e.code === 'unavailable') return '인터넷 연결을 확인해 주세요.';
    if (e.message === 'firebase-sdk-missing') return '공유 모듈을 불러오지 못했어요.';
    if (e.message === 'empty-code') return '초대 코드를 넣어 주세요.';
    if (e.message === 'empty-name') return '캘린더 이름을 넣어 주세요.';
    if (e.message === 'code-taken') return '같은 코드의 캘린더가 이미 있어요. 다시 시도해 주세요.';
    if (e.code) return e.code;
    return e.message || '알 수 없는 오류가 났어요';
  }

  /* ---------------- 탭 ---------------- */
  function isLockedDevice() {
    try {
      return !!(window.StoreMode && typeof StoreMode.shouldSkipFamily === 'function' && StoreMode.shouldSkipFamily());
    } catch (e) { return false; }
  }

  function renderTabs() {
    var wrap = $('calTabs');
    if (!wrap) return;
    wrap.innerHTML = '';
    readList().forEach(function (e) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mode-tab mode-tab--custom';
      b.setAttribute('data-code', e.code);
      b.textContent = e.icon + ' ' + e.name;
      b.title = e.name;
      if (S.active && S.code === e.code) b.classList.add('is-active');
      b.addEventListener('click', function () {
        /* 이미 이 캘린더 화면이면 그대로. 단, 그 위에 매장·출납부가 떠 있으면 다시 들어갑니다. */
        if (S.active && S.code === e.code && !otherModeActive()) return;
        enter(e.code);
      });
      wrap.appendChild(b);
    });
    var add = $('tabAddCal');
    if (add) add.hidden = isLockedDevice();
  }

  function paintTabs() {
    var wrap = $('calTabs');
    if (!wrap) return;
    Array.prototype.forEach.call(wrap.children, function (b) {
      b.classList.toggle('is-active', !!(S.active && b.getAttribute('data-code') === S.code));
    });
    if (S.active) {
      ['tabFamily', 'tabStore', 'tabLedger'].forEach(function (id) {
        var t = $(id);
        if (t) t.classList.remove('is-active');
      });
    }
  }

  /* ---------------- 화면 전환 ---------------- */
  function closeOtherModals() {
    ['profileModal', 'adminModal', 'roomModal', 'entryModal', 'detailModal', 'approveModal', 'daySheetModal',
      'familyBlockedModal', 'storeSettingsModal', 'storePinModal', 'shiftModal', 'shiftReqModal',
      'storeApproveModal', 'payrollModal', 'storeDaySheetModal',
      'lgEntryModal', 'lgDayModal', 'lgPasteModal', 'lgSettingsModal', 'lgGrantModal'].forEach(function (id) {
      var m = $(id);
      if (m) m.hidden = true;
    });
  }

  function otherModeActive() {
    try {
      if (window.StoreMode && typeof StoreMode.isStoreActive === 'function' && StoreMode.isStoreActive()) return true;
    } catch (e) { /* 무시 */ }
    try {
      if (window.LedgerMode && typeof LedgerMode.isActive === 'function' && LedgerMode.isActive()) return true;
    } catch (e) { /* 무시 */ }
    return false;
  }

  function deactivateOthers() {
    try {
      if (window.StoreMode && typeof StoreMode.isStoreActive === 'function' && StoreMode.isStoreActive() && typeof StoreMode.close === 'function') {
        StoreMode.close();
      }
    } catch (e) { /* 무시 */ }
    try {
      if (window.LedgerMode && typeof LedgerMode.isActive === 'function' && LedgerMode.isActive() && typeof LedgerMode.leave === 'function') {
        LedgerMode.leave();
      }
    } catch (e) { /* 무시 */ }
    closeOtherModals();
  }

  function activateView() {
    S.active = true;
    document.body.classList.add('custom-mode');
    document.body.classList.remove('store-mode', 'ledger-mode');
    ['familyView', 'familySubRow', 'storeView', 'storeSubRow', 'ledgerView', 'addBtn', 'storeAddBtn'].forEach(function (id) {
      var n = $(id);
      if (n) n.hidden = true;
    });
    if (el.view) el.view.hidden = false;
    if (el.addBtn) el.addBtn.hidden = false;
    if ($('appTitle')) $('appTitle').textContent = S.icon + ' ' + S.name;
    paintTabs();
  }

  function leave() {
    if (!S.active) return;
    S.active = false;
    document.body.classList.remove('custom-mode');
    if (el.view) el.view.hidden = true;
    if (el.addBtn) el.addBtn.hidden = true;
    closeModals();
    paintTabs();
    /* 가족·매장 화면으로 돌아갈 때 상단 상태 문구를 그 화면 것으로 되돌립니다. */
    if (window.FamilyCalendar && typeof window.FamilyCalendar.paintStatus === 'function') {
      try { window.FamilyCalendar.paintStatus(); } catch (e) { /* 무시 */ }
    }
  }

  function closeModals() {
    ['calAddModal', 'calSettingsModal', 'calEventModal', 'calShiftModal'].forEach(function (id) {
      var m = $(id);
      if (m) m.hidden = true;
    });
  }

  /* ---------------- 연결 ---------------- */
  function enter(code) {
    if (!window.ExtraCloud) { toast('공유 모듈을 불러오지 못했어요'); return; }
    var clean = ExtraCloud.normalizeCode(code);
    var entry = entryOf(clean);
    if (!entry) { openJoin(clean); return; }
    if (isLockedDevice()) { toast('이 기기에서는 추가 캘린더를 열 수 없어요'); return; }

    deactivateOthers();
    S.code = clean;
    S.name = entry.name;
    S.icon = entry.icon;
    S.type = entry.type;
    S.selected = todayISO();
    S.year = new Date().getFullYear();
    S.month = new Date().getMonth();
    S.staff = [];
    S.events = [];
    activateView();
    renderHeader();
    renderBody();
    lsSet(LAST_KEY, clean);
    lsSet(MODE_KEY, 'family');   // 매장 모드 자동 복귀 방지
    connect(clean);
  }

  function connect(code) {
    S.connecting = true;
    S.connectedCode = code;
    ExtraCloud.start(code, {
      onRoom: function (info) { applyRoom(info); },
      onRoomError: function (e) { setNote(hintOf(e), 'error'); },
      onEvents: function (list) {
        S.events = Array.isArray(list) ? list : [];
        S.connected = true;
        S.connecting = false;
        if (S.active && S.code === code) renderBody();
      },
      onStatus: function (st) { setNote(st.text, st.kind); }
    }).then(function (res) {
      if (res && res.exists === false) {
        setNote('이 캘린더 방을 찾을 수 없어요. 초대 코드를 확인해 주세요.', 'error');
      } else if (res && res.denied) {
        setNote('이 캘린더에 들어갈 수 없어요 · 초대 코드를 확인해 주세요', 'error');
      }
    }).catch(function (e) {
      S.connecting = false;
      S.connected = false;
      setNote(hintOf(e), 'error');
    });
  }

  function applyRoom(info) {
    if (!info || !info.exists) {
      S.exists = false;
      setNote('캘린더 방을 찾을 수 없어요. 초대 코드를 확인해 주세요.', 'error');
      return;
    }
    S.exists = true;
    S.name = info.name || S.name;
    S.icon = info.icon || S.icon;
    S.type = info.calType === 'store' ? 'store' : 'general';
    S.staff = Array.isArray(info.staff) ? info.staff : [];
    S.pinHash = info.pinHash || '';
    upsertEntry({ code: S.code, name: S.name, icon: S.icon, type: S.type });
    renderTabs();
    if (S.active) {
      renderHeader();
      renderBody();
      if ($('appTitle')) $('appTitle').textContent = S.icon + ' ' + S.name;
    }
  }

  function renderHeader() {
    if (el.icon) el.icon.textContent = S.icon;
    if (el.name) el.name.textContent = S.name;
    if (el.meta) {
      var role = isManager() ? '관리자' : '구성원';
      el.meta.textContent = (S.type === 'store' ? '🏪 매장·근무형' : '📅 모임·일반형') + ' · ' + role;
    }
    if (el.note) el.note.textContent = S.lastStatus.text || '연결 중…';
    if (el.addBtn) el.addBtn.textContent = S.type === 'store' ? '＋ 근무 등록' : '＋ 일정 추가';
  }

  /* ---------------- 공통 조회 ---------------- */
  function eventsOf(dateISO) {
    return S.events.filter(function (e) { return e.kind !== 'shift' && e.date === dateISO; });
  }
  function shiftsOf(dateISO) {
    return S.events.filter(function (e) { return e.kind === 'shift' && e.date === dateISO; });
  }
  function staffOf(id) {
    for (var i = 0; i < S.staff.length; i++) if (S.staff[i].id === id) return S.staff[i];
    return null;
  }
  function byStart(a, b) {
    var x = hmToMin(a.start), y = hmToMin(b.start);
    if (x === null) x = 99999;
    if (y === null) y = 99999;
    if (x !== y) return x - y;
    return String(a.staffName).localeCompare(String(b.staffName));
  }
  function byTime(a, b) {
    var x = hmToMin(a.time), y = hmToMin(b.time);
    if (x === null) x = -1;
    if (y === null) y = -1;
    if (x !== y) return x - y;
    return String(a.title).localeCompare(String(b.title));
  }
  function dateEventsForRange(fromISO, toISO) {
    return S.events.filter(function (e) {
      return e.kind !== 'shift' && e.date >= fromISO && e.date <= toISO;
    }).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return byTime(a, b);
    });
  }

  /* ---------------- 본문 ---------------- */
  function renderBody() {
    if (!S.active) return;
    var g = $('calvGeneral'), st = $('calvStore');
    if (S.type === 'store') {
      if (g) g.hidden = true;
      if (st) st.hidden = false;
      renderStore();
    } else {
      if (g) g.hidden = false;
      if (st) st.hidden = true;
      renderGeneral();
    }
  }

  function chipRow(color, text, time) {
    var row = document.createElement('span');
    row.className = 'day__ev store';
    var bar = document.createElement('i');
    bar.style.background = color || '#94a3b8';
    row.appendChild(bar);
    var tx = document.createElement('span');
    tx.className = 'day__ev-t';
    tx.textContent = text;
    row.appendChild(tx);
    if (time) {
      var tm = document.createElement('span');
      tm.className = 'day__ev-h';
      tm.textContent = time;
      row.appendChild(tm);
    }
    return row;
  }

  function buildMonthGrid(gridId, titleId, subId, kind) {
    var grid = $(gridId);
    if (!grid) return;
    var y = S.year, m = S.month;
    if ($(titleId)) $(titleId).textContent = y + '년 ' + (m + 1) + '월';
    if ($(subId)) {
      if (kind === 'store') {
        var ms = S.events.filter(function (e) {
          if (e.kind !== 'shift' || e.status === 'canceled' || e.status === 'absent') return false;
          var d = parseISO(e.date);
          return d && d.getFullYear() === y && d.getMonth() === m;
        });
        var mins = 0, pay = 0;
        ms.forEach(function (s) { mins += shiftMinutes(s); pay += shiftWage(s); });
        $(subId).textContent = '근무 ' + ms.length + '건 · ' + hoursText(mins) + ' · ' + money(pay);
      } else {
        var me = S.events.filter(function (e) {
          if (e.kind === 'shift') return false;
          var d = parseISO(e.date);
          return d && d.getFullYear() === y && d.getMonth() === m;
        });
        $(subId).textContent = me.length ? '일정 ' + me.length + '건' : '';
      }
    }

    var first = new Date(y, m, 1);
    var total = new Date(y, m + 1, 0).getDate();
    var weeks = Math.ceil((first.getDay() + total) / 7);
    var start = new Date(y, m, 1 - first.getDay());
    var today = todayISO();

    grid.innerHTML = '';
    for (var i = 0; i < weeks * 7; i++) {
      var dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var dateISO = isoOfDate(dt);
      var inMonth = dt.getMonth() === m;
      var wd = dt.getDay();
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'day'
        + (inMonth ? '' : ' day--out')
        + (wd === 0 ? ' day--sun' : '')
        + (wd === 6 ? ' day--sat' : '')
        + (dateISO === today ? ' day--today' : '')
        + (dateISO === S.selected ? ' day--selected' : '');
      cell.setAttribute('data-date', dateISO);

      var numEl = document.createElement('span');
      numEl.className = 'day__num';
      numEl.textContent = String(dt.getDate());
      cell.appendChild(numEl);

      var chips = [];
      if (kind === 'store') {
        shiftsOf(dateISO).filter(function (s) { return s.status !== 'canceled'; }).sort(byStart).forEach(function (s) {
          var st = staffOf(s.staffId);
          chips.push({ color: st ? st.color : '#94a3b8', text: s.staffName, time: s.start || '' });
        });
      } else {
        eventsOf(dateISO).sort(byTime).forEach(function (e) {
          chips.push({ color: '#4f46e5', text: e.title, time: '' });
        });
      }
      if (chips.length) {
        var box = document.createElement('span');
        box.className = 'day__evs';
        chips.slice(0, 2).forEach(function (c) { box.appendChild(chipRow(c.color, c.text, c.time)); });
        if (chips.length > 2) {
          var more = document.createElement('span');
          more.className = 'day__more';
          more.textContent = '+' + (chips.length - 2);
          box.appendChild(more);
        }
        cell.appendChild(box);
      }

      (function (target, inM) {
        cell.addEventListener('click', function () {
          if (!inM) {
            var d2 = parseISO(target);
            if (d2) { S.year = d2.getFullYear(); S.month = d2.getMonth(); }
          }
          S.selected = target;
          renderBody();
        });
      })(dateISO, inMonth);

      grid.appendChild(cell);
    }
  }

  /* ---------------- 일반형 ---------------- */
  function renderGeneral() {
    buildMonthGrid('calvGrid', 'calvCalTitle', 'calvCalSub', 'general');
    renderDayCard();
    renderUpcoming();
  }

  function renderDayCard() {
    var box = $('calvDayCard');
    if (!box) return;
    var d = parseISO(S.selected) || new Date();
    var list = eventsOf(S.selected).sort(byTime);
    box.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'card-head';
    var h = document.createElement('h2');
    h.textContent = (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + WEEKDAYS[d.getDay()] + '요일';
    head.appendChild(h);
    var hint = document.createElement('span');
    hint.className = 'card-head__hint';
    hint.textContent = list.length ? '일정 ' + list.length + '건' : '일정 없음';
    head.appendChild(hint);
    box.appendChild(head);

    if (!list.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '이 날은 일정이 없어요. 아래 [＋ 일정 추가]로 넣어 보세요.';
      box.appendChild(empty);
    } else {
      var ul = document.createElement('ul');
      ul.className = 'sheet-events';
      list.forEach(function (ev) {
        var li = document.createElement('li');
        li.className = 'sheet-item';
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'sheet-row';
        row.style.setProperty('--cat', '#4f46e5');
        if (ev.time) {
          var tm = document.createElement('span');
          tm.className = 'sheet-row__time';
          tm.textContent = ev.time;
          row.appendChild(tm);
        }
        var tt = document.createElement('span');
        tt.className = 'sheet-row__title';
        tt.textContent = ev.title;
        row.appendChild(tt);
        if (ev.by) {
          var bd = document.createElement('span');
          bd.className = 'sheet-row__more';
          bd.textContent = ev.by;
          row.appendChild(bd);
        }
        var chev = document.createElement('span');
        chev.className = 'sheet-row__chev';
        chev.textContent = '›';
        row.appendChild(chev);
        row.addEventListener('click', function () { openEvent(ev); });
        li.appendChild(row);
        if (ev.memo) {
          var memo = document.createElement('p');
          memo.className = 'cal-row-memo';
          memo.textContent = ev.memo;
          li.appendChild(memo);
        }
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }

    var acts = document.createElement('div');
    acts.className = 'cal-row-actions';
    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-primary btn-small';
    add.textContent = '＋ 이 날 일정';
    add.addEventListener('click', function () { openEvent(null, S.selected); });
    acts.appendChild(add);
    box.appendChild(acts);
  }

  function ddayLabel(dateISO) {
    var n = dayDiff(todayISO(), dateISO);
    if (n === 0) return '오늘';
    if (n === 1) return '내일';
    return 'D-' + n;
  }

  function renderUpcoming() {
    var ul = $('calvUpcoming');
    if (!ul) return;
    var from = todayISO();
    var list = dateEventsForRange(from, addDaysISO(from, 60)).slice(0, 6);
    ul.innerHTML = '';
    if (!list.length) {
      var li0 = document.createElement('li');
      li0.className = 'empty';
      li0.textContent = '앞으로 2달 동안 잡힌 일정이 없어요.';
      ul.appendChild(li0);
      return;
    }
    list.forEach(function (ev) {
      var n = dayDiff(from, ev.date);
      var li = document.createElement('li');
      li.className = 'dday';
      var badge = document.createElement('span');
      badge.className = 'dday__badge' + (n === 0 ? ' is-today' : (n <= 3 ? ' is-soon' : ''));
      badge.textContent = ddayLabel(ev.date);
      li.appendChild(badge);
      var body = document.createElement('div');
      body.className = 'dday__body';
      var title = document.createElement('div');
      title.className = 'dday__title';
      title.textContent = ev.title;
      body.appendChild(title);
      var meta = document.createElement('div');
      meta.className = 'dday__meta';
      meta.textContent = fmtMD(ev.date) + ' (' + WEEKDAYS[(parseISO(ev.date) || new Date()).getDay()] + ')' + (ev.time ? ' · ' + ev.time : '');
      body.appendChild(meta);
      li.appendChild(body);
      li.addEventListener('click', function () { openEvent(ev); });
      ul.appendChild(li);
    });
  }

  /* ---------------- 근무형 ---------------- */
  function activeShifts(dateISO) {
    return shiftsOf(dateISO).filter(function (s) { return s.status !== 'canceled' && s.status !== 'absent'; });
  }
  function sumMinutes(list) { var m = 0; list.forEach(function (s) { m += shiftMinutes(s); }); return m; }
  function sumPay(list) { var p = 0; list.forEach(function (s) { p += shiftWage(s); }); return p; }

  function renderStore() {
    var today = todayISO();
    var tList = activeShifts(today);
    if ($('calvTodayHours')) $('calvTodayHours').textContent = tList.length ? hoursText(sumMinutes(tList)) : '0시간';
    if ($('calvTodayWage')) $('calvTodayWage').textContent = money(sumPay(tList));
    if ($('calvSumHint')) $('calvSumHint').textContent = tList.length ? '오늘 ' + tList.length + '명' : '오늘 근무 없음';

    var monthList = [];
    S.events.forEach(function (e) {
      if (e.kind !== 'shift' || e.status === 'canceled' || e.status === 'absent') return;
      var d = parseISO(e.date);
      if (d && d.getFullYear() === S.year && d.getMonth() === S.month) monthList.push(e);
    });
    if ($('calvMonthWage')) $('calvMonthWage').textContent = money(sumPay(monthList));
    if ($('calvMonthNote')) {
      $('calvMonthNote').textContent = (S.year) + '년 ' + (S.month + 1) + '월 · 근무 ' + monthList.length + '건 · ' + hoursText(sumMinutes(monthList));
    }

    buildMonthGrid('calvSGrid', 'calvSCalTitle', 'calvSCalSub', 'store');

    var legend = $('calvSLegend');
    if (legend) {
      legend.innerHTML = '';
      S.staff.forEach(function (st) {
        var wrap = document.createElement('span');
        var i = document.createElement('i');
        i.style.background = st.color;
        wrap.appendChild(i);
        wrap.appendChild(document.createTextNode(st.name));
        legend.appendChild(wrap);
      });
    }

    renderShiftDay();
  }

  function renderShiftDay() {
    var box = $('calvShiftDay');
    if (!box) return;
    var d = parseISO(S.selected) || new Date();
    var list = shiftsOf(S.selected).sort(byStart);
    box.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'card-head';
    var h = document.createElement('h2');
    h.textContent = (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + WEEKDAYS[d.getDay()] + '요일';
    head.appendChild(h);
    var hint = document.createElement('span');
    hint.className = 'card-head__hint';
    var live = list.filter(function (s) { return s.status !== 'canceled' && s.status !== 'absent'; });
    hint.textContent = list.length ? hoursText(sumMinutes(live)) + ' · ' + money(sumPay(live)) : '근무 없음';
    head.appendChild(hint);
    box.appendChild(head);

    if (!list.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '이 날은 근무가 없어요. 아래 [＋ 근무 등록]으로 넣어 보세요.';
      box.appendChild(empty);
    } else {
      var ul = document.createElement('ul');
      ul.className = 'sheet-events';
      list.forEach(function (s) {
        var st = staffOf(s.staffId);
        var li = document.createElement('li');
        li.className = 'sheet-item';

        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'sheet-row';
        row.style.setProperty('--cat', st ? st.color : '#94a3b8');
        var tm = document.createElement('span');
        tm.className = 'sheet-row__time';
        tm.textContent = (s.start || '--:--') + '~' + (s.end || '--:--');
        row.appendChild(tm);
        var tt = document.createElement('span');
        tt.className = 'sheet-row__title';
        tt.textContent = s.staffName;
        row.appendChild(tt);
        var badges = document.createElement('span');
        badges.className = 'sheet-row__badges';
        var bd = document.createElement('span');
        bd.className = 'sheet-row__badge';
        bd.textContent = STATUS_LABEL[s.status] || '예정';
        badges.appendChild(bd);
        row.appendChild(badges);
        row.addEventListener('click', function () { openShift(s); });
        li.appendChild(row);

        var meta = document.createElement('p');
        meta.className = 'cal-row-memo';
        var parts = [];
        parts.push(hoursText(shiftMinutes(s)) + ' · ' + money(shiftWage(s)));
        if (s.breakMin) parts.push('휴게 ' + s.breakMin + '분');
        if (s.actualStart) parts.push('출근 ' + s.actualStart);
        if (s.actualEnd) parts.push('퇴근 ' + s.actualEnd);
        if (s.memo) parts.push(s.memo);
        meta.textContent = parts.join(' · ');
        li.appendChild(meta);

        if (s.status === 'planned' && s.date === todayISO()) {
          var acts = document.createElement('div');
          acts.className = 'cal-row-actions';
          if (!s.actualStart) {
            var inBtn = document.createElement('button');
            inBtn.type = 'button';
            inBtn.className = 'btn-primary btn-small';
            inBtn.textContent = '출근 체크';
            inBtn.addEventListener('click', function () { markShift(s, 'in'); });
            acts.appendChild(inBtn);
          } else if (!s.actualEnd) {
            var outBtn = document.createElement('button');
            outBtn.type = 'button';
            outBtn.className = 'btn-primary btn-small';
            outBtn.textContent = '퇴근 체크';
            outBtn.addEventListener('click', function () { markShift(s, 'out'); });
            acts.appendChild(outBtn);
            var undoIn = document.createElement('button');
            undoIn.type = 'button';
            undoIn.className = 'btn-ghost btn-small';
            undoIn.textContent = '출근 취소';
            undoIn.addEventListener('click', function () { markShift(s, 'reset'); });
            acts.appendChild(undoIn);
          } else {
            var undo = document.createElement('button');
            undo.type = 'button';
            undo.className = 'btn-ghost btn-small';
            undo.textContent = '출퇴근 기록 지우기';
            undo.addEventListener('click', function () { markShift(s, 'reset'); });
            acts.appendChild(undo);
          }
          li.appendChild(acts);
        }
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }

    var foot = document.createElement('div');
    foot.className = 'cal-row-actions';
    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-primary btn-small';
    add.textContent = '＋ 이 날 근무 등록';
    add.addEventListener('click', function () { openShift(null, S.selected); });
    foot.appendChild(add);
    box.appendChild(foot);
  }

  function shiftData(s) {
    return {
      kind: 'shift',
      date: s.date,
      staffId: s.staffId,
      staffName: s.staffName,
      start: s.start,
      end: s.end,
      breakMin: s.breakMin,
      wage: s.wage,
      status: s.status,
      memo: s.memo,
      actualStart: s.actualStart || null,
      actualEnd: s.actualEnd || null
    };
  }

  function markShift(s, which) {
    if (!window.ExtraCloud) return;
    var data = shiftData(s);
    if (which === 'in') data.actualStart = nowHM();
    else if (which === 'out') data.actualEnd = nowHM();
    else { data.actualStart = null; data.actualEnd = null; }
    ExtraCloud.saveEvent(s.id, data).then(function () {
      toast(which === 'in' ? '출근 ' + data.actualStart + ' 기록했어요'
        : which === 'out' ? '퇴근 ' + data.actualEnd + ' 기록했어요' : '출퇴근 기록을 지웠어요');
    }, function (e) { toast(hintOf(e)); });
  }

  /* ---------------- 일정 모달 (일반형) ---------------- */
  function canEditEvent(ev) {
    if (!ev) return true;
    if (isManager()) return true;
    var mine = myName();
    return !!mine && ev.by === mine;
  }

  function openEvent(ev, presetDate) {
    S.editingId = ev ? ev.id : null;
    var ro = ev ? !canEditEvent(ev) : false;
    resetPasteBox();
    if ($('calEvTitle')) $('calEvTitle').textContent = ev ? '일정 수정' : '일정 추가';
    if ($('calEvTitleInput')) $('calEvTitleInput').value = ev ? ev.title : '';
    if ($('calEvDate')) $('calEvDate').value = ev ? ev.date : (presetDate || S.selected || todayISO());
    if ($('calEvTime')) $('calEvTime').value = ev && ev.time ? ev.time : '';
    if ($('calEvMemo')) $('calEvMemo').value = ev ? ev.memo : '';
    ['calEvTitleInput', 'calEvDate', 'calEvTime', 'calEvMemo'].forEach(function (id) {
      var n = $(id);
      if (n) n.disabled = ro;
    });
    if ($('calEvSave')) $('calEvSave').hidden = ro;
    if ($('calEvDelete')) $('calEvDelete').hidden = !ev || ro;
    if (ro) err('calEvError', '다른 사람이 넣은 일정이라 볼 수만 있어요.');
    else hideErr('calEvError');
    if ($('calEventModal')) $('calEventModal').hidden = false;
  }

  /* ---------------- 문자·카톡 붙여넣기 (일반형) ---------------- */
  function resetPasteBox() {
    var area = $('calPasteArea');
    if (area) area.value = '';
    var st = $('calPasteStatus');
    if (st) { st.hidden = true; st.textContent = ''; st.classList.remove('paste-status--warn'); }
    var cands = $('calPasteCands');
    if (cands) { cands.hidden = true; cands.innerHTML = ''; }
    if (pasteUI) pasteUI.close();
  }

  function renderPasteCands(parsed) {
    var wrap = $('calPasteCands');
    if (!wrap) return;
    wrap.innerHTML = '';
    var list = (parsed && parsed.candidates) || [];
    if (list.length < 2) { wrap.hidden = true; return; }
    wrap.hidden = false;
    list.forEach(function (cand) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'paste-cand' + (cand.date === parsed.date ? ' is-on' : '');
      b.textContent = fmtMD(cand.date) + (cand.hasTime ? ' ' + cand.time : '');
      b.addEventListener('click', function () {
        if ($('calEvDate')) $('calEvDate').value = cand.date;
        if ($('calEvTime')) $('calEvTime').value = cand.hasTime ? cand.time : '';
        Array.prototype.forEach.call(wrap.children, function (x) { x.classList.remove('is-on'); });
        b.classList.add('is-on');
      });
      wrap.appendChild(b);
    });
  }

  function applyPastedEvent(parsed) {
    if (!parsed) return;
    /* 일반형 캘린더에는 담당 가족 칸이 없어 그 안내는 빼 줍니다. */
    parsed.notes = (parsed.notes || []).filter(function (n) { return n.indexOf('담당') === -1; });
    if (parsed.date && $('calEvDate')) $('calEvDate').value = parsed.date;
    if ($('calEvTime')) $('calEvTime').value = parsed.hasTime ? parsed.time : '';
    if (parsed.title && $('calEvTitleInput')) $('calEvTitleInput').value = parsed.title.slice(0, 80);
    if (parsed.memo && $('calEvMemo')) $('calEvMemo').value = parsed.memo.slice(0, 600);
    renderPasteCands(parsed);
    var st = $('calPasteStatus');
    if (st) st.classList.toggle('paste-status--warn', !parsed.date);
  }

  function saveEventForm() {
    if (!window.ExtraCloud) return;
    var title = val('calEvTitleInput').trim();
    var date = val('calEvDate');
    if (!title) { err('calEvError', '제목을 넣어 주세요.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { err('calEvError', '날짜를 골라 주세요.'); return; }
    hideErr('calEvError');
    var data = {
      kind: 'event',
      title: title,
      date: date,
      time: val('calEvTime') || null,
      memo: val('calEvMemo'),
      by: myName() || '구성원'
    };
    ExtraCloud.saveEvent(S.editingId, data).then(function () {
      if ($('calEventModal')) $('calEventModal').hidden = true;
      S.selected = date;
      var d = parseISO(date);
      if (d) { S.year = d.getFullYear(); S.month = d.getMonth(); }
      toast(S.editingId ? '일정을 고쳤어요' : '일정을 넣었어요');
    }, function (e) { err('calEvError', hintOf(e)); });
  }

  /* 🏥 국가 검진·예방접종 — 일반형 캘린더에서는 이 캘린더 일정으로 담습니다. */
  function openHealthSheet() {
    if (!window.FamilyHealth) { toast('잠시 뒤 다시 열어 주세요'); return; }
    window.FamilyHealth.open({
      members: [],
      today: todayISO(),
      onSave: saveHealthToCalendar,
      onSaved: function (n) {
        if ($('calEventModal')) $('calEventModal').hidden = true;
        toast(n + '건을 넣었어요');
      },
      onError: function (e) { return hintOf(e); }
    });
  }

  function saveHealthToCalendar(list) {
    if (!window.ExtraCloud) return Promise.reject(new Error('not-connected'));
    var rows = Array.isArray(list) ? list : [];
    if (!rows.length) return Promise.resolve({ count: 0 });
    var someone = myName() || '구성원';
    var seq = Promise.resolve(0);
    rows.forEach(function (it) {
      seq = seq.then(function (n) {
        return ExtraCloud.saveEvent(null, {
          kind: 'event',
          title: it.title,
          date: it.date,
          time: null,
          memo: it.memo,
          by: someone
        }).then(function () { return n + 1; });
      });
    });
    return seq.then(function (n) {
      var first = rows[0].date;
      S.selected = first;
      var d = parseISO(first);
      if (d) { S.year = d.getFullYear(); S.month = d.getMonth(); }
      return { count: n };
    });
  }

  function deleteEventForm() {
    if (!S.editingId || !window.ExtraCloud) return;
    if (!window.confirm('이 일정을 지울까요?')) return;
    ExtraCloud.deleteEvent(S.editingId).then(function () {
      if ($('calEventModal')) $('calEventModal').hidden = true;
      toast('일정을 지웠어요');
    }, function (e) { err('calEvError', hintOf(e)); });
  }

  /* ---------------- 근무 모달 (근무형) ---------------- */
  function canEditShift(s) {
    if (!s) return true;
    if (isManager()) return true;
    var sid = myStaffId();
    return !!sid && s.staffId === sid;
  }

  function renderShiftStaff() {
    var wrap = $('calShStaff');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!S.staff.length) {
      if ($('calShStaffHint')) $('calShStaffHint').hidden = false;
      return;
    }
    if ($('calShStaffHint')) $('calShStaffHint').hidden = true;
    S.staff.forEach(function (st) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cal-pick__btn' + (S.shiftStaffId === st.id ? ' is-active' : '');
      b.setAttribute('data-id', st.id);
      b.textContent = st.name;
      b.style.setProperty('--pc', st.color);
      b.addEventListener('click', function () {
        S.shiftStaffId = st.id;
        renderShiftStaff();
        var w = $('calShWage');
        if (w && !w.disabled) w.value = String(st.hourly || '');
        updateShiftCalc();
      });
      wrap.appendChild(b);
    });
  }

  function updateShiftCalc() {
    var hint = $('calShCalc');
    if (!hint) return;
    var tmp = {
      start: val('calShStart'),
      end: val('calShEnd'),
      breakMin: num('calShBreak'),
      wage: num('calShWage')
    };
    if (hmToMin(tmp.start) === null || hmToMin(tmp.end) === null) {
      hint.textContent = '시작·종료 시간을 넣으면 근무 시간과 인건비를 계산해요.';
      return;
    }
    hint.textContent = hoursText(shiftMinutes(tmp)) + ' · ' + money(shiftWage(tmp));
  }

  function openShift(s, presetDate) {
    if (!window.ExtraCloud) return;
    S.editingId = s ? s.id : null;
    S.editingShift = s || null;
    var ro = s ? !canEditShift(s) : false;
    S.shiftStatus = s ? s.status : 'planned';
    S.shiftStaffId = s ? s.staffId : (myStaffId() || (S.staff[0] ? S.staff[0].id : ''));
    if ($('calShTitle')) $('calShTitle').textContent = s ? '근무 수정' : '근무 등록';
    if ($('calShDate')) $('calShDate').value = s ? s.date : (presetDate || S.selected || todayISO());
    if ($('calShStart')) $('calShStart').value = s ? s.start : '18:00';
    if ($('calShEnd')) $('calShEnd').value = s ? s.end : '22:00';
    if ($('calShBreak')) $('calShBreak').value = s ? String(s.breakMin || 0) : '0';
    var st = s ? staffOf(s.staffId) : staffOf(S.shiftStaffId);
    if ($('calShWage')) $('calShWage').value = String(s ? s.wage : (st ? st.hourly : 10000));
    if ($('calShMemo')) $('calShMemo').value = s ? s.memo : '';
    renderShiftStaff();
    paintShiftStatus();
    ['calShDate', 'calShStart', 'calShEnd', 'calShBreak', 'calShWage', 'calShMemo'].forEach(function (id) {
      var n = $(id);
      if (n) n.disabled = ro;
    });
    Array.prototype.forEach.call(($('calShStatus') || { children: [] }).children, function (b) {
      b.disabled = ro;
    });
    if ($('calShSave')) $('calShSave').hidden = ro;
    if ($('calShDelete')) $('calShDelete').hidden = !s || ro;
    if (ro) err('calShError', '다른 사람의 근무라 볼 수만 있어요.');
    else hideErr('calShError');
    updateShiftCalc();
    if ($('calShiftModal')) $('calShiftModal').hidden = false;
  }

  function paintShiftStatus() {
    var wrap = $('calShStatus');
    if (!wrap) return;
    Array.prototype.forEach.call(wrap.children, function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-status') === S.shiftStatus);
    });
  }

  function saveShiftForm() {
    if (!window.ExtraCloud) return;
    var st = S.shiftStaffId ? staffOf(S.shiftStaffId) : null;
    if (!st) { err('calShError', S.staff.length ? '담당을 골라 주세요.' : '먼저 ⚙️ 설정에서 근무자를 등록해 주세요.'); return; }
    var date = val('calShDate');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { err('calShError', '날짜를 골라 주세요.'); return; }
    var start = val('calShStart');
    var end = val('calShEnd');
    if (!start || !end) { err('calShError', '시작·종료 시간을 넣어 주세요.'); return; }
    hideErr('calShError');
    var data = {
      kind: 'shift',
      date: date,
      staffId: st.id,
      staffName: st.name,
      start: start,
      end: end,
      breakMin: num('calShBreak'),
      wage: num('calShWage') || st.hourly || 0,
      status: S.shiftStatus,
      memo: val('calShMemo')
    };
    if (S.editingShift) {
      data.actualStart = S.editingShift.actualStart || null;
      data.actualEnd = S.editingShift.actualEnd || null;
    }
    ExtraCloud.saveEvent(S.editingId, data).then(function () {
      if ($('calShiftModal')) $('calShiftModal').hidden = true;
      S.selected = date;
      var d = parseISO(date);
      if (d) { S.year = d.getFullYear(); S.month = d.getMonth(); }
      toast(S.editingId ? '근무를 고쳤어요' : '근무를 등록했어요');
    }, function (e) { err('calShError', hintOf(e)); });
  }

  function deleteShiftForm() {
    if (!S.editingId || !window.ExtraCloud) return;
    if (!window.confirm('이 근무를 지울까요?')) return;
    ExtraCloud.deleteEvent(S.editingId).then(function () {
      if ($('calShiftModal')) $('calShiftModal').hidden = true;
      toast('근무를 지웠어요');
    }, function (e) { err('calShError', hintOf(e)); });
  }

  /* ---------------- 캘린더 추가 모달 ---------------- */
  function paintPane(pane) {
    var seg = $('calAddSeg');
    if (seg) {
      Array.prototype.forEach.call(seg.children, function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-pane') === pane);
      });
    }
    if ($('calNewPane')) $('calNewPane').hidden = pane !== 'new';
    if ($('calJoinPane')) $('calJoinPane').hidden = pane !== 'join';
  }

  function renderIconPick(wrapId, current, onPick) {
    var wrap = $(wrapId);
    if (!wrap) return;
    wrap.innerHTML = '';
    ICONS.forEach(function (ic) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cal-icon-pick__btn' + (ic === current ? ' is-active' : '');
      b.textContent = ic;
      b.setAttribute('data-icon', ic);
      b.addEventListener('click', function () {
        onPick(ic);
        Array.prototype.forEach.call(wrap.children, function (c) {
          c.classList.toggle('is-active', c.getAttribute('data-icon') === ic);
        });
      });
      wrap.appendChild(b);
    });
  }

  function paintType() {
    var wrap = $('calNewType');
    if (!wrap) return;
    Array.prototype.forEach.call(wrap.children, function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-type') === S.newType);
    });
  }

  function openAdd() {
    if (isLockedDevice()) { toast('이 기기에서는 추가 캘린더를 쓸 수 없어요'); return; }
    closeOtherModals();
    S.newIcon = '📅';
    S.newType = 'general';
    S.found = null;
    S.foundCode = '';
    if ($('calNewName')) $('calNewName').value = '';
    if ($('calNewPin')) $('calNewPin').value = '';
    if ($('calNewMe')) $('calNewMe').value = myName() && S.active ? myName() : '';
    if ($('calJoinCode')) $('calJoinCode').value = '';
    if ($('calJoinMe')) $('calJoinMe').value = '';
    if ($('calFound')) { $('calFound').hidden = true; $('calFound').innerHTML = ''; }
    if ($('calJoinGo')) $('calJoinGo').disabled = true;
    hideErr('calNewError');
    hideErr('calJoinError');
    renderIconPick('calNewIcons', S.newIcon, function (ic) { S.newIcon = ic; });
    paintType();
    paintPane('new');
    if ($('calAddModal')) $('calAddModal').hidden = false;
  }

  function closeAdd() {
    if ($('calAddModal')) $('calAddModal').hidden = true;
  }

  function createCalendar() {
    if (!window.ExtraCloud) return;
    var name = val('calNewName').trim();
    if (!name) { err('calNewError', '캘린더 이름을 넣어 주세요.'); return; }
    var pin = val('calNewPin').replace(/[^0-9]/g, '');
    if (pin && pin.length !== 4) { err('calNewError', '관리자 PIN은 4자리 숫자예요. (비우면 PIN 없이 열려요)'); return; }
    hideErr('calNewError');
    var btn = $('calNewCreate');
    if (btn) { btn.disabled = true; btn.textContent = '만드는 중…'; }
    var meName = val('calNewMe').trim() || '관리자';
    createWithFreshCode(name, pin, meName).then(function (code) {
      setMe(code, { name: meName, mgr: true, staffId: '' });
      upsertEntry({ code: code, name: name, icon: S.newIcon, type: S.newType, owner: true });
      renderTabs();
      closeAdd();
      enter(code);
      toast('캘린더를 만들었어요');
    }).catch(function (e) {
      err('calNewError', hintOf(e));
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = '만들기'; }
    });
  }

  /* 초대 코드가 이미 쓰이고 있으면(code-taken) 새 코드로 다시 시도합니다. */
  function createWithFreshCode(name, pin, meName) {
    var attempts = 0;
    function tryOnce() {
      var code = ExtraCloud.generateCode();
      attempts++;
      return ExtraCloud.create(code, { name: name, icon: S.newIcon, type: S.newType, pin: pin || '' }).then(function () {
        return code;
      }, function (e) {
        if (e && e.message === 'code-taken' && attempts < 3) return tryOnce();
        throw e;
      });
    }
    return tryOnce();
  }

  function openJoin(code) {
    openAdd();
    paintPane('join');
    if (code) {
      if ($('calJoinCode')) $('calJoinCode').value = code;
      lookupJoin();
    }
  }

  function lookupJoin() {
    if (!window.ExtraCloud) return;
    var code = ExtraCloud.normalizeCode(val('calJoinCode'));
    if (!code) { err('calJoinError', '초대 코드를 넣어 주세요.'); return; }
    hideErr('calJoinError');
    var box = $('calFound');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    if ($('calJoinGo')) $('calJoinGo').disabled = true;
    var btn = $('calJoinLookup');
    if (btn) { btn.disabled = true; btn.textContent = '확인 중…'; }
    ExtraCloud.fetchRoom(code).then(function (info) {
      if (!info || !info.exists) {
        err('calJoinError', '그 코드의 캘린더를 찾을 수 없어요. 코드를 다시 확인해 주세요.');
        return;
      }
      S.found = info;
      S.foundCode = info.code || code;
      if (box) {
        box.innerHTML = '';
        var title = document.createElement('b');
        title.textContent = info.name ? (info.icon + ' ' + info.name) : '🔒 초대 코드가 맞는 캘린더';
        box.appendChild(title);
        var sub = document.createElement('span');
        sub.textContent = info.name
          ? ((info.calType === 'store' ? '🏪 매장·근무형' : '📅 모임·일반형')
            + (info.staff && info.staff.length ? ' · 근무자 ' + info.staff.length + '명' : ''))
          : '참여를 누르면 이 캘린더가 목록에 추가됩니다.';
        box.appendChild(sub);
        box.hidden = false;
      }
      if ($('calJoinGo')) $('calJoinGo').disabled = false;
    }).catch(function (e) {
      err('calJoinError', hintOf(e));
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = '코드 확인'; }
    });
  }

  function joinCalendar() {
    var info = S.found;
    if (!info) return;
    var code = S.foundCode || info.code;
    var meName = val('calJoinMe').trim() || (info.calType === 'store' ? '구성원' : '구성원');
    var patch = { name: meName };
    if (info.calType === 'store') {
      var sid = '';
      (info.staff || []).forEach(function (st) { if (!sid && st.name === meName) sid = st.id; });
      patch.staffId = sid;
    }
    setMe(code, patch);
    upsertEntry({ code: code, name: info.name || '캘린더', icon: info.icon || '📅', type: info.calType || 'general', owner: false });
    renderTabs();
    closeAdd();
    enter(code);
    toast('캘린더에 참여했어요');
  }

  /* ---------------- 설정 모달 ---------------- */
  function inviteLink() {
    var base = location.origin + location.pathname.replace(/index\.html$/, '');
    if (base.charAt(base.length - 1) !== '/') base += '/';
    return base + '?cal=' + encodeURIComponent(S.code);
  }

  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, function () { fallbackCopy(text, okMsg); });
      return;
    }
    fallbackCopy(text, okMsg);
  }

  function fallbackCopy(text, okMsg) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      toast(ok ? okMsg : '복사가 막혀 있어요. 길게 눌러 복사해 주세요.');
    } catch (e) {
      toast('복사가 막혀 있어요. 길게 눌러 복사해 주세요.');
    }
  }

  function openSettings() {
    renderSettings();
    if ($('calSettingsModal')) $('calSettingsModal').hidden = false;
  }

  function renderSettings() {
    S.setIcon = S.icon;
    if ($('calSetCode')) $('calSetCode').textContent = S.code || '-';
    if ($('calSetName')) {
      $('calSetName').value = S.name;
      $('calSetName').disabled = !isManager();
    }
    renderIconPick('calSetIcons', S.setIcon, function (ic) { S.setIcon = ic; });
    Array.prototype.forEach.call(($('calSetIcons') || { children: [] }).children, function (b) { b.disabled = !isManager(); });
    if ($('calSetSave')) $('calSetSave').hidden = !isManager();
    if ($('calSetMetaNote')) {
      $('calSetMetaNote').textContent = (S.type === 'store' ? '🏪 매장·근무형' : '📅 모임·일반형')
        + (isManager() ? ' · 관리자로 열려 있어요' : ' · 이름·아이콘은 관리자만 바꿀 수 있어요');
    }
    if ($('calSetMe')) $('calSetMe').value = myName();
    var staffWrap = $('calSetMeStaffWrap');
    var sel = $('calSetMeStaff');
    if (staffWrap && sel) {
      staffWrap.hidden = S.type !== 'store';
      sel.innerHTML = '';
      var none = document.createElement('option');
      none.value = '';
      none.textContent = '(아직 고르지 않음)';
      sel.appendChild(none);
      S.staff.forEach(function (st) {
        var o = document.createElement('option');
        o.value = st.id;
        o.textContent = st.name + (st.hourly ? ' · ' + money(st.hourly) : '');
        sel.appendChild(o);
      });
      sel.value = myStaffId();
    }

    var pinBlock = $('calSetPinBlock');
    if (pinBlock) {
      if (isManager()) {
        pinBlock.hidden = true;
      } else {
        pinBlock.hidden = false;
        if ($('calSetPinNote')) $('calSetPinNote').textContent = '관리자 PIN을 넣으면 이 기기에서도 이름·아이콘과 직원 관리를 할 수 있어요.';
      }
    }
    if ($('calSetPin')) $('calSetPin').value = '';
    hideErr('calSetPinError');

    var staffBlock = $('calStaffBlock');
    var list = $('calStaffList');
    if (staffBlock && list) {
      staffBlock.hidden = S.type !== 'store' || !isManager();
      list.innerHTML = '';
      S.staff.forEach(function (st) {
        var li = document.createElement('li');
        li.className = 'cal-staff';
        var dot = document.createElement('i');
        dot.style.background = st.color;
        li.appendChild(dot);
        var nm = document.createElement('b');
        nm.textContent = st.name;
        li.appendChild(nm);
        var wg = document.createElement('input');
        wg.type = 'text';
        wg.inputMode = 'numeric';
        wg.maxLength = 8;
        wg.value = String(st.hourly || '');
        wg.className = 'cal-staff__wage';
        wg.setAttribute('aria-label', st.name + ' 시급');
        wg.addEventListener('change', function () {
          var next = S.staff.map(function (x) {
            return x.id === st.id ? { id: x.id, name: x.name, color: x.color, bg: x.bg, hourly: Math.max(0, Math.round(Number(String(wg.value).replace(/[^0-9]/g, '')) || 0)) } : x;
          });
          saveStaffList(next, st.name + ' 시급을 저장했어요');
        });
        li.appendChild(wg);
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn-ghost btn-small btn-danger';
        del.textContent = '삭제';
        del.addEventListener('click', function () {
          if (!window.confirm(st.name + ' 님을 근무자 목록에서 뺄까요?\n지난 근무 기록은 그대로 남아요.')) return;
          saveStaffList(S.staff.filter(function (x) { return x.id !== st.id; }), st.name + ' 님을 뺐어요');
        });
        li.appendChild(del);
        list.appendChild(li);
      });
      if (!S.staff.length) {
        var e0 = document.createElement('li');
        e0.className = 'empty';
        e0.textContent = '아직 등록된 근무자가 없어요.';
        list.appendChild(e0);
      }
    }
    hideErr('calStaffError');
  }

  function saveStaffList(list, okMsg) {
    if (!window.ExtraCloud) return;
    ExtraCloud.saveStaff(list).then(function () {
      toast(okMsg || '저장했어요');
    }, function (e) { err('calSetPinError', hintOf(e)); });
  }

  function saveMeta() {
    if (!window.ExtraCloud || !isManager()) return;
    var name = val('calSetName').trim();
    if (!name) { toast('캘린더 이름을 넣어 주세요'); return; }
    ExtraCloud.saveRoom({ name: name, icon: S.setIcon }).then(function () {
      S.name = name;
      S.icon = S.setIcon;
      upsertEntry({ code: S.code, name: name, icon: S.setIcon });
      renderTabs();
      renderHeader();
      if ($('appTitle')) $('appTitle').textContent = S.icon + ' ' + S.name;
      toast('이름·아이콘을 저장했어요');
      renderSettings();
    }, function (e) { toast(hintOf(e)); });
  }

  function unlockManager() {
    if (!window.ExtraCloud) return;
    var pin = val('calSetPin').replace(/[^0-9]/g, '');
    if (pin.length !== 4) { err('calSetPinError', 'PIN 4자리를 넣어 주세요.'); return; }
    hideErr('calSetPinError');
    ExtraCloud.checkPin(S.code, pin).then(function (ok) {
      if (!ok) { err('calSetPinError', 'PIN이 맞지 않아요.'); return; }
      setMe(S.code, { mgr: true });
      toast('관리자로 열었어요');
      renderSettings();
      renderHeader();
    }).catch(function (e) { err('calSetPinError', hintOf(e)); });
  }

  function saveMyInfo() {
    var name = val('calSetMe').trim();
    if (!name) { toast('이름을 넣어 주세요'); return; }
    var patch = { name: name };
    if (S.type === 'store') patch.staffId = val('calSetMeStaff');
    setMe(S.code, patch);
    toast('내 정보를 저장했어요');
    renderSettings();
  }

  function leaveCalendar() {
    if (!window.confirm('이 기기에서 "' + S.name + '" 캘린더를 뺄까요?\n서버의 일정·근무는 지워지지 않아요. 초대 코드로 다시 들어올 수 있어요.')) return;
    var code = S.code;
    dropEntry(code);
    leave();
    renderTabs();
    var fam = $('tabFamily');
    if (fam) fam.click();
    toast('이 기기에서 캘린더를 뺐어요');
  }

  /* ---------------- 카톡 요약 ---------------- */
  function buildGeneralKakao(scope) {
    var days = scope === 'week' ? 7 : 1;
    var from = todayISO();
    var lines = ['📅 ' + S.name + ' · ' + (scope === 'week' ? '이번 주(오늘부터 7일)' : '오늘 ' + fmtMD(from))];
    var count = 0;
    for (var i = 0; i < days; i++) {
      var dISO = addDaysISO(from, i);
      var list = eventsOf(dISO).sort(byTime);
      if (!list.length) continue;
      var d = parseISO(dISO);
      lines.push('');
      lines.push('· ' + fmtMD(dISO) + ' (' + WEEKDAYS[d.getDay()] + ')' + (dISO === from ? ' 오늘' : ''));
      list.forEach(function (ev) {
        lines.push('  · ' + (ev.time ? ev.time + ' ' : '') + ev.title + (ev.memo ? ' — ' + ev.memo : ''));
        count++;
      });
    }
    if (!count) lines.push('', '일정이 없어요.');
    return lines.join('\n');
  }

  function buildStoreKakao(scope) {
    var days = scope === 'week' ? 7 : 1;
    var from = todayISO();
    var lines = ['🏪 ' + S.name + ' · ' + (scope === 'week' ? '이번 주 근무(오늘부터 7일)' : '오늘 근무 ' + fmtMD(from))];
    var count = 0;
    for (var i = 0; i < days; i++) {
      var dISO = addDaysISO(from, i);
      var list = shiftsOf(dISO).filter(function (s) { return s.status !== 'canceled'; }).sort(byStart);
      if (!list.length) continue;
      var d = parseISO(dISO);
      lines.push('');
      lines.push('· ' + fmtMD(dISO) + ' (' + WEEKDAYS[d.getDay()] + ')' + (dISO === from ? ' 오늘' : ''));
      list.forEach(function (s) {
        var parts = [(s.start || '--:--') + '~' + (s.end || '--:--'), s.staffName];
        parts.push(hoursText(shiftMinutes(s)));
        if (s.status === 'absent') parts.push('결근');
        else parts.push(money(shiftWage(s)));
        if (s.actualStart) parts.push('출근 ' + s.actualStart + (s.actualEnd ? ' / 퇴근 ' + s.actualEnd : ''));
        if (s.memo) parts.push(s.memo);
        lines.push('  · ' + parts.join(' · '));
        count++;
      });
    }
    if (!count) lines.push('', '근무가 없어요.');
    return lines.join('\n');
  }

  function copyKakao(scope) {
    var text = S.type === 'store' ? buildStoreKakao(scope) : buildGeneralKakao(scope);
    var prev = S.type === 'store' ? $('calvSKakaoPreview') : $('calvKakaoPreview');
    if (prev) {
      prev.textContent = text;
      prev.hidden = false;
    }
    copyText(text, '카톡에 붙여넣을 수 있게 복사했어요');
  }

  /* ---------------- 이벤트 연결 ---------------- */
  function bind() {
    el.view = $('customView');
    el.icon = $('calvIcon');
    el.name = $('calvName');
    el.meta = $('calvMeta');
    el.note = $('calvNote');
    el.addBtn = $('calvAddBtn');

    var addTab = $('tabAddCal');
    if (addTab) addTab.addEventListener('click', openAdd);

    ['tabFamily', 'tabStore', 'tabLedger'].forEach(function (id) {
      var t = $(id);
      if (t) t.addEventListener('click', function () { leave(); });
    });

    if ($('calvSettingsBtn')) $('calvSettingsBtn').addEventListener('click', openSettings);
    if (el.addBtn) el.addBtn.addEventListener('click', function () {
      if (S.type === 'store') openShift(null, S.selected);
      else openEvent(null, S.selected);
    });

    /* 일반형 달력 */
    if ($('calvPrev')) $('calvPrev').addEventListener('click', function () { shiftMonth(-1); });
    if ($('calvNext')) $('calvNext').addEventListener('click', function () { shiftMonth(1); });
    if ($('calvTodayBtn')) $('calvTodayBtn').addEventListener('click', goToday);
    if ($('calvSPrev')) $('calvSPrev').addEventListener('click', function () { shiftMonth(-1); });
    if ($('calvSNext')) $('calvSNext').addEventListener('click', function () { shiftMonth(1); });
    if ($('calvSTodayBtn')) $('calvSTodayBtn').addEventListener('click', goToday);

    if ($('calvKakaoToday')) $('calvKakaoToday').addEventListener('click', function () { copyKakao('today'); });
    if ($('calvKakaoWeek')) $('calvKakaoWeek').addEventListener('click', function () { copyKakao('week'); });
    if ($('calvSKakaoToday')) $('calvSKakaoToday').addEventListener('click', function () { copyKakao('today'); });
    if ($('calvSKakaoWeek')) $('calvSKakaoWeek').addEventListener('click', function () { copyKakao('week'); });

    /* 추가 모달 */
    if ($('calAddClose')) $('calAddClose').addEventListener('click', closeAdd);
    var addBackdrop = $('calAddModal') && $('calAddModal').querySelector('[data-close]');
    if (addBackdrop) addBackdrop.addEventListener('click', closeAdd);
    if ($('calAddSeg')) $('calAddSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-pane]');
      if (!b) return;
      paintPane(b.getAttribute('data-pane'));
    });
    if ($('calNewType')) $('calNewType').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-type]');
      if (!b) return;
      S.newType = b.getAttribute('data-type');
      paintType();
    });
    if ($('calNewCreate')) $('calNewCreate').addEventListener('click', createCalendar);
    if ($('calJoinLookup')) $('calJoinLookup').addEventListener('click', lookupJoin);
    if ($('calJoinGo')) $('calJoinGo').addEventListener('click', joinCalendar);
    if ($('calJoinCode')) $('calJoinCode').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); lookupJoin(); }
    });

    /* 설정 모달 */
    if ($('calSetClose')) $('calSetClose').addEventListener('click', function () { $('calSettingsModal').hidden = true; });
    var setBackdrop = $('calSettingsModal') && $('calSettingsModal').querySelector('[data-close]');
    if (setBackdrop) setBackdrop.addEventListener('click', function () { $('calSettingsModal').hidden = true; });
    if ($('calSetInviteBtn')) $('calSetInviteBtn').addEventListener('click', function () {
      copyText(inviteLink(), '초대 링크를 복사했어요\n카카오톡으로 보내면 받은 사람 폰에서 바로 열려요');
    });
    if ($('calSetCodeBtn')) $('calSetCodeBtn').addEventListener('click', function () {
      copyText(S.code, '초대 코드를 복사했어요');
    });
    if ($('calSetSave')) $('calSetSave').addEventListener('click', saveMeta);
    if ($('calSetPinBtn')) $('calSetPinBtn').addEventListener('click', unlockManager);
    if ($('calSetPin')) $('calSetPin').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); unlockManager(); }
    });
    if ($('calSetMeSave')) $('calSetMeSave').addEventListener('click', saveMyInfo);
    if ($('calStaffAdd')) $('calStaffAdd').addEventListener('click', addStaff);
    if ($('calStaffName')) $('calStaffName').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addStaff(); }
    });
    if ($('calSetLeave')) $('calSetLeave').addEventListener('click', leaveCalendar);

    /* 일정 모달 */
    if ($('calEvClose')) $('calEvClose').addEventListener('click', function () { $('calEventModal').hidden = true; });
    var evBackdrop = $('calEventModal') && $('calEventModal').querySelector('[data-close]');
    if (evBackdrop) evBackdrop.addEventListener('click', function () { $('calEventModal').hidden = true; });
    if ($('calEvSave')) $('calEvSave').addEventListener('click', saveEventForm);
    if ($('calHealthBtn')) $('calHealthBtn').addEventListener('click', openHealthSheet);
    if (window.CalendarPaste && $('calPasteBtn')) {
      pasteUI = CalendarPaste.attachUI({
        entry: $('calPasteBtn'),
        box: $('calPasteBox'),
        area: $('calPasteArea'),
        runBtn: $('calPasteRunBtn'),
        clipBtn: $('calPasteClipBtn'),
        clearBtn: $('calPasteClearBtn'),
        statusEl: $('calPasteStatus'),
        tryClipboard: true,
        getCtx: function () { return { members: [], today: todayISO() }; },
        onFill: applyPastedEvent
      });
    }
    if ($('calEvDelete')) $('calEvDelete').addEventListener('click', deleteEventForm);

    /* 근무 모달 */
    if ($('calShClose')) $('calShClose').addEventListener('click', function () { $('calShiftModal').hidden = true; });
    var shBackdrop = $('calShiftModal') && $('calShiftModal').querySelector('[data-close]');
    if (shBackdrop) shBackdrop.addEventListener('click', function () { $('calShiftModal').hidden = true; });
    if ($('calShSave')) $('calShSave').addEventListener('click', saveShiftForm);
    if ($('calShDelete')) $('calShDelete').addEventListener('click', deleteShiftForm);
    if ($('calShStatus')) $('calShStatus').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-status]');
      if (!b || b.disabled) return;
      S.shiftStatus = b.getAttribute('data-status');
      paintShiftStatus();
    });
    ['calShStart', 'calShEnd', 'calShBreak', 'calShWage'].forEach(function (id) {
      var n = $(id);
      if (n) n.addEventListener('input', updateShiftCalc);
      if (n) n.addEventListener('change', updateShiftCalc);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      ['calAddModal', 'calSettingsModal', 'calEventModal', 'calShiftModal'].forEach(function (id) {
        var m = $(id);
        if (m && !m.hidden) m.hidden = true;
      });
    });
  }

  function shiftMonth(delta) {
    var d = new Date(S.year, S.month + delta, 1);
    S.year = d.getFullYear();
    S.month = d.getMonth();
    renderBody();
  }

  function goToday() {
    var d = new Date();
    S.year = d.getFullYear();
    S.month = d.getMonth();
    S.selected = todayISO();
    renderBody();
  }

  function addStaff() {
    if (!isManager()) { err('calStaffError', '관리자만 근무자를 넣을 수 있어요.'); return; }
    var name = val('calStaffName').trim();
    if (!name) { err('calStaffError', '근무자 이름을 넣어 주세요.'); return; }
    if (S.staff.some(function (s) { return s.name === name; })) { err('calStaffError', '같은 이름이 이미 있어요.'); return; }
    if (S.staff.length >= 30) { err('calStaffError', '근무자는 30명까지 넣을 수 있어요.'); return; }
    hideErr('calStaffError');
    var hourly = Math.max(0, Math.round(Number(String(val('calStaffWage')).replace(/[^0-9]/g, '')) || 0));
    var palette = ['#0d9488', '#2563eb', '#db2777', '#d97706', '#7c3aed', '#059669', '#dc2626', '#0891b2'];
    var next = S.staff.slice();
    next.push({
      id: 'st' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: name,
      color: palette[next.length % palette.length],
      hourly: hourly
    });
    if ($('calStaffName')) $('calStaffName').value = '';
    if ($('calStaffWage')) $('calStaffWage').value = '';
    saveStaffList(next, name + ' 님을 넣었어요');
  }

  /* ---------------- 시작 ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    if (!window.ExtraCloud) return;
    var now = new Date();
    S.year = now.getFullYear();
    S.month = now.getMonth();
    S.selected = todayISO();
    bind();
    renderTabs();

    var params = new URLSearchParams(location.search);
    var cal = params.get('cal');
    if (cal) {
      var clean = ExtraCloud.normalizeCode(cal);
      if (entryOf(clean)) enter(clean);
      else openJoin(clean);
      return;
    }
    if (params.get('code') || params.get('store')) return;
    var last = ls(LAST_KEY);
    if (last && entryOf(last)) enter(last);
  });

  window.ExtraMode = {
    enter: enter,
    leave: leave,
    openAdd: openAdd,
    isActive: function () { return S.active; },
    currentCode: function () { return S.code; },
    currentType: function () { return S.type; },
    events: function () { return S.events.slice(); },
    staff: function () { return S.staff.slice(); },
    list: readList,
    summary: function (scope) { return S.type === 'store' ? buildStoreKakao(scope) : buildGeneralKakao(scope); },
    inviteLink: inviteLink
  };
})();
