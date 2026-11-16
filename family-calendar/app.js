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
  var INITIAL_PIN = '2026';

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
    saving: false,
    profile: '',
    roomPins: {},
    pendingPin: '',
    pinTarget: '',
    memberColor: 0
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

  function eventsOn(dateISO) {
    var y = Number(dateISO.slice(0, 4));
    return events.filter(function (ev) {
      if (!passesMemberFilter(ev)) return false;
      var r = occurrenceRange(ev, y);
      if (r && dateISO >= r.start && dateISO <= r.end) return true;
      /* 12월 말~1월 초처럼 해를 넘기는 기간 */
      var prev = occurrenceRange(ev, y - 1);
      if (prev && dateISO >= prev.start && dateISO <= prev.end) return true;
      return false;
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
    el.ddayList = document.getElementById('ddayList');
    el.modal = document.getElementById('modal');
    el.form = document.getElementById('eventForm');
    el.fTitle = document.getElementById('fTitle');
    el.fDate = document.getElementById('fDate');
    el.fEndDate = document.getElementById('fEndDate');
    el.dateRangeHint = document.getElementById('dateRangeHint');
    el.voiceBtn = document.getElementById('eventVoiceBtn');
    el.voiceStatus = document.getElementById('eventVoiceStatus');
    el.fAllDay = document.getElementById('fAllDay');
    el.fTime = document.getElementById('fTime');
    el.fMembers = document.getElementById('fMembers');
    el.fCategories = document.getElementById('fCategories');
    el.fMemo = document.getElementById('fMemo');
    el.fRepeat = document.getElementById('fRepeat');
    el.dateLunarHint = document.getElementById('dateLunarHint');
    el.repeatHint = document.getElementById('repeatHint');
    el.formError = document.getElementById('formError');
    el.modalTitle = document.getElementById('modalTitle');
    el.deleteBtn = document.getElementById('deleteBtn');
    el.saveBtn = document.getElementById('saveBtn');

    el.statusPill = document.getElementById('statusPill');
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
    el.adminBtn = document.getElementById('adminBtn');
    el.pinModal = document.getElementById('pinModal');
    el.pinForm = document.getElementById('pinForm');
    el.pinTitle = document.getElementById('pinTitle');
    el.pinInput = document.getElementById('pinInput');
    el.pinHint = document.getElementById('pinHint');
    el.pinError = document.getElementById('pinError');
    el.pinClose = document.getElementById('pinClose');
    el.adminModal = document.getElementById('adminModal');
    el.adminClose = document.getElementById('adminClose');
    el.adminMemberList = document.getElementById('adminMemberList');
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
    startCloud();
  }

  /* ---------------- 공유 연결 ---------------- */
  var lastStatus = { kind: 'pending', text: '' };

  function setStatus(kind, text) {
    lastStatus = { kind: kind, text: text };
    paintStatus();
  }

  /* 매장 캘린더 화면이 떠 있을 때는 가족 상태 문구가 위에 덮이지 않게 합니다. */
  function paintStatus() {
    if (!el.statusPill) return;
    if (window.StoreMode && window.StoreMode.isStoreActive()) return;
    var kind = lastStatus.kind, text = lastStatus.text;
    el.statusPill.textContent = kind === 'online' ? '공유 중' : (kind === 'offline' ? '오프라인' : (kind === 'error' ? '오류' : '연결 중'));
    el.statusPill.className = 'app-bar__status app-bar__status--' + (kind || 'pending');
    if (el.appBarNote) el.appBarNote.textContent = text || '';
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
      openRoomModal(true);
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
        onData: function (list) { events = list; cloudReady = true; clearTimeout(connectTimer); renderAll(); },
        onRoom: function (info) { applyRoomMeta(info); },
        onRoomError: function (err) {
          var code = (err && err.code) || '';
          if (code === 'permission-denied') setStatus('error', '가족 방 설정을 읽을 수 없어요 (가족 코드를 확인해 주세요)');
        },
        onStatus: function (s) { setStatus(s.kind, s.text); }
      }).then(function (info) {
        if (info && info.created) {
          cloudReady = true;
          setStatus('online', '새 가족 방을 만들었어요 · 이 코드를 가족에게 알려 주세요');
          clearTimeout(connectTimer);
        }
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

  function openRoomModal(firstRun) {
    el.roomError.hidden = true;
    el.roomError.textContent = '';
    el.roomCode.value = FamilyCloud.initialCode() || '';
    el.roomClose.hidden = !!firstRun;
    el.roomModal.hidden = false;
    try { el.roomCode.focus(); } catch (e) { /* 무시 */ }
  }

  function closeRoomModal() {
    if (el.roomModal) el.roomModal.hidden = true;
  }

  function showRoomError(msg) {
    el.roomError.textContent = msg;
    el.roomError.hidden = false;
  }

  function submitRoomCode(e) {
    if (e) e.preventDefault();
    var code = FamilyCloud.normalizeCode(el.roomCode.value);
    if (!code) { showRoomError('가족 코드를 입력해 주세요.'); return; }
    FamilyCloud.stop();
    events = [];
    state.selected = todayISO();
    renderAll();
    connectToRoom(code);
  }

  function bind() {
    document.getElementById('prevMonth').addEventListener('click', function () { shiftMonth(-1); });
    document.getElementById('nextMonth').addEventListener('click', function () { shiftMonth(1); });
    document.getElementById('todayBtn').addEventListener('click', goToday);
    document.getElementById('addBtn').addEventListener('click', function () {
      if (!state.profile) { openProfileModal(); return; }
      openModal(null, state.selected);
    });
    document.getElementById('resetBtn').addEventListener('click', deleteSamples);
    document.getElementById('inviteBtn').addEventListener('click', copyInviteLink);
    document.getElementById('codeBtn').addEventListener('click', function () { openRoomModal(false); });
    el.roomForm.addEventListener('submit', submitRoomCode);
    el.roomClose.addEventListener('click', closeRoomModal);
    var roomBackdrop = el.roomModal.querySelector('[data-close]');
    if (roomBackdrop) roomBackdrop.addEventListener('click', function () { if (!el.roomClose.hidden) closeRoomModal(); });
    document.getElementById('modalClose').addEventListener('click', closeModal);
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
    el.fRepeat.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-repeat]');
      if (!btn) return;
      setRepeat(btn.getAttribute('data-repeat'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.modal.hidden) closeModal();
    });
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
    renderFilters();
    renderCalendar();
    renderDayCard();
    renderDDay();
    renderRoleUI();
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
      var d = document.createElement('span');
      d.className = 'chip__dot';
      d.style.background = mb.color;
      if (state.member === mb.id) d.style.background = '#fff';
      btn.appendChild(d);
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

      var dayEvents = eventsOn(dateISO);
      if (dayEvents.length) {
        var cats = [];
        dayEvents.forEach(function (ev) {
          var c = categoryById(ev.category);
          if (cats.indexOf(c.color) === -1) cats.push(c.color);
        });
        var dots = document.createElement('span');
        dots.className = 'dots';
        cats.slice(0, 3).forEach(function (color) {
          var d = document.createElement('span');
          d.className = 'dot';
          d.style.background = color;
          dots.appendChild(d);
        });
        if (cats.length > 3) {
          var more = document.createElement('span');
          more.className = 'dots__more';
          more.textContent = '+' + (cats.length - 3);
          dots.appendChild(more);
        }
        cell.appendChild(dots);
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
          }
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
    if (holiday) {
      var badge = document.createElement('span');
      badge.className = 'day-badge';
      badge.textContent = '🎉 ' + holiday;
      head.appendChild(badge);
    }
    el.dayCard.appendChild(head);

    var dayEvents = eventsOn(dateISO);
    if (!dayEvents.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.innerHTML = '이 날은 일정이 없어요.<br><b>' + (canManage() ? '＋ 일정 추가' : '＋ 일정 등록 요청') + ' 버튼</b>으로 등록해 보세요.';
      el.dayCard.appendChild(empty);
      return;
    }

    var list = document.createElement('ul');
    list.className = 'event-list';
    dayEvents.forEach(function (ev) {
      list.appendChild(buildEventItem(ev, y));
    });
    el.dayCard.appendChild(list);
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

    var period = occurrenceLabel(ev, year) || periodLabel(ev);
    if (period) {
      var pEl = document.createElement('span');
      pEl.className = 'event__period';
      pEl.textContent = '📅 ' + period;
      meta.appendChild(pEl);
    }

    var lunarText = lunarTextFor(ev, year);
    if (lunarText) {
      var lEl = document.createElement('span');
      lEl.className = 'event__lunar';
      lEl.textContent = lunarText;
      meta.appendChild(lEl);
    }    if (ev.repeat === 'yearly-solar') {
      var rEl = document.createElement('span');
      rEl.className = 'event__repeat';
      rEl.textContent = '매년';
      meta.appendChild(rEl);
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
    return li;
  }

  function renderDDay() {
    var today = new Date();
    var limit = 6;
    var items = [];

    events.forEach(function (ev) {
      if (!passesMemberFilter(ev)) return;
      [today.getFullYear(), today.getFullYear() + 1].forEach(function (y) {
        var r = occurrenceRange(ev, y);
        if (!r) return;
        var ds = dayDiff(today, parseISO(r.start));
        var de = dayDiff(today, parseISO(r.end));
        if (de < 0 || ds > 365) return;
        var ongoing = ds < 0 && de >= 0;
        items.push({ ev: ev, date: r.start, end: r.end, diff: ongoing ? 0 : ds, ongoing: ongoing });
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
    }).slice(0, limit);

    el.ddayList.innerHTML = '';
    if (!items.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '1년 안에 다가오는 일정이 없어요.';
      el.ddayList.appendChild(empty);
      return;
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
      b.addEventListener('click', function () { b.classList.toggle('is-on'); });
      el.fMembers.appendChild(b);
    });

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
    updateDateHint();

    el.modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    el.modal.hidden = true;
    document.body.style.overflow = '';
    state.editingId = null;
    resetVoiceBox();
  }

  function syncTimeField() {
    el.fTime.disabled = el.fAllDay.checked;
  }

  function setRepeat(value) {
    state.repeat = value || 'none';
    Array.prototype.forEach.call(el.fRepeat.children, function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-repeat') === state.repeat);
    });
    updateRepeatHint();
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
    updateRepeatHint();
  }

  function updateRepeatHint() {
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
    }
    if (parsed.category) {
      Array.prototype.forEach.call(el.fCategories.children, function (b) {
        b.classList.toggle('is-on', b.getAttribute('data-id') === parsed.category);
      });
    }
    if (parsed.title) el.fTitle.value = parsed.title.slice(0, 60);
    if (parsed.lunar) setRepeat('yearly-lunar');
    updateDateHint();

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
      members: memberIds,
      category: currentCategory(),
      memo: el.fMemo.value.trim(),
      repeat: state.repeat,
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

    FamilyCloud.saveEvent(state.editingId, payload).then(function () {
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
    return { id: m.id, name: m.name, color: m.color, bg: m.bg, role: m.role || 'member' };
  }

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
        role: m.role === 'admin' || m.role === 'manager' ? m.role : 'member'
      });
    });
    MEMBERS = next.length ? next : DEFAULT_MEMBERS.slice();
    state.roomPins = info && info.pins && typeof info.pins === 'object' ? info.pins : {};
    requests = info && Array.isArray(info.requests) ? info.requests : [];
    if (state.member !== 'all' && !memberById(state.member)) state.member = 'all';
    if (state.profile && !memberById(state.profile)) {
      state.profile = '';
      rememberProfile('');
    }
    renderAll();
    ensureProfile();
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
    openProfileModal();
  }

  function renderRoleUI() {
    var me = myMember();
    if (el.profileName) {
      el.profileName.textContent = me ? me.name : '사용자 선택';
      el.profileRole.textContent = me ? ROLE_LABEL[me.role || 'member'] : '';
      el.profileRole.hidden = !me || (me.role || 'member') === 'member';
      el.profileDot.style.background = me ? me.color : '#ffffff';
    }
    var manage = canManage();
    var pending = requests.filter(function (r) { return r.status === 'pending'; });
    if (el.approveBtn) {
      el.approveBtn.hidden = !manage;
      if (manage) {
        el.approveCount.textContent = String(pending.length);
        el.approveBtn.classList.toggle('is-active', pending.length > 0);
      }
    }
    if (el.addBtn) el.addBtn.textContent = manage ? '＋ 일정 추가' : '＋ 일정 등록 요청';
    if (el.resetBtn) el.resetBtn.hidden = !manage;
    if (el.codeBtn) el.codeBtn.hidden = !manage;
    renderMyRequests();
    if (el.approveModal && !el.approveModal.hidden) renderApproveCards();
    if (el.adminModal && !el.adminModal.hidden) {
      renderAdminMembers();
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

  function renderMyRequests() {
    if (!el.myRequestsCard) return;
    var mine = requests.filter(function (r) { return r.requesterId && r.requesterId === state.profile; });
    var show = !!state.profile && (mine.length > 0 || !canManage());
    el.myRequestsCard.hidden = !show;
    if (!show) return;
    var waiting = mine.filter(function (r) { return r.status === 'pending'; }).length;
    el.myRequestsHint.textContent = waiting ? '대기 중 ' + waiting + '건' : '대기 중 없음';
    el.myRequestsList.innerHTML = '';
    if (!mine.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '아직 보낸 요청이 없어요. ＋ 일정 등록 요청으로 보내 보세요.';
      el.myRequestsList.appendChild(empty);
      return;
    }
    mine.forEach(function (r) {
      el.myRequestsList.appendChild(buildRequestItem(r, false));
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
    el.approveModalCount.textContent = String(pending.length);
    el.reqCards.innerHTML = '';
    if (!pending.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '지금은 승인을 기다리는 요청이 없어요.';
      el.reqCards.appendChild(empty);
      return;
    }
    pending.forEach(function (r) {
      el.reqCards.appendChild(buildRequestItem(r, true));
    });
  }

  function toast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2800);
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
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'profile-item' + (m.id === state.profile ? ' is-me' : '');
      var dot = document.createElement('span');
      dot.className = 'profile-item__dot';
      dot.style.background = m.color;
      btn.appendChild(dot);
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
      el.profileList.appendChild(btn);
    });
    el.profileAdminActions.hidden = !canManage();
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
    renderAll();
    toast(m.name + ' 님으로 시작해요');
  }

  /* ---------------- 관리자 PIN ---------------- */
  function askPin(m) {
    state.pendingPin = m.id;
    el.pinTitle.textContent = m.name + ' · ' + ROLE_LABEL[m.role || 'manager'];
    el.pinError.hidden = true;
    el.pinInput.value = '';
    var stored = state.roomPins && state.roomPins[m.id];
    el.pinHint.textContent = stored
      ? '등록된 4자리 PIN을 넣어 주세요.'
      : '아직 PIN을 바꾸지 않았어요. 처음 PIN은 2026이에요. 들어간 뒤 설정에서 바꿔 주세요.';
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
    var pin = el.pinInput.value.replace(/\D/g, '');
    if (pin.length !== 4) { showPinError('4자리 숫자를 넣어 주세요.'); return; }
    var stored = state.roomPins && state.roomPins[m.id];
    var ok = stored ? (FamilyCloud.pinHash(m.id, pin) === stored) : (pin === INITIAL_PIN);
    if (!ok) { showPinError('PIN이 맞지 않아요.'); return; }
    el.pinError.hidden = true;
    el.pinModal.hidden = true;
    state.pendingPin = '';
    switchProfile(m);
    if (!stored) toast('처음 PIN(2026)으로 들어왔어요 · 관리자 설정에서 바꿔 주세요');
  }

  /* ---------------- 관리자 설정 ---------------- */
  function openAdminModal() {
    if (!canManage()) return;
    el.memberError.hidden = true;
    el.pinChangeError.hidden = true;
    el.newMemberName.value = '';
    el.newPin.value = '';
    el.newPin2.value = '';
    renderAdminMembers();
    renderMemberColors();
    renderPinTargets();
    el.adminModal.hidden = false;
  }

  function renderAdminMembers() {
    el.adminMemberList.innerHTML = '';
    MEMBERS.forEach(function (m) {
      var role = m.role || 'member';
      var li = document.createElement('li');
      li.className = 'admin-member';
      var dot = document.createElement('span');
      dot.className = 'admin-member__dot';
      dot.style.background = m.color;
      li.appendChild(dot);
      var name = document.createElement('span');
      name.className = 'admin-member__name';
      name.textContent = m.name;
      li.appendChild(name);
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
      el.adminMemberList.appendChild(li);
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

  function saveMemberList(next, okMsg) {
    FamilyCloud.saveMembers(next).then(function () {
      if (okMsg) toast(okMsg);
      renderAdminMembers();
      renderPinTargets();
    }).catch(function (err) {
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
    if (!name) { showMemberError('이름을 넣어 주세요.'); return; }
    if (name.length > 12) { showMemberError('이름은 12자까지 넣을 수 있어요.'); return; }
    if (MEMBERS.some(function (m) { return m.name === name; })) { showMemberError('같은 이름이 이미 있어요.'); return; }
    if (MEMBERS.length >= 12) { showMemberError('구성원은 12명까지 추가할 수 있어요.'); return; }
    var color = MEMBER_COLORS[state.memberColor % MEMBER_COLORS.length];
    var next = MEMBERS.map(plainMember);
    next.push({ id: 'm' + Date.now().toString(36), name: name, color: color, bg: color + '1f', role: 'member' });
    el.memberError.hidden = true;
    el.newMemberName.value = '';
    FamilyCloud.saveMembers(next).then(function () {
      toast(name + ' 님을 구성원으로 추가했어요');
      renderAdminMembers();
    }).catch(function (err) {
      showMemberError('추가하지 못했어요 · ' + errorHint(err));
    });
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
    FamilyCloud.setPin(target.id, pin).then(function () {
      el.newPin.value = '';
      el.newPin2.value = '';
      toast(target.name + ' 님 PIN을 바꿨어요');
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
    if (ev.repeat === 'yearly-solar') rows.push(['반복', '매년 양력']);
    if (ev.repeat === 'yearly-lunar') rows.push(['반복', '매년 음력']);
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
    note.textContent = '일정 수정·삭제는 아빠·엄마만 할 수 있어요.';
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
    eventsOn: eventsOn,
    seedSamples: seedSamples,
    inviteLink: inviteLink,
    isReady: function () { return cloudReady; },
    role: function () { return myRole(); },
    profile: function () { return state.profile; },
    connect: startCloud,
    paintStatus: paintStatus,
    applyVoice: applyVoiceEvent
  };
})();
