/* 우리 가족 달력 — 가족 공유판 (Firebase Cloud Firestore 실시간 동기화) */
(function () {
  'use strict';

  var L = window.FamilyLunar;

  var DEFAULT_MEMBERS = [
    { id: 'dad', name: '아빠', color: '#3b82f6', bg: '#e8f1fe', role: 'admin' },
    { id: 'mom', name: '엄마', color: '#ec4899', bg: '#fdeaf3', role: 'manager' },
    { id: 'grandma', name: '외할머니', color: '#f59e0b', bg: '#fef3e2', role: 'member' },
    { id: 'first', name: '첫째', color: '#10b981', bg: '#e6f7f0', role: 'member' },
    { id: 'second', name: '둘째', color: '#8b5cf6', bg: '#f0e9fe', role: 'member' },
    { id: 'third', name: '막내', color: '#06b6d4', bg: '#e2f6fa', role: 'member' }
  ];
  var MEMBERS = DEFAULT_MEMBERS.slice();
  var MEMBER_COLORS = ['#3b82f6', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16', '#0ea5e9', '#a855f7'];
  var ROLE_LABEL = { admin: '메인 관리자', manager: '부매니저', member: '구성원' };
  var PROFILE_KEY = 'family-calendar.me.v2';

  var CATEGORIES = [
    { id: 'birthday', label: '생일', emoji: '🎂', color: '#ec4899' },
    { id: 'memorial', label: '제사', emoji: '🕯️', color: '#a855f7' },
    { id: 'school', label: '학교', emoji: '🏫', color: '#3b82f6' },
    { id: 'hospital', label: '병원', emoji: '🏥', color: '#10b981' },
    { id: 'etc', label: '여행·기타', emoji: '✈️', color: '#f59e0b' }
  ];

  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var NAV_MIN_YEAR = 2024;
  var NAV_MAX_YEAR = 2037;
  var SAMPLE_PREFIX = '[샘플]';

  /* ---------------- 저장소 (Firebase 공유) ---------------- */
  var events = [];
  var requests = [];
  var profileRequests = [];
  var photos = [];
  var pasteUI = null;
  var cloudReady = false;
  var connectTimer = null;
  var toastTimer = null;
  var state = {
    year: 0,
    month: 0,
    selected: '',
    member: 'all',
    editingId: null,
    repeat: 'none',
    weekday: 0,
    weekdayTouched: false,
    checklist: [],
    saving: false,
    profile: '',
    account: null,
    googleIntentStarted: false,
    roomPins: {},
    revokedUids: [],
    removedMembers: {},
    joins: [],
    gateState: '',
    blocked: '',
    pendingPin: '',
    pinTarget: '',
    memberColor: 0,
    sheetDate: '',
    sheetOpen: '',
    ddayOpen: false,
    moreOpen: false
  };

  function isEventLike(ev) {
    return ev && typeof ev === 'object' && typeof ev.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ev.date || '');
  }

  function seedSamples() {
    var seeds = [
      { title: '[샘플] 아빠 생일', category: 'birthday', repeat: 'yearly-solar', date: '2026-12-05', members: ['dad'], memo: '케이크 미리 주문하기' },
      { title: '[샘플] 엄마 생일', category: 'birthday', repeat: 'yearly-lunar', lunar: { month: 10, day: 12 }, members: ['mom'], memo: '음력 10월 12일 · 가족 저녁 식사' },
      { title: '[샘플] 외할머니 생신', category: 'birthday', repeat: 'yearly-lunar', lunar: { month: 10, day: 20 }, members: ['grandma'], memo: '음력 10월 20일 · 외식 준비', time: '12:00' },
      { title: '[샘플] 제사 준비', category: 'memorial', repeat: 'yearly-lunar', lunar: { month: 11, day: 3 }, members: ['mom'], memo: '음력 11월 3일 · 오후 7시, 제수 장보기' },
      { title: '[샘플] 학교 체험학습', category: 'school', repeat: 'none', date: '2026-11-19', members: ['second', 'third'], memo: '도시락과 물병 챙기기' },
      { title: '[샘플] 치과 정기검진', category: 'hospital', repeat: 'none', date: '2026-11-25', time: '16:30', members: ['first'], memo: '보호자 동반' },
      { title: '[샘플] 독감 예방접종', category: 'hospital', repeat: 'none', date: '2026-12-02', time: '10:00', members: ['third'] },
      { title: '[샘플] 중간고사', category: 'school', repeat: 'none', date: '2026-12-16', members: ['first'], memo: '시험 범위 확인' },
      { title: '[샘플] 가족여행 출발', category: 'etc', repeat: 'none', date: '2026-12-28', time: '09:30', members: ['dad', 'mom', 'grandma', 'first', 'second', 'third'], memo: '공항 2시간 전 도착' }
    ];

    return seeds.map(function (s) {
      var date = s.date;
      var lunar = null;
      if (s.lunar) {
        var sol = L.toSolar(2026, s.lunar.month, s.lunar.day, false);
        if (!sol) return null;
        date = iso(sol.y, sol.m, sol.d);
        lunar = { month: s.lunar.month, day: s.lunar.day, leap: false };
      }
      return {
        id: uid(),
        title: s.title,
        date: date,
        time: s.time || null,
        members: s.members.slice(),
        category: s.category,
        memo: s.memo || '',
        repeat: s.repeat,
        lunar: lunar
      };
    }).filter(Boolean);
  }

  function uid() {
    return 'ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------------- 날짜 도구 ---------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function isoOfDate(dt) { return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); }
  function parseISO(s) { return L.parseISO(s); }
  function todayISO() { return isoOfDate(new Date()); }
  function dayDiff(a, b) {
    var A = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    var B = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((B - A) / 86400000);
  }
  function memberById(id) {
    for (var i = 0; i < MEMBERS.length; i++) if (MEMBERS[i].id === id) return MEMBERS[i];
    return null;
  }

  /* 사진이 있으면 동그란 사진, 없으면 색 점 */
  function avatarNode(m, size) {
    var el;
    if (m && m.photoDataUrl) {
      el = document.createElement('img');
      el.src = m.photoDataUrl;
      el.alt = '';
      el.className = 'avatar';
    } else {
      el = document.createElement('span');
      el.className = 'avatar avatar--dot';
      el.style.background = m ? m.color : '#94a3b8';
    }
    if (size) { el.style.width = size + 'px'; el.style.height = size + 'px'; }
    return el;
  }
  function categoryById(id) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i];
    return CATEGORIES[CATEGORIES.length - 1];
  }

  /* ---------------- 반복 일정 계산 ---------------- */
  function lunarOccurrence(year, lunar) {
    if (!lunar) return null;
    var tries = [];
    if (lunar.leap) {
      tries.push([lunar.month, lunar.day, true]);
      if (lunar.day === 30) tries.push([lunar.month, 29, true]);
    }
    tries.push([lunar.month, lunar.day, false]);
    if (lunar.day === 30) tries.push([lunar.month, 29, false]);
    for (var i = 0; i < tries.length; i++) {
      var sol = L.toSolar(year, tries[i][0], tries[i][1], tries[i][2]);
      if (sol) return iso(sol.y, sol.m, sol.d);
    }
    return null;
  }

  function occurrenceForYear(ev, year) {
    var base = parseISO(ev.date);
    if (ev.repeat === 'none') {
      return base.getFullYear() === year ? ev.date : null;
    }
    if (ev.repeat === 'yearly-lunar' && ev.lunar) {
      return lunarOccurrence(year, ev.lunar);
    }
    var d = new Date(year, base.getMonth(), base.getDate());
    if (d.getDate() !== base.getDate()) d = new Date(year, base.getMonth() + 1, 0); // 2/29 → 말일
    return isoOfDate(d);
  }

  /* 기간 일정: 시작일부터 며칠인지 */
  function rangeSpanDays(ev) {
    if (!ev || !ev.endDate) return 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.endDate)) return 0;
    var n = Math.round((parseISO(ev.endDate) - parseISO(ev.date)) / 86400000);
    return n > 0 ? n : 0;
  }

  function occurrenceRange(ev, year) {
    var start = occurrenceForYear(ev, year);
    if (!start) return null;
    var span = rangeSpanDays(ev);
    if (!span) return { start: start, end: start };
    var d = parseISO(start);
    d.setDate(d.getDate() + span);
    return { start: start, end: isoOfDate(d) };
  }

  function periodLabel(ev) {
    if (!ev || !ev.endDate || ev.endDate <= ev.date) return '';
    var s = parseISO(ev.date), e = parseISO(ev.endDate);
    return (s.getMonth() + 1) + '.' + s.getDate() + ' ~ ' + (e.getMonth() + 1) + '.' + e.getDate();
  }

  /* 달력·상세에 쓰는 표시용 기간(반복 일정은 그 해의 날짜로) */
  function occurrenceLabel(ev, year) {
    var r = occurrenceRange(ev, year);
    if (!r || r.start === r.end) return '';
    var s = parseISO(r.start), e = parseISO(r.end);
    return (s.getMonth() + 1) + '.' + s.getDate() + ' ~ ' + (e.getMonth() + 1) + '.' + e.getDate();
  }

  /* ---------------- 반복 일정 계산 (매주·매월 포함) ---------------- */
  function addDaysISO(baseISO, n) {
    var d = parseISO(baseISO);
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    return isoOfDate(x);
  }

  /* 매월 반복: 그 달에 같은 일자가 없으면 말일로 계산합니다 (예: 31일 → 2월은 28/29일). */
  function monthlyStart(ev, year, month) {
    var y = year + Math.floor(month / 12);
    var m = ((month % 12) + 12) % 12;
    var base = parseISO(ev.date);
    var dim = new Date(y, m + 1, 0).getDate();
    var day = Math.min(base.getDate(), dim);
    var start = iso(y, m + 1, day);
    return start < ev.date ? null : start;
  }

  /* 그 날짜가 어떤 반복 발생(기간 포함)에 들어가는지 → {start, end} 또는 null */
  function occurrenceCovering(ev, dateISO) {
    var repeat = ev.repeat || 'none';
    var span = rangeSpanDays(ev);
    if (repeat === 'weekly') {
      var d0 = parseISO(ev.date), d = parseISO(dateISO);
      var diff = Math.round((d - d0) / 86400000);
      if (diff < 0) return null;
      var k = Math.floor(diff / 7);
      var cands = [addDaysISO(ev.date, 7 * k)];
      if (k > 0) cands.push(addDaysISO(ev.date, 7 * (k - 1)));
      for (var i = 0; i < cands.length; i++) {
        var end = addDaysISO(cands[i], span);
        if (dateISO >= cands[i] && dateISO <= end) return { start: cands[i], end: end };
      }
      return null;
    }
    if (repeat === 'monthly') {
      var dt = parseISO(dateISO);
      for (var off = 0; off >= -2; off--) {
        var start2 = monthlyStart(ev, dt.getFullYear(), dt.getMonth() + off);
        if (!start2) continue;
        var end2 = addDaysISO(start2, span);
        if (dateISO >= start2 && dateISO <= end2) return { start: start2, end: end2 };
      }
      return null;
    }
    var y = Number(dateISO.slice(0, 4));
    var r = occurrenceRange(ev, y);
    if (r && dateISO >= r.start && dateISO <= r.end) return r;
    /* 12월 말~1월 초처럼 해를 넘기는 기간 */
    var prev = occurrenceRange(ev, y - 1);
    if (prev && dateISO >= prev.start && dateISO <= prev.end) return prev;
    return null;
  }

  /* fromISO ~ toISO 사이에 시작하는 반복 발생 목록 */
  function occurrenceStarts(ev, fromISO, toISO) {
    var out = [];
    var repeat = ev.repeat || 'none';
    var span = rangeSpanDays(ev);
    if (repeat === 'weekly') {
      var d0 = parseISO(ev.date);
      var diff = Math.round((parseISO(fromISO) - d0) / 86400000);
      var k = Math.max(0, Math.ceil(diff / 7));
      for (var i = 0; i < 400; i++) {
        var s = addDaysISO(ev.date, 7 * (k + i));
        if (s > toISO) break;
        out.push({ start: s, end: addDaysISO(s, span) });
      }
      return out;
    }
    if (repeat === 'monthly') {
      var f = parseISO(fromISO), t = parseISO(toISO);
      var y = f.getFullYear(), m = f.getMonth();
      while (y < t.getFullYear() || (y === t.getFullYear() && m <= t.getMonth())) {
        var s2 = monthlyStart(ev, y, m);
        if (s2 && s2 >= fromISO && s2 <= toISO) out.push({ start: s2, end: addDaysISO(s2, span) });
        m++;
        if (m > 11) { m = 0; y++; }
      }
      return out;
    }
    var y0 = parseISO(fromISO).getFullYear();
    for (var yy = y0 - 1; yy <= y0 + 2; yy++) {
      var r = occurrenceRange(ev, yy);
      if (r && r.start >= fromISO && r.start <= toISO) out.push({ start: r.start, end: r.end });
    }
    return out;
  }

  function eventsOn(dateISO) {
    return events.filter(function (ev) {
      if (!passesMemberFilter(ev)) return false;
      return !!occurrenceCovering(ev, dateISO);
    }).sort(compareEvents);
  }

  function compareEvents(a, b) {
    var ta = a.time || '00:00';
    var tb = b.time || '00:00';
    if (ta === tb) return a.title.localeCompare(b.title, 'ko');
    return ta < tb ? -1 : 1;
  }

  function passesMemberFilter(ev) {
    if (state.member === 'all') return true;
    return (ev.members || []).indexOf(state.member) !== -1;
  }

  function lunarTextFor(ev, year) {
    if (ev.repeat !== 'yearly-lunar' || !ev.lunar) return '';
    return L.lunarLabel(ev.lunar);
  }

  /* ---------------- 렌더 ---------------- */
  var el = {};

  function init() {
    el.memberFilter = document.getElementById('memberFilter');
    el.calTitle = document.getElementById('calTitle');
    el.calSub = document.getElementById('calSub');
    el.grid = document.getElementById('grid');
    el.legend = document.getElementById('legend');
    el.dayCard = document.getElementById('dayCard');
    el.daySheetModal = document.getElementById('daySheetModal');
    el.daySheetTitle = document.getElementById('daySheetTitle');
    el.daySheetSub = document.getElementById('daySheetSub');
    el.daySheetStats = document.getElementById('daySheetStats');
    el.daySheetHint = document.getElementById('daySheetHint');
    el.daySheetAddBtn = document.getElementById('daySheetAddBtn');
    el.daySheetList = document.getElementById('daySheetList');
    el.daySheetClose = document.getElementById('daySheetClose');
    el.ddayList = document.getElementById('ddayList');
    el.modal = document.getElementById('modal');
    el.form = document.getElementById('eventForm');
    el.fTitle = document.getElementById('fTitle');
    el.fDate = document.getElementById('fDate');
    el.fEndDate = document.getElementById('fEndDate');
    el.dateRangeHint = document.getElementById('dateRangeHint');
    el.voiceBtn = document.getElementById('eventVoiceBtn');
    el.voiceStatus = document.getElementById('eventVoiceStatus');
    el.pasteBtn = document.getElementById('pasteBtn');
    el.pasteBox = document.getElementById('pasteBox');
    el.pasteArea = document.getElementById('pasteArea');
    el.pasteRunBtn = document.getElementById('pasteRunBtn');
    el.pasteClipBtn = document.getElementById('pasteClipBtn');
    el.pasteClearBtn = document.getElementById('pasteClearBtn');
    el.pasteStatus = document.getElementById('pasteStatus');
    el.pasteCands = document.getElementById('pasteCands');
    el.fAllDay = document.getElementById('fAllDay');
    el.fTime = document.getElementById('fTime');
    el.fMembers = document.getElementById('fMembers');
    el.fMembersAll = document.getElementById('fMembersAll');
    el.fMembersCount = document.getElementById('fMembersCount');
    el.fCategories = document.getElementById('fCategories');
    el.fMemo = document.getElementById('fMemo');
    el.fRepeat = document.getElementById('fRepeat');
    el.fRemind = document.getElementById('fRemind');
    el.fWeekdays = document.getElementById('fWeekdays');
    el.fWeekdayField = document.getElementById('fWeekdayField');
    el.fChecklist = document.getElementById('fChecklist');
    el.fCheckItem = document.getElementById('fCheckItem');
    el.fCheckAddBtn = document.getElementById('fCheckAddBtn');
    el.kakaoTodayBtn = document.getElementById('kakaoTodayBtn');
    el.kakaoWeekBtn = document.getElementById('kakaoWeekBtn');
    el.kakaoPreview = document.getElementById('kakaoPreview');
    el.photoCard = document.getElementById('photoCard');
    el.remindBanner = document.getElementById('remindBanner');
    el.notifyBtn = document.getElementById('notifyBtn');
    el.dateLunarHint = document.getElementById('dateLunarHint');
    el.repeatHint = document.getElementById('repeatHint');
    el.formError = document.getElementById('formError');
    el.modalTitle = document.getElementById('modalTitle');
    el.deleteBtn = document.getElementById('deleteBtn');
    el.saveBtn = document.getElementById('saveBtn');

    el.statusPill = document.getElementById('statusPill');
    if (el.statusPill && !el.statusPill.dataset.boundTap) {
      el.statusPill.dataset.boundTap = '1';
      el.statusPill.style.cursor = 'pointer';
      el.statusPill.title = '연결 상태 보기';
      el.statusPill.addEventListener('click', function () {
        if (window.StoreMode && window.StoreMode.isStoreActive()) return;
        if (window.ExtraMode && typeof window.ExtraMode.isActive === 'function' && window.ExtraMode.isActive()) return;
        var msg = (lastStatus && lastStatus.text) ? lastStatus.text : '연결 상태 정보가 아직 없어요.';
        var codeNow = (state && state.roomCode) ? state.roomCode : '없음';
        var uidNow = (window.FamilyCloud && typeof window.FamilyCloud.myUid === 'function') ? (window.FamilyCloud.myUid() || '미로그인') : '';
        if (confirm('현재 상태: ' + msg + '\n가족 코드: ' + codeNow + (uidNow ? '\n기기 ID: ' + uidNow.slice(0, 8) + '…' : '') + '\n\n[확인]을 누르면 지금 다시 연결을 시도합니다.')) {
          if (state && state.roomCode) connectToRoom(state.roomCode);
          else if (typeof openRoomModal === 'function') openRoomModal();
        }
      });
    }
    el.appBarNote = document.getElementById('appBarNote');
    el.roomModal = document.getElementById('roomModal');
    el.roomForm = document.getElementById('roomForm');
    el.roomCode = document.getElementById('roomCode');
    el.roomError = document.getElementById('roomError');
    el.roomClose = document.getElementById('roomClose');
    el.roomCodeNow = document.getElementById('roomCodeNow');

    el.profileBtn = document.getElementById('profileBtn');
    el.profileName = document.getElementById('profileName');
    el.profileRole = document.getElementById('profileRole');
    el.profileDot = document.getElementById('profileDot');
    el.approveBtn = document.getElementById('approveBtn');
    el.approveCount = document.getElementById('approveCount');
    el.myRequestsCard = document.getElementById('myRequestsCard');
    el.myRequestsList = document.getElementById('myRequestsList');
    el.myRequestsHint = document.getElementById('myRequestsHint');
    el.addBtn = document.getElementById('addBtn');
    el.resetBtn = document.getElementById('resetBtn');
    el.codeBtn = document.getElementById('codeBtn');
    el.requestNote = document.getElementById('requestNote');
    el.profileModal = document.getElementById('profileModal');
    el.profileList = document.getElementById('profileList');
    el.profileClose = document.getElementById('profileClose');
    el.profileAdminActions = document.getElementById('profileAdminActions');
    el.myInfoBox = document.getElementById('myInfoBox');
    el.myInfoName = document.getElementById('myInfoName');
    el.myInfoRole = document.getElementById('myInfoRole');
    el.myNameInput = document.getElementById('myNameInput');
    el.myTelInput = document.getElementById('myTelInput');
    el.myTelHint = document.getElementById('myTelHint');
    el.myInfoNote = document.getElementById('myInfoNote');
    el.myInfoSaveBtn = document.getElementById('myInfoSaveBtn');
    el.notifyBox = document.getElementById('notifyBox');
    el.notifyWho = document.getElementById('notifyWho');
    el.notifyState = document.getElementById('notifyState');
    el.notifyScope = document.getElementById('notifyScope');
    el.notifyNewEvent = document.getElementById('notifyNewEvent');
    el.notifyNote = document.getElementById('notifyNote');
    el.notifyExactBtn = document.getElementById('notifyExactBtn');
    el.newMemberTel = document.getElementById('newMemberTel');
    el.adminBtn = document.getElementById('adminBtn');
    el.pinModal = document.getElementById('pinModal');
    el.pinForm = document.getElementById('pinForm');
    el.pinTitle = document.getElementById('pinTitle');
    el.pinInput = document.getElementById('pinInput');
    el.pinConfirmField = document.getElementById('pinConfirmField');
    el.pinConfirmInput = document.getElementById('pinConfirmInput');
    el.pinHint = document.getElementById('pinHint');
    el.pinError = document.getElementById('pinError');
    el.pinClose = document.getElementById('pinClose');
    el.adminModal = document.getElementById('adminModal');
    el.adminClose = document.getElementById('adminClose');
    el.adminMemberList = document.getElementById('adminMemberList');
    el.adminMembersBlock = document.getElementById('adminMembersBlock');
    el.adminRemovedBlock = document.getElementById('adminRemovedBlock');
    el.adminRemovedList = document.getElementById('adminRemovedList');
    el.adminJoinBlock = document.getElementById('adminJoinBlock');
    el.adminJoinList = document.getElementById('adminJoinList');
    el.roomJoinBox = document.getElementById('roomJoinBox');
    el.roomJoinName = document.getElementById('roomJoinName');
    el.roomJoinBtn = document.getElementById('roomJoinBtn');
    el.roomJoinMsg = document.getElementById('roomJoinMsg');
    el.roomPendingHint = document.getElementById('roomPendingHint');
    el.familyBlockedModal = document.getElementById('familyBlockedModal');
    el.familyBlockedMsg = document.getElementById('familyBlockedMsg');
    el.newMemberName = document.getElementById('newMemberName');
    el.newMemberColors = document.getElementById('newMemberColors');
    el.memberError = document.getElementById('memberError');
    el.addMemberBtn = document.getElementById('addMemberBtn');
    el.pinTargets = document.getElementById('pinTargets');
    el.newPin = document.getElementById('newPin');
    el.newPin2 = document.getElementById('newPin2');
    el.pinChangeError = document.getElementById('pinChangeError');
    el.changePinBtn = document.getElementById('changePinBtn');
    el.approveModal = document.getElementById('approveModal');
    el.approveClose = document.getElementById('approveClose');
    el.approveModalCount = document.getElementById('approveModalCount');
    el.reqCards = document.getElementById('reqCards');
    el.detailModal = document.getElementById('detailModal');
    el.detailTitle = document.getElementById('detailTitle');
    el.detailBody = document.getElementById('detailBody');
    el.detailClose = document.getElementById('detailClose');
    el.detailOk = document.getElementById('detailOk');
    el.toast = document.getElementById('toast');

    var today = new Date();
    state.year = today.getFullYear();
    state.month = today.getMonth();
    state.selected = todayISO();

    bind();
    bindRoles();
    renderAll();
    initAccount();
    startCloud();
    updateNotifyBtn();
    setInterval(checkReminders, 30000);
    setTimeout(checkReminders, 4000);
    setTimeout(syncAndroidAlarms, 4000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { checkReminders(); syncAndroidAlarms(); }
    });
  }

  /* ---------------- 공유 연결 ---------------- */
  var lastStatus = { kind: 'pending', text: '' };
  var autoRecovered = false;

  function setStatus(kind, text) {
    lastStatus = { kind: kind, text: text };
    paintStatus();
    /* 로그인·로그아웃 직후에는 토큰 교체 순간에 한 번씩 권한 오류가 날 수 있어
       화면에 오류를 띄우기 전에 한 번만 연결을 다시 시도합니다. */
    if (kind === 'error') scheduleAutoRecover();
  }

  function scheduleAutoRecover() {
    if (autoRecovered) return;
    autoRecovered = true;
    setTimeout(function () {
      var code = window.FamilyCloud ? FamilyCloud.storedCode() : '';
      if (!code) return;
      try { FamilyCloud.stop(); } catch (e) { /* 무시 */ }
      cloudReady = false;
      connectToRoom(code);
    }, 2500);
  }

  /* 매장 캘린더 화면이 떠 있을 때는 가족 상태 문구가 위에 덮이지 않게 합니다. */
  function paintStatus() {
    if (!el.statusPill) return;
    if (window.StoreMode && window.StoreMode.isStoreActive()) return;
    if (window.ExtraMode && typeof window.ExtraMode.isActive === 'function' && window.ExtraMode.isActive()) return;
    var kind = lastStatus.kind, text = lastStatus.text;
    el.statusPill.textContent = kind === 'online' ? '공유 중' : (kind === 'offline' ? '오프라인' : (kind === 'error' ? '오류' : '연결 중'));
    el.statusPill.className = 'app-bar__status app-bar__status--' + (kind || 'pending');
    /* 평소에는 문구를 감추고, 연결이 안 될 때만 위에 보여 줍니다. */
    if (el.appBarNote) {
      el.appBarNote.textContent = text || '';
      el.appBarNote.hidden = (kind === 'online');
    }
    var line = document.getElementById('setStatusLine');
    if (line) line.textContent = text ? '지금 연결: ' + text : '';
  }

  function errorHint(err) {
    if (!err) return '알 수 없는 오류';
    if (err.code === 'permission-denied') return '가족 방에 쓸 권한이 없어요. 가족 코드를 확인해 주세요.';
    if (err.code === 'unavailable') return '인터넷 연결을 확인해 주세요.';
    if (err.code === 'auth/operation-not-allowed') return '익명 로그인이 꺼져 있어요.';
    if (err.code === 'auth/network-request-failed') return '인터넷 연결을 확인해 주세요.';
    if (err.message === 'firebase-sdk-missing') return '공유 모듈을 불러오지 못했어요.';
    if (err.message === 'empty-code') return '가족 코드를 입력해 주세요.';
    if (err.code) return err.code;
    return err.message || '알 수 없는 오류';
  }

  function seedPayloads() {
    return seedSamples().map(function (ev) {
      return {
        title: ev.title, date: ev.date, time: ev.time, members: ev.members,
        category: ev.category, memo: ev.memo, repeat: ev.repeat, lunar: ev.lunar
      };
    });
  }

  function startCloud() {
    if (!window.FamilyCloud) {
      setStatus('error', '공유 모듈을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
      return;
    }
    /* 알바생(매장 전용) 기기는 가족 방을 열지 않습니다. */
    if (window.StoreMode && window.StoreMode.shouldSkipFamily()) {
      setStatus('pending', '매장 캘린더 전용 모드예요');
      return;
    }
    var code = FamilyCloud.initialCode();
    if (!code) {
      setStatus('pending', '가족 코드를 넣으면 가족과 함께 쓰는 달력이 열려요');
      /* 매장 초대 링크로 들어온 기기(알바생·사장님)에서는 가족 코드 창을 띄우지 않습니다. */
      var storeParam = '';
      try { storeParam = new URLSearchParams(location.search).get('store') || ''; } catch (e) { storeParam = ''; }
      var storeActive = !!(window.StoreMode && typeof window.StoreMode.isStoreActive === 'function' && window.StoreMode.isStoreActive());
      if (!storeParam && !storeActive) openRoomModal(true);
      return;
    }
    connectToRoom(code);
  }

  function connectToRoom(code) {
    setStatus('pending', '가족 방에 연결하는 중…');
    cloudReady = false;
    var attempt = 0;

    function run() {
      attempt++;
      FamilyCloud.start(code, {
        seedEvents: seedPayloads,
        confirmCreate: function (clean) {
          return window.confirm('"' + clean + '" 코드의 가족 방을 찾지 못했어요.\n\n새로 만들면 지금까지의 일정은 보이지 않아요.\n코드를 다시 확인하고, 처음 만드는 방이 맞으면 확인을 눌러 주세요.');
        },
        onData: function (list) { applyEventData(list); },
        onPhotos: function (list) { photos = list; renderAlbum(); },
        onRoom: function (info) { applyRoomMeta(info); },
        onJoins: function (list) { state.joins = Array.isArray(list) ? list : []; renderAdminJoins(); },
        onGate: function (res) { handleGate(res); },
        onMoved: function () {
          setStatus('pending', '이 방은 새 코드로 옮겨졌어요');
          openRoomModal(false);
          showRoomError('이 방 주소는 더 이상 쓰지 않아요. 새 가족 코드를 넣어 주세요.');
        },
        onRoomError: function (err) {
          var code = (err && err.code) || '';
          /* 일정이 이미 흐르고 있으면 방 문서 읽기는 잠시 뒤 저절로 풀립니다
             (로그인·로그아웃 직후 토큰 교체 순간). 화면을 오류로 덮지 않습니다. */
          if (code === 'permission-denied') {
            if (!cloudReady) setStatus('error', '가족 방 설정을 읽을 수 없어요 (가족 코드를 확인해 주세요)');
            return;
          }
          if (code) setStatus('error', '가족 방 설정을 읽지 못했어요 · ' + code);
        },
        onStatus: function (s) { setStatus(s.kind, s.text); }
      }).then(function (info) {
        if (info && info.moved) return;
        if (info && info.created) {
          cloudReady = true;
          setStatus('online', '새 가족 방을 만들었어요 · 이 코드를 가족에게 알려 주세요');
          clearTimeout(connectTimer);
        }
        if (info && info.claimed) {
          cloudReady = true;
          setStatus('online', '이 기기로 가족 방 관리를 시작해요');
          clearTimeout(connectTimer);
        }
        if (info && info.joined === false) { clearTimeout(connectTimer); return; }
        updateRoomInfo();
        closeRoomModal();
      }).catch(function (err) {
        if (err && err.message === 'cancelled') {
          clearTimeout(connectTimer);
          setStatus('pending', '가족 코드를 다시 확인해 주세요');
          openRoomModal(false);
          showRoomError('새 방을 만들지 않았어요. 가족 코드를 다시 확인해 주세요.');
          return;
        }
        setStatus('error', '연결하지 못했어요 · ' + errorHint(err));
        openRoomModal(false);
        showRoomError('연결하지 못했어요 · ' + errorHint(err));
      });
    }

    run();
    scheduleRetry();

    function scheduleRetry() {
      clearTimeout(connectTimer);
      connectTimer = setTimeout(function () {
        if (cloudReady || attempt >= 3) return;
        setStatus('pending', '연결이 느려요 · 다시 연결하는 중…');
        FamilyCloud.stop();
        run();
        scheduleRetry();
      }, 15000);
    }
  }

  function updateRoomInfo() {
    if (!el.roomCodeNow) return;
    var code = FamilyCloud.storedCode();
    el.roomCodeNow.textContent = code ? '가족 코드: ' + code : '';
    el.roomCodeNow.hidden = !code;
  }

  function setRoomSubmitLabel(label) {
    var btn = el.roomForm ? el.roomForm.querySelector('button[type="submit"]') : null;
    if (btn) btn.textContent = label || '시작하기';
  }

  function openRoomModal(firstRun) {
    el.roomError.hidden = true;
    el.roomError.textContent = '';
    el.roomCode.value = FamilyCloud.initialCode() || '';
    el.roomClose.hidden = !!firstRun;
    if (el.roomJoinBox) el.roomJoinBox.hidden = true;
    setRoomSubmitLabel('시작하기');
    el.roomModal.hidden = false;
    try { el.roomCode.focus(); } catch (e) { /* 무시 */ }
  }

  function closeRoomModal() {
    if (el.roomModal) el.roomModal.hidden = true;
    if (el.roomJoinBox) el.roomJoinBox.hidden = true;
    setRoomSubmitLabel('시작하기');
  }

  function showRoomError(msg) {
    el.roomError.textContent = msg;
    el.roomError.hidden = false;
  }

  /* ---------------- 기기 입장 게이트 ----------------
     방은 이제 "승인된 기기"만 열립니다. 승인이 없으면 이 화면에서 입장 요청을 보냅니다. */
  function handleGate(res) {
    var st = (res && res.state) || '';
    state.gateState = st;
    if (st === 'member') {
      cloudReady = true;
      if (el.roomJoinBox) el.roomJoinBox.hidden = true;
      updateRoomInfo();
      closeRoomModal();
      setStatus('online', '공유 중');
      toast('승인되었어요 · 가족 달력이 열렸습니다');
      renderAll();
      return;
    }
    if (st !== 'need-request' && st !== 'pending' && st !== 'rejected') return;
    showJoinGate(st);
  }

  function showJoinGate(st) {
    if (!el.roomJoinBox) return;
    var code = (window.FamilyCloud && FamilyCloud.currentCode) ? FamilyCloud.currentCode() : '';
    if (!code) code = el.roomCode ? FamilyCloud.normalizeCode(el.roomCode.value) : '';
    el.roomCode.value = code;
    el.roomJoinBox.hidden = false;
    var pending = st === 'pending';
    el.roomJoinName.hidden = pending;
    el.roomJoinBtn.hidden = pending;
    el.roomPendingHint.hidden = !pending;
    el.roomJoinMsg.hidden = true;
    setRoomSubmitLabel(pending ? '승인 상태 다시 확인' : '입장 요청 보내기');
    if (pending) {
      setStatus('pending', '관리자 승인을 기다리는 중이에요');
    } else {
      var saved = '';
      try { saved = localStorage.getItem('family-calendar.join.name.v1') || ''; } catch (e) { saved = ''; }
      if (saved && el.roomJoinName) el.roomJoinName.value = saved;
      setStatus('pending', st === 'rejected' ? '관리자가 입장을 거절했어요 · 다시 요청할 수 있어요' : '이 기기는 아직 승인되지 않았어요');
    }
    el.roomModal.hidden = false;
  }

  function submitFamilyJoin() {
    if (!el.roomJoinName) return;
    var name = String(el.roomJoinName.value || '').trim().slice(0, 20);
    if (!name) {
      el.roomJoinMsg.textContent = '이 기기를 부를 이름을 넣어 주세요 (예: 엄마 폰).';
      el.roomJoinMsg.hidden = false;
      return;
    }
    el.roomJoinBtn.disabled = true;
    el.roomJoinMsg.hidden = true;
    FamilyCloud.requestJoin({ name: name, device: (navigator.userAgent || '').slice(0, 60) }).then(function () {
      try { localStorage.setItem('family-calendar.join.name.v1', name); } catch (e) { /* 무시 */ }
      showJoinGate('pending');
      toast('입장 요청을 보냈어요 · 관리자(아빠·엄마) 승인을 기다려 주세요');
    }).catch(function (err) {
      el.roomJoinMsg.textContent = '요청을 보내지 못했어요 · ' + errorHint(err);
      el.roomJoinMsg.hidden = false;
    }).then(function () {
      el.roomJoinBtn.disabled = false;
    });
  }

  var lastJoinAlertKey = '';
  /* 관리자 설정 — 기기 입장 요청 목록 */
  function renderAdminJoins() {
    if (!el.adminJoinList) return;
    var serverAdmin = !!(window.FamilyCloud && FamilyCloud.isAdmin && FamilyCloud.isAdmin());
    var list = serverAdmin ? (state.joins || []).filter(function (j) { return j && j.status === 'pending'; }) : [];
    if (el.adminJoinBlock) el.adminJoinBlock.hidden = !list.length;
    if (list.length) {
      var key = list.map(function (j) { return j.uid; }).join(',');
      if (key !== lastJoinAlertKey) {
        lastJoinAlertKey = key;
        var names = list.map(function (j) { return j.name || '새 기기'; }).join(', ');
        toast('📱 ' + names + ' 입장 요청 · ⚙️ 설정 → 🔑 관리자 설정에서 승인해 주세요');
      }
    } else {
      lastJoinAlertKey = '';
    }
    el.adminJoinList.innerHTML = '';
    list.forEach(function (j) {
      var li = document.createElement('li');
      li.className = 'admin-member';
      var label = document.createElement('span');
      label.className = 'admin-member__name';
      label.textContent = '📱 ' + (j.name || '기기');
      li.appendChild(label);
      var ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn-ghost btn-small';
      ok.textContent = '승인';
      ok.addEventListener('click', function () { decideFamilyJoin(j, false); });
      li.appendChild(ok);
      var okAdmin = document.createElement('button');
      okAdmin.type = 'button';
      okAdmin.className = 'btn-ghost btn-small';
      okAdmin.textContent = '관리자로 승인';
      okAdmin.addEventListener('click', function () { decideFamilyJoin(j, true); });
      li.appendChild(okAdmin);
      var no = document.createElement('button');
      no.type = 'button';
      no.className = 'admin-member__out';
      no.textContent = '거절';
      no.addEventListener('click', function () { FamilyCloud.rejectJoin(j.uid); });
      li.appendChild(no);
      el.adminJoinList.appendChild(li);
    });
  }

  function decideFamilyJoin(j, asAdmin) {
    FamilyCloud.approveJoin(j.uid, { admin: !!asAdmin }).then(function () {
      toast(asAdmin ? '관리자 권한으로 승인했어요' : '승인했어요 · 그 기기에서 바로 열립니다');
      renderAdminJoins();
    }).catch(function (err) {
      toast('승인하지 못했어요 · ' + errorHint(err));
    });
  }

  function submitRoomCode(e) {
    if (e) e.preventDefault();
    var code = FamilyCloud.normalizeCode(el.roomCode.value);
    if (!code) { showRoomError('가족 코드를 입력해 주세요.'); return; }
    var currentCode = (window.FamilyCloud && FamilyCloud.currentCode) ? FamilyCloud.normalizeCode(FamilyCloud.currentCode()) : '';
    if (el.roomJoinBox && !el.roomJoinBox.hidden && (!currentCode || code === currentCode)) {
      if (state.gateState === 'need-request' || state.gateState === 'rejected') {
        submitFamilyJoin();
        return;
      }
      if (state.gateState === 'pending') {
        toast('관리자 승인을 기다리는 중이에요');
        return;
      }
    }
    FamilyCloud.stop();
    events = [];
    resetEventWatch();
    state.selected = todayISO();
    renderAll();
    connectToRoom(code);
  }

  function bindMonthSwipe(target, onShift) {
    if (!target || typeof onShift !== 'function') return;
    var sx = 0, sy = 0, st = 0;
    target.addEventListener('touchstart', function (e) {
      if (!e.touches || e.touches.length !== 1) { st = 0; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
    }, { passive: true });
    target.addEventListener('touchend', function (e) {
      if (!st || !e.changedTouches || !e.changedTouches.length) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - sx, dy = t.clientY - sy, dt = Date.now() - st;
      st = 0;
      if (dt > 700 || Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      onShift(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  function bind() {
    document.getElementById('prevMonth').addEventListener('click', function () { shiftMonth(-1); });
    document.getElementById('nextMonth').addEventListener('click', function () { shiftMonth(1); });
    document.getElementById('todayBtn').addEventListener('click', goToday);
    bindMonthSwipe(el.grid, shiftMonth);
    document.getElementById('addBtn').addEventListener('click', function () {
      if (!state.profile) { openProfileModal(); return; }
      openModal(null, state.selected);
    });
    document.getElementById('resetBtn').addEventListener('click', deleteSamples);
    document.getElementById('inviteBtn').addEventListener('click', copyInviteLink);
    document.getElementById('codeBtn').addEventListener('click', function () { openRoomModal(false); });
    el.roomForm.addEventListener('submit', submitRoomCode);
    el.roomClose.addEventListener('click', closeRoomModal);
    if (el.roomJoinBtn) el.roomJoinBtn.addEventListener('click', submitFamilyJoin);
    var roomBackdrop = el.roomModal.querySelector('[data-close]');
    if (roomBackdrop) roomBackdrop.addEventListener('click', function () { if (!el.roomClose.hidden) closeRoomModal(); });
    document.getElementById('modalClose').addEventListener('click', closeModal);
    /* ⚙️ 설정 — 초대·관리·안내를 한 곳에서 */
    var gear = document.getElementById('gearBtn');
    if (gear) gear.addEventListener('click', function () { openSettingsForView(); });
    var setClose = document.getElementById('settingsClose');
    if (setClose) setClose.addEventListener('click', closeSettingsModal);
    var setModal = document.getElementById('settingsModal');
    if (setModal) {
      var setBackdrop = setModal.querySelector('[data-close]');
      if (setBackdrop) setBackdrop.addEventListener('click', closeSettingsModal);
    }
    var setProfileRow = document.getElementById('setProfileRow');
    if (setProfileRow) setProfileRow.addEventListener('click', function () {
      closeSettingsModal();
      openProfileModal();
    });
    var setAdminRow = document.getElementById('setAdminRow');
    if (setAdminRow) setAdminRow.addEventListener('click', function () {
      if (!canManage()) { toast('아빠·엄마만 열 수 있어요'); return; }
      closeSettingsModal();
      openAdminModal();
    });
    /* ✏️ 가족 이름·번호 바꾸기 — 관리자 설정의 구성원 목록으로 바로 */
    var setMembersRow = document.getElementById('setMembersRow');
    if (setMembersRow) setMembersRow.addEventListener('click', function () {
      if (!canManage()) { toast('아빠·엄마만 바꿀 수 있어요'); return; }
      closeSettingsModal();
      openAdminModal(true);
    });
    /* 🏥 국가 검진·예방접종 */
    var healthBtn = document.getElementById('healthBtn');
    if (healthBtn) healthBtn.addEventListener('click', function () { openHealth('event'); });
    var setHealthRow = document.getElementById('setHealthRow');
    if (setHealthRow) setHealthRow.addEventListener('click', function () {
      closeSettingsModal();
      openHealth('settings');
    });
    /* 일정 추가 — [+ 더보기] 접기/펼치기 */
    var moreBtn = document.getElementById('eventMoreBtn');
    if (moreBtn) moreBtn.addEventListener('click', function () { toggleMore(!state.moreOpen); });
    ['fEndDate'].forEach(function (id) {
      var input = document.getElementById(id);
      if (input) input.addEventListener('change', updateMoreBadges);
    });
    if (el.fMemo) el.fMemo.addEventListener('input', updateMoreBadges);
    if (el.fCategories) el.fCategories.addEventListener('click', function () { setTimeout(updateMoreBadges, 0); });
    /* 다가오는 일정 더 보기 */
    var ddayMore = document.getElementById('ddayMoreBtn');
    if (ddayMore) ddayMore.addEventListener('click', function () {
      state.ddayOpen = !state.ddayOpen;
      renderDDay();
    });
    var backdrop = el.modal.querySelector('[data-close]');
    if (backdrop) backdrop.addEventListener('click', closeModal);
    el.form.addEventListener('submit', function (e) { e.preventDefault(); saveEvent(); });
    el.deleteBtn.addEventListener('click', deleteEvent);
    el.fAllDay.addEventListener('change', syncTimeField);
    el.fDate.addEventListener('change', updateDateHint);
    if (el.fEndDate) el.fEndDate.addEventListener('change', updateDateHint);
    if (window.CalendarVoice && el.voiceBtn) {
      CalendarVoice.attach(el.voiceBtn, {
        statusEl: el.voiceStatus,
        idleLabel: '🎤 말로 입력하기',
        onText: applyVoiceEvent
      });
    }
    if (window.CalendarPaste && el.pasteBtn) {
      pasteUI = CalendarPaste.attachUI({
        entry: el.pasteBtn,
        box: el.pasteBox,
        area: el.pasteArea,
        runBtn: el.pasteRunBtn,
        clipBtn: el.pasteClipBtn,
        clearBtn: el.pasteClearBtn,
        statusEl: el.pasteStatus,
        tryClipboard: true,
        getCtx: function () {
          return {
            members: MEMBERS.map(function (m) { return { id: m.id, name: m.name }; }),
            today: todayISO()
          };
        },
        memberName: function (id) { var m = memberById(id); return m ? m.name : ''; },
        onFill: applyPastedEvent
      });
    }
    el.fRepeat.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-repeat]');
      if (!btn) return;
      setRepeat(btn.getAttribute('data-repeat'));
    });
    if (el.fRemind) {
      el.fRemind.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-remind]');
        if (!btn) return;
        setRemind(btn.getAttribute('data-remind'));
      });
    }
    if (el.fCheckAddBtn) el.fCheckAddBtn.addEventListener('click', addChecklistItem);
    if (el.fCheckItem) {
      el.fCheckItem.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); }
      });
    }
    if (el.kakaoTodayBtn) el.kakaoTodayBtn.addEventListener('click', function () { copyKakaoSummary('today'); });
    if (el.kakaoWeekBtn) el.kakaoWeekBtn.addEventListener('click', function () { copyKakaoSummary('week'); });
    if (el.notifyBtn) el.notifyBtn.addEventListener('click', askNotify);
    if (el.fMembersAll) el.fMembersAll.addEventListener('click', toggleAllMembers);
    if (el.notifyScope) {
      Array.prototype.forEach.call(el.notifyScope.children, function (b) {
        b.addEventListener('click', function () { setMyNotifyPrefs({ scope: b.getAttribute('data-scope') }); });
      });
    }
    if (el.notifyNewEvent) {
      el.notifyNewEvent.addEventListener('change', function () { setMyNotifyPrefs({ newEvent: el.notifyNewEvent.checked }); });
    }
    if (el.notifyExactBtn) {
      el.notifyExactBtn.addEventListener('click', function () {
        try {
          if (window.AndroidApp && typeof window.AndroidApp.openExactAlarmSettings === 'function') {
            window.AndroidApp.openExactAlarmSettings();
          }
        } catch (e) { /* 무시 */ }
      });
    }
    if (el.daySheetClose) el.daySheetClose.addEventListener('click', closeDaySheet);
    if (el.daySheetModal) {
      var daySheetBackdrop = el.daySheetModal.querySelector('[data-close]');
      if (daySheetBackdrop) daySheetBackdrop.addEventListener('click', closeDaySheet);
    }
    if (el.daySheetAddBtn) el.daySheetAddBtn.addEventListener('click', addEventFromSheet);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.daySheetModal && !el.daySheetModal.hidden) closeDaySheet();
      var st = document.getElementById('settingsModal');
      if (e.key === 'Escape' && st && !st.hidden) closeSettingsModal();
      if (e.key === 'Escape' && !el.modal.hidden) closeModal();
    });
  }

  /* ---------------- ⚙️ 설정 시트 ---------------- */
  function openSettingsForView() {
    if (window.StoreMode && typeof window.StoreMode.isStoreActive === 'function' && window.StoreMode.isStoreActive()) {
      if (window.StoreMode.openHub) { window.StoreMode.openHub(); return; }
    }
    if (window.ExtraMode && typeof window.ExtraMode.isActive === 'function' && window.ExtraMode.isActive()) {
      var calvBtn = document.getElementById('calvSettingsBtn');
      if (calvBtn) { calvBtn.click(); return; }
    }
    openSettingsModal();
  }

  function openSettingsModal() {
    var modal = document.getElementById('settingsModal');
    if (!modal) return;
    var setAdminRow = document.getElementById('setAdminRow');
    if (setAdminRow) setAdminRow.hidden = !canManage();
    var setMembersRow = document.getElementById('setMembersRow');
    if (setMembersRow) setMembersRow.hidden = !canManage();
    paintStatus();
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeSettingsModal() {
    var modal = document.getElementById('settingsModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  /* 일정 추가 — 부가 항목 접기/펼치기 */
  function toggleMore(open) {
    state.moreOpen = !!open;
    var btn = document.getElementById('eventMoreBtn');
    var box = document.getElementById('eventExtra');
    if (btn) {
      btn.setAttribute('aria-expanded', state.moreOpen ? 'true' : 'false');
      var label = btn.querySelector('.more-toggle__label');
      if (label) label.textContent = state.moreOpen ? '− 접기' : '＋ 더보기';
    }
    if (box) box.hidden = !state.moreOpen;
    updateMoreBadges();
  }

  /* 접힌 상태에서도 무엇이 들어 있는지 배지로 보여 줍니다. */
  function updateMoreBadges() {
    var wrap = document.getElementById('eventMoreBadges');
    if (!wrap) return;
    var list = [];
    if (el.fEndDate && el.fEndDate.value && el.fDate.value && el.fEndDate.value > el.fDate.value) {
      list.push('📆 기간');
    }
    var catOn = el.fCategories ? el.fCategories.querySelector('.pick.is-on') : null;
    if (catOn && catOn.getAttribute('data-id') !== 'etc') {
      list.push(catOn.textContent.trim());
    }
    if (state.repeat && state.repeat !== 'none') list.push('🔁 ' + repeatLabel({ repeat: state.repeat, weekday: state.weekday, date: el.fDate.value }));
    if (state.remind && state.remind !== 'none') list.push('🔔 ' + remindLabel(Number(state.remind)));
    var checkCount = currentChecklist().length;
    if (checkCount) list.push('☑️ 준비물 ' + checkCount);
    if (el.fMemo && el.fMemo.value.trim()) list.push('📝 메모');

    wrap.innerHTML = '';
    list.forEach(function (text) {
      var span = document.createElement('span');
      span.textContent = text;
      wrap.appendChild(span);
    });
    wrap.hidden = !list.length;
  }

  function shiftMonth(delta) {
    var d = new Date(state.year, state.month + delta, 1);
    if (d.getFullYear() < NAV_MIN_YEAR || d.getFullYear() > NAV_MAX_YEAR) return;
    state.year = d.getFullYear();
    state.month = d.getMonth();
    /* 보던 날짜가 화면 밖으로 나가면 그 달의 1일(이번 달이면 오늘)로 선택을 옮깁니다 */
    var sel = parseISO(state.selected);
    if (sel.getFullYear() !== state.year || sel.getMonth() !== state.month) {
      var now = new Date();
      if (now.getFullYear() === state.year && now.getMonth() === state.month) {
        state.selected = todayISO();
      } else {
        state.selected = iso(state.year, state.month + 1, 1);
      }
    }
    renderAll();
  }

  function goToday() {
    var today = new Date();
    state.year = today.getFullYear();
    state.month = today.getMonth();
    state.selected = todayISO();
    renderAll();
  }

  function selectDate(dateISO, scrollToCalendar) {
    state.selected = dateISO;
    var dt = parseISO(dateISO);
    state.year = dt.getFullYear();
    state.month = dt.getMonth();
    renderAll();
    if (scrollToCalendar) {
      var card = document.querySelector('.calendar');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderAll() {
    if (state.blocked) return;
    renderFilters();
    renderCalendar();
    renderDayCard();
    renderAlbum();
    renderDDay();
    renderRoleUI();
    renderDaySheet();
  }

  function renderFilters() {
    el.memberFilter.innerHTML = '';
    var all = document.createElement('button');
    all.type = 'button';
    all.className = 'chip' + (state.member === 'all' ? ' is-active' : '');
    all.setAttribute('aria-pressed', String(state.member === 'all'));
    if (state.member === 'all') all.style.background = '#4f46e5';
    var dot = document.createElement('span');
    dot.className = 'chip__dot';
    all.appendChild(dot);
    all.appendChild(document.createTextNode('전체'));
    all.addEventListener('click', function () { setMember('all'); });
    el.memberFilter.appendChild(all);

    MEMBERS.forEach(function (mb) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip' + (state.member === mb.id ? ' is-active' : '');
      btn.setAttribute('aria-pressed', String(state.member === mb.id));
      if (state.member === mb.id) btn.style.background = mb.color;
      var av = avatarNode(mb, 18);
      av.classList.add('chip__av');
      btn.appendChild(av);
      btn.appendChild(document.createTextNode(mb.name));
      btn.addEventListener('click', function () { setMember(mb.id); });
      el.memberFilter.appendChild(btn);
    });
  }

  function setMember(id) {
    state.member = id;
    renderAll();
  }

  function renderLegend() {
    el.legend.innerHTML = '';
    CATEGORIES.forEach(function (cat) {
      var wrap = document.createElement('span');
      var i = document.createElement('i');
      i.style.background = cat.color;
      wrap.appendChild(i);
      wrap.appendChild(document.createTextNode(cat.emoji + ' ' + cat.label));
      el.legend.appendChild(wrap);
    });
  }

  function renderCalendar() {
    var y = state.year;
    var m = state.month;
    el.calTitle.textContent = y + '년 ' + (m + 1) + '월';

    var first = new Date(y, m, 1);
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var lunarFirst = L.toLunar(y, m + 1, 1);
    var lunarLast = L.toLunar(y, m + 1, daysInMonth);
    if (lunarFirst && lunarLast) {
      el.calSub.textContent = '음력 ' + lunarShort(lunarFirst) + ' ~ ' + lunarShort(lunarLast);
    } else {
      el.calSub.textContent = '';
    }

    renderLegend();

    el.grid.innerHTML = '';
    var weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
    var start = new Date(y, m, 1 - first.getDay());
    var today = todayISO();

    for (var i = 0; i < weeks * 7; i++) {
      var dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var dateISO = isoOfDate(dt);
      var inMonth = dt.getMonth() === m;
      var wd = dt.getDay();

      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'day';
      if (!inMonth) cell.className += ' day--out';
      if (wd === 0) cell.className += ' day--sun';
      if (wd === 6) cell.className += ' day--sat';

      var holiday = L.holidayName(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
      if (holiday) cell.className += ' day--hol';
      if (dateISO === today) cell.className += ' day--today';
      if (dateISO === state.selected) cell.className += ' day--selected';
      cell.setAttribute('data-date', dateISO);

      var num = document.createElement('span');
      num.className = 'day__num';
      num.textContent = String(dt.getDate());
      cell.appendChild(num);

      if (holiday) {
        var hl = document.createElement('span');
        hl.className = 'day__hol';
        hl.textContent = holiday;
        cell.appendChild(hl);
      }

      /* 달력 칸 안 미리보기 — 최대 2개 제목 + 남은 개수(+N) */
      var dayEvents = eventsOn(dateISO);
      if (dayEvents.length) {
        var evs = document.createElement('span');
        evs.className = 'day__evs';
        dayEvents.slice(0, 2).forEach(function (ev) {
          var c = categoryById(ev.category);
          var row = document.createElement('span');
          row.className = 'day__ev';
          var bar = document.createElement('i');
          bar.style.background = c.color;
          row.appendChild(bar);
          var tx = document.createElement('span');
          /* 칸이 좁아서 '[샘플]' 머리말은 빼고 보여 줍니다. */
          tx.textContent = String(ev.title || '').replace(/^\[샘플\]\s*/, '');
          row.appendChild(tx);
          evs.appendChild(row);
        });
        if (dayEvents.length > 2) {
          var more = document.createElement('span');
          more.className = 'day__more';
          more.textContent = '+' + (dayEvents.length - 2);
          evs.appendChild(more);
        }
        cell.appendChild(evs);
      }

      (function (targetISO, inMonthFlag) {
        cell.addEventListener('click', function () {
          if (!inMonthFlag) {
            var d2 = parseISO(targetISO);
            state.year = d2.getFullYear();
            state.month = d2.getMonth();
            state.selected = targetISO;
            renderAll();
          } else {
            state.selected = targetISO;
            renderCalendar();
            renderDayCard();
            renderAlbum();
          }
          openDaySheet(targetISO);
        });
      })(dateISO, inMonth);

      el.grid.appendChild(cell);
    }
  }

  function lunarShort(lunar) {
    return (lunar.leap ? '윤' : '') + lunar.month + '.' + lunar.day;
  }

  function renderDayCard() {
    var dateISO = state.selected;
    var dt = parseISO(dateISO);
    var y = dt.getFullYear();
    var m = dt.getMonth() + 1;
    var d = dt.getDate();
    var wd = dt.getDay();

    el.dayCard.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'day-head';

    var dateWrap = document.createElement('div');
    dateWrap.className = 'day-head__date';
    var strong = document.createElement('strong');
    strong.textContent = m + '월 ' + d + '일';
    dateWrap.appendChild(strong);
    var dow = document.createElement('span');
    dow.className = 'day-head__dow' + (wd === 0 ? ' is-sun' : wd === 6 ? ' is-sat' : '');
    dow.textContent = '(' + WEEKDAYS[wd] + ')';
    dateWrap.appendChild(dow);
    var lunar = L.toLunar(y, m, d);
    if (lunar) {
      var lunarEl = document.createElement('span');
      lunarEl.className = 'day-head__lunar';
      lunarEl.textContent = L.lunarLabel(lunar);
      dateWrap.appendChild(lunarEl);
    }
    head.appendChild(dateWrap);

    var holiday = L.holidayName(y, m, d);
    var right = document.createElement('div');
    right.className = 'day-head__right';
    if (holiday) {
      var badge = document.createElement('span');
      badge.className = 'day-badge';
      badge.textContent = '🎉 ' + holiday;
      right.appendChild(badge);
    }
    /* 선택한 날에 바로 일정 추가 */
    var quickAdd = document.createElement('button');
    quickAdd.type = 'button';
    quickAdd.className = 'day-card__add';
    quickAdd.textContent = canManage() ? '＋ 추가' : '＋ 등록 요청';
    quickAdd.addEventListener('click', function () {
      if (!state.profile) { openProfileModal(); return; }
      openModal(null, dateISO);
    });
    right.appendChild(quickAdd);
    head.appendChild(right);
    el.dayCard.appendChild(head);

    var dayEvents = eventsOn(dateISO);
    if (!dayEvents.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.innerHTML = '이 날은 일정이 없어요.<br><b>＋ 추가</b>를 누르면 바로 넣을 수 있어요.';
      el.dayCard.appendChild(empty);
      return;
    }

    var list = document.createElement('ul');
    list.className = 'event-list';
    var shown = dayEvents.slice(0, 3);
    shown.forEach(function (ev) {
      list.appendChild(buildEventItem(ev, y));
    });
    el.dayCard.appendChild(list);
    if (dayEvents.length > 3) {
      var moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'fold-more';
      moreBtn.textContent = '일정 ' + dayEvents.length + '개 모두 보기';
      moreBtn.addEventListener('click', function () { openDaySheet(dateISO); });
      el.dayCard.appendChild(moreBtn);
    }
  }

  /* ---------------- 📅 날짜 한눈에 보기 바텀시트 ---------------- */
  /* 종일 → 시간순 정렬 (달력 칸·시트 공통) */
  function sheetSort(a, b) {
    var aa = a.time ? 1 : 0;
    var bb = b.time ? 1 : 0;
    if (aa !== bb) return aa - bb;
    if (a.time && b.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
    return String(a.title).localeCompare(String(b.title), 'ko');
  }

  function sheetEvents(dateISO) {
    return eventsOn(dateISO).slice().sort(sheetSort);
  }

  /* 사용자가 날짜를 직접 눌렀을 때만 열립니다(첫 진입 자동 팝업 없음). */
  function openDaySheet(dateISO) {
    if (!el.daySheetModal) return;
    state.sheetDate = dateISO;
    var list = sheetEvents(dateISO);
    state.sheetOpen = list.length === 1 ? list[0].id : '';
    el.daySheetModal.hidden = false;
    document.body.style.overflow = 'hidden';
    renderDaySheet();
  }

  function closeDaySheet() {
    if (!el.daySheetModal || el.daySheetModal.hidden) return;
    el.daySheetModal.hidden = true;
    document.body.style.overflow = '';
    state.sheetDate = '';
    state.sheetOpen = '';
  }

  function renderDaySheet() {
    if (!el.daySheetModal || el.daySheetModal.hidden) return;
    var dateISO = state.sheetDate || state.selected;
    if (!dateISO) return;
    var dt = parseISO(dateISO);
    var y = dt.getFullYear();
    var m = dt.getMonth() + 1;
    var d = dt.getDate();
    var wd = dt.getDay();

    el.daySheetTitle.textContent = m + '월 ' + d + '일 (' + WEEKDAYS[wd] + ')';
    var subParts = [];
    var lunar = L.toLunar(y, m, d);
    if (lunar) subParts.push(L.lunarLabel(lunar));
    var holiday = L.holidayName(y, m, d);
    if (holiday) subParts.push('🎉 ' + holiday);
    el.daySheetSub.textContent = subParts.join(' · ');

    var list = sheetEvents(dateISO);
    if (el.daySheetStats) {
      var allDay = list.filter(function (ev) { return !ev.time; }).length;
      el.daySheetStats.textContent = list.length
        ? '일정 ' + list.length + '건' + (allDay ? ' · 종일 ' + allDay : '')
        : '일정 없음';
    }
    if (el.daySheetAddBtn) {
      el.daySheetAddBtn.textContent = canManage() ? '＋ 일정 추가' : '＋ 일정 등록 요청';
    }
    if (el.daySheetHint) {
      el.daySheetHint.textContent = list.length > 1
        ? '일정을 누르면 메모·준비물·수정이 펼쳐져요'
        : (list.length ? '메모·준비물·수정을 여기서 바로 할 수 있어요' : '');
    }

    el.daySheetList.innerHTML = '';
    if (!list.length) {
      var empty = document.createElement('li');
      empty.className = 'sheet-empty';
      empty.innerHTML = '이 날은 일정이 없어요.<br><b>' + (canManage() ? '＋ 일정 추가' : '＋ 일정 등록 요청') + '</b>로 넣어 보세요.';
      el.daySheetList.appendChild(empty);
      return;
    }
    list.forEach(function (ev) {
      el.daySheetList.appendChild(buildSheetEvent(ev, y));
    });
  }

  function buildSheetEvent(ev, year) {
    var cat = categoryById(ev.category);
    var open = state.sheetOpen === ev.id;
    var li = document.createElement('li');
    li.className = 'sheet-item' + (open ? ' is-open' : '');

    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'sheet-row';
    row.style.setProperty('--cat', cat.color);
    row.setAttribute('aria-expanded', open ? 'true' : 'false');

    var emoji = document.createElement('span');
    emoji.className = 'sheet-row__emoji';
    emoji.textContent = cat.emoji;
    row.appendChild(emoji);

    var title = document.createElement('span');
    title.className = 'sheet-row__title';
    title.textContent = ev.title;
    row.appendChild(title);

    var time = document.createElement('span');
    time.className = 'sheet-row__time';
    time.textContent = ev.time || '종일';
    row.appendChild(time);

    var members = ev.members || [];
    if (members.length) {
      var badges = document.createElement('span');
      badges.className = 'sheet-row__badges';
      members.slice(0, 2).forEach(function (id) {
        var mb = memberById(id);
        if (!mb) return;
        var b = document.createElement('span');
        b.className = 'sheet-row__badge';
        b.style.setProperty('--mbg', mb.bg);
        b.style.setProperty('--mfg', mb.color);
        b.textContent = mb.name;
        badges.appendChild(b);
      });
      if (members.length > 2) {
        var bm = document.createElement('span');
        bm.className = 'sheet-row__more';
        bm.textContent = '+' + (members.length - 2);
        badges.appendChild(bm);
      }
      row.appendChild(badges);
    }

    var ck = checklistDone(ev);
    if (ck.total) {
      var ckEl = document.createElement('span');
      ckEl.className = 'sheet-row__check' + (ck.done === ck.total ? ' is-done' : '');
      ckEl.textContent = '☑ ' + ck.done + '/' + ck.total;
      row.appendChild(ckEl);
    }

    var chev = document.createElement('span');
    chev.className = 'sheet-row__chev';
    chev.textContent = open ? '▴' : '▾';
    row.appendChild(chev);

    row.addEventListener('click', function () {
      state.sheetOpen = open ? '' : ev.id;
      renderDaySheet();
    });
    li.appendChild(row);

    if (open) li.appendChild(buildSheetEventDetail(ev, year));
    return li;
  }

  function buildSheetEventDetail(ev, year) {
    var box = document.createElement('div');
    box.className = 'sheet-detail';

    var metaBits = [];
    var occ = occurrenceCovering(ev, state.sheetDate || state.selected);
    if (occ && occ.start !== occ.end) metaBits.push('📅 ' + fmtRange(occ.start, occ.end));
    var rep = repeatLabel(ev);
    if (rep) metaBits.push(rep);
    var lunarText = lunarTextFor(ev, year);
    if (lunarText) metaBits.push(lunarText);
    if (ev.remind !== null && ev.remind !== undefined) metaBits.push('🔔 ' + remindLabel(ev.remind));
    if (metaBits.length) {
      var meta = document.createElement('p');
      meta.className = 'sheet-detail__meta';
      meta.textContent = metaBits.join(' · ');
      box.appendChild(meta);
    }

    if (ev.memo) {
      var memo = document.createElement('p');
      memo.className = 'sheet-detail__memo';
      memo.textContent = ev.memo;
      box.appendChild(memo);
    }

    var ck = checklistDone(ev);
    if (ck.total) {
      var ckWrap = document.createElement('div');
      ckWrap.className = 'sheet-detail__check';
      var ckHead = document.createElement('div');
      ckHead.className = 'sheet-detail__checkhead';
      ckHead.textContent = '☑️ 준비물 ' + ck.done + '/' + ck.total;
      ckWrap.appendChild(ckHead);
      ckWrap.appendChild(buildChecklistNode(ev, 'sheet'));
      box.appendChild(ckWrap);
    }

    var actions = document.createElement('div');
    actions.className = 'sheet-detail__actions';
    if (canManage()) {
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-ghost btn-small';
      editBtn.textContent = '✏️ 수정';
      editBtn.addEventListener('click', function () {
        var date = state.sheetDate || state.selected;
        closeDaySheet();
        openModal(ev, date);
      });
      actions.appendChild(editBtn);

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-ghost btn-small btn-danger';
      delBtn.textContent = '🗑 삭제';
      delBtn.addEventListener('click', function () { deleteEventFromSheet(ev); });
      actions.appendChild(delBtn);
    } else {
      var viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'btn-ghost btn-small';
      viewBtn.textContent = '자세히 보기';
      viewBtn.addEventListener('click', function () {
        closeDaySheet();
        openDetail(ev);
      });
      actions.appendChild(viewBtn);
      var note = document.createElement('span');
      note.className = 'sheet-detail__note';
      note.textContent = '수정·삭제는 아빠·엄마만 할 수 있어요';
      actions.appendChild(note);
    }
    box.appendChild(actions);
    return box;
  }

  function deleteEventFromSheet(ev) {
    if (!window.confirm('"' + ev.title + '" 일정을 삭제할까요?\n가족 모두의 달력에서 지워집니다.')) return;
    FamilyCloud.deleteEvent(ev.id).catch(function (err) {
      window.alert('삭제하지 못했어요 · ' + errorHint(err));
    });
  }

  function addEventFromSheet() {
    var date = state.sheetDate || state.selected;
    closeDaySheet();
    if (!state.profile) { openProfileModal(); return; }
    openModal(null, date);
  }

  /* ---------------- 📷 날짜 사진 앨범 ---------------- */
  var REMIND_LABEL = { '0': '정시', '10': '10분 전', '30': '30분 전', '60': '1시간 전', '1440': '전날' };

  function remindLabel(v) {
    if (v === null || v === undefined || v === '') return '';
    return REMIND_LABEL[String(v)] || (v + '분 전');
  }

  function photosOn(dateISO) {
    return photos.filter(function (p) { return p.date === dateISO; });
  }

  function renderAlbum() {
    var card = el.photoCard;
    if (!card) return;
    var dateISO = state.selected;
    var all = photosOn(dateISO);

    /* 사진이 없는 날은 한 줄로 접어 둡니다(달력 아래를 가볍게). */
    if (!all.length) {
      card.innerHTML = '';
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'card-fold__row';
      var t = document.createElement('h2');
      t.textContent = '📷 ' + (parseISO(dateISO).getMonth() + 1) + '월 ' + parseISO(dateISO).getDate() + '일 사진';
      row.appendChild(t);
      var hint = document.createElement('span');
      hint.className = 'hint';
      hint.textContent = '아직 없음';
      row.appendChild(hint);
      var add = document.createElement('span');
      add.className = 'chev';
      add.textContent = '＋ 사진 ›';
      row.appendChild(add);
      row.addEventListener('click', function () { addPhotos(dateISO); });
      card.appendChild(row);
      return;
    }
    var folders = [];
    all.forEach(function (p) { if (folders.indexOf(p.folder) === -1) folders.push(p.folder); });
    folders.sort();
    if (state.photoFolder !== 'all' && folders.indexOf(state.photoFolder) === -1) state.photoFolder = 'all';
    var shown = state.photoFolder === 'all' ? all : all.filter(function (p) { return p.folder === state.photoFolder; });

    card.innerHTML = '';
    var head = document.createElement('div');
    head.className = 'card-head';
    var h2 = document.createElement('h2');
    h2.textContent = '📷 ' + (parseISO(dateISO).getMonth() + 1) + '월 ' + parseISO(dateISO).getDate() + '일 사진';
    head.appendChild(h2);
    var hint = document.createElement('span');
    hint.className = 'card-head__hint';
    hint.textContent = all.length ? all.length + '장 · 폴더 ' + folders.length + '개' : '아직 없음';
    head.appendChild(hint);
    card.appendChild(head);

    var chips = document.createElement('div');
    chips.className = 'folder-chips';
    function chip(label, key) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip chip--sm' + (state.photoFolder === key ? ' is-active' : '');
      b.textContent = label;
      b.addEventListener('click', function () {
        state.photoFolder = key;
        renderAlbum();
      });
      chips.appendChild(b);
    }
    chip('전체', 'all');
    folders.forEach(function (f) { chip(f, f); });
    var addFolder = document.createElement('button');
    addFolder.type = 'button';
    addFolder.className = 'chip chip--sm chip--ghost';
    addFolder.textContent = '＋ 폴더';
    addFolder.addEventListener('click', function () {
      var name = window.prompt('새 폴더 이름 (예: 첫날, 온천, 먹거리)', '');
      if (!name) return;
      state.photoFolder = name.trim().slice(0, 24) || '기본';
      addPhotos(dateISO);
    });
    chips.appendChild(addFolder);
    card.appendChild(chips);

    if (!shown.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.innerHTML = '이 날 사진이 없어요.<br><b>＋ 사진 추가</b>로 폴더별로 모아 두면 가족 모두의 폰에 같이 보여요.';
      card.appendChild(empty);
    } else {
      var grid = document.createElement('div');
      grid.className = 'photo-grid';
      shown.forEach(function (p, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'photo-thumb';
        var img = document.createElement('img');
        img.src = p.photo;
        img.alt = p.folder + ' 사진';
        img.loading = 'lazy';
        b.appendChild(img);
        var tag = document.createElement('span');
        tag.className = 'photo-thumb__folder';
        tag.textContent = p.folder;
        b.appendChild(tag);
        b.addEventListener('click', function () {
          var items = shown.map(function (x) {
            return { id: x.id, src: x.photo, caption: x.folder + ' · ' + x.date };
          });
          CalendarMedia.openLightbox(items, i, {
            onDelete: function (item) {
              FamilyCloud.deletePhoto(item.id).then(function () {
                CalendarMedia.closeLightbox();
                toast('사진을 지웠어요');
              }).catch(function (err) {
                window.alert('지우지 못했어요 · ' + errorHint(err));
              });
            }
          });
        });
        grid.appendChild(b);
      });
      card.appendChild(grid);
    }

    var actions = document.createElement('div');
    actions.className = 'guide-actions';
    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn-primary btn-small';
    addBtn.textContent = '＋ 사진 추가' + (state.photoFolder !== 'all' ? ' (' + state.photoFolder + ')' : '');
    addBtn.addEventListener('click', function () { addPhotos(dateISO); });
    actions.appendChild(addBtn);
    card.appendChild(actions);
    var note = document.createElement('p');
    note.className = 'field-hint';
    note.textContent = '사진은 올릴 때 자동으로 줄여서(긴 변 900px) 저장돼요. 가족 모두의 폰에서 바로 보이고, 눌러서 크게 볼 수 있어요.';
    card.appendChild(note);
  }

  function addPhotos(dateISO) {
    if (!state.profile) { openProfileModal(); return; }
    var folder = state.photoFolder === 'all' ? '기본' : state.photoFolder;
    CalendarMedia.pickFiles(true).then(function (files) {
      if (!files || !files.length) return;
      var picks = files.slice(0, 10);
      toast(picks.length + '장 올리는 중…');
      var chain = Promise.resolve(), ok = 0, fail = 0;
      picks.forEach(function (f) {
        chain = chain.then(function () {
          return CalendarMedia.fit(f, 900, 0.72).then(function (url) {
            return FamilyCloud.savePhoto({ date: dateISO, folder: folder, photoDataUrl: url });
          }).then(function () { ok++; }).catch(function () { fail++; });
        });
      });
      chain.then(function () {
        toast(ok + '장 저장했어요' + (fail ? ' · ' + fail + '장 실패' : ''));
        state.photoFolder = folder;
        renderAlbum();
      });
    });
  }

  /* ---------------- 🔔 일정 미리 알림 ---------------- */
  var firedReminders = {};
  var NOTIFY_KEY = 'family-calendar.notify.v1';
  var notifyPrefs = loadNotifyPrefs();

  function loadNotifyPrefs() {
    try {
      var raw = localStorage.getItem(NOTIFY_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      return obj && typeof obj === 'object' ? obj : {};
    } catch (e) { return {}; }
  }

  function saveNotifyPrefs() {
    try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(notifyPrefs)); } catch (e) { /* 무시 */ }
  }

  /* 이 폰(프로필)의 알림 설정 — 기본은 '내 담당 일정만' + 새 일정 알림 켜짐 */
  function myNotifyPrefs() {
    var p = state.profile ? notifyPrefs[state.profile] : null;
    if (!p || typeof p !== 'object') return { scope: 'mine', newEvent: true };
    return { scope: p.scope === 'all' ? 'all' : 'mine', newEvent: p.newEvent !== false };
  }

  function setMyNotifyPrefs(patch) {
    if (!state.profile) { toast('먼저 이 폰을 쓰는 사람을 골라 주세요'); return; }
    var next = myNotifyPrefs();
    if (patch && patch.scope) next.scope = patch.scope === 'all' ? 'all' : 'mine';
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'newEvent')) next.newEvent = !!patch.newEvent;
    notifyPrefs[state.profile] = next;
    saveNotifyPrefs();
    renderNotifyBox();
    syncAndroidAlarms();
  }

  /* 내가 알림 받을 일정인가 — '전체 일정'이면 모두, 아니면 내가 담당으로 들어간 일정만.
     이 폰을 쓰는 사람(프로필)을 아직 고르지 않았으면 아무 알림도 울리지 않습니다. */
  function notifyCovers(ev) {
    if (!state.profile) return false;
    if (myNotifyPrefs().scope === 'all') return true;
    return (ev.members || []).indexOf(state.profile) !== -1;
  }

  function memberNamesOf(ids) {
    return (ids || []).map(function (id) {
      var m = memberById(id);
      return m ? m.name : '';
    }).filter(Boolean).join('·');
  }

  function reminderAt(ev, occurrenceStart) {
    var t = ev.time ? ev.time.split(':').map(Number) : [9, 0];
    var start = parseISO(occurrenceStart);
    var when = new Date(start.getFullYear(), start.getMonth(), start.getDate(), t[0] || 0, t[1] || 0, 0, 0);
    return { when: when, fire: new Date(when.getTime() - (Number(ev.remind) || 0) * 60000) };
  }

  /* 알림 문구 — 담당이 누구인지 [담당: 첫째·아빠]처럼 붙입니다. */
  function reminderMessage(ev, when) {
    var hh = ('0' + when.getHours()).slice(-2) + ':' + ('0' + when.getMinutes()).slice(-2);
    var who = memberNamesOf(ev.members);
    var lead = Number(ev.remind) > 0 ? ' (' + remindLabel(ev.remind) + ')' : '';
    var body = (who ? '[담당: ' + who + '] ' : '') +
      (when.getMonth() + 1) + '월 ' + when.getDate() + '일 ' + hh + (ev.time ? '' : ' (종일)') + lead +
      (ev.memo ? '\n' + ev.memo : '');
    return { title: '🔔 ' + (ev.title || '일정'), body: body, who: who };
  }

  function checkReminders() {
    if (!events.length) return;
    var now = new Date();
    var from = addDaysISO(todayISO(), -1);
    var to = addDaysISO(todayISO(), 2);
    events.forEach(function (ev) {
      if (ev.remind === null || ev.remind === undefined || isNaN(Number(ev.remind))) return;
      if (!notifyCovers(ev)) return;
      occurrenceStarts(ev, from, to).forEach(function (r) {
        var t = reminderAt(ev, r.start);
        var key = ev.id + '|' + r.start;
        if (firedReminders[key]) return;
        var diff = now.getTime() - t.fire.getTime();
        if (diff >= 0 && diff < 90000) {
          firedReminders[key] = true;
          showReminder(ev, t.when);
        }
      });
    });
  }

  function showReminder(ev, when) {
    var msg = reminderMessage(ev, when);
    var text = msg.title + ' · ' + msg.body.split('\n')[0];
    var banner = el.remindBanner;
    if (banner) {
      banner.innerHTML = '';
      var span = document.createElement('span');
      span.textContent = text;
      banner.appendChild(span);
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'remind-banner__close';
      close.textContent = '✕';
      close.addEventListener('click', function () { banner.hidden = true; });
      banner.appendChild(close);
      banner.hidden = false;
      clearTimeout(banner._timer);
      banner._timer = setTimeout(function () { banner.hidden = true; }, 25000);
    }
    systemNotify(msg.title, msg.body, 'family-calendar-' + ev.id);
  }

  /* 휴대폰 알림 — 안드로이드 앱은 네이티브 알림, 브라우저는 웹 알림 */
  function systemNotify(title, body, tag) {
    try {
      if (window.AndroidApp && typeof window.AndroidApp.notify === 'function') {
        window.AndroidApp.notify(title, body);
      } else if (window.Notification && Notification.permission === 'granted') {
        var n = new Notification(title, { body: body, tag: tag || undefined });
        n.onclick = function () { window.focus(); };
      }
    } catch (e) { /* 알림 못 띄워도 배너·토스트는 보임 */ }
  }

  /* 🔔 APK 예약 알람 — 앱을 닫아 둬도 울리도록 다가오는 미리 알림을 네이티브에 넘깁니다.
     (웹 브라우저에는 이 기능이 없어 화면이 열려 있을 때만 동작합니다) */
  function buildAlarmPlan(days) {
    var out = [];
    var now = Date.now();
    var from = addDaysISO(todayISO(), -1);
    var to = addDaysISO(todayISO(), days || 45);
    events.forEach(function (ev) {
      if (ev.remind === null || ev.remind === undefined || isNaN(Number(ev.remind))) return;
      if (!notifyCovers(ev)) return;
      occurrenceStarts(ev, from, to).forEach(function (r) {
        var t = reminderAt(ev, r.start);
        var at = t.fire.getTime();
        if (at <= now + 15000) return;
        var msg = reminderMessage(ev, t.when);
        out.push({ id: ev.id + '@' + r.start, title: msg.title, body: msg.body, at: at });
      });
    });
    out.sort(function (a, b) { return a.at - b.at; });
    return out.slice(0, 100);
  }

  function syncAndroidAlarms() {
    var bridge = window.AndroidApp;
    if (!bridge || typeof bridge.scheduleNotifications !== 'function') return;
    try {
      bridge.scheduleNotifications(JSON.stringify(buildAlarmPlan(45)));
    } catch (e) { /* 예약 실패해도 앱 동작에는 영향 없음 */ }
  }

  /* ---------------- 📅 홈 화면 위젯 (안드로이드 앱) ----------------
     앱이 열려 일정을 불러올 때마다 오늘 일정과 앞으로 14일 안의 다가오는 일정을 가볍게 만들어
     AndroidApp.updateWidget(json) 으로 넘깁니다. 홈 화면 위젯은 그 내용을 저장해 두고 보여 줍니다.
     일반 브라우저에는 브리지가 없어 조용히 지나갑니다. */
  function widgetNameOf(ev) {
    return String((ev && ev.title) || '').replace(/^\[샘플\]\s*/, '');
  }

  function buildWidgetPayload() {
    var today = todayISO();
    var todayList = events.filter(function (ev) {
      return isEventLike(ev) && !!occurrenceCovering(ev, today);
    }).sort(compareEvents).slice(0, 6).map(function (ev) {
      return { t: ev.time || '', n: widgetNameOf(ev), w: memberNamesOf(ev.members) };
    });

    var from = addDaysISO(today, 1);
    var to = addDaysISO(today, 14);
    var upcoming = [];
    events.forEach(function (ev) {
      if (!isEventLike(ev)) return;
      try {
        occurrenceStarts(ev, from, to).forEach(function (occ) {
          upcoming.push({
            d: occ.start,
            t: ev.time || '',
            n: widgetNameOf(ev),
            w: memberNamesOf(ev.members)
          });
        });
      } catch (e) { /* 반복 계산이 안 되는 일정은 위젯에서 건너뜀 */ }
    });
    upcoming.sort(function (a, b) {
      if (a.d !== b.d) return a.d < b.d ? -1 : 1;
      var ta = a.t || '00:00', tb = b.t || '00:00';
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.n.localeCompare(b.n, 'ko');
    });

    return { date: today, today: todayList, upcoming: upcoming.slice(0, 6), ts: Date.now() };
  }

  function syncAndroidWidget() {
    var bridge = window.AndroidApp;
    if (!bridge || typeof bridge.updateWidget !== 'function') return;
    if (!cloudReady || state.blocked) return;
    try {
      bridge.updateWidget(JSON.stringify(buildWidgetPayload()));
    } catch (e) { /* 위젯 갱신 실패는 앱 동작에 영향 없음 */ }
  }

  /* 새 일정 감지 — 동기화로 새로 들어온 일정 중 내 담당(또는 전체)인 것을 알립니다. */
  var knownEventIds = {};
  var knownReady = false;
  var selfCreated = {};

  function resetEventWatch() {
    knownEventIds = {};
    knownReady = false;
    selfCreated = {};
  }

  function markSelfCreated(id) {
    if (!id) return;
    selfCreated[id] = Date.now();
    knownEventIds[id] = true;
  }

  function detectNewEvents(list) {
    var fresh = [];
    list.forEach(function (ev) {
      if (knownEventIds[ev.id]) return;
      if (selfCreated[ev.id]) return;
      /* 앱을 새로 열거나 다시 연결했을 때 이미 있던 일정이 무더기로 울리지 않도록 */
      if (ev.createdAt && Date.now() - ev.createdAt > 30 * 60000) return;
      if (!myNotifyPrefs().newEvent) return;
      if (!notifyCovers(ev)) return;
      fresh.push(ev);
    });
    return fresh;
  }

  function announceNewEvents(fresh) {
    if (!fresh.length) return;
    fresh.slice(0, 3).forEach(function (ev) {
      var d = parseISO(ev.date);
      var when = (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAYS[d.getDay()] + ')' + (ev.time ? ' ' + ev.time : '');
      var who = memberNamesOf(ev.members);
      var title = myNotifyPrefs().scope === 'all' ? '🔔 새 일정이 등록됐어요' : '🔔 내 담당 새 일정이 등록됐어요';
      systemNotify(title, ev.title + ' · ' + when + (who ? '\n[담당: ' + who + ']' : ''), 'family-calendar-new-' + ev.id);
    });
    var first = fresh[0];
    toast((myNotifyPrefs().scope === 'all' ? '새 일정이 등록됐어요 · ' : '내 담당 새 일정이 등록됐어요 · ') + first.title +
      (fresh.length > 1 ? ' 외 ' + (fresh.length - 1) + '건' : ''));
  }

  function applyEventData(list) {
    var first = !knownReady;
    var fresh = first ? [] : detectNewEvents(list);
    events = list;
    cloudReady = true;
    clearTimeout(connectTimer);
    knownEventIds = {};
    list.forEach(function (ev) { knownEventIds[ev.id] = true; });
    knownReady = true;
    renderAll();
    if (!first) announceNewEvents(fresh);
    syncAndroidAlarms();
    syncAndroidWidget();
  }

  function updateNotifyBtn() {
    var btn = el.notifyBtn;
    if (!btn) return;
    if (window.AndroidApp && typeof window.AndroidApp.notify === 'function') {
      btn.textContent = '🔔 알림 켜짐';
      btn.classList.add('is-on');
      btn.hidden = false;
      return;
    }
    var ok = window.Notification && Notification.permission === 'granted';
    btn.textContent = ok ? '🔔 알림 켜짐' : '🔔 알림 켜기';
    btn.classList.toggle('is-on', !!ok);
    btn.hidden = !window.Notification;
  }

  /* 🔔 내 알림 설정 — 프로필을 고른 사람마다 '담당만/전체'를 따로 기억합니다. */
  function renderNotifyBox() {
    if (!el.notifyBox) return;
    var me = myMember();
    el.notifyBox.hidden = !me;
    if (!me) return;
    var p = myNotifyPrefs();
    if (el.notifyWho) el.notifyWho.textContent = me.name;
    if (el.notifyState) el.notifyState.textContent = p.scope === 'all' ? '전체 일정' : '담당 일정만';
    if (el.notifyScope) {
      Array.prototype.forEach.call(el.notifyScope.children, function (b) {
        var on = b.getAttribute('data-scope') === p.scope;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    }
    if (el.notifyNewEvent) el.notifyNewEvent.checked = p.newEvent;
    if (el.notifyNote) {
      var scopeText = p.scope === 'all'
        ? '가족 모두의 일정을 알려드려요.'
        : '내 이름이 담당에 들어간 일정만 알려드려요.';
      var where = (window.AndroidApp && typeof window.AndroidApp.scheduleNotifications === 'function')
        ? '앱을 닫아 둬도 예약 알림이 울려요.'
        : '브라우저에서는 달력 화면이 열려 있을 때만 알림이 울려요(푸시 서버 없이 예약 불가).';
      el.notifyNote.textContent = scopeText + ' ' + where;
    }
    if (el.notifyExactBtn) {
      var bridge = window.AndroidApp;
      var exactUnknown = !!(bridge && typeof bridge.canScheduleExact === 'function');
      var exactOk = true;
      if (exactUnknown) {
        try { exactOk = !!bridge.canScheduleExact(); } catch (e) { exactOk = true; }
      }
      el.notifyExactBtn.hidden = !exactUnknown || exactOk;
    }
  }

  function askNotify() {
    if (!window.Notification) {
      toast('이 브라우저는 알림을 지원하지 않아요. 앱을 열어 두면 화면 위 배너로 알려드려요.');
      return;
    }
    if (Notification.permission === 'granted') {
      toast('알림이 켜져 있어요 · 앱이 열려 있을 때 알려드려요');
      updateNotifyBtn();
      return;
    }
    if (Notification.permission === 'denied') {
      toast('브라우저 설정에서 알림을 허용해 주세요');
      return;
    }
    Notification.requestPermission().then(function (p) {
      updateNotifyBtn();
      toast(p === 'granted' ? '알림을 켰어요 · 앱이 열려 있을 때 알려드려요' : '알림이 꺼져 있어요 · 앱 화면 배너로는 알려드려요');
    });
  }

  function buildEventItem(ev, year) {
    var cat = categoryById(ev.category);
    var li = document.createElement('li');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'event';
    btn.style.setProperty('--cat', cat.color);

    var body = document.createElement('div');
    body.className = 'event__body';

    var title = document.createElement('div');
    title.className = 'event__title';
    var catEl = document.createElement('span');
    catEl.className = 'event__cat';
    catEl.textContent = cat.emoji;
    title.appendChild(catEl);
    title.appendChild(document.createTextNode(ev.title));
    body.appendChild(title);

    var meta = document.createElement('div');
    meta.className = 'event__meta';
    var timeEl = document.createElement('span');
    timeEl.className = 'event__time';
    timeEl.textContent = ev.time ? ev.time : '종일';
    meta.appendChild(timeEl);

    var occ = occurrenceCovering(ev, state.selected);
    var period = occ && occ.start !== occ.end ? fmtRange(occ.start, occ.end) : '';
    if (period) {
      var pEl = document.createElement('span');
      pEl.className = 'event__period';
      pEl.textContent = '📅 ' + period;
      meta.appendChild(pEl);
    }
    if (ev.remind !== null && ev.remind !== undefined) {
      var rEl = document.createElement('span');
      rEl.className = 'event__remind';
      rEl.textContent = '🔔 ' + remindLabel(ev.remind);
      meta.appendChild(rEl);
    }

    var lunarText = lunarTextFor(ev, year);
    if (lunarText) {
      var lEl = document.createElement('span');
      lEl.className = 'event__lunar';
      lEl.textContent = lunarText;
      meta.appendChild(lEl);
    }
    var rep = repeatLabel(ev);
    if (rep) {
      var repEl = document.createElement('span');
      repEl.className = 'event__repeat';
      repEl.textContent = rep;
      meta.appendChild(repEl);
    }

    var badges = document.createElement('span');
    badges.className = 'mbadges';
    (ev.members || []).forEach(function (id) {
      var mb = memberById(id);
      if (!mb) return;
      var b = document.createElement('span');
      b.className = 'mbadge';
      b.style.setProperty('--mbg', mb.bg);
      b.style.setProperty('--mfg', mb.color);
      var dot = document.createElement('i');
      b.appendChild(dot);
      b.appendChild(document.createTextNode(mb.name));
      badges.appendChild(b);
    });
    meta.appendChild(badges);
    body.appendChild(meta);

    if (ev.memo) {
      var memo = document.createElement('div');
      memo.className = 'event__memo';
      memo.textContent = ev.memo;
      body.appendChild(memo);
    }

    btn.appendChild(body);
    btn.addEventListener('click', function () {
      if (canManage()) openModal(ev, null);
      else openDetail(ev);
    });
    li.appendChild(btn);
    if (ev.checklist && ev.checklist.length) {
      li.appendChild(buildChecklistNode(ev, 'event'));
    }
    return li;
  }

  /* ---------------- ☑️ 준비물 체크리스트 ---------------- */
  function newCheckId() {
    return 'ck' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  function checklistDone(ev) {
    var list = (ev && ev.checklist) || [];
    var n = list.filter(function (i) { return i && i.done; }).length;
    return { done: n, total: list.length };
  }

  function buildChecklistNode(ev, variant) {
    var list = ev.checklist || [];
    var ul = document.createElement('ul');
    ul.className = 'checklist' + (variant ? ' checklist--' + variant : '');
    list.forEach(function (item) {
      if (!item || !item.text) return;
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'check-row' + (item.done ? ' is-done' : '');
      b.setAttribute('aria-pressed', item.done ? 'true' : 'false');
      var box = document.createElement('span');
      box.className = 'check-row__box';
      box.textContent = item.done ? '✓' : '';
      b.appendChild(box);
      var tx = document.createElement('span');
      tx.className = 'check-row__text';
      tx.textContent = item.text;
      b.appendChild(tx);
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleCheck(ev, item.id);
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
    return ul;
  }

  /* 체크 토글 — 가족 모두의 폰에 바로 저장됩니다. */
  function toggleCheck(ev, itemId) {
    if (!ev || !ev.id) return;
    var list = (ev.checklist || []).map(function (i) {
      return { id: i.id, text: i.text, done: !!i.done };
    });
    var hit = false;
    list.forEach(function (i) {
      if (i.id === itemId) { i.done = !i.done; hit = true; }
    });
    if (!hit) return;
    ev.checklist = list;
    if (el.dayCard) renderDayCard();
    if (el.detailModal && !el.detailModal.hidden) openDetail(ev);
    renderDaySheet();
    var c = checklistDone({ checklist: list });
    if (FamilyCloud.saveChecklist) {
      FamilyCloud.saveChecklist(ev.id, list).then(function () {
        toast(c.total && c.done === c.total ? '준비물을 다 챙겼어요' : '준비물 ' + c.done + '/' + c.total + ' 체크');
      }).catch(function (err) {
        window.alert('체크를 저장하지 못했어요 · ' + errorHint(err));
      });
    }
  }

  function renderDDay() {
    var today = new Date();
    var todayStr = todayISO();
    var horizon = addDaysISO(todayStr, 365);
    var limit = 6;
    var items = [];

    events.forEach(function (ev) {
      if (!passesMemberFilter(ev)) return;
      var cov = occurrenceCovering(ev, todayStr);
      if (cov) {
        items.push({ ev: ev, date: cov.start, end: cov.end, diff: 0, ongoing: cov.start < todayStr });
      }
      occurrenceStarts(ev, addDaysISO(todayStr, 1), horizon).slice(0, 1).forEach(function (r) {
        items.push({ ev: ev, date: r.start, end: r.end, diff: dayDiff(today, parseISO(r.start)), ongoing: false });
      });
    });

    items.sort(function (a, b) {
      if (a.diff !== b.diff) return a.diff - b.diff;
      var ta = a.ev.time || '00:00';
      var tb = b.ev.time || '00:00';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    var seen = {};
    items = items.filter(function (it) {
      var key = it.ev.id + '|' + it.date;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
    var total = items.length;
    var showCount = state.ddayOpen ? 12 : 3;
    items = items.slice(0, showCount);

    el.ddayList.innerHTML = '';
    var moreBtn = document.getElementById('ddayMoreBtn');
    if (!items.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '1년 안에 다가오는 일정이 없어요.';
      el.ddayList.appendChild(empty);
      if (moreBtn) moreBtn.hidden = true;
      return;
    }
    if (moreBtn) {
      moreBtn.hidden = total <= 3;
      moreBtn.textContent = state.ddayOpen ? '접기' : '더 보기 ' + Math.min(total - 3, 9) + '개';
    }

    items.forEach(function (it) {
      var ev = it.ev;
      var cat = categoryById(ev.category);
      var dt = parseISO(it.date);
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dday';

      var badge = document.createElement('span');
      badge.className = 'dday__badge' + (it.ongoing ? ' is-ongoing' : it.diff === 0 ? ' is-today' : it.diff <= 7 ? ' is-soon' : '');
      badge.textContent = it.ongoing ? '진행 중' : it.diff === 0 ? 'D-DAY' : 'D-' + it.diff;
      btn.appendChild(badge);

      var body = document.createElement('div');
      body.className = 'dday__body';

      var title = document.createElement('div');
      title.className = 'dday__title';
      title.textContent = cat.emoji + ' ' + ev.title;
      body.appendChild(title);

      var meta = document.createElement('div');
      meta.className = 'dday__meta';
      var when = document.createElement('span');
      if (it.end && it.end !== it.date) {
        var se = parseISO(it.end);
        when.textContent = (dt.getMonth() + 1) + '.' + dt.getDate() + ' ~ ' + (se.getMonth() + 1) + '.' + se.getDate() + ' (' + WEEKDAYS[dt.getDay()] + '~' + WEEKDAYS[se.getDay()] + ')';
      } else {
        when.textContent = (dt.getMonth() + 1) + '.' + dt.getDate() + ' (' + WEEKDAYS[dt.getDay()] + ')';
      }
      meta.appendChild(when);
      if (ev.time) {
        var t = document.createElement('span');
        t.textContent = ev.time;
        meta.appendChild(t);
      }
      var lunarText = lunarTextFor(ev, dt.getFullYear());
      if (lunarText) {
        var l = document.createElement('span');
        l.className = 'event__lunar';
        l.textContent = lunarText;
        meta.appendChild(l);
      }
      var names = (ev.members || []).map(function (id) {
        var mb = memberById(id);
        return mb ? mb.name : '';
      }).filter(Boolean);
      if (names.length) {
        var n = document.createElement('span');
        n.textContent = names.length > 3 ? names.slice(0, 3).join('·') + ' 외 ' + (names.length - 3) : names.join('·');
        meta.appendChild(n);
      }
      body.appendChild(meta);
      btn.appendChild(body);

      btn.addEventListener('click', function () { selectDate(it.date, true); });
      li.appendChild(btn);
      el.ddayList.appendChild(li);
    });
  }

  function fmtMD(dateISO) {
    var d = parseISO(dateISO);
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }

  function fmtRange(aISO, bISO) {
    var s = parseISO(aISO), e = parseISO(bISO);
    return (s.getMonth() + 1) + '.' + s.getDate() + ' ~ ' + (e.getMonth() + 1) + '.' + e.getDate();
  }

  function weekdayOf(ev) {
    var w = Number(ev && ev.weekday);
    if (!isFinite(w) || w < 0 || w > 6 || ev.weekday === null || ev.weekday === undefined) {
      return parseISO(ev.date).getDay();
    }
    return w;
  }

  function repeatLabel(ev) {
    var r = (ev && ev.repeat) || 'none';
    if (r === 'weekly') return '매주 ' + WEEKDAYS[weekdayOf(ev)];
    if (r === 'monthly') return '매월 ' + parseISO(ev.date).getDate() + '일';
    if (r === 'yearly-solar') return '매년';
    if (r === 'yearly-lunar') return '매년 음력';
    return '';
  }

  /* ---------------- 💬 카톡 요약 복사 ---------------- */
  function weekStartISO(dateISO, startDay) {
    var d = parseISO(dateISO);
    var wd = (d.getDay() - (startDay || 0) + 7) % 7;
    return addDaysISO(dateISO, -wd);
  }

  function summaryLine(ev) {
    var cat = categoryById(ev.category);
    var names = (ev.members || []).map(function (id) {
      var m = memberById(id);
      return m ? m.name : '';
    }).filter(Boolean);
    var line = '· ' + (ev.time ? ev.time + ' ' : '종일 ') + cat.emoji + ' ' + ev.title;
    if (names.length) line += ' — ' + names.join('·');
    var c = checklistDone(ev);
    if (c.total) line += ' (준비물 ' + c.done + '/' + c.total + ')';
    return line;
  }

  function daySummaryBlock(dateISO) {
    var list = eventsOn(dateISO);
    if (!list.length) return '';
    var dt = parseISO(dateISO);
    var out = ['[' + (dt.getMonth() + 1) + '/' + dt.getDate() + '(' + WEEKDAYS[dt.getDay()] + ')]'];
    list.forEach(function (ev) { out.push(summaryLine(ev)); });
    return out.join('\n');
  }

  function buildKakaoText(scope) {
    var lines = [];
    if (scope === 'today') {
      var t = todayISO();
      var dt = parseISO(t);
      var block = daySummaryBlock(t);
      lines.push('📅 우리 가족 달력 · ' + (dt.getMonth() + 1) + '월 ' + dt.getDate() + '일(' + WEEKDAYS[dt.getDay()] + ')');
      if (block) {
        lines.push(block.split('\n').slice(1).join('\n'));
      } else {
        lines.push('오늘은 일정이 없어요.');
      }
      return lines.join('\n').trim();
    }
    var start = weekStartISO(todayISO(), 0);
    var end = addDaysISO(start, 6);
    var s = parseISO(start), e = parseISO(end);
    lines.push('📅 우리 가족 이번 주 · ' + (s.getMonth() + 1) + '/' + s.getDate() + '(' + WEEKDAYS[s.getDay()] + ') ~ ' + (e.getMonth() + 1) + '/' + e.getDate() + '(' + WEEKDAYS[e.getDay()] + ')');
    var any = false;
    for (var i = 0; i < 7; i++) {
      var b = daySummaryBlock(addDaysISO(start, i));
      if (!b) continue;
      any = true;
      lines.push(b);
    }
    if (!any) lines.push('이번 주는 일정이 없어요.');
    return lines.join('\n').trim();
  }

  function fallbackCopyText(text, okMsg) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) toast(okMsg);
      else window.prompt('아래 내용을 복사해 주세요.', text);
    } catch (e) {
      window.prompt('아래 내용을 복사해 주세요.', text);
    }
  }

  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, function () { fallbackCopyText(text, okMsg); });
    } else {
      fallbackCopyText(text, okMsg);
    }
  }

  function copyKakaoSummary(scope) {
    var text = buildKakaoText(scope);
    if (el.kakaoPreview) {
      el.kakaoPreview.textContent = text;
      el.kakaoPreview.hidden = false;
    }
    copyText(text, scope === 'today' ? '오늘 일정을 복사했어요 · 카톡에 붙여넣으세요' : '이번 주 일정을 복사했어요 · 카톡에 붙여넣으세요');
  }

  /* ---------------- 모달 ---------------- */
  function openModal(ev, presetDate) {
    state.editingId = ev ? ev.id : null;
    var manage = canManage();
    el.modalTitle.textContent = ev ? (manage ? '일정 수정' : '일정 보기') : (manage ? '일정 추가' : '일정 등록 요청');
    el.deleteBtn.hidden = !ev || !manage;
    el.formError.hidden = true;
    el.saveBtn.textContent = ev ? '저장' : (manage ? '저장' : '등록 요청 보내기');
    el.requestNote.hidden = manage || !!ev;

    el.fTitle.value = ev ? ev.title : '';
    el.fDate.value = ev ? ev.date : (presetDate || state.selected);
    el.fEndDate.value = ev && ev.endDate ? ev.endDate : '';
    el.fMemo.value = ev ? (ev.memo || '') : '';
    resetVoiceBox();
    resetPasteBox();
    state.weekday = ev ? weekdayOf(ev) : parseISO(el.fDate.value || state.selected).getDay();
    state.weekdayTouched = !!ev;
    renderChecklistEditor(ev ? (ev.checklist || []) : []);

    if (ev && ev.time) {
      el.fAllDay.checked = false;
      el.fTime.value = ev.time;
    } else {
      el.fAllDay.checked = true;
      el.fTime.value = '18:00';
    }
    syncTimeField();

    var memberIds = ev ? (ev.members || []) : [];
    el.fMembers.innerHTML = '';
    MEMBERS.forEach(function (mb) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick' + (memberIds.indexOf(mb.id) !== -1 ? ' is-on' : '');
      b.setAttribute('data-id', mb.id);
      b.style.setProperty('--c', mb.color);
      b.style.setProperty('--bgc', mb.bg);
      b.style.setProperty('--fgc', mb.color);
      var i = document.createElement('i');
      b.appendChild(i);
      b.appendChild(document.createTextNode(mb.name));
      b.addEventListener('click', function () {
        b.classList.toggle('is-on');
        paintMembersCount();
      });
      el.fMembers.appendChild(b);
    });
    paintMembersCount();

    var catId = ev ? ev.category : 'etc';
    el.fCategories.innerHTML = '';
    CATEGORIES.forEach(function (cat) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick pick--cat' + (cat.id === catId ? ' is-on' : '');
      b.setAttribute('data-id', cat.id);
      b.style.setProperty('--c', cat.color);
      b.style.setProperty('--bgc', cat.color + '1f');
      b.style.setProperty('--fgc', cat.color);
      b.textContent = cat.emoji + ' ' + cat.label;
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(el.fCategories.children, function (child) {
          child.classList.remove('is-on');
        });
        b.classList.add('is-on');
      });
      el.fCategories.appendChild(b);
    });

    setRepeat(ev ? ev.repeat : 'none');
    setRemind(ev && ev.remind !== null && ev.remind !== undefined ? String(ev.remind) : 'none');
    updateDateHint();

    /* 수정할 때 부가 항목이 이미 차 있으면 펼쳐서 보여 줍니다. */
    var hasExtra = !!(ev && (ev.endDate || String(ev.memo || '').trim() || (ev.checklist && ev.checklist.length) ||
      (ev.repeat && ev.repeat !== 'none') || (ev.remind !== null && ev.remind !== undefined) ||
      (ev.category && ev.category !== 'etc')));
    toggleMore(hasExtra);
    updateMoreBadges();

    el.modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    el.modal.hidden = true;
    document.body.style.overflow = '';
    state.editingId = null;
    resetVoiceBox();
  }

  /* ---------------- 🏥 국가 검진·예방접종 (아이 + 성인) ---------------- */
  function healthMembers() {
    return MEMBERS.map(function (m) {
      return { id: m.id, name: m.name, color: m.color, bg: m.bg, birth: m.birth || '' };
    });
  }

  function openHealth(from) {
    if (!window.FamilyHealth) {
      window.alert('검진·예방접종 기능을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.');
      return;
    }
    window.FamilyHealth.open({
      members: healthMembers(),
      today: todayISO(),
      onSave: saveHealthEvents,
      onSaved: function (n) {
        toast(n + '건을 달력에 넣었어요');
        if (from === 'event' && !state.editingId) closeModal();
      },
      onError: function (err) {
        return (canManage() ? '달력에 넣지 못했어요 · ' : '등록 요청을 보내지 못했어요 · ') + errorHint(err);
      }
    });
  }

  /* 고른 검진·접종을 일정으로 담습니다. 카테고리는 🏥 병원, 담당은 고른 가족이에요. */
  function saveHealthEvents(list, meta) {
    if (!cloudReady) return Promise.reject(new Error('아직 가족 방에 연결되지 않았어요. 잠시 후 다시 시도해 주세요.'));
    var me = myMember();
    var ownerId = (meta && meta.memberId) || (me && me.id) || '';
    if (!ownerId) return Promise.reject(new Error('이 폰 주인을 먼저 골라 주세요(⚙️ 설정 → 내 정보).'));
    var remember = function (it) {
      return {
        title: it.title,
        date: it.date,
        endDate: null,
        time: null,
        remind: it.remind,
        members: [ownerId],
        category: 'hospital',
        memo: it.memo,
        repeat: 'none',
        weekday: null,
        checklist: [],
        lunar: null
      };
    };
    var payloads = (list || []).map(remember);
    if (!payloads.length) return Promise.resolve({ count: 0 });
    /* 저장 뒤 달력은 '오늘 이후 가장 가까운 날'로 이동합니다(과거 보완 건만 있으면 그 날짜). */
    var goDate = (function () {
      var t = todayISO();
      var dates = payloads.map(function (p) { return p.date; }).sort();
      for (var i = 0; i < dates.length; i++) if (dates[i] >= t) return dates[i];
      return dates[dates.length - 1];
    })();

    if (!canManage()) {
      var seq = Promise.resolve(0);
      payloads.forEach(function (p) {
        seq = seq.then(function (n) {
          return FamilyCloud.submitRequest(p, { id: me.id, name: me.name }).then(function () { return n + 1; });
        });
      });
      return seq.then(function (n) {
        goToDate(goDate);
        renderAll();
        return { count: n };
      });
    }

    return FamilyCloud.saveEvents(payloads).then(function (ids) {
      (ids || []).forEach(function (id) { markSelfCreated(id); });
      goToDate(goDate);
      renderAll();
      return { count: (ids || []).length };
    });
  }

  function syncTimeField() {
    el.fTime.disabled = el.fAllDay.checked;
  }

  function setRepeat(value) {
    state.repeat = value || 'none';
    Array.prototype.forEach.call(el.fRepeat.children, function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-repeat') === state.repeat);
    });
    renderWeekdays();
    updateRepeatHint();
    if (typeof updateMoreBadges === 'function') updateMoreBadges();
  }

  /* 매주 반복 요일 선택 단추 */
  function renderWeekdays() {
    if (!el.fWeekdays) return;
    el.fWeekdays.innerHTML = '';
    WEEKDAYS.forEach(function (name, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'weekday-btn' + (Number(state.weekday) === i ? ' is-active' : '');
      if (i === 0) b.classList.add('is-sun');
      if (i === 6) b.classList.add('is-sat');
      b.textContent = name;
      b.addEventListener('click', function () {
        state.weekday = i;
        state.weekdayTouched = true;
        Array.prototype.forEach.call(el.fWeekdays.children, function (c) { c.classList.remove('is-active'); });
        b.classList.add('is-active');
        updateRepeatHint();
      });
      el.fWeekdays.appendChild(b);
    });
  }

  /* 준비물 체크리스트 편집기(추가·수정 화면) */
  function renderChecklistEditor(items) {
    state.checklist = (items || []).map(function (i) {
      return { id: i.id || newCheckId(), text: String(i.text || '').slice(0, 40), done: !!i.done };
    });
    paintChecklistEditor();
  }

  function paintChecklistEditor() {
    if (!el.fChecklist) return;
    el.fChecklist.innerHTML = '';
    if (!state.checklist.length) {
      var empty = document.createElement('li');
      empty.className = 'checklist__empty';
      empty.textContent = '준비물을 넣어 두면 일정 상세에서 체크할 수 있어요.';
      el.fChecklist.appendChild(empty);
      return;
    }
    state.checklist.forEach(function (item, idx) {
      var li = document.createElement('li');
      li.className = 'check-row check-row--edit' + (item.done ? ' is-done' : '');
      var box = document.createElement('button');
      box.type = 'button';
      box.className = 'check-row__box';
      box.textContent = item.done ? '✓' : '';
      box.setAttribute('aria-label', '완료 표시');
      box.addEventListener('click', function () {
        item.done = !item.done;
        paintChecklistEditor();
      });
      var tx = document.createElement('input');
      tx.type = 'text';
      tx.className = 'check-row__input';
      tx.maxLength = 40;
      tx.value = item.text;
      tx.setAttribute('placeholder', '준비물');
      tx.addEventListener('input', function () { item.text = tx.value.slice(0, 40); });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'check-row__del';
      del.textContent = '✕';
      del.setAttribute('aria-label', '준비물 삭제');
      del.addEventListener('click', function () {
        state.checklist.splice(idx, 1);
        paintChecklistEditor();
      });
      li.appendChild(box);
      li.appendChild(tx);
      li.appendChild(del);
      el.fChecklist.appendChild(li);
    });
  }

  function addChecklistItem() {
    var input = el.fCheckItem;
    var text = String(input ? input.value : '').trim().slice(0, 40);
    if (!text) { if (input) input.focus(); return; }
    if (state.checklist.length >= 30) { toast('준비물은 30개까지 넣을 수 있어요'); return; }
    state.checklist.push({ id: newCheckId(), text: text, done: false });
    if (input) input.value = '';
    paintChecklistEditor();
    if (input) input.focus();
  }

  function currentChecklist() {
    return (state.checklist || []).map(function (i) {
      return { id: i.id, text: String(i.text || '').trim().slice(0, 40), done: !!i.done };
    }).filter(function (i) { return i.text; });
  }

  function setRemind(value) {
    state.remind = value || 'none';
    if (!el.fRemind) return;
    Array.prototype.forEach.call(el.fRemind.children, function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-remind') === state.remind);
    });
    if (typeof updateMoreBadges === 'function') updateMoreBadges();
  }

  function currentCategory() {
    var on = el.fCategories.querySelector('.pick.is-on');
    return on ? on.getAttribute('data-id') : 'etc';
  }

  function currentMembers() {
    return Array.prototype.map.call(el.fMembers.querySelectorAll('.pick.is-on'), function (b) {
      return b.getAttribute('data-id');
    });
  }

  /* 담당 가족 — [전체 선택] 버튼과 'n/m명' 표시를 지금 선택 상태에 맞춥니다. */
  function paintMembersCount() {
    var picked = currentMembers();
    var total = MEMBERS.length;
    if (el.fMembersCount) el.fMembersCount.textContent = picked.length + '/' + total + '명';
    var all = el.fMembersAll;
    if (!all) return;
    var isAll = total > 0 && picked.length === total;
    all.classList.toggle('is-on', isAll);
    all.textContent = isAll ? '전체 해제' : '전체 선택';
    all.setAttribute('aria-pressed', String(isAll));
    all.disabled = total === 0;
  }

  /* 한 번 누르면 전원 선택, 다 선택돼 있으면 전원 해제(다시 누르면 원상 복귀 가능). */
  function toggleAllMembers() {
    var btns = Array.prototype.slice.call(el.fMembers.querySelectorAll('.pick'));
    if (!btns.length) return;
    var allOn = btns.every(function (b) { return b.classList.contains('is-on'); });
    btns.forEach(function (b) { b.classList.toggle('is-on', !allOn); });
    paintMembersCount();
  }

  function updateDateHint() {
    var val = el.fDate.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      el.dateLunarHint.textContent = '';
      updateRepeatHint();
      return;
    }
    var p = val.split('-').map(Number);
    var lunar = L.toLunar(p[0], p[1], p[2]);
    var holiday = L.holidayName(p[0], p[1], p[2]);
    var parts = [];
    if (lunar) parts.push(L.lunarLabel(lunar) + (lunar.leap ? ' (윤달)' : ''));
    else parts.push('음력 변환 범위(2022~2040) 밖이에요');
    if (holiday) parts.push('🎉 ' + holiday);
    el.dateLunarHint.textContent = parts.join(' · ');
    if (state.repeat === 'weekly' && !state.weekdayTouched) {
      state.weekday = parseISO(val).getDay();
      renderWeekdays();
    }
    updateRepeatHint();
  }

  function updateRepeatHint() {
    if (el.fWeekdayField) el.fWeekdayField.hidden = state.repeat !== 'weekly';
    if (state.repeat === 'weekly') {
      var wv = el.fDate.value;
      var wd = Number(state.weekday);
      if (!isFinite(wd) || wd < 0 || wd > 6) wd = 0;
      var extra = '';
      if (wv && /^\d{4}-\d{2}-\d{2}$/.test(wv)) {
        var shift = (wd - parseISO(wv).getDay() + 7) % 7;
        if (shift) extra = ' 시작일은 첫 ' + WEEKDAYS[wd] + '요일인 ' + fmtMD(addDaysISO(wv, shift)) + '로 맞춰 저장해요.';
      }
      el.repeatHint.textContent = '매주 ' + WEEKDAYS[wd] + '요일마다 반복해요.' + extra;
      return;
    }
    if (state.repeat === 'monthly') {
      var mv = el.fDate.value;
      var day = mv && /^\d{4}-\d{2}-\d{2}$/.test(mv) ? parseISO(mv).getDate() : 1;
      el.repeatHint.textContent = '매월 ' + day + '일마다 반복해요.' + (day > 28 ? ' 그 일자가 없는 달은 말일로 계산해요.' : '');
      return;
    }
    if (state.repeat === 'yearly-lunar') {
      var val = el.fDate.value;
      var p = val && /^\d{4}-\d{2}-\d{2}$/.test(val) ? val.split('-').map(Number) : null;
      var lunar = p ? L.toLunar(p[0], p[1], p[2]) : null;
      if (lunar) {
        var sol = L.toSolar(p[0], lunar.month, lunar.day, false);
        el.repeatHint.textContent = '음력 ' + (lunar.leap ? '윤' : '') + lunar.month + '월 ' + lunar.day + '일로 저장돼요. 해마다 그 해의 양력 날짜로 자동 계산해요 (예: ' + p[0] + '년 → ' + (sol ? sol.m + '월 ' + sol.d + '일' : '계산 불가') + ').' + (lunar.leap ? ' 윤달이 없는 해에는 같은 달의 같은 날로 계산해요.' : '');
      } else {
        el.repeatHint.textContent = '선택한 날짜의 음력을 계산할 수 없어요. 2022~2040년 사이 날짜를 골라 주세요.';
      }
    } else if (state.repeat === 'yearly-solar') {
      el.repeatHint.textContent = '같은 양력 월·일로 매년 반복돼요.';
    } else {
      el.repeatHint.textContent = '반복하지 않아요.';
    }
  }

  function showFormError(msg) {
    el.formError.textContent = msg;
    el.formError.hidden = false;
  }

  /* ---------------- 말로 입력(음성) ---------------- */
  function resetVoiceBox() {
    if (el.voiceStatus) {
      el.voiceStatus.hidden = true;
      el.voiceStatus.textContent = '';
    }
    if (window.CalendarVoice) CalendarVoice.stop();
  }

  function applyVoiceEvent(text) {
    if (!window.CalendarVoice) return;
    var parsed = CalendarVoice.parse(text, {
      members: MEMBERS.map(function (m) { return { id: m.id, name: m.name }; }),
      today: todayISO()
    });

    if (parsed.date) el.fDate.value = parsed.date;
    if (el.fEndDate) el.fEndDate.value = (parsed.endDate && parsed.endDate !== parsed.date) ? parsed.endDate : '';
    if (parsed.hasTime) {
      el.fAllDay.checked = false;
      el.fTime.value = parsed.time || '18:00';
      syncTimeField();
    }
    if (parsed.members && parsed.members.length) {
      Array.prototype.forEach.call(el.fMembers.children, function (b) {
        b.classList.toggle('is-on', parsed.members.indexOf(b.getAttribute('data-id')) !== -1);
      });
      paintMembersCount();
    }
    if (parsed.category) {
      Array.prototype.forEach.call(el.fCategories.children, function (b) {
        b.classList.toggle('is-on', b.getAttribute('data-id') === parsed.category);
      });
    }
    if (parsed.title) el.fTitle.value = parsed.title.slice(0, 60);
    if (parsed.lunar) setRepeat('yearly-lunar');
    updateDateHint();
    /* 말로 채운 부가 항목(기간·카테고리·반복)은 바로 보이게 펼칩니다. */
    if (parsed.endDate || parsed.category || parsed.lunar) toggleMore(true);
    updateMoreBadges();

    var bits = [];
    if (parsed.date) bits.push('📅 ' + parsed.date + (parsed.endDate && parsed.endDate !== parsed.date ? ' ~ ' + parsed.endDate : ''));
    if (parsed.hasTime) bits.push('⏰ ' + parsed.time + (parsed.endTime ? ' ~ ' + parsed.endTime : ''));
    if (parsed.members && parsed.members.length) {
      bits.push('👥 ' + parsed.members.map(function (id) {
        var m = memberById(id);
        return m ? m.name : '';
      }).filter(Boolean).join('·'));
    }
    if (parsed.category) bits.push('🏷 ' + categoryById(parsed.category).label);
    if (parsed.title) bits.push('✏️ ' + parsed.title);
    if (parsed.lunar) bits.push('🌙 매년 음력');

    if (el.voiceStatus) {
      el.voiceStatus.hidden = false;
      el.voiceStatus.textContent = '말한 내용: ' + text + '\n' +
        (bits.length ? '→ ' + bits.join(' · ') + '\n맞는지 확인하고, 틀린 칸은 직접 고쳐 주세요.' :
          '→ 알아들은 날짜·시간이 없어요. 날짜와 시간을 직접 넣어 주세요.');
    }
  }

  /* ---------------- 문자·카톡 붙여넣기 ---------------- */
  function resetPasteBox() {
    if (el.pasteArea) el.pasteArea.value = '';
    if (el.pasteStatus) {
      el.pasteStatus.hidden = true;
      el.pasteStatus.textContent = '';
      el.pasteStatus.classList.remove('paste-status--warn');
    }
    if (el.pasteCands) {
      el.pasteCands.hidden = true;
      el.pasteCands.innerHTML = '';
    }
    if (pasteUI) pasteUI.close();
  }

  function renderPasteCands(parsed) {
    var wrap = el.pasteCands;
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
        el.fDate.value = cand.date;
        if (el.fEndDate) el.fEndDate.value = (cand.endDate && cand.endDate !== cand.date) ? cand.endDate : '';
        if (cand.hasTime && cand.time) {
          el.fAllDay.checked = false;
          el.fTime.value = cand.time;
        } else {
          el.fAllDay.checked = true;
        }
        syncTimeField();
        updateDateHint();
        updateMoreBadges();
        Array.prototype.forEach.call(wrap.children, function (x) { x.classList.remove('is-on'); });
        b.classList.add('is-on');
        /* 위에 적힌 '이렇게 채웠어요'의 날짜도 같이 바꿔 줍니다. */
        if (el.pasteStatus && !el.pasteStatus.hidden) {
          el.pasteStatus.textContent = el.pasteStatus.textContent.replace(/📅 [0-9.~]+/,
            '📅 ' + cand.date.replace(/-/g, '.') +
            (cand.endDate && cand.endDate !== cand.date ? '~' + cand.endDate.slice(5).replace('-', '.') : ''));
        }
      });
      wrap.appendChild(b);
    });
  }

  function withRo(name) {
    var s = String(name || '');
    var code = s.charCodeAt(s.length - 1);
    if (code >= 0xAC00 && code <= 0xD7A3) return s + ((code - 0xAC00) % 28 ? '으로' : '로');
    return s + '으로';
  }

  function applyPastedEvent(parsed) {
    if (!parsed) return;
    if (parsed.date) el.fDate.value = parsed.date;
    if (el.fEndDate) el.fEndDate.value = (parsed.endDate && parsed.endDate !== parsed.date) ? parsed.endDate : '';
    if (parsed.hasTime && parsed.time) {
      el.fAllDay.checked = false;
      el.fTime.value = parsed.time;
    } else if (parsed.date) {
      el.fAllDay.checked = true;
    }
    syncTimeField();
    if (parsed.members && parsed.members.length) {
      Array.prototype.forEach.call(el.fMembers.children, function (b) {
        b.classList.toggle('is-on', parsed.members.indexOf(b.getAttribute('data-id')) !== -1);
      });
      paintMembersCount();
    } else if (!currentMembers().length && state.profile) {
      /* 문자에 이름이 없으면 이 폰 주인을 담당으로 골라 둡니다(칩으로 바로 바꿀 수 있음). */
      var me = memberById(state.profile);
      if (me) {
        Array.prototype.forEach.call(el.fMembers.children, function (b) {
          b.classList.toggle('is-on', b.getAttribute('data-id') === me.id);
        });
        paintMembersCount();
        parsed.members = [me.id];
        parsed.notes = (parsed.notes || []).filter(function (n) { return n.indexOf('담당 가족을 찾지') === -1; });
        parsed.notes.push('담당은 ' + withRo(me.name) + ' 골라 뒀어요 · 다르면 직접 바꿔 주세요');
      }
    }
    if (parsed.category) {
      Array.prototype.forEach.call(el.fCategories.children, function (b) {
        b.classList.toggle('is-on', b.getAttribute('data-id') === parsed.category);
      });
    }
    if (parsed.title) el.fTitle.value = parsed.title.slice(0, 60);
    if (parsed.memo) el.fMemo.value = parsed.memo.slice(0, 600);
    updateDateHint();
    if (parsed.endDate || parsed.category || parsed.memo) toggleMore(true);
    updateMoreBadges();
    renderPasteCands(parsed);
    if (el.pasteStatus) el.pasteStatus.classList.toggle('paste-status--warn', !parsed.date);
  }

  function saveEvent() {
    var title = el.fTitle.value.trim();
    var date = el.fDate.value;
    if (!title) {
      showFormError('제목을 입력해 주세요.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      showFormError('날짜를 선택해 주세요.');
      return;
    }
    var weekday = null;
    if (state.repeat === 'weekly') {
      var wd = Number(state.weekday);
      if (!isFinite(wd) || wd < 0 || wd > 6) wd = parseISO(date).getDay();
      var shiftDays = (wd - parseISO(date).getDay() + 7) % 7;
      if (shiftDays) {
        date = addDaysISO(date, shiftDays);
        el.fDate.value = date;
      }
      weekday = wd;
    }
    var memberIds = currentMembers();
    if (!memberIds.length) {
      showFormError('담당 가족을 한 명 이상 선택해 주세요.');
      return;
    }
    var endDate = el.fEndDate ? el.fEndDate.value : '';
    if (endDate && endDate < date) {
      showFormError('종료일이 시작일보다 빨라요.');
      return;
    }
    if (endDate && endDate === date) endDate = '';

    var lunar = null;
    if (state.repeat === 'yearly-lunar') {
      var p = date.split('-').map(Number);
      var l = L.toLunar(p[0], p[1], p[2]);
      if (!l) {
        showFormError('이 날짜의 음력을 계산할 수 없어요. 2022~2040년 사이 날짜를 골라 주세요.');
        return;
      }
      lunar = { month: l.month, day: l.day, leap: !!l.leap };
    }

    var time = el.fAllDay.checked ? null : (el.fTime.value || null);
    var payload = {
      title: title,
      date: date,
      endDate: endDate || null,
      time: time,
      remind: state.remind && state.remind !== 'none' ? Number(state.remind) : null,
      members: memberIds,
      category: currentCategory(),
      memo: el.fMemo.value.trim(),
      repeat: state.repeat,
      weekday: weekday,
      checklist: currentChecklist(),
      lunar: lunar
    };

    if (!cloudReady) {
      showFormError('아직 가족 방에 연결되지 않았어요. 잠시 후 다시 저장해 주세요.');
      return;
    }
    if (state.saving) return;
    state.saving = true;
    el.saveBtn.disabled = true;

    var done = function () { state.saving = false; el.saveBtn.disabled = false; };
    var fail = function (err) {
      showFormError((canManage() ? '저장하지 못했어요 · ' : '요청을 보내지 못했어요 · ') + errorHint(err));
    };

    if (!canManage()) {
      var me = myMember();
      if (!me) {
        done();
        closeModal();
        openProfileModal();
        return;
      }
      FamilyCloud.submitRequest(payload, { id: me.id, name: me.name }).then(function () {
        goToDate(date);
        closeModal();
        renderAll();
        toast('등록 요청을 보냈어요 · 아빠·엄마 승인 후 달력에 올라가요');
      }).catch(fail).then(done);
      return;
    }

    FamilyCloud.saveEvent(state.editingId, payload).then(function (newId) {
      /* 내가 방금 만든 일정은 '새 일정 알림'에서 빼기 */
      markSelfCreated(state.editingId || newId);
      goToDate(date);
      closeModal();
      renderAll();
    }).catch(fail).then(done);
  }

  function goToDate(date) {
    state.selected = date;
    var dt = parseISO(date);
    state.year = dt.getFullYear();
    state.month = dt.getMonth();
  }

  function deleteEvent() {
    if (!state.editingId) return;
    var target = null;
    for (var i = 0; i < events.length; i++) if (events[i].id === state.editingId) target = events[i];
    if (!target) return;
    if (!window.confirm('"' + target.title + '" 일정을 삭제할까요?\n가족 모두의 달력에서 지워집니다.')) return;
    var id = state.editingId;
    closeModal();
    FamilyCloud.deleteEvent(id).catch(function (err) {
      window.alert('삭제하지 못했어요 · ' + errorHint(err));
    });
  }

  function deleteSamples() {
    if (!canManage()) return;
    if (!cloudReady) {
      window.alert('아직 가족 방에 연결되지 않았어요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    if (!window.confirm('샘플 일정을 모두 지울까요?\n가족이 실제로 넣은 일정은 그대로 남습니다.')) return;
    FamilyCloud.deleteSamples().then(function (n) {
      window.alert(n ? n + '개의 샘플 일정을 지웠어요.' : '지울 샘플 일정이 없어요.');
    }).catch(function (err) {
      window.alert('지우지 못했어요 · ' + errorHint(err));
    });
  }

  function inviteLink() {
    var code = FamilyCloud.storedCode();
    if (!code) return '';
    return location.origin + location.pathname + '?code=' + encodeURIComponent(code);
  }

  function copyInviteLink() {
    var link = inviteLink();
    if (!link) {
      window.alert('아직 가족 방에 연결되지 않았어요.');
      return;
    }
    var done = function () { window.alert('가족 초대 링크를 복사했어요.\n카카오톡으로 보내면 가족은 링크만 누르면 돼요.\n\n' + link); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, function () { window.prompt('이 링크를 복사해 주세요.', link); });
    } else {
      window.prompt('이 링크를 복사해 주세요.', link);
    }
  }

  /* ---------------- 사용자(프로필)·권한 ---------------- */
  function myMember() {
    if (!state.profile) return null;
    return memberById(state.profile);
  }

  function myRole() {
    var m = myMember();
    return m ? (m.role || 'member') : 'member';
  }

  function canManage() {
    var r = myRole();
    return r === 'admin' || r === 'manager';
  }

  function isAdmin() { return myRole() === 'admin'; }

  function savedProfile() {
    try { return localStorage.getItem(PROFILE_KEY) || ''; } catch (e) { return ''; }
  }

  function rememberProfile(id) {
    try {
      if (id) localStorage.setItem(PROFILE_KEY, id);
      else localStorage.removeItem(PROFILE_KEY);
    } catch (e) { /* 저장 못해도 이번엔 동작 */ }
  }

  function plainMember(m) {
    var out = { id: m.id, name: m.name, color: m.color, bg: m.bg, role: m.role || 'member' };
    if (m.tel) out.tel = FamilyCloud.normalizeTel(m.tel);
    if (m.photoDataUrl) out.photoDataUrl = m.photoDataUrl;
    /* 내보내기(차단) 때 쓸 계정 목록은 다른 칸을 고칠 때도 유지합니다. */
    if (Array.isArray(m.uids) && m.uids.length) {
      out.uids = m.uids.filter(function (u) { return typeof u === 'string' && u; }).slice(0, 8);
    }
    return out;
  }

  /* 등록된 휴대폰 번호 (없으면 빈 문자열) */
  function telOf(m) { return m && m.tel ? String(m.tel) : ''; }
  function telHref(tel) { return 'tel:' + FamilyCloud.telDigits(tel); }

  /* 방 문서에서 구성원·PIN 해시·등록 요청을 받아 화면 상태에 반영합니다. */
  function applyRoomMeta(info) {
    var list = info && Array.isArray(info.members) ? info.members : [];
    var next = [];
    list.forEach(function (m) {
      if (!m || typeof m.name !== 'string' || !m.name) return;
      var id = String(m.id || '');
      if (!id) return;
      var color = /^#[0-9a-fA-F]{3,8}$/.test(m.color || '') ? m.color : '#64748b';
      next.push({
        id: id,
        name: m.name.slice(0, 12),
        color: color,
        bg: /^#[0-9a-fA-F]{3,8}$/.test(m.bg || '') ? m.bg : (color + '1f'),
        role: m.role === 'admin' || m.role === 'manager' ? m.role : 'member',
        tel: FamilyCloud.normalizeTel(m.tel || ''),
        uids: Array.isArray(m.uids) ? m.uids.filter(function (u) { return typeof u === 'string' && u; }).slice(0, 8) : [],
        photoDataUrl: typeof m.photoDataUrl === 'string' && m.photoDataUrl.indexOf('data:image/') === 0 ? m.photoDataUrl : ''
      });
    });
    MEMBERS = next.length ? next : DEFAULT_MEMBERS.slice();
    /* 새로 만든 방은 구성원 목록이 비어 있습니다. 화면에 보이는 기본 구성원을 방에 한 번
       저장해, 신상정보 변경 요청의 '바뀌기 전 이름'과 승인이 어긋나지 않게 합니다. */
    if (info && Array.isArray(info.members) && !info.members.length && !state.membersSeedSent) {
      state.membersSeedSent = true;
      FamilyCloud.saveMembers(MEMBERS.map(plainMember)).catch(function () {
        state.membersSeedSent = false;
      });
    }
    state.roomPins = info && info.pins && typeof info.pins === 'object' ? info.pins : {};
    state.revokedUids = info && Array.isArray(info.revokedUids) ? info.revokedUids : [];
    state.removedMembers = info && info.removedMembers && typeof info.removedMembers === 'object' ? info.removedMembers : {};
    requests = info && Array.isArray(info.requests) ? info.requests : [];
    profileRequests = info && Array.isArray(info.profileRequests) ? info.profileRequests : [];
    if (state.member !== 'all' && !memberById(state.member)) state.member = 'all';
    if (state.profile && !memberById(state.profile)) {
      state.profile = '';
      rememberProfile('');
    }
    state.blocked = familyBlockReason();
    if (state.blocked) { showFamilyBlocked(); return; }
    hideFamilyBlocked();
    renderAll();
    ensureProfile();
  }

  /* 내보낸 구성원의 계정(uid)인지 — 그 계정으로는 가족 달력을 열 수 없게 합니다.
     (메인 관리자 프로필로 들어와 있을 때는 잠그지 않아 스스로 잠기는 일을 막습니다) */
  function familyBlockReason() {
    var info = accountNow();
    var uid = info && info.uid ? info.uid : '';
    if (!uid) return '';
    if ((state.revokedUids || []).indexOf(uid) < 0) return '';
    var mine = myMember();
    if (mine && (mine.role || 'member') === 'admin') return '';
    return '내보내기(이용 정지) 처리되어 가족 달력에 접근할 수 없습니다';
  }

  function showFamilyBlocked() {
    if (!el.familyBlockedModal) return;
    if (el.familyBlockedMsg) el.familyBlockedMsg.textContent = state.blocked || '내보내기(이용 정지) 처리되어 가족 달력에 접근할 수 없습니다';
    el.familyBlockedModal.hidden = false;
  }

  function hideFamilyBlocked() {
    if (el.familyBlockedModal) el.familyBlockedModal.hidden = true;
  }

  /* 계정이 바뀌었을 때 차단 상태를 다시 봅니다. */
  function checkFamilyBlock() {
    var reason = familyBlockReason();
    if (reason) { state.blocked = reason; showFamilyBlocked(); return true; }
    if (state.blocked) {
      state.blocked = '';
      hideFamilyBlocked();
      renderAll();
    }
    return false;
  }

  function ensureProfile() {
    if (!el.profileModal) return;
    if (!state.profile) {
      var saved = savedProfile();
      if (saved && memberById(saved)) {
        state.profile = saved;
        renderAll();
      }
    }
    if (state.profile) return;
    if (!el.roomModal.hidden) return;
    if (!el.profileModal.hidden) return;
    /* 매장 화면을 보고 있는 기기에서는 가족 프로필 창을 띄우지 않습니다. */
    if (window.StoreMode && typeof window.StoreMode.isStoreActive === 'function' && window.StoreMode.isStoreActive()) return;
    openProfileModal();
  }

  function pendingProfileRequests() {
    return profileRequests.filter(function (r) { return r.status === 'pending'; });
  }

  function renderRoleUI() {
    var me = myMember();
    if (el.profileName) {
      el.profileName.textContent = me ? me.name : '사용자 선택';
      el.profileRole.textContent = me ? ROLE_LABEL[me.role || 'member'] : '';
      el.profileRole.hidden = !me || (me.role || 'member') === 'member';
      el.profileDot.style.background = me ? me.color : '#ffffff';
      if (me && me.photoDataUrl) {
        el.profileDot.style.backgroundImage = 'url("' + me.photoDataUrl + '")';
        el.profileDot.style.backgroundSize = 'cover';
        el.profileDot.style.backgroundPosition = 'center';
      } else {
        el.profileDot.style.backgroundImage = '';
      }
    }
    var manage = canManage();
    var pending = requests.filter(function (r) { return r.status === 'pending'; });
    var pendingCount = pending.length + pendingProfileRequests().length;
    if (el.approveBtn) {
      el.approveBtn.hidden = !manage;
      if (manage) {
        el.approveCount.textContent = String(pendingCount);
        el.approveBtn.classList.toggle('is-active', pendingCount > 0);
      }
    }
    if (el.addBtn) el.addBtn.textContent = manage ? '＋ 일정 추가' : '＋ 일정 등록 요청';
    if (el.resetBtn) el.resetBtn.hidden = !manage;
    if (el.codeBtn) el.codeBtn.hidden = !manage;
    var setAdminRow = document.getElementById('setAdminRow');
    if (setAdminRow) setAdminRow.hidden = !manage;
    var setMembersRow = document.getElementById('setMembersRow');
    if (setMembersRow) setMembersRow.hidden = !manage;
    renderMyRequests();
    if (el.approveModal && !el.approveModal.hidden) renderApproveCards();
    if (el.adminModal && !el.adminModal.hidden) {
      /* 이름을 고치는 중이면 입력하던 글자를 지우지 않도록 그 줄은 다시 그리지 않습니다. */
      var ae = document.activeElement;
      var typing = ae && el.adminMemberList.contains(ae)
        && ae.classList && ae.classList.contains('admin-member__name');
      if (!typing) renderAdminMembers();
      renderPinTargets();
    }
    if (el.profileModal && !el.profileModal.hidden) renderProfileList();
  }

  function formatReqDate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '날짜 없음';
    var dt = parseISO(iso);
    return (dt.getMonth() + 1) + '월 ' + dt.getDate() + '일(' + WEEKDAYS[dt.getDay()] + ')';
  }

  function requestStatusLabel(s) {
    if (s === 'approved') return '승인됨';
    if (s === 'rejected') return '거절됨';
    return '대기 중';
  }

  function buildRequestItem(r, withActions) {
    var li = document.createElement('li');
    li.className = 'req-card req-card--' + r.status;
    var cat = categoryById(r.category);

    var top = document.createElement('div');
    top.className = 'req-card__top';
    var title = document.createElement('strong');
    title.textContent = cat.emoji + ' ' + r.title;
    top.appendChild(title);
    var chip = document.createElement('span');
    chip.className = 'req-status req-status--' + r.status;
    chip.textContent = requestStatusLabel(r.status);
    top.appendChild(chip);
    li.appendChild(top);

    var meta = document.createElement('div');
    meta.className = 'req-card__meta';
    meta.textContent = '📅 ' + formatReqDate(r.date) + (r.endDate && r.endDate > r.date ? ' ~ ' + formatReqDate(r.endDate) : '') + ' · ' + (r.time ? r.time : '종일');
    li.appendChild(meta);

    var names = (r.members || []).map(function (id) {
      var m = memberById(id);
      return m ? m.name : '';
    }).filter(Boolean);
    if (names.length) {
      var who = document.createElement('div');
      who.className = 'req-card__meta';
      who.textContent = '👥 담당 ' + names.join('·');
      li.appendChild(who);
    }
    if (r.memo) {
      var memo = document.createElement('div');
      memo.className = 'req-card__memo';
      memo.textContent = r.memo;
      li.appendChild(memo);
    }
    var ck = checklistDone({ checklist: r.checklist || [] });
    if (ck.total) {
      var ckEl = document.createElement('div');
      ckEl.className = 'req-card__meta';
      ckEl.textContent = '☑️ 준비물 ' + ck.total + '개';
      li.appendChild(ckEl);
    }

    var by = document.createElement('div');
    by.className = 'req-card__by';
    var byText = (r.requesterName || '구성원') + ' 님이 요청';
    if (r.status !== 'pending' && r.decidedByName) {
      byText += ' · ' + r.decidedByName + ' 님이 ' + (r.status === 'approved' ? '승인' : '거절');
    }
    by.textContent = byText;
    li.appendChild(by);

    if (withActions && r.status === 'pending') {
      var actions = document.createElement('div');
      actions.className = 'req-card__actions';
      var reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'btn-ghost btn-small btn-danger';
      reject.textContent = '거절';
      reject.addEventListener('click', function () { decideRequest(r, false); });
      var approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'btn-primary btn-small';
      approve.textContent = '승인';
      approve.addEventListener('click', function () { decideRequest(r, true); });
      actions.appendChild(reject);
      actions.appendChild(approve);
      li.appendChild(actions);
    }
    return li;
  }

  /* 신상정보(이름·번호) 변경 요청 카드 */
  function profileChangeLines(r) {
    var lines = [];
    if (r.name) {
      lines.push(r.name === r.prevName
        ? '이름 ' + r.name + ' (그대로)'
        : '이름 ' + (r.prevName || '없음') + ' → ' + r.name);
    }
    if ((r.tel || '') !== (r.prevTel || '')) {
      lines.push('번호 ' + (r.prevTel || '미등록') + ' → ' + (r.tel || '지움'));
    } else if (r.tel) {
      lines.push('번호 ' + r.tel + ' (그대로)');
    }
    return lines;
  }

  function buildProfileRequestItem(r, withActions) {
    var li = document.createElement('li');
    li.className = 'req-card req-card--' + r.status;

    var top = document.createElement('div');
    top.className = 'req-card__top';
    var title = document.createElement('strong');
    title.textContent = '🙋 신상정보 변경 요청';
    top.appendChild(title);
    var chip = document.createElement('span');
    chip.className = 'req-status req-status--' + r.status;
    chip.textContent = requestStatusLabel(r.status);
    top.appendChild(chip);
    li.appendChild(top);

    var who = document.createElement('div');
    who.className = 'req-card__meta';
    var requester = r.requesterName || (memberById(r.targetId) ? memberById(r.targetId).name : '') || '구성원';
    who.textContent = '👤 ' + requester + ' 님';
    li.appendChild(who);

    profileChangeLines(r).forEach(function (line) {
      var row = document.createElement('div');
      row.className = 'req-card__meta';
      row.textContent = line;
      li.appendChild(row);
    });

    var by = document.createElement('div');
    by.className = 'req-card__by';
    var byText = (r.requesterName || '구성원') + ' 님이 요청';
    if (r.status !== 'pending' && r.decidedByName) {
      byText += ' · ' + r.decidedByName + ' 님이 ' + (r.status === 'approved' ? '승인' : '거절');
    }
    by.textContent = byText;
    li.appendChild(by);

    if (withActions && r.status === 'pending') {
      var actions = document.createElement('div');
      actions.className = 'req-card__actions';
      var reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'btn-ghost btn-small btn-danger';
      reject.textContent = '거절';
      reject.addEventListener('click', function () { decideProfileChange(r, false); });
      var approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'btn-primary btn-small';
      approve.textContent = '승인';
      approve.addEventListener('click', function () { decideProfileChange(r, true); });
      actions.appendChild(reject);
      actions.appendChild(approve);
      li.appendChild(actions);
    }
    return li;
  }

  function profileErrorHint(err) {
    var msg = (err && err.message) || '';
    if (msg === 'already-decided') return '이미 처리된 요청이에요. 화면을 새로 고쳐 확인해 주세요.';
    if (msg === 'member-missing') return '그 구성원을 찾을 수 없어요. 관리자 설정에서 확인해 주세요.';
    if (msg === 'name-taken') return '같은 이름의 구성원이 이미 있어요.';
    if (msg === 'request-missing') return '요청을 찾을 수 없어요. 화면을 새로 고쳐 확인해 주세요.';
    return errorHint(err);
  }

  /* 승인하면 members[] 가 바뀌고, 거절하면 그대로입니다. */
  function decideProfileChange(r, approve) {
    if (!canManage()) return;
    var me = myMember();
    if (!me) return;
    var who = r.requesterName || '구성원';
    if (!approve && !window.confirm(who + ' 님의 신상정보 변경 요청을 거절할까요?\n구성원 정보는 바뀌지 않아요.')) return;
    var run = approve ? FamilyCloud.approveProfileRequest : FamilyCloud.rejectProfileRequest;
    run(r, { id: me.id, name: me.name }, MEMBERS.map(plainMember)).then(function () {
      toast(approve ? who + ' 님 신상정보를 바꿨어요' : '거절했어요 · 구성원 정보는 그대로예요');
    }).catch(function (err) {
      window.alert('처리하지 못했어요 · ' + profileErrorHint(err));
    });
  }

  function renderMyRequests() {
    if (!el.myRequestsCard) return;
    var mine = requests.filter(function (r) { return r.requesterId && r.requesterId === state.profile; });
    var mineProf = profileRequests.filter(function (r) {
      return !!state.profile && (r.requesterId === state.profile || r.targetId === state.profile);
    });
    var show = !!state.profile && (mine.length > 0 || mineProf.length > 0 || !canManage());
    el.myRequestsCard.hidden = !show;
    if (!show) return;
    var waiting = mine.filter(function (r) { return r.status === 'pending'; }).length
      + mineProf.filter(function (r) { return r.status === 'pending'; }).length;
    el.myRequestsHint.textContent = waiting ? '대기 중 ' + waiting + '건' : '대기 중 없음';
    el.myRequestsList.innerHTML = '';
    if (!mine.length && !mineProf.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '아직 보낸 요청이 없어요. ＋ 일정 등록 요청으로 보내 보세요.';
      el.myRequestsList.appendChild(empty);
      return;
    }
    mine.forEach(function (r) {
      el.myRequestsList.appendChild(buildRequestItem(r, false));
    });
    mineProf.forEach(function (r) {
      el.myRequestsList.appendChild(buildProfileRequestItem(r, false));
    });
  }

  function decideRequest(r, approve) {
    if (!canManage()) return;
    var me = myMember();
    if (!me) return;
    if (!approve && !window.confirm('"' + r.title + '" 요청을 거절할까요?\n달력에는 올라가지 않아요.')) return;
    var run = approve ? FamilyCloud.approveRequest : FamilyCloud.rejectRequest;
    run(r, { id: me.id, name: me.name }).then(function () {
      toast(approve ? '승인했어요 · 달력에 올라갔어요' : '거절했어요 · 달력에 올라가지 않아요');
    }).catch(function (err) {
      window.alert('처리하지 못했어요 · ' + errorHint(err));
    });
  }

  function openApproveModal() {
    if (!canManage()) return;
    renderApproveCards();
    el.approveModal.hidden = false;
  }

  function renderApproveCards() {
    if (!el.reqCards) return;
    var pending = requests.filter(function (r) { return r.status === 'pending'; });
    var pendingProf = pendingProfileRequests();
    el.approveModalCount.textContent = String(pending.length + pendingProf.length);
    el.reqCards.innerHTML = '';
    if (!pending.length && !pendingProf.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '지금은 승인을 기다리는 요청이 없어요.';
      el.reqCards.appendChild(empty);
      return;
    }
    pending.forEach(function (r) {
      el.reqCards.appendChild(buildRequestItem(r, true));
    });
    pendingProf.forEach(function (r) {
      el.reqCards.appendChild(buildProfileRequestItem(r, true));
    });
  }

  function toast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2800);
  }

  /* ---------------- 계정 ----------------
     계정·이메일 / 구글 / 카카오 / 네이버 로그인 화면은 잠시 미뤄 두었습니다(2026-11-17).
     화면에는 로그인·계정 UI가 전혀 없고, Firestore 접근을 위해 cloud.js가 익명 인증을
     조용히 자동으로 유지합니다. 나중에 로그인을 다시 붙일 때 이 자리에 화면만 더하면 됩니다. */

  function accountFallback() {
    return { signedIn: false, anonymous: true, uid: '', email: '', name: '', method: 'anonymous', methodLabel: '익명 기기', providerId: '' };
  }

  function accountNow() {
    if (state.account) return state.account;
    if (window.FamilyCloud && typeof FamilyCloud.accountInfo === 'function') {
      try { return FamilyCloud.accountInfo(); } catch (e) { return accountFallback(); }
    }
    return accountFallback();
  }

  /* 로그인 화면이 없어도 익명 세션이 바뀌면 내보내기(차단) 상태를 다시 봅니다. */
  function initAccount() {
    if (!window.FamilyCloud || typeof FamilyCloud.onAuth !== 'function') return;
    FamilyCloud.onAuth(function (info) {
      state.account = info;
      checkFamilyBlock();
    });
  }

  /* ---------------- 프로필 선택 ---------------- */
  function openProfileModal() {
    if (!el.profileModal) return;
    renderProfileList();
    el.profileModal.hidden = false;
  }

  function closeProfileModal() {
    if (el.profileModal) el.profileModal.hidden = true;
  }

  function renderProfileList() {
    el.profileList.innerHTML = '';
    MEMBERS.forEach(function (m) {
      var role = m.role || 'member';
      var row = document.createElement('div');
      row.className = 'profile-row';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'profile-item' + (m.id === state.profile ? ' is-me' : '');
      var av = avatarNode(m, 26);
      av.classList.add('profile-item__dot');
      btn.appendChild(av);
      var name = document.createElement('span');
      name.className = 'profile-item__name';
      name.textContent = m.name;
      btn.appendChild(name);
      if (role !== 'member') {
        var badge = document.createElement('span');
        badge.className = 'profile-item__role';
        badge.textContent = '🔑 ' + ROLE_LABEL[role];
        btn.appendChild(badge);
      }
      if (m.id === state.profile) {
        var now = document.createElement('span');
        now.className = 'profile-item__now';
        now.textContent = '현재';
        btn.appendChild(now);
      }
      btn.addEventListener('click', function () { chooseProfile(m.id); });
      row.appendChild(btn);

      /* 등록된 번호는 눌러서 바로 전화(tel:) */
      var tel = telOf(m);
      if (tel) {
        var call = document.createElement('a');
        call.className = 'profile-call';
        call.href = telHref(tel);
        call.textContent = '📞 ' + tel;
        call.title = m.name + ' ' + tel + ' 전화';
        call.setAttribute('aria-label', m.name + ' ' + tel + ' 전화 걸기');
        row.appendChild(call);
      } else {
        var none = document.createElement('span');
        none.className = 'profile-call profile-call--none';
        none.textContent = '미등록';
        row.appendChild(none);
      }
      el.profileList.appendChild(row);
    });
    el.profileAdminActions.hidden = !canManage();
    renderMyInfo();
    renderNotifyBox();
  }

  /* 내 정보 — 지금 고른 구성원이 자기 이름·휴대폰 번호를 직접 고칩니다.
     일반 구성원이 저장하면 신상정보 변경 요청(pending)으로 올라가고, 아빠·엄마가 승인해야
     members[] 에 반영됩니다. 관리자(아빠·엄마)는 저장하면 바로 반영됩니다. */
  function renderMyInfo() {
    if (!el.myInfoBox) return;
    var me = myMember();
    el.myInfoBox.hidden = !me;
    if (!me) return;
    el.myInfoName.textContent = me.name;
    el.myInfoRole.textContent = ROLE_LABEL[me.role || 'member'];
    if (el.myNameInput && document.activeElement !== el.myNameInput) el.myNameInput.value = me.name;
    var tel = telOf(me);
    if (el.myTelInput && document.activeElement !== el.myTelInput) el.myTelInput.value = tel;
    el.myTelHint.textContent = tel
      ? '저장된 번호 ' + tel
      : '아직 번호가 없어요. 번호를 넣으면 구성원 목록에서 눌러 바로 전화할 수 있어요.';

    var mineProf = profileRequests.filter(function (r) { return r.targetId === me.id; });
    var pending = mineProf.filter(function (r) { return r.status === 'pending'; })[0];
    if (el.myInfoNote) {
      if (pending) {
        el.myInfoNote.textContent = '승인 대기 중 · ' + profileChangeLines(pending).join(', ')
          + '. 다시 저장하면 이 요청이 바뀝니다.';
      } else if (canManage()) {
        el.myInfoNote.textContent = '관리자는 저장하면 바로 반영돼요.';
      } else if (mineProf.length && mineProf[0].status === 'rejected') {
        el.myInfoNote.textContent = '마지막 변경 요청이 거절되었어요. 내용을 다시 확인해 저장해 보세요.';
      } else {
        el.myInfoNote.textContent = '저장하면 신상정보 변경 요청으로 올라가고, 아빠·엄마 승인 뒤에 반영돼요.';
      }
    }
  }

  function saveMyInfo() {
    var me = myMember();
    if (!me) { toast('먼저 이 폰을 쓰는 사람을 골라 주세요'); return; }
    var name = String(el.myNameInput ? el.myNameInput.value : me.name).trim().slice(0, 12);
    var tel = FamilyCloud.normalizeTel(el.myTelInput ? el.myTelInput.value : '');
    if (el.myTelInput) el.myTelInput.value = tel;
    if (!name) { toast('이름을 넣어 주세요'); return; }
    if (tel && !FamilyCloud.telLooksValid(tel)) {
      toast('휴대폰 번호를 다시 확인해 주세요 (예: 010-1234-5678)');
      return;
    }
    var nameSame = name === me.name;
    var telSame = tel === telOf(me);
    if (nameSame && telSame) { toast('저장된 정보와 같아요'); return; }
    if (!nameSame && MEMBERS.some(function (x) { return x.id !== me.id && x.name === name; })) {
      toast('같은 이름이 이미 있어요');
      return;
    }
    var btn = el.myInfoSaveBtn;
    if (btn) btn.disabled = true;

    /* 관리자(아빠·엄마): 저장하면 바로 반영 */
    if (canManage()) {
      var next = MEMBERS.map(plainMember);
      next.forEach(function (x) {
        if (x.id !== me.id) return;
        x.name = name;
        if (tel) x.tel = tel; else delete x.tel;
      });
      FamilyCloud.saveMembers(next).then(function () {
        toast(telSame ? '내 이름을 저장했어요' : '내 정보를 저장했어요');
        renderMyInfo();
      }).catch(function (err) {
        window.alert('저장하지 못했어요 · ' + errorHint(err));
      }).then(function () {
        if (btn) btn.disabled = false;
      });
      return;
    }

    /* 일반 구성원: 신상정보 변경 요청 */
    FamilyCloud.submitProfileRequest({ meId: me.id, meName: me.name, name: name, tel: tel }).then(function () {
      toast('변경 요청을 보냈어요 · 아빠·엄마 승인을 기다려 주세요');
      renderMyInfo();
    }).catch(function (err) {
      window.alert('요청을 보내지 못했어요 · ' + profileErrorHint(err));
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function chooseProfile(id) {
    var m = memberById(id);
    if (!m) return;
    if (m.id === state.profile) { closeProfileModal(); return; }
    var role = m.role || 'member';
    if (role === 'admin' || role === 'manager') { askPin(m); return; }
    switchProfile(m);
  }

  function switchProfile(m) {
    state.profile = m.id;
    rememberProfile(m.id);
    state.member = 'all';
    closeProfileModal();
    /* 이 폰의 계정을 이 프로필에 묶어 둡니다 — 나중에 관리자가 내보내면 그 계정을 차단할 수 있어요. */
    if (window.FamilyCloud && typeof FamilyCloud.bindMemberAccount === 'function') {
      FamilyCloud.bindMemberAccount(m.id);
    }
    renderAll();
    toast(m.name + ' 님으로 시작해요');
    syncAndroidAlarms();
    renderNotifyBox();
  }

  /* ---------------- 관리자 PIN ----------------
     PIN은 화면 잠금(편의)입니다. 서버 권한은 방 문서의 adminUids로 판정합니다.
     처음 쓰는 구성원은 기본 PIN 없이 "새 PIN 정하기"로 들어가고, 오답은 기기에 저장해 제한합니다. */
  var PIN_MAX_TRY = 5;
  var PIN_WAIT_MS = 60000;
  var PIN_GUARD_KEY = 'family-calendar.pin.guard.v1';

  function pinGuard() {
    try { return JSON.parse(localStorage.getItem(PIN_GUARD_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function pinGuardSave(g) {
    try { localStorage.setItem(PIN_GUARD_KEY, JSON.stringify(g || {})); } catch (e) { /* 무시 */ }
  }
  function pinWaitLeft(id) {
    var rec = pinGuard()[id];
    if (!rec || !rec.until) return 0;
    var left = rec.until - Date.now();
    return left > 0 ? left : 0;
  }
  function pinMiss(id) {
    var g = pinGuard();
    var rec = g[id] || { tries: 0, until: 0 };
    rec.tries = (Number(rec.tries) || 0) + 1;
    if (rec.tries >= PIN_MAX_TRY) { rec.tries = 0; rec.until = Date.now() + PIN_WAIT_MS; }
    g[id] = rec;
    pinGuardSave(g);
    return rec;
  }
  function pinClear(id) {
    var g = pinGuard();
    delete g[id];
    pinGuardSave(g);
  }

  function askPin(m) {
    state.pendingPin = m.id;
    el.pinTitle.textContent = m.name + ' · ' + ROLE_LABEL[m.role || 'manager'];
    el.pinError.hidden = true;
    el.pinInput.value = '';
    if (el.pinConfirmInput) el.pinConfirmInput.value = '';
    var stored = state.roomPins && state.roomPins[m.id];
    var wait = pinWaitLeft(m.id);
    if (el.pinConfirmField) el.pinConfirmField.hidden = !!stored;
    el.pinHint.textContent = stored
      ? '등록된 4자리 PIN을 넣어 주세요.'
      : (wait
        ? '너무 여러 번 틀렸어요. ' + Math.ceil(wait / 1000) + '초 뒤에 다시 넣어 주세요.'
        : '이 기기에서 처음 쓰는 관리자 PIN이에요. 새 PIN(4자리)을 정해 아래에 한 번 더 넣어 주세요.');
    el.pinModal.hidden = false;
    try { el.pinInput.focus(); } catch (e) { /* 무시 */ }
  }

  function showPinError(msg) {
    el.pinError.textContent = msg;
    el.pinError.hidden = false;
  }

  function submitPin(e) {
    if (e) e.preventDefault();
    var m = memberById(state.pendingPin);
    if (!m) { el.pinModal.hidden = true; return; }
    var wait = pinWaitLeft(m.id);
    if (wait) { showPinError('너무 여러 번 틀렸어요. ' + Math.ceil(wait / 1000) + '초 뒤에 다시 넣어 주세요.'); return; }
    var pin = el.pinInput.value.replace(/\D/g, '');
    if (pin.length !== 4) { showPinError('4자리 숫자를 넣어 주세요.'); return; }
    var stored = state.roomPins && state.roomPins[m.id];
    if (!stored) {
      var again = el.pinConfirmInput ? el.pinConfirmInput.value.replace(/\D/g, '') : '';
      if (again !== pin) { showPinError('두 번 넣은 PIN이 달라요.'); return; }
      FamilyCloud.setPin(m.id, pin).then(function () {
        state.roomPins = state.roomPins || {};
        state.roomPins[m.id] = FamilyCloud.pinHash(m.id, pin);
        pinClear(m.id);
        el.pinError.hidden = true;
        el.pinModal.hidden = true;
        state.pendingPin = '';
        switchProfile(m);
        toast('관리자 PIN을 새로 정했어요 · 다음부터 이 PIN으로 들어옵니다');
      }).catch(function () {
        showPinError('PIN을 저장하지 못했어요. 잠시 뒤 다시 해 주세요.');
      });
      return;
    }
    var ok = FamilyCloud.pinHash(m.id, pin) === stored;
    if (!ok) {
      var rec = pinMiss(m.id);
      if (rec.until) showPinError('5번 틀렸어요. 1분 뒤에 다시 넣어 주세요.');
      else showPinError('PIN이 맞지 않아요. (' + rec.tries + '/' + PIN_MAX_TRY + ')');
      return;
    }
    pinClear(m.id);
    el.pinError.hidden = true;
    el.pinModal.hidden = true;
    state.pendingPin = '';
    switchProfile(m);
  }

  /* ---------------- 관리자 설정 ---------------- */
  function openAdminModal(scrollToMembers) {
    if (!canManage()) return;
    el.memberError.hidden = true;
    el.pinChangeError.hidden = true;
    var okEl = document.getElementById('pinChangeOk');
    if (okEl) okEl.hidden = true;
    el.newMemberName.value = '';
    if (el.newMemberTel) el.newMemberTel.value = '';
    el.newPin.value = '';
    el.newPin2.value = '';
    renderAdminMembers();
    renderMemberColors();
    renderPinTargets();
    renderAdminJoins();
    el.adminModal.hidden = false;
    /* ⚙️ → 가족 이름·번호 바꾸기 로 들어오면 구성원 목록부터 보여 줍니다. */
    if (scrollToMembers === true && el.adminMembersBlock) {
      try {
        var sheet = el.adminModal.querySelector('.modal__sheet');
        if (sheet && sheet.scrollTo) {
          var top = el.adminMembersBlock.getBoundingClientRect().top - sheet.getBoundingClientRect().top;
          sheet.scrollTo({ top: Math.max(0, sheet.scrollTop + top - 10) });
        } else {
          el.adminMembersBlock.scrollIntoView({ block: 'start' });
        }
      } catch (e) { /* 무시 */ }
    }
  }

  /* 구성원 사진 지우기 */
  function clearMemberPhoto(m) {
    if (!canManage()) return;
    var next = MEMBERS.map(plainMember);
    next.forEach(function (x) { if (x.id === m.id) x.photoDataUrl = ''; });
    saveMemberList(next, m.name + ' 님 사진을 지웠어요');
  }

  function renderAdminMembers() {
    el.adminMemberList.innerHTML = '';
    MEMBERS.forEach(function (m) {
      var role = m.role || 'member';
      var li = document.createElement('li');
      li.className = 'admin-member';

      var photoBtn = document.createElement('button');
      photoBtn.type = 'button';
      photoBtn.className = 'admin-member__photo';
      photoBtn.setAttribute('aria-label', m.name + ' 사진 바꾸기');
      photoBtn.title = '사진 바꾸기';
      var av = avatarNode(m, 30);
      photoBtn.appendChild(av);
      photoBtn.addEventListener('click', function () { pickMemberPhoto(m); });
      li.appendChild(photoBtn);
      if (m.photoDataUrl) {
        var clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'admin-member__photo-clear';
        clear.textContent = '✕';
        clear.title = '사진 지우기';
        clear.setAttribute('aria-label', m.name + ' 사진 지우기');
        clear.addEventListener('click', function () { clearMemberPhoto(m); });
        li.appendChild(clear);
      }

      var nameRow = document.createElement('span');
      nameRow.className = 'admin-member__namerow';
      var pen = document.createElement('span');
      pen.className = 'admin-member__pen';
      pen.textContent = '✏️';
      pen.setAttribute('aria-hidden', 'true');
      nameRow.appendChild(pen);

      var name = document.createElement('input');
      name.type = 'text';
      name.className = 'admin-member__name';
      name.value = m.name;
      name.maxLength = 12;
      name.setAttribute('aria-label', m.name + ' 이름 바꾸기');
      name.setAttribute('autocomplete', 'off');
      name.title = '이름을 고치고 Enter 또는 [✓ 저장]을 누르면 저장돼요';
      nameRow.appendChild(name);
      li.appendChild(nameRow);

      /* 이름을 고치면 줄 아래 [✓ 이름 저장] 이 나타났다가, 저장되면 사라집니다. */
      var saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'admin-member__save';
      saveBtn.textContent = '✓ 이름 저장';
      saveBtn.hidden = true;
      saveBtn.setAttribute('aria-label', m.name + ' 새 이름 저장');
      saveBtn.addEventListener('click', function () { changeMemberName(m, name.value); });

      function syncDirty() {
        var typed = String(name.value || '').trim().slice(0, 12);
        var dirty = typed !== m.name && typed.length > 0;
        li.classList.toggle('admin-member--dirty', dirty);
        saveBtn.hidden = !dirty;
      }
      name.addEventListener('input', syncDirty);
      name.addEventListener('change', function () { changeMemberName(m, name.value); });
      name.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        changeMemberName(m, name.value);
      });

      var select = document.createElement('select');
      select.className = 'admin-member__role';
      ['admin', 'manager', 'member'].forEach(function (r) {
        var opt = document.createElement('option');
        opt.value = r;
        opt.textContent = ROLE_LABEL[r];
        if (r === role) opt.selected = true;
        select.appendChild(opt);
      });
      select.disabled = !isAdmin();
      if (!isAdmin()) select.classList.add('is-locked');
      select.addEventListener('change', function () { changeRole(m, select.value); });
      li.appendChild(select);

      /* 휴대폰 번호 — 숫자/하이픈 자동 정리, 다른 곳을 누르면 저장 */
      var telRow = document.createElement('div');
      telRow.className = 'admin-member__tel';
      var telIcon = document.createElement('span');
      telIcon.className = 'admin-member__tel-icon';
      telIcon.textContent = '📞';
      telRow.appendChild(telIcon);
      var tel = document.createElement('input');
      tel.type = 'tel';
      tel.className = 'admin-member__telinput';
      tel.value = telOf(m);
      tel.placeholder = '010-1234-5678';
      tel.maxLength = 20;
      tel.setAttribute('inputmode', 'tel');
      tel.setAttribute('autocomplete', 'off');
      tel.setAttribute('aria-label', m.name + ' 휴대폰 번호');
      tel.title = '번호를 넣고 다른 곳을 누르면 저장돼요';
      tel.addEventListener('change', function () { changeMemberTel(m, tel.value); });
      telRow.appendChild(tel);

      /* 메인 관리자만 일반 구성원을 내보낼 수 있어요 — 전화번호 줄 끝에 작게 */
      if (isAdmin() && (m.role || 'member') !== 'admin') {
        var outBtn = document.createElement('button');
        outBtn.type = 'button';
        outBtn.className = 'admin-member__out';
        outBtn.textContent = '🚪';
        outBtn.title = m.name + ' 님을 가족 달력에서 내보내기';
        outBtn.setAttribute('aria-label', m.name + ' 가족 달력에서 내보내기');
        outBtn.addEventListener('click', function () { removeFamilyMember(m); });
        telRow.appendChild(outBtn);
      }

      li.appendChild(telRow);
      li.appendChild(saveBtn);

      el.adminMemberList.appendChild(li);
    });
    renderRemovedMembers();
  }

  /* 내보낸 구성원 목록 (관리자 설정) — 잘못 내보냈을 때 되돌리기 */
  function renderRemovedMembers() {
    if (!el.adminRemovedBlock || !el.adminRemovedList) return;
    if (!isAdmin()) { el.adminRemovedBlock.hidden = true; return; }
    var list = state.removedMembers || {};
    var keys = Object.keys(list);
    el.adminRemovedList.innerHTML = '';
    el.adminRemovedBlock.hidden = !keys.length;
    if (!keys.length) return;
    keys.forEach(function (key) {
      var r = list[key];
      if (!r || !r.name) return;
      var li = document.createElement('li');
      li.className = 'admin-member admin-member--out';
      var dot = document.createElement('span');
      dot.className = 'admin-member__dot';
      dot.style.background = r.color || '#94a3b8';
      li.appendChild(dot);
      var name = document.createElement('span');
      name.className = 'admin-member__name';
      name.textContent = r.name;
      li.appendChild(name);
      var badge = document.createElement('span');
      badge.className = 'admin-member__badge';
      badge.textContent = (r.uids && r.uids.length) ? '계정 차단됨' : '계정 기록 없음';
      li.appendChild(badge);
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn-ghost btn-small';
      back.textContent = '되돌리기';
      back.addEventListener('click', function () { restoreFamilyMember(key, r); });
      li.appendChild(back);
      el.adminRemovedList.appendChild(li);
    });
  }

  /* 🚪 가족 구성원 내보내기 — 목록에서 빼고, 그 구성원 계정을 차단합니다. */
  function removeFamilyMember(m) {
    if (!isAdmin()) { toast('메인 관리자만 구성원을 내보낼 수 있어요'); return; }
    if ((m.role || 'member') === 'admin') { toast('메인 관리자는 내보낼 수 없어요'); return; }
    if (m.id === state.profile) { window.alert('지금 이 폰에서 쓰는 프로필은 내보낼 수 없어요.\n다른 구성원을 골라 주세요.'); return; }
    if (!window.confirm(m.name + ' 님을 가족 달력에서 내보낼까요?\n\n'
      + '· 구성원 목록에서 빠지고, 로그인한 계정은 다시 들어올 수 없어요.\n'
      + '· 지금까지 넣은 일정과 확인 기록은 그대로 남아요.')) return;
    FamilyCloud.removeMember(m.id, myMember()).then(function (uids) {
      if (!uids || !uids.length) {
        window.alert(m.name + ' 님을 가족 달력에서 내보냈어요.\n\n'
          + '다만 이 구성원은 로그인(계정) 기록이 없어서 계정 차단은 안 됐어요.\n'
          + '그 폰에서는 다시 들어와 다른 구성원를 고를 수 있으니, 필요하면 구성원 목록을 확인해 주세요.');
      } else {
        toast(m.name + ' 님을 내보냈어요 · 그 계정은 다시 들어올 수 없어요');
      }
    }).catch(function (err) {
      var msg = (err && err.message) || '';
      if (msg === 'cannot-remove-admin') window.alert('메인 관리자는 내보낼 수 없어요.');
      else if (msg === 'member-missing') window.alert('구성원을 찾지 못했어요. 화면을 새로 고쳐 확인해 주세요.');
      else window.alert('내보내지 못했어요 · ' + errorHint(err));
    });
  }

  function restoreFamilyMember(key, r) {
    if (!isAdmin()) return;
    var name = r && r.name ? r.name : '이 구성원';
    if (!window.confirm(name + ' 님을 다시 구성원으로 넣을까요?\n\n그 계정의 차단이 풀러서 다시 들어올 수 있어요.')) return;
    FamilyCloud.restoreMember(key).then(function () {
      toast(name + ' 님을 다시 넣었어요 · 차단도 풀렸어요');
    }).catch(function (err) {
      var msg = (err && err.message) || '';
      if (msg === 'name-taken') window.alert('같은 이름의 구성원이 이미 있어서 되돌리지 못했어요.\n그 구성원 이름을 바꾼 뒤 다시 시도해 주세요.');
      else window.alert('되돌리지 못했어요 · ' + errorHint(err));
    });
  }

  /* 구성원 이름 변경 — 달력 칩·일정·프로필에 바로 반영 */
  function changeMemberName(m, raw) {
    if (!canManage()) return;
    var name = String(raw || '').trim().slice(0, 12);
    if (!name) { toast('이름을 넣어 주세요'); renderAdminMembers(); return; }
    if (name === m.name) return;
    if (MEMBERS.some(function (x) { return x.id !== m.id && x.name === name; })) {
      toast('같은 이름이 이미 있어요');
      renderAdminMembers();
      return;
    }
    var next = MEMBERS.map(plainMember);
    next.forEach(function (x) { if (x.id === m.id) x.name = name; });
    saveMemberList(next, (m.name || '구성원') + ' → ' + name + ' 으로 바꿨어요');
  }

  /* 구성원 휴대폰 번호 — 관리자 설정에서 저장 (숫자/하이픈 자동 정리) */
  function changeMemberTel(m, raw) {
    if (!canManage()) return;
    var tel = FamilyCloud.normalizeTel(raw);
    if (tel === telOf(m)) return;
    if (tel && !FamilyCloud.telLooksValid(tel)) {
      toast('휴대폰 번호를 다시 확인해 주세요 (예: 010-1234-5678)');
      renderAdminMembers();
      return;
    }
    var next = MEMBERS.map(plainMember);
    next.forEach(function (x) { if (x.id === m.id) { if (tel) x.tel = tel; else delete x.tel; } });
    saveMemberList(next, tel ? m.name + ' 님 번호를 저장했어요' : m.name + ' 님 번호를 지웠어요');
  }

  /* 구성원 사진 — 160×160으로 줄여 방 문서에 저장 */
  function pickMemberPhoto(m) {
    if (!canManage()) return;
    CalendarMedia.pickFiles(false).then(function (files) {
      if (!files || !files.length) return;
      CalendarMedia.square(files[0], 160, 0.82).then(function (url) {
        var next = MEMBERS.map(plainMember);
        next.forEach(function (x) { if (x.id === m.id) x.photoDataUrl = url; });
        saveMemberList(next, m.name + ' 님 사진을 저장했어요');
      }).catch(function () {
        toast('사진을 읽지 못했어요');
      });
    });
  }

  function changeRole(m, role) {
    if (!isAdmin()) return;
    if ((m.role || 'member') === role) return;
    var next = MEMBERS.map(plainMember);
    if (role === 'admin') {
      var cur = MEMBERS.filter(function (x) { return (x.role || 'member') === 'admin' && x.id !== m.id; });
      if (cur.length && !window.confirm(m.name + ' 님을 메인 관리자로 바꿀까요?\n지금 메인 관리자(' + cur[0].name + ')는 부매니저가 됩니다.')) {
        renderAdminMembers();
        return;
      }
      next.forEach(function (x) { if (x.role === 'admin' && x.id !== m.id) x.role = 'manager'; });
    }
    next.forEach(function (x) { if (x.id === m.id) x.role = role; });
    if (!next.some(function (x) { return x.role === 'admin'; })) {
      window.alert('메인 관리자는 한 명 이상 있어야 해요.');
      renderAdminMembers();
      return;
    }
    saveMemberList(next, m.name + ' 님 역할을 ' + ROLE_LABEL[role] + '(으)로 바꿨어요');
  }

  /* 저장한 구성을 바로 화면에 반영합니다 — 서버 응답(실시간 반영)을 기다리지 않아도
     구성원 칩·일정 담당자·내 정보·관리자 목록이 즉시 바뀝니다. */
  function applyMembersLocal(list) {
    MEMBERS = (list || []).map(function (m) {
      return {
        id: m.id,
        name: String(m.name || '').slice(0, 12),
        color: /^#[0-9a-fA-F]{3,8}$/.test(m.color || '') ? m.color : '#64748b',
        bg: /^#[0-9a-fA-F]{3,8}$/.test(m.bg || '') ? m.bg : '#f1f5f9',
        role: m.role === 'admin' || m.role === 'manager' ? m.role : 'member',
        tel: FamilyCloud.normalizeTel(m.tel || ''),
        uids: Array.isArray(m.uids) ? m.uids.filter(function (u) { return typeof u === 'string' && u; }).slice(0, 8) : [],
        photoDataUrl: typeof m.photoDataUrl === 'string' ? m.photoDataUrl : ''
      };
    });
    if (!MEMBERS.length) MEMBERS = DEFAULT_MEMBERS.slice();
    if (state.member !== 'all' && !memberById(state.member)) state.member = 'all';
    renderAll();
    if (el.adminModal && !el.adminModal.hidden) renderAdminMembers();
  }

  function saveMemberList(next, okMsg) {
    var before = MEMBERS.map(plainMember);
    applyMembersLocal(next);
    if (okMsg) toast(okMsg);
    renderPinTargets();
    FamilyCloud.saveMembers(next).then(function () {
      /* 서버 저장 완료 — 실시간 반영(onRoom)이 최종 값을 한 번 더 맞춰 줍니다. */
    }).catch(function (err) {
      applyMembersLocal(before);
      window.alert('저장하지 못했어요 · ' + errorHint(err));
    });
  }

  function renderMemberColors() {
    el.newMemberColors.innerHTML = '';
    MEMBER_COLORS.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (i === state.memberColor ? ' is-on' : '');
      b.style.background = c;
      b.setAttribute('aria-label', '색상 ' + (i + 1) + ' · ' + c);
      b.title = c;
      b.addEventListener('click', function () {
        state.memberColor = i;
        Array.prototype.forEach.call(el.newMemberColors.children, function (child) {
          child.classList.remove('is-on');
        });
        b.classList.add('is-on');
      });
      el.newMemberColors.appendChild(b);
    });
  }

  function showMemberError(msg) {
    el.memberError.textContent = msg;
    el.memberError.hidden = false;
  }

  function addMember() {
    if (!canManage()) return;
    var name = el.newMemberName.value.trim();
    var tel = FamilyCloud.normalizeTel(el.newMemberTel ? el.newMemberTel.value : '');
    if (!name) { showMemberError('이름을 넣어 주세요.'); return; }
    if (name.length > 12) { showMemberError('이름은 12자까지 넣을 수 있어요.'); return; }
    if (tel && !FamilyCloud.telLooksValid(tel)) { showMemberError('휴대폰 번호를 다시 확인해 주세요 (예: 010-1234-5678).'); return; }
    if (MEMBERS.some(function (m) { return m.name === name; })) { showMemberError('같은 이름이 이미 있어요.'); return; }
    if (MEMBERS.length >= 12) { showMemberError('구성원은 12명까지 추가할 수 있어요.'); return; }
    var color = MEMBER_COLORS[state.memberColor % MEMBER_COLORS.length];
    var next = MEMBERS.map(plainMember);
    var added = { id: 'm' + Date.now().toString(36), name: name, color: color, bg: color + '1f', role: 'member' };
    if (tel) added.tel = tel;
    next.push(added);
    el.memberError.hidden = true;
    el.newMemberName.value = '';
    if (el.newMemberTel) el.newMemberTel.value = '';
    saveMemberList(next, name + ' 님을 구성원으로 추가했어요');
  }

  function renderPinTargets() {
    el.pinTargets.innerHTML = '';
    var targets = MEMBERS.filter(function (m) {
      var r = m.role || 'member';
      if (r !== 'admin' && r !== 'manager') return false;
      return isAdmin() || m.id === state.profile;
    });
    if (!targets.some(function (m) { return m.id === state.pinTarget; })) {
      state.pinTarget = targets.length ? targets[0].id : '';
    }
    targets.forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick' + (m.id === state.pinTarget ? ' is-on' : '');
      b.style.setProperty('--c', m.color);
      b.style.setProperty('--bgc', m.bg);
      b.style.setProperty('--fgc', m.color);
      b.textContent = m.name + ' · ' + ROLE_LABEL[m.role || 'member'];
      b.addEventListener('click', function () {
        state.pinTarget = m.id;
        Array.prototype.forEach.call(el.pinTargets.children, function (child) {
          child.classList.remove('is-on');
        });
        b.classList.add('is-on');
      });
      el.pinTargets.appendChild(b);
    });
  }

  function showPinChangeError(msg) {
    var okEl = document.getElementById('pinChangeOk');
    if (okEl) okEl.hidden = true;
    el.pinChangeError.textContent = msg;
    el.pinChangeError.hidden = false;
  }

  function changePin() {
    var target = memberById(state.pinTarget);
    if (!target) { showPinChangeError('PIN을 바꿀 사람을 골라 주세요.'); return; }
    var pin = el.newPin.value.replace(/\D/g, '');
    var pin2 = el.newPin2.value.replace(/\D/g, '');
    if (pin.length !== 4) { showPinChangeError('4자리 숫자를 넣어 주세요.'); return; }
    if (pin !== pin2) { showPinChangeError('두 번 넣은 PIN이 달라요.'); return; }
    el.pinChangeError.hidden = true;
    var okEl = document.getElementById('pinChangeOk');
    if (okEl) okEl.hidden = true;
    try { el.newPin.blur(); el.newPin2.blur(); } catch (e) { /* 무시 */ }
    FamilyCloud.setPin(target.id, pin).then(function () {
      state.roomPins = state.roomPins || {};
      state.roomPins[target.id] = FamilyCloud.pinHash(target.id, pin);
      el.newPin.value = '';
      el.newPin2.value = '';
      if (okEl) {
        okEl.textContent = '✓ ' + target.name + ' 님 PIN을 저장했어요';
        okEl.hidden = false;
      }
      toast(target.name + ' 님 PIN을 저장했어요');
    }).catch(function (err) {
      showPinChangeError('저장하지 못했어요 · ' + errorHint(err));
    });
  }

  /* ---------------- 일정 상세(일반 구성원) ---------------- */
  function openDetail(ev) {
    var y = Number(ev.date.slice(0, 4));
    var cat = categoryById(ev.category);
    var dt = parseISO(ev.date);
    el.detailTitle.textContent = cat.emoji + ' ' + ev.title;
    el.detailBody.innerHTML = '';
    var rows = [];
    rows.push(['날짜', dt.getFullYear() + '년 ' + (dt.getMonth() + 1) + '월 ' + dt.getDate() + '일 (' + WEEKDAYS[dt.getDay()] + ')']);
    if (ev.endDate && ev.endDate > ev.date) {
      var ed = parseISO(ev.endDate);
      rows.push(['기간', (dt.getMonth() + 1) + '월 ' + dt.getDate() + '일 ~ ' + (ed.getMonth() + 1) + '월 ' + ed.getDate() + '일 (' + (dayDiff(dt, ed) + 1) + '일간)']);
    }
    if (ev.time) rows.push(['시간', ev.time]);
    rows.push(['종류', cat.label]);
    var names = (ev.members || []).map(function (id) {
      var m = memberById(id);
      return m ? m.name : '';
    }).filter(Boolean);
    if (names.length) rows.push(['담당', names.join(' · ')]);
    var lunarText = lunarTextFor(ev, y);
    if (lunarText) rows.push(['음력', lunarText]);
    var repLabel = repeatLabel(ev);
    if (repLabel) rows.push(['반복', repLabel]);
    if (ev.remind !== null && ev.remind !== undefined) rows.push(['알림', '🔔 ' + remindLabel(ev.remind)]);
    if (ev.memo) rows.push(['메모', ev.memo]);
    rows.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'detail-row';
      var k = document.createElement('span');
      k.className = 'detail-row__k';
      k.textContent = r[0];
      var v = document.createElement('span');
      v.className = 'detail-row__v';
      v.textContent = r[1];
      row.appendChild(k);
      row.appendChild(v);
      el.detailBody.appendChild(row);
    });
    var note = document.createElement('p');
    note.className = 'field-hint';
    note.textContent = '일정 수정·삭제는 아빠·엄마만 할 수 있어요. 준비물 체크는 누구나 할 수 있어요.';
    if (ev.checklist && ev.checklist.length) {
      var wrap = document.createElement('div');
      wrap.className = 'detail-check';
      var h = document.createElement('div');
      h.className = 'detail-check__head';
      var c = checklistDone(ev);
      h.textContent = '☑️ 준비물 ' + c.done + '/' + c.total;
      wrap.appendChild(h);
      wrap.appendChild(buildChecklistNode(ev, 'detail'));
      el.detailBody.appendChild(wrap);
    }
    el.detailBody.appendChild(note);
    el.detailModal.hidden = false;
  }

  function bindRoles() {
    el.profileBtn.addEventListener('click', openProfileModal);
    el.profileClose.addEventListener('click', function () {
      if (state.profile) closeProfileModal();
    });
    var profileBackdrop = el.profileModal.querySelector('[data-close]');
    if (profileBackdrop) profileBackdrop.addEventListener('click', function () {
      if (state.profile) closeProfileModal();
    });
    el.approveBtn.addEventListener('click', openApproveModal);
    el.approveClose.addEventListener('click', function () { el.approveModal.hidden = true; });
    var approveBackdrop = el.approveModal.querySelector('[data-close]');
    if (approveBackdrop) approveBackdrop.addEventListener('click', function () { el.approveModal.hidden = true; });
    el.pinForm.addEventListener('submit', submitPin);
    el.pinClose.addEventListener('click', function () { el.pinModal.hidden = true; state.pendingPin = ''; });
    var pinBackdrop = el.pinModal.querySelector('[data-close]');
    if (pinBackdrop) pinBackdrop.addEventListener('click', function () { el.pinModal.hidden = true; state.pendingPin = ''; });
    el.adminBtn.addEventListener('click', openAdminModal);
    el.adminClose.addEventListener('click', function () { el.adminModal.hidden = true; });
    var adminBackdrop = el.adminModal.querySelector('[data-close]');
    if (adminBackdrop) adminBackdrop.addEventListener('click', function () { el.adminModal.hidden = true; });
    el.addMemberBtn.addEventListener('click', addMember);
    if (el.myInfoSaveBtn) el.myInfoSaveBtn.addEventListener('click', saveMyInfo);
    [el.myNameInput, el.myTelInput].forEach(function (input) {
      if (!input) return;
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); saveMyInfo(); }
      });
    });
    el.changePinBtn.addEventListener('click', changePin);
    el.detailClose.addEventListener('click', function () { el.detailModal.hidden = true; });
    el.detailOk.addEventListener('click', function () { el.detailModal.hidden = true; });
    var detailBackdrop = el.detailModal.querySelector('[data-close]');
    if (detailBackdrop) detailBackdrop.addEventListener('click', function () { el.detailModal.hidden = true; });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!el.detailModal.hidden) el.detailModal.hidden = true;
      if (!el.approveModal.hidden) el.approveModal.hidden = true;
      if (!el.adminModal.hidden) el.adminModal.hidden = true;
      if (!el.pinModal.hidden) { el.pinModal.hidden = true; state.pendingPin = ''; }
      if (!el.profileModal.hidden && state.profile) closeProfileModal();
    });
  }

  /* ---------------- PWA ---------------- */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () { /* 오프라인 캐시는 없어도 동작 */ });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    init();
    registerSW();
  });

  window.FamilyCalendar = {
    get events() { return events; },
    get requests() { return requests; },
    occurrenceForYear: occurrenceForYear,
    occurrenceRange: occurrenceRange,
    occurrenceCovering: occurrenceCovering,
    occurrenceStarts: occurrenceStarts,
    eventsOn: eventsOn,
    buildKakaoText: buildKakaoText,
    seedSamples: seedSamples,
    inviteLink: inviteLink,
    /* 알림 점검용 */
    notifyPrefs: function () { return myNotifyPrefs(); },
    notifyCovers: function (ev) { return notifyCovers(ev); },
    alarmPlan: function (days) { return buildAlarmPlan(days || 45); },
    syncAlarms: syncAndroidAlarms,
    checkReminders: checkReminders,
    isReady: function () { return cloudReady; },
    role: function () { return myRole(); },
    profile: function () { return state.profile; },
    connect: startCloud,
    paintStatus: paintStatus,
    applyVoice: applyVoiceEvent
  };
})();
