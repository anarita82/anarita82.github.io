/* 🏪 매장 달력 — 화면·계산 로직
   - 가족 달력(app.js)과 같은 페이지에서 [가족]/[매장] 탭으로 전환합니다.
   - 매장 방은 Firebase 방 자체가 달라 가족 일정과 섞이지 않습니다.
   - 사장님: 매장 코드·초대·승인·시급·급여명세서 전부 / 알바생: 본인 근무와 본인 명세서만.
*/
(function () {
  'use strict';

  var OWNER_KEY = 'family-calendar.store.owner.v1';
  var LOCK_KEY = 'family-calendar.store.locked.v1';
  var STAFF_KEY = 'family-calendar.store.staff.v1';
  var DEVICE_KEY = 'family-calendar.store.device.v1';
  var MODE_KEY = 'family-calendar.mode.v1';
  var INITIAL_PIN = '2026';
  var DEFAULT_WAGE = 10000;

  var STAFF_COLORS = [
    { c: '#0d9488', bg: '#e6fffb' }, { c: '#2563eb', bg: '#e8f1fe' },
    { c: '#db2777', bg: '#fdeaf3' }, { c: '#d97706', bg: '#fef3e2' },
    { c: '#7c3aed', bg: '#f0e9fe' }, { c: '#059669', bg: '#e6f7f0' },
    { c: '#dc2626', bg: '#feeaea' }, { c: '#0891b2', bg: '#e2f6fa' },
    { c: '#4f46e5', bg: '#eef0ff' }, { c: '#65a30d', bg: '#eff8dd' }
  ];
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var STATUS_LABEL = { planned: '예정', done: '근무완료', absent: '결근', canceled: '취소' };
  var NAV_MIN_YEAR = 2024;
  var NAV_MAX_YEAR = 2037;

  var S = {
    active: false,
    connected: false,
    connecting: false,
    code: '',
    role: 'none',          // none | owner | staff
    via: '',               // invite | manual | restore
    staff: [],
    joins: [],
    profileRequests: [],
    shiftRequests: [],
    handovers: [],
    shifts: [],
    pins: {},
    settings: { taxMode: 'none', taxRate: 3.3, weeklyAllowance: false, payDay: 10, weeklyHours: 15 },
    storeName: '',
    revokedUids: [],
    revokedDevices: [],
    blocked: '',
    year: 0,
    month: 0,
    selected: '',
    filter: 'all',
    payY: 0,
    payM: 0,
    shiftEditingId: null,
    shiftStaffId: '',
    shiftStatus: 'planned',
    reqShift: null,
    reqWantStaff: '',
    payStaffId: '',
    payExtra: 0,
    payWeekly: false,
    pendingPin: '',
    pinAsked: false,
    lastStatus: { kind: 'pending', text: '' }
  };

  var el = {};
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }

  /* ---------------- 저장소 ---------------- */
  function ls(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function lsSet(key, v) { try { if (v) localStorage.setItem(key, v); else localStorage.removeItem(key); } catch (e) { /* 무시 */ } }
  function isOwnerDevice() { return ls(OWNER_KEY) === '1'; }
  function isLocked() { return ls(LOCK_KEY) === '1'; }
  function myStaffId() { return ls(STAFF_KEY); }
  function deviceId() {
    var id = ls(DEVICE_KEY);
    if (!id) {
      id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      lsSet(DEVICE_KEY, id);
    }
    return id;
  }

  function isOwner() { return S.role === 'owner'; }

  /* 이 기기의 계정(uid) — 퇴사 차단에 씁니다. */
  function myUid() {
    if (window.StoreCloud && typeof StoreCloud.currentUid === 'function') {
      try { return StoreCloud.currentUid() || ''; } catch (e) { return ''; }
    }
    return '';
  }

  /* 퇴사(강제 탈퇴)된 기기인지 — 사장님 기기는 절대 막지 않습니다. */
  function blockReason() {
    if (isOwnerDevice()) return '';
    var uid = myUid();
    if (uid && (S.revokedUids || []).indexOf(uid) >= 0) return '퇴사(탈퇴) 처리되어 매장에 접근할 수 없습니다';
    var dev = deviceId();
    if (dev && (S.revokedDevices || []).indexOf(dev) >= 0) return '퇴사(탈퇴) 처리되어 매장에 접근할 수 없습니다';
    var sid = myStaffId();
    var st = sid ? staffById(sid) : null;
    if (st && st.retired) return '퇴사(탈퇴) 처리되어 매장에 접근할 수 없습니다';
    var mine = myJoinRequest();
    if (mine && mine.staffId) {
      var joined = staffById(mine.staffId);
      if (joined && joined.retired) return '퇴사(탈퇴) 처리되어 매장에 접근할 수 없습니다';
    }
    return '';
  }
  function me() {
    var id = myStaffId();
    for (var i = 0; i < S.staff.length; i++) if (S.staff[i].id === id) return S.staff[i];
    return null;
  }
  function staffById(id) {
    for (var i = 0; i < S.staff.length; i++) if (S.staff[i].id === id) return S.staff[i];
    return null;
  }

  /* 휴대폰 번호 정리·표시 (가족 달력과 같은 규칙) */
  function normTel(v) {
    if (window.StoreCloud && typeof StoreCloud.normalizeTel === 'function') return StoreCloud.normalizeTel(v);
    if (window.FamilyCloud && typeof FamilyCloud.normalizeTel === 'function') return FamilyCloud.normalizeTel(v);
    return String(v == null ? '' : v).trim().slice(0, 20);
  }
  function telOf(o) { return o && o.tel ? String(o.tel) : ''; }
  function telHref(tel) {
    if (window.StoreCloud && typeof StoreCloud.telDigits === 'function') return 'tel:' + StoreCloud.telDigits(tel);
    return 'tel:' + String(tel || '').replace(/[^0-9+]/g, '');
  }
  function telLooksValid(v) {
    var d = String(v == null ? '' : v).replace(/[^0-9]/g, '');
    return d.length >= 9 && d.length <= 15;
  }

  /* ---------------- 날짜·숫자 도구 ---------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function isoOfDate(d) { return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function todayISO() { return isoOfDate(new Date()); }
  function parseISO(s) {
    var p = String(s || '').split('-').map(Number);
    if (p.length !== 3 || isNaN(p[0])) return new Date();
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function monthKey(y, m) { return y + '-' + pad2(m + 1); }
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function toMin(hhmm) {
    var p = String(hhmm || '').split(':').map(Number);
    if (p.length !== 2 || isNaN(p[0]) || isNaN(p[1])) return 0;
    return p[0] * 60 + p[1];
  }
  function money(n) { return Math.round(Number(n) || 0).toLocaleString('ko-KR') + '원'; }
  function hoursText(min) {
    var m = Math.max(0, Math.round(Number(min) || 0));
    var h = Math.floor(m / 60), r = m % 60;
    if (!h) return (r ? r + '분' : '0시간');
    return h + '시간' + (r ? ' ' + r + '분' : '');
  }
  function weekKey(dateISO) {
    var d = parseISO(dateISO);
    var wd = (d.getDay() + 6) % 7; // 월=0
    d.setDate(d.getDate() - wd);
    return isoOfDate(d);
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
  }
  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, function () { fallbackCopy(text, okMsg); });
    } else {
      fallbackCopy(text, okMsg);
    }
  }
  function fallbackCopy(text, okMsg) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast(okMsg);
    } catch (e) {
      window.prompt('아래 내용을 복사해 주세요.', text);
    }
  }

  /* ---------------- 근무 계산 ---------------- */
  function shiftMinutes(sh) {
    var s = toMin(sh.start), e = toMin(sh.end);
    if (!s && !e) return 0;
    if (e <= s) e += 1440; // 자정을 넘기는 근무
    var m = e - s - Math.max(0, Number(sh.breakMin) || 0);
    return Math.max(0, m);
  }
  function shiftPay(sh) {
    return Math.round((Number(sh.wage) || 0) * shiftMinutes(sh) / 60);
  }
  function countsForPay(sh) { return sh.status === 'planned' || sh.status === 'done'; }
  function byStart(a, b) {
    var ta = a.start || '00:00', tb = b.start || '00:00';
    if (ta === tb) return String(a.staffName).localeCompare(String(b.staffName), 'ko');
    return ta < tb ? -1 : 1;
  }
  function passFilter(sh) { return S.filter === 'all' || sh.staffId === S.filter; }
  function shiftsOn(dateISO) {
    return S.shifts.filter(function (s) { return s.date === dateISO && passFilter(s); }).sort(byStart);
  }
  function shiftsInMonth(y, m) {
    var key = monthKey(y, m);
    return S.shifts.filter(function (s) { return s.date && s.date.slice(0, 7) === key && passFilter(s); });
  }
  function sumMinutes(list) {
    return list.reduce(function (n, s) { return n + (countsForPay(s) ? shiftMinutes(s) : 0); }, 0);
  }
  function sumPay(list) {
    return list.reduce(function (n, s) { return n + (countsForPay(s) ? shiftPay(s) : 0); }, 0);
  }

  /* ---------------- 상태 표시 ---------------- */
  function setStoreStatus(kind, text) {
    S.lastStatus = { kind: kind, text: text };
    paintStoreStatus();
  }
  function paintStoreStatus() {
    if (!S.active) return;
    var pill = $('statusPill');
    var note = $('appBarNote');
    if (pill) {
      pill.textContent = S.lastStatus.kind === 'online' ? '공유 중'
        : S.lastStatus.kind === 'offline' ? '오프라인'
        : S.lastStatus.kind === 'error' ? '오류' : '연결 중';
      pill.className = 'app-bar__status app-bar__status--' + (S.lastStatus.kind || 'pending');
    }
    if (note) note.textContent = S.lastStatus.text || '';
  }
  function errorHint(err) {
    if (!err) return '알 수 없는 오류';
    if (err.code === 'permission-denied') return '매장 방에 쓸 권한이 없어요. 매장 코드를 확인해 주세요.';
    if (err.code === 'unavailable') return '인터넷 연결을 확인해 주세요.';
    if (err.code === 'auth/operation-not-allowed') return '익명 로그인이 꺼져 있어요.';
    if (err.message === 'firebase-sdk-missing') return '공유 모듈을 불러오지 못했어요.';
    if (err.message === 'empty-code') return '매장 코드를 입력해 주세요.';
    if (err.message === 'revoked') return '퇴사(탈퇴) 처리되어 매장에 접근할 수 없습니다.';
    if (err.code) return err.code;
    return err.message || '알 수 없는 오류';
  }

  /* ---------------- 부팅·모드 전환 ---------------- */
  function boot() {
    el.tabs = $('modeTabs');
    el.tabFamily = $('tabFamily');
    el.tabStore = $('tabStore');
    el.familyView = $('familyView');
    el.familySubRow = $('familySubRow');
    el.storeSubRow = $('storeSubRow');
    el.storeView = $('storeView');
    el.storeWho = $('storeWhoName');
    el.storeApproveBtn = $('storeApproveBtn');
    el.storeApproveCount = $('storeApproveCount');
    el.storeAddBtn = $('storeAddBtn');
    el.title = $('appTitle');
    el.setupCard = $('storeSetupCard');
    el.joinCard = $('storeJoinCard');
    el.main = $('storeMain');
    el.loadingCard = $('storeLoadingCard');
    el.blockedCard = $('storeBlockedCard');

    var q = new URLSearchParams(location.search);
    var storeParam = q.get('store');
    if (storeParam) StoreCloud.rememberCode(storeParam);

    var familyCode = (window.FamilyCloud && FamilyCloud.storedCode()) || '';
    var hadOwner = isOwnerDevice();
    /* 매장 초대 링크(?store=)로 들어왔으면, 이 폰에 가족 코드가 이미 있어도
       가족 화면 대신 매장 입장 화면부터 엽니다. (가족 탭은 그대로 보입니다)
       가족 방이 없는 알바생 폰에서는 계속 가족 탭·방이 보이지 않습니다(잠금 유지). */
    var inviteViaLink = !!storeParam && !hadOwner;
    if (inviteViaLink) {
      if (!familyCode) lsSet(LOCK_KEY, '1');
      S.via = 'invite';
    }

    if (StoreCloud.storedCode()) S.code = StoreCloud.storedCode();

    bind();
    renderModeChrome();

    var mode = ls(MODE_KEY) || 'family';
    if (isLocked() || inviteViaLink) {
      activate('boot');
    } else if (mode === 'store' && S.code) {
      activate('boot');
    } else {
      deactivate('boot');
    }
    syncTabs();
  }

  function bind() {
    if (el.tabFamily) el.tabFamily.addEventListener('click', function () { deactivate('tab'); });
    if (el.tabStore) el.tabStore.addEventListener('click', function () { activate('tab'); });
    if (el.storeApproveBtn) el.storeApproveBtn.addEventListener('click', openApprovalModal);

    /* 매장 시작 */
    var createBtn = $('storeCreateBtn');
    if (createBtn) createBtn.addEventListener('click', createStore);
    var openBtn = $('storeOpenCodeBtn');
    if (openBtn) openBtn.addEventListener('click', function () {
      var code = StoreCloud.normalizeCode($('storeCodeInput').value);
      if (!code) { toast('매장 코드를 넣어 주세요'); return; }
      StoreCloud.rememberCode(code);
      S.code = code;
      S.pinAsked = false;
      enterStore(code, 'manual');
    });
    var openPinBtn = $('storeOpenPinBtn');
    if (openPinBtn) openPinBtn.addEventListener('click', function () {
      S.pinAsked = false;
      openOwnerPin();
    });

    /* 알바생 입장 */
    var joinBtn = $('storeJoinBtn');
    if (joinBtn) joinBtn.addEventListener('click', submitJoin);
    var ownerLink = $('storeOwnerLinkBtn');
    if (ownerLink) ownerLink.addEventListener('click', openOwnerPin);
    var rejoin = $('storePendingRejoin');
    if (rejoin) rejoin.addEventListener('click', function () { showJoinForm(); });
    var meSave = $('storeMeSaveBtn');
    if (meSave) meSave.addEventListener('click', saveMyInfo);

    /* 📝 교대 인수인계 */
    var handAdd = $('storeHandoverAddBtn');
    if (handAdd) handAdd.addEventListener('click', addHandover);
    var handInput = $('storeHandoverInput');
    if (handInput) handInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addHandover(); }
    });

    /* 💬 카톡 요약 */
    var kanToday = $('storeKakaoTodayBtn');
    if (kanToday) kanToday.addEventListener('click', function () { copyStoreKakao('today'); });
    var kanWeek = $('storeKakaoWeekBtn');
    if (kanWeek) kanWeek.addEventListener('click', function () { copyStoreKakao('week'); });

    /* 🙋 근무 변경·대타 요청 */
    var reqForm = $('shiftReqForm');
    if (reqForm) reqForm.addEventListener('submit', function (e) { e.preventDefault(); submitShiftReq(); });
    var reqClose = $('shiftReqClose');
    if (reqClose) reqClose.addEventListener('click', closeShiftReq);
    var reqBackdrop = $('shiftReqModal') && $('shiftReqModal').querySelector('[data-close]');
    if (reqBackdrop) reqBackdrop.addEventListener('click', closeShiftReq);
    var reqOpenBtn = $('shiftReqBtn');
    if (reqOpenBtn) reqOpenBtn.addEventListener('click', function () {
      var target = null;
      S.shifts.forEach(function (s) { if (s.id === S.shiftEditingId) target = s; });
      if (target) openShiftReq(target);
    });
    var reqQuick = $('reqQuick');
    if (reqQuick) reqQuick.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-quick]');
      if (!b) return;
      applyQuickTime(b.getAttribute('data-quick'));
    });

    /* 달력 */
    var prev = $('storePrevMonth'); if (prev) prev.addEventListener('click', function () { shiftMonth(-1); });
    var next = $('storeNextMonth'); if (next) next.addEventListener('click', function () { shiftMonth(1); });
    var todayBtn = $('storeTodayBtn'); if (todayBtn) todayBtn.addEventListener('click', goToday);

    /* 급여명세서 월 이동 */
    var pPrev = $('payrollPrev'); if (pPrev) pPrev.addEventListener('click', function () { shiftPayMonth(-1); });
    var pNext = $('payrollNext'); if (pNext) pNext.addEventListener('click', function () { shiftPayMonth(1); });

    /* 매장 설정 */
    var copyCode = $('storeCopyCodeBtn');
    if (copyCode) copyCode.addEventListener('click', function () {
      if (!S.code) return;
      copyText(S.code, '매장 코드를 복사했어요');
    });
    var copyLink = $('storeCopyInviteBtn');
    if (copyLink) copyLink.addEventListener('click', function () {
      if (!S.code) return;
      copyText(inviteLink(), '매장 초대 링크를 복사했어요\n카카오톡으로 보내면 알바생은 링크만 누르면 돼요');
    });
    var settingsBtn = $('storeSettingsBtn');
    if (settingsBtn) settingsBtn.addEventListener('click', openSettings);

    var addBtn = el.storeAddBtn;
    if (addBtn) addBtn.addEventListener('click', function () {
      if (!isOwner()) return;
      openShift(null, S.selected);
    });

    /* 근무 모달 */
    var shiftForm = $('shiftForm');
    if (shiftForm) shiftForm.addEventListener('submit', function (e) { e.preventDefault(); saveShift(); });
    var shiftClose = $('shiftClose'); if (shiftClose) shiftClose.addEventListener('click', closeShift);
    var shiftBackdrop = $('shiftModal') && $('shiftModal').querySelector('[data-close]');
    if (shiftBackdrop) shiftBackdrop.addEventListener('click', closeShift);
    var shiftDel = $('shiftDeleteBtn'); if (shiftDel) shiftDel.addEventListener('click', deleteShift);
    var statusWrap = $('shiftStatus');
    if (statusWrap) statusWrap.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-status]');
      if (!b) return;
      S.shiftStatus = b.getAttribute('data-status');
      Array.prototype.forEach.call(statusWrap.children, function (c) {
        c.classList.toggle('is-active', c.getAttribute('data-status') === S.shiftStatus);
      });
    });
    ['shiftStart', 'shiftEnd', 'shiftBreak'].forEach(function (id) {
      var f = $(id);
      if (f) f.addEventListener('input', updateShiftHint);
    });
    var shiftEndDate = $('shiftEndDate');
    if (shiftEndDate) shiftEndDate.addEventListener('change', updateShiftHint);

    if (window.CalendarVoice && $('shiftVoiceBtn')) {
      CalendarVoice.attach($('shiftVoiceBtn'), {
        statusEl: $('shiftVoiceStatus'),
        idleLabel: '🎤 말로 입력하기',
        onText: applyVoiceShift
      });
    }

    /* 승인 모달 */
    var apClose = $('storeApproveClose');
    if (apClose) apClose.addEventListener('click', function () { $('storeApproveModal').hidden = true; });

    /* 명세서 모달 */
    var payClose = $('payrollClose');
    if (payClose) payClose.addEventListener('click', function () { $('payrollModal').hidden = true; });
    var payCopy = $('payrollCopyBtn');
    if (payCopy) payCopy.addEventListener('click', copyPayrollText);
    var payPrint = $('payrollPrintBtn');
    if (payPrint) payPrint.addEventListener('click', printPayroll);
    var payExtra = $('payrollExtra');
    if (payExtra) payExtra.addEventListener('input', function () {
      S.payExtra = Math.max(0, Math.round(Number(payExtra.value) || 0));
      renderPayrollModal();
    });
    var payWeekly = $('payrollWeekly');
    if (payWeekly) payWeekly.addEventListener('change', function () {
      S.payWeekly = payWeekly.checked;
      renderPayrollModal();
    });

    /* 설정 모달 */
    var setClose = $('storeSettingsClose');
    if (setClose) setClose.addEventListener('click', function () { $('storeSettingsModal').hidden = true; });
    var nameSave = $('storeNameSaveBtn');
    if (nameSave) nameSave.addEventListener('click', saveStoreName);
    var taxWrap = $('settingsTax');
    if (taxWrap) taxWrap.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tax]');
      if (!b) return;
      Array.prototype.forEach.call(taxWrap.children, function (c) {
        c.classList.toggle('is-active', c.getAttribute('data-tax') === b.getAttribute('data-tax'));
      });
      var rate = $('settingsTaxRate');
      if (rate) rate.disabled = b.getAttribute('data-tax') !== 'custom';
    });
    var settingsSave = $('settingsSaveBtn');
    if (settingsSave) settingsSave.addEventListener('click', savePayrollSettings);
    var pinSave = $('storePinSaveBtn');
    if (pinSave) pinSave.addEventListener('click', changeOwnerPin);
    var unlockBtn = $('storeUnlockBtn');
    if (unlockBtn) unlockBtn.addEventListener('click', openOwnerPin);
    var leaveBtn = $('storeLeaveBtn');
    if (leaveBtn) leaveBtn.addEventListener('click', leaveStoreDevice);

    /* PIN 모달 */
    var pinForm = $('storePinForm');
    if (pinForm) pinForm.addEventListener('submit', submitOwnerPin);
    var pinClose = $('storePinClose');
    if (pinClose) pinClose.addEventListener('click', function () {
      $('storePinModal').hidden = true;
      if (S.role === 'none') {
        if (isLocked()) showJoinForm();
        else showSetup('사장님 PIN을 넣어야 매장을 관리할 수 있어요.');
      }
    });
    var pinStaff = $('storePinStaffLink');
    if (pinStaff) pinStaff.addEventListener('click', function () {
      $('storePinModal').hidden = true;
      showJoinForm();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      ['shiftModal', 'shiftReqModal', 'storeApproveModal', 'payrollModal', 'storeSettingsModal', 'storePinModal'].forEach(function (id) {
        var m = $(id);
        if (m && !m.hidden) m.hidden = true;
      });
    });
  }

  function renderModeChrome() {
    var locked = isLocked();
    if (el.tabs) el.tabs.hidden = locked;
    if (el.tabStore) el.tabStore.hidden = locked;
    syncTabs();
  }

  function syncTabs() {
    if (el.tabFamily) el.tabFamily.classList.toggle('is-active', !S.active);
    if (el.tabStore) el.tabStore.classList.toggle('is-active', S.active);
  }

  function activate() {
    S.active = true;
    document.body.classList.add('store-mode');
    if (el.familyView) el.familyView.hidden = true;
    if (el.familySubRow) el.familySubRow.hidden = true;
    if (el.storeSubRow) el.storeSubRow.hidden = false;
    if (el.storeView) el.storeView.hidden = false;
    if (el.title) el.title.textContent = '🏪 매장 달력';
    lsSet(MODE_KEY, 'store');
    renderModeChrome();
    syncTabs();
    paintStoreStatus();

    if (!S.code) {
      showSetup();
      setStoreStatus('pending', '매장 캘린더를 시작해 주세요');
      return;
    }
    if (!S.connected && !S.connecting) enterStore(S.code, S.via === 'invite' ? 'invite' : 'restore');
    renderAll();
  }

  function deactivate() {
    S.active = false;
    document.body.classList.remove('store-mode');
    if (el.familyView) el.familyView.hidden = false;
    if (el.familySubRow) el.familySubRow.hidden = false;
    if (el.storeSubRow) el.storeSubRow.hidden = true;
    if (el.storeView) el.storeView.hidden = true;
    if (el.storeAddBtn) el.storeAddBtn.hidden = true;
    if (el.title) el.title.textContent = '📅 우리 가족 달력';
    lsSet(MODE_KEY, 'family');
    syncTabs();
    if (window.FamilyCalendar) {
      if (!FamilyCalendar.isReady()) FamilyCalendar.connect();
      if (typeof FamilyCalendar.paintStatus === 'function') FamilyCalendar.paintStatus();
    }
  }

  /* ---------------- 매장 방 연결 ---------------- */
  function enterStore(code, via) {
    if (!window.StoreCloud) { setStoreStatus('error', '공유 모듈을 불러오지 못했어요'); return; }
    var clean = StoreCloud.normalizeCode(code);
    if (!clean) { showSetup(); return; }
    S.code = clean;
    S.via = via || 'restore';
    S.connecting = true;
    showLoading();
    setStoreStatus('pending', '매장 방에 연결하는 중…');

    StoreCloud.start(clean, {
      onStatus: function (s) { setStoreStatus(s.kind, s.text); },
      onShifts: function (list) { S.shifts = list; S.connected = true; S.connecting = false; renderAll(); },
      onHandovers: function (list) { S.handovers = list || []; renderHandover(); },
      onRoom: function (info) { applyRoom(info); },
      onRoomError: function (err) {
        if (err && err.code === 'permission-denied') setStoreStatus('error', '매장 방 설정을 읽을 수 없어요 (매장 코드를 확인해 주세요)');
      }
    }).then(function (info) {
      if (info && info.exists === false) {
        StoreCloud.stop();
        S.connected = false;
        S.connecting = false;
        showSetup(clean + ' 코드의 매장을 찾지 못했어요.\n코드를 다시 확인하거나 새로 만들어 주세요.');
        setStoreStatus('error', '매장을 찾지 못했어요');
      }
    }).catch(function (err) {
      S.connecting = false;
      setStoreStatus('error', '연결하지 못했어요 · ' + errorHint(err));
      showSetup('연결하지 못했어요 · ' + errorHint(err));
    });
  }

  function applyRoom(info) {
    S.staff = info.staff || [];
    S.joins = info.joinRequests || [];
    S.profileRequests = info.profileRequests || [];
    S.shiftRequests = info.shiftRequests || [];
    S.pins = info.pins || {};
    S.revokedUids = Array.isArray(info.revokedUids) ? info.revokedUids : [];
    S.revokedDevices = Array.isArray(info.revokedDevices) ? info.revokedDevices : [];
    S.settings = info.payrollSettings || S.settings;
    S.payWeekly = !!S.settings.weeklyAllowance;
    S.storeName = info.storeName || '';
    var blocked = blockReason();
    if (blocked) {
      S.blocked = blocked;
      S.role = 'none';
      lsSet(STAFF_KEY, '');
      showBlocked(blocked);
      return;
    }
    S.blocked = '';
    if (S.role === 'none') resolveIdentity();
    if (S.role === 'staff' && !me()) {
      // 승인이 해제된 경우
      lsSet(STAFF_KEY, '');
      S.role = 'none';
      showJoinForm('사장님이 입장을 해제했어요. 다시 요청해 주세요.');
    }
    renderAll();
  }

  function resolveIdentity() {
    var sid = myStaffId();
    if (isOwnerDevice()) { S.role = 'owner'; afterIdentity(); return; }
    var blocked = blockReason();
    if (blocked) {
      S.blocked = blocked;
      S.role = 'none';
      lsSet(STAFF_KEY, '');
      showBlocked(blocked);
      return;
    }
    if (sid && staffById(sid)) {
      S.role = 'staff';
      S.filter = sid;
      if (isLocked()) {
        renderModeChrome();
      }
      afterIdentity();
      return;
    }
    var mine = S.joins.filter(function (r) { return r.deviceId === deviceId(); })
      .sort(function (a, b) { return (b.requestedAt || 0) - (a.requestedAt || 0); })[0];
    if (mine) {
      if (mine.status === 'approved') {
        lsSet(STAFF_KEY, mine.staffId);
        /* 가족 방이 없는 알바생 폰만 매장 전용(가족 탭 숨김)으로 잠급니다.
           가족 코드가 있는 폰(가족이 매장에서도 일하는 경우)은 두 탭을 모두 봅니다. */
        var famCode = (window.FamilyCloud && typeof FamilyCloud.storedCode === 'function') ? FamilyCloud.storedCode() : '';
        if (!famCode) lsSet(LOCK_KEY, '1');
        if (staffById(mine.staffId)) {
          S.role = 'staff';
          S.filter = mine.staffId;
          renderModeChrome();
          afterIdentity();
          toast('입장이 승인되었어요 · 매장 캘린더가 열렸어요');
          return;
        }
      } else if (mine.status === 'pending') {
        showPending();
        setStoreStatus('pending', '입장 승인을 기다리는 중이에요');
        return;
      } else {
        showJoinForm('사장님이 입장을 거절했어요. 필요하면 다시 요청해 주세요.');
        return;
      }
    }
    if (S.via === 'invite' || isLocked()) {
      showJoinForm();
    } else if (!S.pinAsked) {
      S.pinAsked = true;
      openOwnerPin();
    }
  }

  function afterIdentity() {
    if (S.role === 'owner') {
      lsSet(OWNER_KEY, '1');
      lsSet(LOCK_KEY, '');
      renderModeChrome();
    }
    setStoreStatus('online', '매장 실시간 공유 중');
    renderAll();
  }

  /* ---------------- 화면 상태 ---------------- */
  function showLoading() {
    if (el.setupCard) el.setupCard.hidden = true;
    if (el.joinCard) el.joinCard.hidden = true;
    if (el.main) el.main.hidden = true;
    if (el.blockedCard) el.blockedCard.hidden = true;
    if (el.loadingCard) el.loadingCard.hidden = false;
    if (el.storeAddBtn) el.storeAddBtn.hidden = true;
  }

  /* 🚪 퇴사(강제 탈퇴)된 기기 — 매장 일정·인수인계·급여 화면을 막고 안내만 보여줍니다. */
  function showBlocked(msg) {
    if (el.loadingCard) el.loadingCard.hidden = true;
    if (el.setupCard) el.setupCard.hidden = true;
    if (el.joinCard) el.joinCard.hidden = true;
    if (el.main) el.main.hidden = true;
    if (el.storeAddBtn) el.storeAddBtn.hidden = true;
    if (el.blockedCard) {
      el.blockedCard.hidden = false;
      var text = $('storeBlockedMsg');
      if (text) text.textContent = msg || '퇴사(탈퇴) 처리되어 매장에 접근할 수 없습니다';
    }
    setStoreStatus('error', '퇴사(탈퇴) 처리되어 매장에 접근할 수 없습니다');
  }

  function showSetup(msg) {
    if (el.loadingCard) el.loadingCard.hidden = true;
    if (el.joinCard) el.joinCard.hidden = true;
    if (el.main) el.main.hidden = true;
    if (el.blockedCard) el.blockedCard.hidden = true;
    if (el.setupCard) {
      el.setupCard.hidden = false;
      var hint = $('storeSetupMsg');
      if (hint) {
        hint.textContent = msg || '';
        hint.hidden = !msg;
      }
      var pinBtn = $('storeOpenPinBtn');
      if (pinBtn) pinBtn.hidden = !S.code;
    }
    if (el.storeAddBtn) el.storeAddBtn.hidden = true;
  }

  function showJoinForm(msg) {
    if (el.loadingCard) el.loadingCard.hidden = true;
    if (el.setupCard) el.setupCard.hidden = true;
    if (el.main) el.main.hidden = true;
    if (el.blockedCard) el.blockedCard.hidden = true;
    if (el.storeAddBtn) el.storeAddBtn.hidden = true;
    if (!el.joinCard) return;
    el.joinCard.hidden = false;
    var form = $('storeJoinForm'), pending = $('storePendingBox'), hint = $('storeJoinHint');
    if (form) form.hidden = false;
    if (pending) pending.hidden = true;
    if (hint) hint.textContent = S.code ? '코드 ' + S.code : '';
    var err = $('storeJoinError');
    if (err) {
      if (msg) { err.textContent = msg; err.hidden = false; }
      else { err.hidden = true; }
    }
    var nameInput = $('storeJoinName');
    if (nameInput) {
      var saved = ls('family-calendar.store.myname.v1');
      if (saved && !nameInput.value) nameInput.value = saved;
    }
    var telInput = $('storeJoinTel');
    if (telInput) {
      var savedTel = ls('family-calendar.store.mytel.v1');
      if (savedTel && !telInput.value) telInput.value = savedTel;
    }
  }

  /* 이 기기에서 보낸 가장 최근 입장 요청 */
  function myJoinRequest() {
    return S.joins.filter(function (r) { return r.deviceId === deviceId(); })
      .sort(function (a, b) { return (b.requestedAt || 0) - (a.requestedAt || 0); })[0] || null;
  }

  function showPending() {
    if (el.loadingCard) el.loadingCard.hidden = true;
    if (el.setupCard) el.setupCard.hidden = true;
    if (el.main) el.main.hidden = true;
    if (el.blockedCard) el.blockedCard.hidden = true;
    if (el.storeAddBtn) el.storeAddBtn.hidden = true;
    if (!el.joinCard) return;
    el.joinCard.hidden = false;
    var form = $('storeJoinForm'), pending = $('storePendingBox');
    if (form) form.hidden = true;
    if (pending) pending.hidden = false;
    var who = $('storePendingWho');
    if (who) {
      var mine = myJoinRequest();
      if (mine) {
        who.textContent = '🙋 ' + mine.name + (telOf(mine) ? ' · 📞 ' + telOf(mine) : ' · 연락처 미입력');
        who.hidden = false;
      } else {
        who.hidden = true;
      }
    }
  }

  function showMain() {
    if (el.loadingCard) el.loadingCard.hidden = true;
    if (el.setupCard) el.setupCard.hidden = true;
    if (el.joinCard) el.joinCard.hidden = true;
    if (el.blockedCard) el.blockedCard.hidden = true;
    if (el.main) el.main.hidden = false;
    if (el.storeAddBtn) el.storeAddBtn.hidden = !isOwner() || !S.active;
    if (el.storeSubRow) {
      var who = isOwner() ? '사장님' : (me() ? me().name : '알바생');
      if (el.storeWho) el.storeWho.textContent = who;
    }
    if (el.storeApproveBtn) {
      var pendingCount = S.joins.filter(function (r) { return r.status === 'pending'; }).length
        + pendingProfileRequests().length
        + (S.shiftRequests || []).filter(function (r) { return r.status === 'pending'; }).length;
      el.storeApproveBtn.hidden = !isOwner();
      if (isOwner()) {
        el.storeApproveCount.textContent = String(pendingCount);
        el.storeApproveBtn.classList.toggle('is-active', pendingCount > 0);
      }
    }
  }

  function pendingProfileRequests() {
    return (S.profileRequests || []).filter(function (r) { return r.status === 'pending'; });
  }

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

  /* ---------------- 매장 만들기 / 입장 요청 ---------------- */
  function createStore() {
    if (!window.StoreCloud) { toast('공유 모듈을 불러오지 못했어요'); return; }
    var code = StoreCloud.generateCode();
    var btn = $('storeCreateBtn');
    if (btn) btn.disabled = true;
    setStoreStatus('pending', '매장 방을 만드는 중…');
    StoreCloud.createRoom(code).then(function (res) {
      lsSet(OWNER_KEY, '1');
      lsSet(LOCK_KEY, '');
      S.code = code;
      StoreCloud.rememberCode(code);
      S.connected = false;
      setStoreStatus('pending', '매장 방에 연결하는 중…');
      enterStore(code, 'owner');
      toast(res && res.created ? '매장 캘린더를 만들었어요' : '이미 있는 매장에 연결했어요');
      renderModeChrome();
    }).catch(function (err) {
      setStoreStatus('error', '매장을 만들지 못했어요 · ' + errorHint(err));
      toast('매장을 만들지 못했어요');
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function submitJoin() {
    if (!S.code || !S.connected) { toast('매장 방에 연결하는 중이에요. 잠시 후 다시 눌러 주세요'); return; }
    var nameInput = $('storeJoinName');
    var telInput = $('storeJoinTel');
    var name = (nameInput ? nameInput.value : '').trim();
    var tel = normTel(telInput ? telInput.value : '');
    if (telInput) telInput.value = tel;
    var err = $('storeJoinError');
    if (!name) { if (err) { err.textContent = '이름을 넣어 주세요.'; err.hidden = false; } return; }
    if (name.length > 12) { if (err) { err.textContent = '이름은 12자까지 넣을 수 있어요.'; err.hidden = false; } return; }
    if (!tel) { if (err) { err.textContent = '휴대폰 번호를 넣어 주세요. (사장님이 연락할 번호)'; err.hidden = false; } return; }
    if (!telLooksValid(tel)) { if (err) { err.textContent = '휴대폰 번호를 다시 확인해 주세요 (예: 010-1234-5678).'; err.hidden = false; } return; }
    var already = S.staff.filter(function (m) { return m.name === name; })[0];
    if (already) { if (err) { err.textContent = '같은 이름이 이미 있어요. 구분되는 이름(예: 오후 알바)을 넣어 주세요.'; err.hidden = false; } return; }
    if (err) err.hidden = true;
    var blocked = blockReason();
    if (blocked) { showBlocked(blocked); return; }
    var btn = $('storeJoinBtn');
    if (btn) btn.disabled = true;
    StoreCloud.submitJoinRequest({ name: name, tel: tel, deviceId: deviceId() }).then(function () {
      lsSet('family-calendar.store.myname.v1', name);
      lsSet('family-calendar.store.mytel.v1', tel);
      showPending();
      setStoreStatus('pending', '입장 승인을 기다리는 중이에요');
      toast('입장 요청을 보냈어요 · 사장님 승인을 기다려 주세요');
    }).catch(function (e) {
      if (e && e.message === 'revoked') { showBlocked('퇴사(탈퇴) 처리되어 매장에 접근할 수 없습니다'); return; }
      if (err) { err.textContent = '요청을 보내지 못했어요 · ' + errorHint(e); err.hidden = false; }
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  /* ---------------- 사장님 PIN ---------------- */
  function openOwnerPin() {
    if (!S.code) { showSetup(); return; }
    S.pendingPin = 'owner';
    var err = $('storePinError');
    if (err) err.hidden = true;
    var input = $('storePinInput');
    if (input) input.value = '';
    var hint = $('storePinHint');
    var stored = S.pins && S.pins.owner;
    if (hint) {
      hint.textContent = stored
        ? '등록된 4자리 사장님 PIN을 넣어 주세요.'
        : '처음에는 2026으로 열려요. 들어간 뒤 매장 설정에서 꼭 바꿔 주세요.';
    }
    var m = $('storePinModal');
    if (m) m.hidden = false;
    try { if (input) input.focus(); } catch (e) { /* 무시 */ }
  }

  function submitOwnerPin(e) {
    if (e) e.preventDefault();
    var input = $('storePinInput');
    var err = $('storePinError');
    var pin = (input ? input.value : '').replace(/\D/g, '');
    if (pin.length !== 4) { if (err) { err.textContent = '4자리 숫자를 넣어 주세요.'; err.hidden = false; } return; }
    var stored = S.pins && S.pins.owner;
    var ok = stored ? (StoreCloud.pinHash(pin) === stored) : (pin === INITIAL_PIN);
    if (!ok) { if (err) { err.textContent = 'PIN이 맞지 않아요.'; err.hidden = false; } return; }
    if (err) err.hidden = true;
    $('storePinModal').hidden = true;
    S.pinAsked = false;
    lsSet(OWNER_KEY, '1');
    lsSet(LOCK_KEY, '');
    S.role = 'owner';
    S.filter = 'all';
    renderModeChrome();
    renderAll();
    toast(stored ? '사장님으로 열었어요' : '처음 PIN(2026)으로 열었어요 · 매장 설정에서 바꿔 주세요');
  }

  /* ---------------- 렌더 ---------------- */
  function renderAll() {
    if (!S.active) return;
    if (S.blocked) return;
    if (S.role === 'none') { paintStoreStatus(); return; }    if (!S.connected) {
      // 방 문서는 받았지만 근무 목록을 아직 못 받은 경우
      if (!S.shifts.length) showLoading();
    }
    if (S.role === 'staff' && myStaffId()) S.filter = myStaffId();
    showMain();
    renderDash();
    renderMyCard();
    renderStaffFilter();
    renderCalendar();
    renderDay();
    renderHandover();
    renderPayroll();
    renderStaffList();
    renderGuide();
    var apModal = $('storeApproveModal');
    if (apModal && !apModal.hidden) renderApprovalCards();
    paintStoreStatus();
  }

  function renderDash() {
    var today = todayISO();
    var todayShifts = S.shifts.filter(function (s) { return s.date === today && passFilter(s); });
    var monthShifts = shiftsInMonth(S.year, S.month);
    var todayMin = sumMinutes(todayShifts);
    var todayPay = sumPay(todayShifts);
    var monthMin = sumMinutes(monthShifts);
    var monthPay = sumPay(monthShifts);

    var label = $('dashMonthLabel');
    if (label) label.textContent = (S.month + 1) + '월 근무';
    var tH = $('dashTodayHours'); if (tH) tH.textContent = hoursText(todayMin);
    var tC = $('dashTodayCost'); if (tC) tC.textContent = money(todayPay);
    var mH = $('dashMonthHours'); if (mH) mH.textContent = hoursText(monthMin);
    var mC = $('dashMonthCost'); if (mC) mC.textContent = money(monthPay);

    var person = $('dashPerson');
    if (person) {
      if (!isOwner()) {
        person.hidden = false;
        person.textContent = (me() ? me().name : '내') + ' · 이번 달 ' + hoursText(monthMin) + ' · 예상 급여 ' + money(monthPay);
      } else if (S.filter !== 'all') {
        var st = staffById(S.filter);
        var days = {};
        monthShifts.forEach(function (s) { if (countsForPay(s)) days[s.date] = 1; });
        person.hidden = false;
        person.textContent = (st ? st.name : '선택') + ' · 이번 달 ' + Object.keys(days).length + '일 · ' + hoursText(monthMin) + ' · 예상 ' + money(monthPay);
      } else {
        person.hidden = true;
      }
    }
  }

  function renderStaffFilter() {
    var wrap = $('storeStaffFilter');
    if (!wrap) return;
    wrap.innerHTML = '';
    var list = isOwner()
      ? S.staff.filter(function (m) { return !m.retired || m.id === S.filter; })
      : S.staff.filter(function (m) { return m.id === myStaffId() && !m.retired; });
    function chip(id, name, color, active, member) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (active ? ' is-active' : '');
      b.setAttribute('aria-pressed', String(active));
      if (active) b.style.background = color || '#0d9488';
      if (member) {
        var av = storeAvatar(member, 18);
        av.classList.add('chip__av');
        b.appendChild(av);
      } else {
        var d = document.createElement('span');
        d.className = 'chip__dot';
        d.style.background = color || '#94a3b8';
        if (active) d.style.background = '#fff';
        b.appendChild(d);
      }
      b.appendChild(document.createTextNode(name));
      b.addEventListener('click', function () {
        if (!isOwner()) return;
        S.filter = id;
        renderAll();
      });
      wrap.appendChild(b);
    }
    if (isOwner()) chip('all', '전체', '#0d9488', S.filter === 'all');
    list.forEach(function (m) {
      chip(m.id, m.name + (m.retired ? ' ·퇴사' : ''), m.color, S.filter === m.id, m);
    });
    if (!list.length && !isOwner()) wrap.innerHTML = '<span class="field-hint">등록된 알바생이 없어요.</span>';
  }

  function renderCalendar() {
    var grid = $('storeGrid');
    var title = $('storeCalTitle');
    var sub = $('storeCalSub');
    if (!grid) return;
    var y = S.year, m = S.month;
    if (title) title.textContent = y + '년 ' + (m + 1) + '월';
    if (sub) {
      var ms = shiftsInMonth(y, m);
      sub.textContent = '총 ' + hoursText(sumMinutes(ms)) + (isOwner() ? ' · ' + money(sumPay(ms)) : '');
    }

    var first = new Date(y, m, 1);
    var total = daysInMonth(y, m);
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
      cell.className = 'day';
      if (!inMonth) cell.className += ' day--out';
      if (wd === 0) cell.className += ' day--sun';
      if (wd === 6) cell.className += ' day--sat';
      if (dateISO === today) cell.className += ' day--today';
      if (dateISO === S.selected) cell.className += ' day--selected';

      var num = document.createElement('span');
      num.className = 'day__num';
      num.textContent = String(dt.getDate());
      cell.appendChild(num);

      var dayShifts = S.shifts.filter(function (s) { return s.date === dateISO && passFilter(s); });
      if (dayShifts.length) {
        var dots = document.createElement('span');
        dots.className = 'dots';
        var seen = [];
        dayShifts.forEach(function (s) {
          var st = staffById(s.staffId);
          var color = st ? st.color : '#94a3b8';
          if (seen.indexOf(color) !== -1) return;
          seen.push(color);
          if (seen.length > 3) return;
          var d = document.createElement('span');
          d.className = 'dot';
          d.style.background = color;
          dots.appendChild(d);
        });
        if (seen.length > 3) {
          var more = document.createElement('span');
          more.className = 'dots__more';
          more.textContent = '+' + (seen.length - 3);
          dots.appendChild(more);
        }
        cell.appendChild(dots);
        var hEl = document.createElement('span');
        hEl.className = 'store-cell__hours';
        hEl.textContent = dayShifts.length + '명';
        cell.appendChild(hEl);
      }

      (function (target, inM) {
        cell.addEventListener('click', function () {
          if (!inM) {
            var d2 = parseISO(target);
            S.year = d2.getFullYear();
            S.month = d2.getMonth();
          }
          S.selected = target;
          renderCalendar();
          renderDay();
        });
      })(dateISO, inMonth);

      grid.appendChild(cell);
    }

    var legend = $('storeLegend');
    if (legend) {
      legend.innerHTML = '';
      S.staff.forEach(function (m) {
        var wrap = document.createElement('span');
        var i = document.createElement('i');
        i.style.background = m.color;
        wrap.appendChild(i);
        wrap.appendChild(document.createTextNode(m.name));
        legend.appendChild(wrap);
      });
    }
  }

  function renderDay() {
    var card = $('storeDayCard');
    if (!card) return;
    var dateISO = S.selected || todayISO();
    var dt = parseISO(dateISO);
    var wd = dt.getDay();
    card.innerHTML = '';

    var head = document.createElement('div');
    head.className = 'day-head';
    var wrap = document.createElement('div');
    wrap.className = 'day-head__date';
    var strong = document.createElement('strong');
    strong.textContent = (dt.getMonth() + 1) + '월 ' + dt.getDate() + '일';
    wrap.appendChild(strong);
    var dow = document.createElement('span');
    dow.className = 'day-head__dow' + (wd === 0 ? ' is-sun' : wd === 6 ? ' is-sat' : '');
    dow.textContent = '(' + WEEKDAYS[wd] + ')';
    wrap.appendChild(dow);
    head.appendChild(wrap);

    if (isOwner()) {
      var add = document.createElement('button');
      add.type = 'button';
      add.className = 'day-card__add store';
      add.textContent = '＋ 근무 등록';
      add.addEventListener('click', function () { openShift(null, dateISO); });
      head.appendChild(add);
    }
    card.appendChild(head);

    var list = shiftsOn(dateISO);
    if (!list.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.innerHTML = '이 날은 등록된 근무가 없어요.' + (isOwner() ? '<br><b>＋ 근무 등록</b>으로 알바 스케줄을 넣어 보세요.' : '');
      card.appendChild(empty);
      return;
    }

    var ul = document.createElement('ul');
    ul.className = 'shift-list';
    list.forEach(function (sh) {
      ul.appendChild(buildShiftItem(sh));
    });
    card.appendChild(ul);

    var min = sumMinutes(list);
    var total = document.createElement('p');
    total.className = 'store-total';
    var heads = list.filter(function (s) { return countsForPay(s); }).length;
    total.textContent = '당일 ' + heads + '명 근무 · ' + hoursText(min) + (isOwner() ? ' · 인건비 ' + money(sumPay(list)) : '');
    card.appendChild(total);
  }

  function buildShiftItem(sh) {
    var st = staffById(sh.staffId);
    var color = st ? st.color : '#94a3b8';
    var li = document.createElement('li');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shift';
    btn.style.setProperty('--sc', color);

    var body = document.createElement('div');
    body.className = 'shift__body';

    var top = document.createElement('div');
    top.className = 'shift__top';
    var av = storeAvatar(st, 20);
    av.style.marginRight = '2px';
    top.appendChild(av);
    var name = document.createElement('span');
    name.className = 'shift__name';
    name.textContent = sh.staffName || (st ? st.name : '알바');
    top.appendChild(name);
    var tag = document.createElement('span');
    tag.className = 'store-tag store-tag--' + (sh.status || 'planned');
    tag.textContent = STATUS_LABEL[sh.status] || '예정';
    top.appendChild(tag);
    body.appendChild(top);

    var meta = document.createElement('div');
    meta.className = 'shift__meta';
    var time = document.createElement('span');
    time.className = 'shift__time';
    time.textContent = (sh.start || '--:--') + ' ~ ' + (sh.end || '--:--');
    meta.appendChild(time);
    var dur = document.createElement('span');
    dur.textContent = hoursText(shiftMinutes(sh)) + (sh.breakMin ? ' (휴게 ' + sh.breakMin + '분)' : '');
    meta.appendChild(dur);
    if (isOwner() || (sh.staffId && sh.staffId === myStaffId())) {
      var pay = document.createElement('span');
      pay.className = 'shift__pay';
      pay.textContent = money(shiftPay(sh));
      meta.appendChild(pay);
    }
    if (isOwner() && st && telOf(st)) {
      var tel = document.createElement('span');
      tel.className = 'shift__tel';
      tel.textContent = '📞 ' + telOf(st);
      meta.appendChild(tel);
    }
    body.appendChild(meta);

    if (sh.memo) {
      var memo = document.createElement('div');
      memo.className = 'shift__memo';
      memo.textContent = sh.memo;
      body.appendChild(memo);
    }

    /* 실제 출퇴근 시각 */
    if (sh.actualStart) {
      var act = document.createElement('div');
      act.className = 'shift__actual';
      act.textContent = '🕒 실제 ' + sh.actualStart + ' ~ ' + (sh.actualEnd || '근무 중')
        + (sh.actualEnd ? ' (' + hoursText(actualMinutes(sh)) + ')' : '');
      body.appendChild(act);
    }

    /* 내 근무 변경·대타 요청 상태 */
    var myReq = latestShiftRequest(sh.id, isOwner() ? '' : myStaffId());
    if (myReq) {
      var rq = document.createElement('div');
      rq.className = 'shift__req shift__req--' + myReq.status;
      rq.textContent = '🙋 변경 요청 ' + (myReq.status === 'pending' ? '대기 중' : myReq.status === 'approved' ? '승인됨' : '거절됨')
        + (myReq.reqStart || myReq.reqEnd ? ' · ' + (myReq.reqStart || '?') + '~' + (myReq.reqEnd || '?') : '')
        + (myReq.wantStaffName ? ' · 대타 ' + myReq.wantStaffName : '');
      body.appendChild(rq);
    }

    btn.appendChild(body);
    btn.addEventListener('click', function () {
      if (isOwner()) openShift(sh, null);
      else openShift(sh, null, true);
    });
    li.appendChild(btn);
    var attRow = buildAttendanceRow(sh);
    if (attRow) li.appendChild(attRow);
    return li;
  }

  /* ---------------- 🕒 출퇴근 체크 ---------------- */
  function nowHM() {
    var d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function actualMinutes(sh) {
    if (!sh || !sh.actualStart || !sh.actualEnd) return 0;
    var s = toMin(sh.actualStart), e = toMin(sh.actualEnd);
    if (e <= s) e += 1440;
    return Math.max(0, e - s);
  }

  /* 내 근무(알바생)이거나 사장님이면, 오늘 근무에 출근·퇴근 단추가 보입니다. */
  function buildAttendanceRow(sh) {
    var mine = isOwner() || (sh.staffId && sh.staffId === myStaffId());
    if (!mine) return null;
    if (!sh.actualStart && sh.date !== todayISO()) return null;
    if (sh.status === 'canceled' || sh.status === 'absent') return null;

    var row = document.createElement('div');
    row.className = 'att-row';

    function btn(label, cls, onClick) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'att-btn ' + cls;
      b.textContent = label;
      b.addEventListener('click', onClick);
      row.appendChild(b);
      return b;
    }

    if (!sh.actualStart) {
      btn('출근 체크', 'is-start', function () { markAttendance(sh, 'start'); });
    } else if (!sh.actualEnd) {
      var s = document.createElement('span');
      s.className = 'att-state';
      s.textContent = '출근 ' + sh.actualStart;
      row.appendChild(s);
      btn('퇴근 체크', 'is-end', function () { markAttendance(sh, 'end'); });
      btn('출근 취소', 'is-ghost', function () { clearAttendance(sh, 'start'); });
    } else {
      btn('퇴근 취소', 'is-ghost', function () { clearAttendance(sh, 'end'); });
    }
    return row;
  }

  function markAttendance(sh, which) {
    var hm = nowHM();
    var patch = {};
    if (which === 'start') {
      patch.actualStart = hm;
      patch.actualEnd = null;
    } else {
      patch.actualEnd = hm;
    }
    StoreCloud.updateShift(sh.id, patch).then(function () {
      toast(which === 'start' ? '출근 ' + hm + ' 체크했어요' : '퇴근 ' + hm + ' 체크했어요');
    }).catch(function (err) {
      window.alert('출퇴근을 저장하지 못했어요 · ' + errorHint(err));
    });
  }

  function clearAttendance(sh, which) {
    var patch = which === 'start' ? { actualStart: null, actualEnd: null } : { actualEnd: null };
    StoreCloud.updateShift(sh.id, patch).then(function () {
      toast(which === 'start' ? '출근 기록을 지웠어요' : '퇴근 기록을 지웠어요');
    }).catch(function (err) {
      window.alert('기록을 지우지 못했어요 · ' + errorHint(err));
    });
  }

  /* 그 근무의 가장 최근 변경 요청 (staffId 있으면 그 알바생 것만) */
  function latestShiftRequest(shiftId, staffId) {
    var list = (S.shiftRequests || []).filter(function (r) {
      if (r.shiftId !== shiftId) return false;
      if (staffId && r.staffId !== staffId) return false;
      return true;
    });
    return list.length ? list[0] : null;
  }

  /* ---------------- 📝 교대 인수인계 메모 ---------------- */
  function timeHHMM(ms) {
    var d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function handoversOn(dateISO) {
    return (S.handovers || []).filter(function (h) { return h.date === dateISO; })
      .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
  }

  function renderHandover() {
    var card = $('storeHandoverCard');
    if (!card) return;
    var dateISO = S.selected || todayISO();
    var dt = parseISO(dateISO);
    var list = handoversOn(dateISO);
    var hint = $('storeHandoverHint');
    if (hint) hint.textContent = (dt.getMonth() + 1) + '/' + dt.getDate() + ' · ' + list.length + '건';
    var listEl = $('storeHandoverList');
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!list.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '아직 남긴 인수인계가 없어요. 교대할 때 특이사항을 한 줄 남겨 주세요.';
      listEl.appendChild(empty);
      return;
    }
    list.forEach(function (h) {
      var li = document.createElement('li');
      li.className = 'handover-item' + (h.done ? ' is-done' : '');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'check-row';
      b.setAttribute('aria-pressed', h.done ? 'true' : 'false');
      var box = document.createElement('span');
      box.className = 'check-row__box';
      box.textContent = h.done ? '✓' : '';
      b.appendChild(box);
      var tx = document.createElement('span');
      tx.className = 'check-row__text';
      tx.textContent = h.text;
      b.appendChild(tx);
      b.addEventListener('click', function () { toggleHandover(h); });
      li.appendChild(b);
      var by = document.createElement('div');
      by.className = 'handover-item__by';
      by.textContent = '✍️ ' + (h.author || '알바') + (h.createdAt ? ' · ' + timeHHMM(h.createdAt) : '');
      li.appendChild(by);
      if (isOwner() || (h.authorId && h.authorId === myStaffId())) {
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'handover-item__del';
        del.textContent = '✕';
        del.setAttribute('aria-label', '인수인계 삭제');
        del.addEventListener('click', function () { removeHandover(h); });
        li.appendChild(del);
      }
      listEl.appendChild(li);
    });
  }

  function addHandover() {
    var input = $('storeHandoverInput');
    var text = String(input ? input.value : '').trim().slice(0, 80);
    if (!text) { toast('남길 내용을 입력해 주세요'); if (input) input.focus(); return; }
    var dateISO = S.selected || todayISO();
    var author = isOwner() ? '사장님' : (me() ? me().name : '알바');
    var authorId = isOwner() ? '' : myStaffId();
    var btn = $('storeHandoverAddBtn');
    if (btn) btn.disabled = true;
    StoreCloud.saveHandover({ date: dateISO, text: text, author: author, authorId: authorId }).then(function () {
      if (input) input.value = '';
      toast('인수인계를 남겼어요');
    }).catch(function (err) {
      window.alert('남기지 못했어요 · ' + errorHint(err));
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function toggleHandover(h) {
    StoreCloud.updateHandover(h.id, { done: !h.done }).then(function () {
      toast(!h.done ? '확인 완료로 표시했어요' : '확인 표시를 풀었어요');
    }).catch(function (err) {
      window.alert('저장하지 못했어요 · ' + errorHint(err));
    });
  }

  function removeHandover(h) {
    if (!window.confirm('"' + h.text + '" 인수인계를 지울까요?')) return;
    StoreCloud.deleteHandover(h.id).then(function () {
      toast('인수인계를 지웠어요');
    }).catch(function (err) {
      window.alert('지우지 못했어요 · ' + errorHint(err));
    });
  }

  /* ---------------- 🙋 근무 변경·대타 요청 (알바생) ---------------- */
  function openShiftReq(sh) {
    if (!sh) return;
    S.reqShift = sh;
    S.reqWantStaff = '';
    var d = parseISO(sh.date);
    var intro = $('shiftReqIntro');
    if (intro) {
      intro.innerHTML = '<b>' + esc((d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + (sh.start || '--:--') + ' ~ ' + (sh.end || '--:--')) +
        '</b> 근무를 바꾸려고 해요.<br>바꿀 내용을 적어 보내면 사장님이 <b>승인</b>한 뒤 근무가 바뀝니다.';
    }
    setVal('reqStart', '');
    setVal('reqEnd', '');
    setVal('reqReason', '');
    var err = $('reqError');
    if (err) err.hidden = true;
    var pick = $('reqStaffPicker');
    if (pick) {
      pick.innerHTML = '';
      var others = S.staff.filter(function (m) { return m.id !== sh.staffId && m.active !== false; });
      if (!others.length) {
        var none = document.createElement('span');
        none.className = 'field-hint';
        none.textContent = '대타로 넘길 다른 알바생이 없어요. 시간 변경만 요청할 수 있어요.';
        pick.appendChild(none);
      }
      others.forEach(function (m) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'pick';
        b.setAttribute('data-id', m.id);
        b.style.setProperty('--c', m.color);
        b.style.setProperty('--bgc', m.bg);
        b.style.setProperty('--fgc', m.color);
        var i = document.createElement('i');
        b.appendChild(i);
        b.appendChild(document.createTextNode(m.name));
        b.addEventListener('click', function () {
          if (S.reqWantStaff === m.id) {
            S.reqWantStaff = '';
            b.classList.remove('is-on');
          } else {
            S.reqWantStaff = m.id;
            Array.prototype.forEach.call(pick.querySelectorAll('button'), function (c) { c.classList.remove('is-on'); });
            b.classList.add('is-on');
          }
        });
        pick.appendChild(b);
      });
    }
    var m2 = $('shiftReqModal');
    if (m2) m2.hidden = false;
  }

  function closeShiftReq() {
    var m = $('shiftReqModal');
    if (m) m.hidden = true;
    S.reqShift = null;
    S.reqWantStaff = '';
  }

  function showReqError(msg) {
    var err = $('reqError');
    if (err) { err.textContent = msg; err.hidden = false; }
  }

  /* 희망 시간 빠른 조정 — 지금 근무에서 ±1·2시간 옮긴 시간을 채웁니다. */
  function applyQuickTime(kind) {
    var sh = S.reqShift;
    if (!sh) return;
    if (kind === 'clear') {
      setVal('reqStart', '');
      setVal('reqEnd', '');
      return;
    }
    var delta = kind === 'late2' ? 120 : kind === 'late1' ? 60 : kind === 'early1' ? -60 : 0;
    if (!delta) return;
    function shiftHM(hm) {
      var m = toMin(hm) + delta;
      while (m < 0) m += 1440;
      m = m % 1440;
      return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
    }
    var s = sh.start || '18:00';
    var e = sh.end || '22:00';
    setVal('reqStart', shiftHM(s));
    setVal('reqEnd', shiftHM(e));
    var err = $('reqError');
    if (err) err.hidden = true;
  }

  function submitShiftReq() {
    var sh = S.reqShift;
    if (!sh) return;
    var rs = getVal('reqStart'), re = getVal('reqEnd');
    if ((rs && !re) || (!rs && re)) { showReqError('희망 시간은 출근·퇴근을 함께 넣어 주세요.'); return; }
    if (rs && re && rs === re) { showReqError('희망 출근과 퇴근 시간이 같아요.'); return; }
    var want = S.reqWantStaff ? staffById(S.reqWantStaff) : null;
    if (!rs && !want) { showReqError('바꿀 시간이나 대타 직원을 하나는 골라 주세요.'); return; }
    var btn = $('reqSaveBtn');
    if (btn) btn.disabled = true;
    StoreCloud.submitShiftRequest({
      shiftId: sh.id,
      date: sh.date,
      staffId: sh.staffId,
      staffName: sh.staffName,
      reqStart: rs,
      reqEnd: re,
      wantStaffId: want ? want.id : '',
      wantStaffName: want ? want.name : '',
      reason: getVal('reqReason').trim()
    }).then(function () {
      closeShiftReq();
      var sm = $('shiftModal');
      if (sm) sm.hidden = true;
      toast('변경 요청을 보냈어요 · 사장님 승인을 기다려 주세요');
    }).catch(function (err) {
      showReqError('요청을 보내지 못했어요 · ' + errorHint(err));
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  /* ---------------- 💬 카톡 요약 복사 ---------------- */
  function storeSummaryLine(sh) {
    var line = '· ' + (sh.start || '--:--') + '~' + (sh.end || '--:--') + ' ' + (sh.staffName || '알바') + ' (' + hoursText(shiftMinutes(sh)) + ')';
    if (sh.status && sh.status !== 'planned') line += ' ' + (STATUS_LABEL[sh.status] || '');
    if (sh.actualStart) line += '\n   실제 ' + sh.actualStart + '~' + (sh.actualEnd || '근무 중');
    return line;
  }

  function storeDayBlock(dateISO) {
    var list = S.shifts.filter(function (s) { return s.date === dateISO && passFilter(s); }).sort(byStart);
    var hand = handoversOn(dateISO);
    if (!list.length && !hand.length) return '';
    var dt = parseISO(dateISO);
    var out = ['[' + (dt.getMonth() + 1) + '/' + dt.getDate() + '(' + WEEKDAYS[dt.getDay()] + ')]'];
    list.forEach(function (sh) { out.push(storeSummaryLine(sh)); });
    if (hand.length) {
      out.push('· 인수인계 ' + hand.length + '건: ' + hand.slice(0, 3).map(function (h) { return h.text; }).join(' / ')
        + (hand.length > 3 ? ' 외 ' + (hand.length - 3) : ''));
    }
    return out.join('\n');
  }

  function buildStoreKakaoText(scope) {
    var lines = [];
    var start = scope === 'today' ? todayISO() : weekKey(todayISO());
    var end = scope === 'today' ? todayISO() : isoOfDate(new Date(parseISO(start).getFullYear(), parseISO(start).getMonth(), parseISO(start).getDate() + 6));
    var s = parseISO(start), e = parseISO(end);
    var who = isOwner() ? (S.filter !== 'all' && staffById(S.filter) ? staffById(S.filter).name : '전체') : (me() ? me().name : '내');
    var head = '🏪 ' + (S.storeName || '매장') + ' · ' + (scope === 'today' ? '오늘' : '이번 주') + ' 근무';
    lines.push(head);
    if (scope === 'today') {
      var block = storeDayBlock(start);
      lines.push(block ? block.split('\n').slice(1).join('\n') : '오늘은 등록된 근무가 없어요.');
    } else {
      lines.push((s.getMonth() + 1) + '/' + s.getDate() + '(' + WEEKDAYS[s.getDay()] + ') ~ ' + (e.getMonth() + 1) + '/' + e.getDate() + '(' + WEEKDAYS[e.getDay()] + ') · ' + who);
      var any = false;
      for (var i = 0; i < 7; i++) {
        var b = storeDayBlock(isoOfDate(new Date(s.getFullYear(), s.getMonth(), s.getDate() + i)));
        if (!b) continue;
        any = true;
        lines.push(b);
      }
      if (!any) lines.push('이번 주는 등록된 근무가 없어요.');
    }
    return lines.join('\n').trim();
  }

  function copyStoreKakao(scope) {
    var text = buildStoreKakaoText(scope);
    var prev = $('storeKakaoPreview');
    if (prev) {
      prev.textContent = text;
      prev.hidden = false;
    }
    copyText(text, scope === 'today' ? '오늘 근무를 복사했어요 · 카톡에 붙여넣으세요' : '이번 주 근무를 복사했어요 · 카톡에 붙여넣으세요');
  }

  /* ---------------- 근무 등록/수정 ---------------- */
  function openShift(sh, presetDate, readonly) {
    if (!isOwner() && !readonly) return;
    S.shiftEditingId = sh ? sh.id : null;
    var firstActive = S.staff.filter(function (m) { return !m.retired; })[0];
    S.shiftStaffId = sh ? sh.staffId : (S.filter !== 'all' ? S.filter : (firstActive ? firstActive.id : ''));
    S.shiftStatus = sh ? (sh.status || 'planned') : 'planned';
    resetShiftVoiceBox();

    var title = $('shiftTitle');
    if (title) title.textContent = sh ? (readonly ? '근무 정보' : '근무 수정') : '근무 등록';

    var pickWrap = $('shiftStaffPicker');
    if (pickWrap) {
      pickWrap.innerHTML = '';
      var pickable = S.staff.filter(function (m) { return !m.retired || m.id === S.shiftStaffId; });
      if (!pickable.length) {
        pickWrap.innerHTML = '<p class="field-hint">등록된 알바생이 없어요. 알바생이 초대 링크로 입장을 요청하면 승인해 주세요.</p>';
      }
      pickable.forEach(function (m) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'pick' + (m.id === S.shiftStaffId ? ' is-on' : '');
        b.setAttribute('data-id', m.id);
        b.style.setProperty('--c', m.color);
        b.style.setProperty('--bgc', m.bg);
        b.style.setProperty('--fgc', m.color);
        var dot = document.createElement('i');
        b.appendChild(dot);
        b.appendChild(document.createTextNode(m.name));
        b.addEventListener('click', function () {
          if (readonly) return;
          S.shiftStaffId = m.id;
          Array.prototype.forEach.call(pickWrap.children, function (c) { c.classList.remove('is-on'); });
          b.classList.add('is-on');
          var wage = $('shiftWage');
          if (wage && !S.shiftEditingId) wage.value = String(m.hourly || '');
          updateShiftHint();
        });
        pickWrap.appendChild(b);
      });
    }

    setVal('shiftDate', sh ? sh.date : (presetDate || S.selected || todayISO()));
    setVal('shiftEndDate', '');
    var rangeField = $('shiftRangeField');
    if (rangeField) rangeField.hidden = !!sh;
    var rangeHint = $('shiftRangeHint');
    if (rangeHint) rangeHint.textContent = sh
      ? '이 근무를 여러 날로 바꾸려면 지우고 새로 등록해 주세요.'
      : '여러 날 연속 근무면 종료일을 골라 주세요. 같은 날이면 하루만 등록돼요.';
    setVal('shiftStart', sh ? sh.start : '18:00');
    setVal('shiftEnd', sh ? sh.end : '22:00');
    setVal('shiftBreak', sh ? String(sh.breakMin || 0) : '0');
    var st = staffById(S.shiftStaffId);
    setVal('shiftWage', sh ? String(sh.wage || 0) : String((st && st.hourly) || ''));
    setVal('shiftMemo', sh ? (sh.memo || '') : '');

    var statusWrap = $('shiftStatus');
    if (statusWrap) {
      Array.prototype.forEach.call(statusWrap.children, function (c) {
        c.classList.toggle('is-active', c.getAttribute('data-status') === S.shiftStatus);
        c.disabled = !!readonly;
      });
    }
    ['shiftDate', 'shiftStart', 'shiftEnd', 'shiftBreak', 'shiftWage', 'shiftMemo'].forEach(function (id) {
      var f = $(id);
      if (f) f.disabled = !!readonly;
    });
    var sEnd = $('shiftEndDate');
    if (sEnd) sEnd.disabled = !!readonly;
    if (pickWrap) {
      Array.prototype.forEach.call(pickWrap.querySelectorAll('button'), function (b) {
        b.disabled = !!readonly;
      });
    }

    var saveBtn = $('shiftSaveBtn');
    if (saveBtn) { saveBtn.hidden = !!readonly; saveBtn.textContent = sh ? '저장' : '등록'; }
    var delBtn = $('shiftDeleteBtn');
    if (delBtn) delBtn.hidden = !sh || !!readonly;
    var reqBtn = $('shiftReqBtn');
    if (reqBtn) reqBtn.hidden = !(sh && readonly);
    var reqNote = $('shiftReqStatus');
    if (reqNote) {
      var mineReq = sh ? latestShiftRequest(sh.id, isOwner() ? '' : myStaffId()) : null;
      if (mineReq) {
        reqNote.hidden = false;
        reqNote.textContent = '🙋 변경 요청 · ' + (mineReq.status === 'pending' ? '사장님 승인 대기 중'
          : mineReq.status === 'approved' ? '승인됨 (근무가 바뀌었어요)' : '거절됨')
          + (mineReq.reqStart || mineReq.reqEnd ? ' · 희망 ' + (mineReq.reqStart || '?') + '~' + (mineReq.reqEnd || '?') : '')
          + (mineReq.wantStaffName ? ' · 대타 ' + mineReq.wantStaffName : '')
          + (mineReq.reason ? ' · ' + mineReq.reason : '');
      } else {
        reqNote.hidden = true;
        reqNote.textContent = '';
      }
    }
    var vBox = $('shiftVoiceBtn');
    if (vBox && vBox.parentNode) vBox.parentNode.hidden = !!readonly;
    var err = $('shiftError');
    if (err) err.hidden = true;

    updateShiftHint();
    var modal = $('shiftModal');
    if (modal) modal.hidden = false;
  }

  function setVal(id, v) {
    var f = $(id);
    if (f) f.value = v;
  }
  function getVal(id) {
    var f = $(id);
    return f ? f.value : '';
  }

  function updateShiftHint() {
    var hint = $('shiftHoursHint');
    if (!hint) return;
    var min = shiftMinutes({ start: getVal('shiftStart'), end: getVal('shiftEnd'), breakMin: getVal('shiftBreak') });
    var wage = Math.max(0, Math.round(Number(getVal('shiftWage')) || 0));
    var overnight = toMin(getVal('shiftEnd')) <= toMin(getVal('shiftStart'));
    var endDate = getVal('shiftEndDate');
    var startDate = getVal('shiftDate');
    var extra = '';
    if (!S.shiftEditingId && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate > startDate) {
      var n = Math.round((parseISO(endDate) - parseISO(startDate)) / 86400000) + 1;
      extra = ' · ' + n + '일 연속 등록 · 합계 ' + hoursText(min * n) + ' / ' + money(Math.round(wage * min / 60) * n);
    }
    hint.textContent = '근무 ' + hoursText(min) + ' · 예상 ' + money(Math.round(wage * min / 60)) + (overnight ? ' · 자정을 넘기는 근무로 계산해요' : '') + extra;
  }

  /* ---------------- 매장 말로 입력 ---------------- */
  function resetShiftVoiceBox() {
    var status = $('shiftVoiceStatus');
    if (status) { status.hidden = true; status.textContent = ''; }
    if (window.CalendarVoice) CalendarVoice.stop();
  }

  function applyVoiceShift(text) {
    if (!window.CalendarVoice) return;
    var parsed = CalendarVoice.parse(text, {
      members: S.staff.map(function (m) { return { id: m.id, name: m.name }; }),
      today: todayISO()
    });
    if (parsed.members && parsed.members.length) {
      S.shiftStaffId = parsed.members[0];
      var wrap = $('shiftStaffPicker');
      if (wrap) {
        Array.prototype.forEach.call(wrap.querySelectorAll('button'), function (b) {
          b.classList.toggle('is-on', b.getAttribute('data-id') === S.shiftStaffId);
        });
      }
      var st = staffById(S.shiftStaffId);
      if (st && !S.shiftEditingId) setVal('shiftWage', String(st.hourly || ''));
    }
    if (parsed.date) setVal('shiftDate', parsed.date);
    if (parsed.endDate && parsed.endDate !== parsed.date) setVal('shiftEndDate', parsed.endDate);
    if (parsed.time) setVal('shiftStart', parsed.time);
    if (parsed.endTime) setVal('shiftEnd', parsed.endTime);
    if (parsed.title && !getVal('shiftMemo')) setVal('shiftMemo', parsed.title.slice(0, 60));
    var rangeField = $('shiftRangeField');
    if (rangeField && S.shiftEditingId) rangeField.hidden = true;
    updateShiftHint();

    var bits = [];
    if (parsed.date) bits.push('📅 ' + parsed.date + (parsed.endDate && parsed.endDate !== parsed.date ? ' ~ ' + parsed.endDate : ''));
    if (parsed.time) bits.push('⏰ ' + parsed.time + (parsed.endTime ? ' ~ ' + parsed.endTime : ''));
    if (parsed.members && parsed.members.length) {
      bits.push('👥 ' + parsed.members.map(function (id) {
        var m = staffById(id);
        return m ? m.name : '';
      }).filter(Boolean).join('·'));
    }
    if (parsed.title) bits.push('✏️ ' + parsed.title);
    var status = $('shiftVoiceStatus');
    if (status) {
      status.hidden = false;
      status.textContent = '말한 내용: ' + text + '\n' +
        (bits.length ? '→ ' + bits.join(' · ') + '\n맞는지 확인하고, 틀린 칸은 직접 고쳐 주세요.' :
          '→ 알아들은 내용이 없어요. 알바생·시간을 직접 넣어 주세요.');
    }
  }

  function closeShift() {
    var m = $('shiftModal');
    if (m) m.hidden = true;
    S.shiftEditingId = null;
    resetShiftVoiceBox();
  }

  function saveShift() {
    if (!isOwner()) return;
    var date = getVal('shiftDate');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showShiftError('날짜를 골라 주세요.'); return; }
    if (!S.shiftStaffId) { showShiftError('알바생을 골라 주세요.'); return; }
    var start = getVal('shiftStart'), end = getVal('shiftEnd');
    if (!start || !end) { showShiftError('출근·퇴근 시간을 넣어 주세요.'); return; }
    if (start === end) { showShiftError('출근과 퇴근 시간이 같아요.'); return; }
    var endDate = getVal('shiftEndDate');
    if (endDate && endDate < date) { showShiftError('종료일이 시작일보다 빨라요.'); return; }
    var staff = staffById(S.shiftStaffId);
    if (!staff) { showShiftError('알바생 정보를 찾지 못했어요. 화면을 새로 고쳐 주세요.'); return; }
    var status = S.shiftStatus || 'planned';
    var payload = {
      date: date,
      staffId: staff.id,
      staffName: staff.name,
      start: start,
      end: end,
      breakMin: Math.max(0, Math.round(Number(getVal('shiftBreak')) || 0)),
      wage: Math.max(0, Math.round(Number(getVal('shiftWage')) || staff.hourly || 0)),
      status: status,
      memo: getVal('shiftMemo').trim()
    };
    /* 출퇴근 기록은 근무를 수정해도 지우지 않습니다. */
    if (S.shiftEditingId) {
      var before = null;
      S.shifts.forEach(function (s) { if (s.id === S.shiftEditingId) before = s; });
      if (before) {
        payload.actualStart = before.actualStart || null;
        payload.actualEnd = before.actualEnd || null;
      }
    }
    var btn = $('shiftSaveBtn');
    if (btn) btn.disabled = true;

    var multi = !S.shiftEditingId && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate > date;
    var dates = [date];
    if (multi) {
      dates = [];
      var cur = parseISO(date), last = parseISO(endDate);
      while (cur <= last && dates.length < 62) {
        dates.push(isoOfDate(cur));
        cur.setDate(cur.getDate() + 1);
      }
      if (dates.length > 1 && !window.confirm(dates.length + '일 근무를 한 번에 등록할까요?\n' + dates[0] + ' ~ ' + dates[dates.length - 1] + ' · 매일 같은 시간·시급')) {
        if (btn) btn.disabled = false;
        return;
      }
    }

    var jobs = dates.map(function (d) {
      var p = {
        date: d,
        staffId: payload.staffId,
        staffName: payload.staffName,
        start: payload.start,
        end: payload.end,
        breakMin: payload.breakMin,
        wage: payload.wage,
        status: payload.status,
        actualStart: payload.actualStart || null,
        actualEnd: payload.actualEnd || null,
        memo: payload.memo
      };
      return StoreCloud.saveShift(S.shiftEditingId, p);
    });

    Promise.all(jobs).then(function () {
      S.selected = date;
      var d = parseISO(date);
      S.year = d.getFullYear();
      S.month = d.getMonth();
      closeShift();
      toast(dates.length > 1 ? dates.length + '일 근무를 등록했어요' : '근무를 저장했어요');
      renderAll();
    }).catch(function (err) {
      showShiftError('저장하지 못했어요 · ' + errorHint(err));
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function showShiftError(msg) {
    var err = $('shiftError');
    if (err) { err.textContent = msg; err.hidden = false; }
  }

  function deleteShift() {
    if (!isOwner() || !S.shiftEditingId) return;
    var id = S.shiftEditingId;
    var target = null;
    S.shifts.forEach(function (s) { if (s.id === id) target = s; });
    var label = target ? target.date.slice(5) + ' ' + (target.staffName || '') + ' ' + target.start + '~' + target.end : '이 근무';
    if (!window.confirm(label + ' 근무를 지울까요?\n매장 달력에서 사라져요.')) return;
    closeShift();
    StoreCloud.deleteShift(id).then(function () {
      toast('근무를 지웠어요');
    }).catch(function (err) {
      window.alert('지우지 못했어요 · ' + errorHint(err));
    });
  }

  function shiftMonth(delta) {
    var d = new Date(S.year, S.month + delta, 1);
    if (d.getFullYear() < NAV_MIN_YEAR || d.getFullYear() > NAV_MAX_YEAR) return;
    S.year = d.getFullYear();
    S.month = d.getMonth();
    var now = new Date();
    S.selected = (now.getFullYear() === S.year && now.getMonth() === S.month) ? todayISO() : iso(S.year, S.month + 1, 1);
    renderAll();
  }

  function goToday() {
    var now = new Date();
    S.year = now.getFullYear();
    S.month = now.getMonth();
    S.selected = todayISO();
    renderAll();
  }

  function shiftPayMonth(delta) {
    var d = new Date(S.payY, S.payM + delta, 1);
    if (d.getFullYear() < NAV_MIN_YEAR || d.getFullYear() > NAV_MAX_YEAR) return;
    S.payY = d.getFullYear();
    S.payM = d.getMonth();
    renderPayroll();
  }

  /* ---------------- 급여명세서 ---------------- */
  function computePayroll(staffId, y, m) {
    var key = monthKey(y, m);
    var list = S.shifts.filter(function (s) {
      return s.staffId === staffId && s.date && s.date.slice(0, 7) === key;
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var paid = list.filter(countsForPay);
    var days = {};
    paid.forEach(function (s) { days[s.date] = 1; });
    var minutes = sumMinutes(paid);
    var base = sumPay(paid);
    var avgWage = minutes ? Math.round(base / (minutes / 60)) : 0;
    var staff = staffById(staffId);

    var weekly = 0;
    if (S.payWeekly && minutes) {
      var groups = {};
      paid.forEach(function (s) {
        var k = weekKey(s.date);
        groups[k] = groups[k] || { min: 0, pay: 0 };
        groups[k].min += shiftMinutes(s);
        groups[k].pay += shiftPay(s);
      });
      Object.keys(groups).forEach(function (k) {
        var g = groups[k];
        if (!g.min) return;
        var h = g.min / 60;
        if (h < (S.settings.weeklyHours || 15)) return;
        var avg = g.pay / h;
        weekly += Math.round(Math.min(h, 40) / 40 * 8 * avg);
      });
    }
    var extra = Math.max(0, Math.round(Number(S.payExtra) || 0));
    var gross = base + weekly + extra;
    var taxRate = S.settings.taxMode === 'none' ? 0 : (S.settings.taxMode === '3.3' ? 3.3 : (Number(S.settings.taxRate) || 0));
    var tax = Math.round(gross * taxRate / 100);
    var net = gross - tax;
    var absent = list.filter(function (s) { return s.status === 'absent'; }).length;

    return {
      staff: staff,
      staffName: staff ? staff.name : '알바',
      staffTel: staff ? telOf(staff) : '',
      list: list,
      days: Object.keys(days).length,
      minutes: minutes,
      base: base,
      avgWage: avgWage,
      weekly: weekly,
      extra: extra,
      gross: gross,
      taxRate: taxRate,
      tax: tax,
      net: net,
      absent: absent,
      y: y,
      m: m,
      storeName: S.storeName || '우리 매장'
    };
  }

  function payDayText(y, m) {
    var day = Math.min(S.settings.payDay || 10, daysInMonth(y, m + 1));
    var d = new Date(y, m + 1, 1);
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + day + '일';
  }

  function renderPayroll() {
    var list = $('payList');
    var label = $('payrollMonth');
    if (!list) return;
    if (label) label.textContent = S.payY + '년 ' + (S.payM + 1) + '월';
    var ml = $('payrollMonthLabel');
    if (ml) ml.textContent = '알바생별 월 급여';

    list.innerHTML = '';
    var targets = isOwner() ? S.staff : S.staff.filter(function (m) { return m.id === myStaffId(); });
    if (!targets.length) {
      list.innerHTML = isOwner()
        ? '<li class="empty">아직 등록된 알바생이 없어요.<br>초대 링크로 들어온 알바생을 <b>승인</b>하면 여기에 나와요.</li>'
        : '<li class="empty">급여명세서가 아직 없어요.</li>';
      return;
    }
    targets.forEach(function (m) {
      var calc = computePayroll(m.id, S.payY, S.payM);
      var li = document.createElement('li');
      li.className = 'pay-row';
      var dot = document.createElement('span');
      dot.className = 'pay-row__dot';
      dot.style.background = m.color;
      li.appendChild(dot);
      var body = document.createElement('div');
      body.className = 'pay-row__body';
      var name = document.createElement('div');
      name.className = 'pay-row__name';
      name.textContent = m.name + (m.retired ? ' · 퇴사' : '');
      body.appendChild(name);
      var meta = document.createElement('div');
      meta.className = 'pay-row__meta';
      meta.textContent = calc.days + '일 · ' + hoursText(calc.minutes);
      body.appendChild(meta);
      li.appendChild(body);
      var amt = document.createElement('span');
      amt.className = 'pay-row__amt';
      amt.textContent = calc.minutes ? money(calc.net) : '-';
      li.appendChild(amt);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pay-row__btn';
      btn.textContent = '명세서';
      btn.addEventListener('click', function () { openPayroll(m.id); });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function openPayroll(staffId) {
    if (!isOwner() && staffId !== myStaffId()) return;
    S.payStaffId = staffId;
    S.payExtra = 0;
    S.payWeekly = !!S.settings.weeklyAllowance;
    renderPayrollModal();
    var m = $('payrollModal');
    if (m) m.hidden = false;
  }

  function statementHTML(calc) {
    var rows = [
      ['근무일수', calc.days + '일 (총 ' + hoursText(calc.minutes) + ')'],
      ['기본급', money(calc.base) + (calc.avgWage ? ' (평균 시급 ' + money(calc.avgWage) + ')' : '')],
      ['주휴수당', money(calc.weekly)],
      ['기타 수당', money(calc.extra)]
    ];
    var html = '<div class="pay-doc">';
    html += '<div class="pay-doc__head"><div class="pay-doc__title">급 여 명 세 서</div>';
    html += '<div class="pay-doc__sub">' + esc(calc.storeName) + ' · ' + calc.y + '년 ' + (calc.m + 1) + '월</div></div>';
    html += '<div class="pay-doc__who"><div>' + esc(calc.staffName) + '</div><span>' + calc.y + '-' + pad2(calc.m + 1) + '-01 ~ ' + calc.y + '-' + pad2(calc.m + 1) + '-' + pad2(daysInMonth(calc.y, calc.m)) + '</span></div>';
    if (calc.staffTel) html += '<p class="pay-doc__tel">📞 ' + esc(calc.staffTel) + '</p>';
    html += '<table class="pay-doc__table"><tbody>';
    rows.forEach(function (r) {
      html += '<tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>';
    });
    html += '<tr><th>' + (calc.taxRate ? '공제 (' + calc.taxRate + '%)' : '공제') + '</th><td>' + (calc.tax ? '-' + money(calc.tax) : money(0)) + '</td></tr>';
    html += '</tbody></table>';
    html += '<div class="pay-doc__net"><span>실지급액</span><b>' + money(calc.net) + '</b></div>';
    html += '<div class="pay-doc__who" style="margin-top:8px"><div>지급일</div><span>' + payDayText(calc.y, calc.m) + '</span></div>';
    if (calc.list.length) {
      html += '<ul class="pay-doc__list">';
      calc.list.slice(0, 40).forEach(function (s) {
        var d = parseISO(s.date);
        var pay = countsForPay(s) ? money(shiftPay(s)) : (STATUS_LABEL[s.status] || '');
        html += '<li><span>' + (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAYS[d.getDay()] + ') ' + s.start + '~' + s.end + ' · ' + hoursText(shiftMinutes(s)) + '</span><span>' + pay + '</span></li>';
      });
      if (calc.list.length > 40) html += '<li><span>… 외 ' + (calc.list.length - 40) + '건</span><span></span></li>';
      html += '</ul>';
    }
    if (calc.absent) html += '<p class="pay-doc__note">결근 ' + calc.absent + '건은 급여 계산에서 빠졌습니다.</p>';
    html += '<p class="pay-doc__note">위 금액은 매장 캘린더에서 계산한 예상 금액입니다. 실제 지급액과 다를 수 있습니다.</p>';
    html += '<div class="pay-doc__sign"><span>지급자: ' + esc(calc.storeName) + '</span><span>확인: ____________</span></div>';
    html += '</div>';
    return html;
  }

  function renderPayrollModal() {
    var body = $('payrollBody');
    if (!body) return;
    var calc = computePayroll(S.payStaffId, S.payY, S.payM);
    body.innerHTML = '';
    var title = $('payrollTitle');
    if (title) title.textContent = '🧾 ' + calc.staffName + ' · ' + S.payY + '년 ' + (S.payM + 1) + '월';

    if (isOwner()) {
      var tools = document.createElement('div');
      tools.className = 'pay-tools';
      tools.innerHTML =
        '<label class="pay-tools__row"><span>기타 수당(원)</span>' +
        '<input type="number" id="payrollExtra" min="0" step="1000" inputmode="numeric" value="' + calc.extra + '" /></label>' +
        '<label class="settings-check"><input type="checkbox" id="payrollWeekly"' + (S.payWeekly ? ' checked' : '') + ' /> 주휴수당 자동 계산 포함</label>';
      body.appendChild(tools);
      var extraInput = tools.querySelector('#payrollExtra');
      if (extraInput) extraInput.addEventListener('change', function () {
        S.payExtra = Math.max(0, Math.round(Number(extraInput.value) || 0));
        renderPayrollModal();
      });
      var weeklyInput = tools.querySelector('#payrollWeekly');
      if (weeklyInput) weeklyInput.addEventListener('change', function () {
        S.payWeekly = weeklyInput.checked;
        renderPayrollModal();
      });
    }

    var wrap = document.createElement('div');
    wrap.innerHTML = statementHTML(calc);
    body.appendChild(wrap.firstChild);
    S._lastCalc = calc;
  }

  function payrollText(calc) {
    var lines = [];
    lines.push('🧾 [' + calc.storeName + '] ' + calc.y + '년 ' + (calc.m + 1) + '월 급여명세서');
    lines.push('- 성명: ' + calc.staffName);
    if (calc.staffTel) lines.push('- 연락처: ' + calc.staffTel);
    lines.push('- 근무일수: ' + calc.days + '일 (총 ' + hoursText(calc.minutes) + ')');
    lines.push('- 기본급: ' + money(calc.base) + (calc.avgWage ? ' (평균 시급 ' + money(calc.avgWage) + ')' : ''));
    lines.push('- 주휴수당: ' + money(calc.weekly));
    lines.push('- 기타 수당: ' + money(calc.extra));
    lines.push('- 공제' + (calc.taxRate ? '(' + calc.taxRate + '%)' : '') + ': ' + (calc.tax ? '-' + money(calc.tax) : money(0)));
    lines.push('- 실지급액: ' + money(calc.net));
    lines.push('- 지급일: ' + payDayText(calc.y, calc.m));
    if (calc.absent) lines.push('- 결근 ' + calc.absent + '건은 계산에서 빠졌어요.');
    lines.push('※ 앱에서 계산한 예상 금액이며 실제 지급액과 다를 수 있습니다.');
    return lines.join('\n');
  }

  function copyPayrollText() {
    var calc = S._lastCalc || computePayroll(S.payStaffId, S.payY, S.payM);
    copyText(payrollText(calc), '급여명세서를 복사했어요\n카톡·문자에 그대로 붙여넣으면 돼요');
  }

  function printPayroll() {
    var calc = S._lastCalc || computePayroll(S.payStaffId, S.payY, S.payM);
    var area = $('printArea');
    if (!area) { window.print(); return; }
    area.innerHTML = statementHTML(calc);
    window.print();
  }

  /* ---------------- 알바생 관리·승인 ---------------- */
  function renderStaffList() {
    var card = $('storeStaffCard');
    if (!card) return;
    card.hidden = !isOwner();
    if (!isOwner()) return;
    var list = $('staffList');
    if (!list) return;
    list.innerHTML = '';
    if (!S.staff.length) {
      list.innerHTML = '<li class="empty">아직 알바생이 없어요.<br><b>초대 링크</b>를 보내고 승인하면 여기에 나와요.</li>';
      return;
    }
    var working = S.staff.filter(function (m) { return !m.retired; });
    var retired = S.staff.filter(function (m) { return m.retired; });
    if (!working.length) {
      var none = document.createElement('li');
      none.className = 'empty';
      none.textContent = '지금 일하는 알바생은 없어요.';
      list.appendChild(none);
    }
    working.forEach(function (m) { list.appendChild(staffRow(m, false)); });
    if (retired.length) {
      var head = document.createElement('li');
      head.className = 'staff-list__head';
      head.textContent = '🚪 퇴사자 ' + retired.length + '명 · 지난 근무·급여 기록은 그대로 남아 있어요';
      list.appendChild(head);
      retired.forEach(function (m) { list.appendChild(staffRow(m, true)); });
    }
  }

  /* 알바생 한 줄 — 퇴사한 사람은 이름·시급을 잠그고 [복직]·[완전 삭제]만 보여 줍니다. */
  function staffRow(m, isRetired) {
    var li = document.createElement('li');
    li.className = 'staff-row' + (isRetired ? ' staff-row--retired' : '');

    var photoBtn = document.createElement('button');
    photoBtn.type = 'button';
    photoBtn.className = 'staff-row__photo';
    photoBtn.setAttribute('aria-label', m.name + (isRetired ? ' 사진' : ' 사진 바꾸기'));
    photoBtn.appendChild(storeAvatar(m, 30));
    if (isRetired) photoBtn.disabled = true;
    else photoBtn.addEventListener('click', function () { pickStaffPhoto(m); });
    li.appendChild(photoBtn);
    if (m.photoDataUrl && !isRetired) {
      var clearPh = document.createElement('button');
      clearPh.type = 'button';
      clearPh.className = 'admin-member__photo-clear';
      clearPh.textContent = '✕';
      clearPh.title = '사진 지우기';
      clearPh.addEventListener('click', function () { clearStaffPhoto(m); });
      li.appendChild(clearPh);
    }

    if (isRetired) {
      var nameText = document.createElement('span');
      nameText.className = 'staff-row__name';
      nameText.textContent = m.name;
      li.appendChild(nameText);
      var off = document.createElement('span');
      off.className = 'staff-row__off';
      off.textContent = '퇴사';
      li.appendChild(off);
      var back = document.createElement('button');
      back.type = 'button';
      back.className = 'staff-row__act';
      back.textContent = '복직';
      back.title = m.name + ' 님을 다시 일하는 알바생으로 되돌리기';
      back.addEventListener('click', function () { restoreStaffMember(m); });
      li.appendChild(back);
      var purge = document.createElement('button');
      purge.type = 'button';
      purge.className = 'staff-row__del';
      purge.textContent = '✕';
      purge.setAttribute('aria-label', m.name + ' 목록에서 완전히 삭제');
      purge.title = '목록에서 완전 삭제 (근무·급여 기록은 남음)';
      purge.addEventListener('click', function () { purgeStaffMember(m); });
      li.appendChild(purge);
      var wageText = document.createElement('span');
      wageText.className = 'staff-row__note';
      wageText.textContent = '시급 ' + money(m.hourly || 0);
      li.appendChild(wageText);
      return li;
    }

    var name = document.createElement('input');
    name.type = 'text';
    name.className = 'staff-row__name';
    name.value = m.name;
    name.maxLength = 12;
    name.setAttribute('aria-label', m.name + ' 이름 바꾸기');
    name.title = '이름을 고치고 다른 곳을 누르면 저장돼요';
    name.addEventListener('change', function () { saveStaffName(m, name.value); });
    li.appendChild(name);

    if (m.active === false) {
      var paused = document.createElement('span');
      paused.className = 'staff-row__off';
      paused.textContent = '정지';
      li.appendChild(paused);
    }
    var wage = document.createElement('input');
    wage.type = 'number';
    wage.className = 'staff-row__wage';
    wage.min = '0';
    wage.step = '100';
    wage.inputMode = 'numeric';
    wage.value = String(m.hourly || '');
    wage.setAttribute('aria-label', m.name + ' 기본 시급');
    wage.addEventListener('change', function () { saveStaffHourly(m.id, wage.value); });
    li.appendChild(wage);
    var retire = document.createElement('button');
    retire.type = 'button';
    retire.className = 'staff-row__retire';
    retire.textContent = '🚪 퇴사';
    retire.setAttribute('aria-label', m.name + ' 퇴사(강제 탈퇴) 처리');
    retire.title = '퇴사 처리 — 그 직원 폰에서 매장 접근을 막고, 지난 근무·급여는 남겨요';
    retire.addEventListener('click', function () { retireStaff(m); });
    li.appendChild(retire);

    /* 휴대폰 번호 — 알바생 카드에서 바로 보이고 고칠 수 있어요 */
    var telRow = document.createElement('div');
    telRow.className = 'staff-row__telrow';
    var telIcon = document.createElement('span');
    telIcon.className = 'staff-row__telicon';
    telIcon.textContent = '📞';
    telRow.appendChild(telIcon);
    var telInput = document.createElement('input');
    telInput.type = 'tel';
    telInput.className = 'staff-row__tel';
    telInput.value = telOf(m);
    telInput.placeholder = '010-1234-5678';
    telInput.maxLength = 20;
    telInput.setAttribute('inputmode', 'tel');
    telInput.setAttribute('autocomplete', 'off');
    telInput.setAttribute('aria-label', m.name + ' 휴대폰 번호');
    telInput.title = '번호를 넣고 다른 곳을 누르면 저장돼요';
    telInput.addEventListener('change', function () { saveStaffTel(m, telInput.value); });
    telRow.appendChild(telInput);
    if (telOf(m)) {
      var call = document.createElement('a');
      call.className = 'staff-row__call';
      call.href = telHref(telOf(m));
      call.textContent = '📞';
      call.title = telOf(m) + ' 전화';
      call.setAttribute('aria-label', m.name + ' ' + telOf(m) + ' 전화 걸기');
      telRow.appendChild(call);
    }
    li.appendChild(telRow);
    return li;
  }

  /* 🚪 퇴사(강제 탈퇴) — 사장님만. 과거 근무·급여 기록은 남기고 접근만 막습니다. */
  function retireStaff(m) {
    if (!isOwner()) return;
    if (!window.confirm(m.name + ' 님을 퇴사 처리할까요?\n\n'
      + '· 퇴사하면 그 직원 폰에서 매장 일정·인수인계·급여 화면이 바로 잠기고, 다시 들어올 수 없어요.\n'
      + '· 지난 근무 기록과 급여명세서는 그대로 남아서 정산할 수 있어요.\n'
      + '· 다시 일하게 되면 [복직]을 누르면 돼요.')) return;
    StoreCloud.retireStaff(m.id).then(function (info) {
      renderStaffList();
      if (!info || (!info.uid && !info.deviceId)) {
        window.alert(m.name + ' 님을 퇴사자로 표시했어요.\n\n다만 이 직원은 계정·기기 정보가 저장되기 전에 승인돼서 기기 차단이 확실하지 않아요.\n그 폰에서 다시 입장 요청이 오면 [거절]해 주세요.');
      } else {
        toast(m.name + ' 님을 퇴사 처리했어요 · 지난 근무·급여는 그대로 남아요');
      }
    }).catch(function (err) {
      window.alert('퇴사 처리하지 못했어요 · ' + errorHint(err));
    });
  }

  /* 복직 — 퇴사 표시를 지우고 그 폰의 매장 접근 차단을 풉니다. */
  function restoreStaffMember(m) {
    if (!isOwner()) return;
    if (!window.confirm(m.name + ' 님을 복직시킬까요?\n\n매장 접근 차단이 풀려서 그 폰에서 다시 매장 달력을 볼 수 있어요.')) return;
    StoreCloud.restoreStaff(m.id).then(function () {
      renderStaffList();
      toast(m.name + ' 님을 복직시켰어요');
    }).catch(function (err) {
      window.alert('복직 처리하지 못했어요 · ' + errorHint(err));
    });
  }

  /* 완전 삭제 — 목록에서 지웁니다. 근무(events)·급여 기록은 남고, 차단은 유지됩니다. */
  function purgeStaffMember(m) {
    if (!isOwner()) return;
    if (!window.confirm(m.name + ' 님을 알바생 목록에서 완전히 지울까요?\n\n'
      + '지난 근무·급여 기록(근무 일정)은 그대로 남아요.\n'
      + '다만 급여명세서 목록에서는 이 이름이 빠져서, 남은 근무는 이름으로만 보여요.')) return;
    StoreCloud.purgeStaff(m.id).then(function () {
      renderStaffList();
      toast(m.name + ' 님을 목록에서 지웠어요');
    }).catch(function (err) {
      window.alert('지우지 못했어요 · ' + errorHint(err));
    });
  }

  function storeAvatar(m, size) {
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
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    return el;
  }

  function staffPlain(m) {
    /* joinedAt은 화면에서 밀리초 숫자로 쓰지만, 저장할 때는 원래 타입(Firestore Timestamp)으로
       돌려놓아야 이름·시급·번호를 고칠 때마다 값이 사라지지 않습니다. */
    var joined = null;
    if (m.joinedAt) {
      joined = m.joinedAt;
      if (typeof m.joinedAt === 'number' && window.firebase && firebase.firestore && firebase.firestore.Timestamp) {
        try { joined = firebase.firestore.Timestamp.fromMillis(m.joinedAt); } catch (e) { joined = m.joinedAt; }
      }
    }
    var out = {
      id: m.id, name: m.name, color: m.color, bg: m.bg,
      hourly: m.hourly, joinedAt: joined, active: m.active !== false
    };
    var tel = normTel(m.tel);
    if (tel) out.tel = tel;
    if (m.photoDataUrl) out.photoDataUrl = m.photoDataUrl;
    /* 퇴사·계정 연결 정보는 이름·시급을 고칠 때도 그대로 남겨야 합니다. */
    if (m.uid) out.uid = String(m.uid).slice(0, 128);
    if (m.deviceId) out.deviceId = String(m.deviceId).slice(0, 60);
    if (m.retired) {
      out.retired = true;
      var retired = m.retiredAt;
      if (typeof m.retiredAt === 'number' && window.firebase && firebase.firestore && firebase.firestore.Timestamp) {
        try { retired = firebase.firestore.Timestamp.fromMillis(m.retiredAt); } catch (e) { retired = m.retiredAt; }
      }
      if (retired) out.retiredAt = retired;
    }
    return out;
  }

  function saveStaffName(m, raw) {
    if (!isOwner()) return;
    var name = String(raw || '').trim().slice(0, 12);
    if (!name) { toast('이름을 넣어 주세요'); renderStaffList(); return; }
    if (name === m.name) return;
    if (S.staff.some(function (x) { return x.id !== m.id && x.name === name; })) {
      toast('같은 이름이 이미 있어요');
      renderStaffList();
      return;
    }
    var next = S.staff.map(staffPlain);
    next.forEach(function (x) { if (x.id === m.id) x.name = name; });
    StoreCloud.saveRoom({ staff: next }).then(function () {
      toast((m.name || '알바생') + ' → ' + name + ' 으로 바꿨어요');
    }).catch(function (err) {
      window.alert('저장하지 못했어요 · ' + errorHint(err));
    });
  }

  function pickStaffPhoto(m) {
    if (!isOwner()) return;
    if (!window.CalendarMedia) return;
    CalendarMedia.pickFiles(false).then(function (files) {
      if (!files || !files.length) return;
      CalendarMedia.square(files[0], 160, 0.82).then(function (url) {
        var next = S.staff.map(staffPlain);
        next.forEach(function (x) { if (x.id === m.id) x.photoDataUrl = url; });
        return StoreCloud.saveRoom({ staff: next }).then(function () {
          toast(m.name + ' 님 사진을 저장했어요');
        });
      }).catch(function () {
        toast('사진을 읽지 못했어요');
      });
    });
  }

  function clearStaffPhoto(m) {
    if (!isOwner()) return;
    var next = S.staff.map(staffPlain);
    next.forEach(function (x) { if (x.id === m.id) delete x.photoDataUrl; });
    StoreCloud.saveRoom({ staff: next }).then(function () {
      toast(m.name + ' 님 사진을 지웠어요');
    }).catch(function (err) {
      window.alert('저장하지 못했어요 · ' + errorHint(err));
    });
  }

  function saveStaffHourly(staffId, value) {
    if (!isOwner()) return;
    var hourly = Math.max(0, Math.round(Number(value) || 0));
    var next = S.staff.map(function (m) {
      var out = staffPlain(m);
      out.hourly = m.id === staffId ? hourly : m.hourly;
      return out;
    });
    StoreCloud.saveRoom({ staff: next }).then(function () {
      toast('기본 시급을 저장했어요');
    }).catch(function (err) {
      window.alert('저장하지 못했어요 · ' + errorHint(err));
    });
  }

  /* 휴대폰 번호 저장 — 사장님이 알바생 번호를 고칠 때 */
  function saveStaffTel(m, raw) {
    if (!isOwner()) return;
    var tel = normTel(raw);
    if (tel === telOf(m)) return;
    if (tel && !telLooksValid(tel)) {
      toast('휴대폰 번호를 다시 확인해 주세요 (예: 010-1234-5678)');
      renderStaffList();
      return;
    }
    var next = S.staff.map(function (x) {
      var out = staffPlain(x);
      if (x.id === m.id) { if (tel) out.tel = tel; else delete out.tel; }
      return out;
    });
    StoreCloud.saveRoom({ staff: next }).then(function () {
      toast(tel ? m.name + ' 님 번호를 저장했어요' : m.name + ' 님 번호를 지웠어요');
    }).catch(function (err) {
      window.alert('저장하지 못했어요 · ' + errorHint(err));
    });
  }

  /* 알바생 본인 화면 — 자기 이름·휴대폰 번호를 직접 고칩니다.
     저장하면 staff[] 를 바로 바꾸지 않고 신상정보 변경 요청으로 올라갑니다(사장님 승인 후 반영). */
  function renderMyCard() {
    var card = $('storeMeCard');
    if (!card) return;
    var mine = S.role === 'staff' ? me() : null;
    card.hidden = !mine;
    if (!mine) return;
    var nameEl = $('storeMeName');
    if (nameEl) nameEl.textContent = mine.name + (mine.active === false ? ' · 정지' : '');
    var nameInput = $('storeMeNameInput');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = mine.name;
    var input = $('storeMeTel');
    if (input && document.activeElement !== input) input.value = telOf(mine);
    var hint = $('storeMeTelHint');
    if (hint) {
      hint.textContent = telOf(mine)
        ? '저장된 번호 ' + telOf(mine)
        : '아직 번호가 없어요. 번호를 넣으면 사장님 알바생 목록에 보여요.';
    }
    var note = $('storeMeNote');
    if (note) {
      var mineReq = (S.profileRequests || []).filter(function (r) { return r.targetId === mine.id; });
      var pending = mineReq.filter(function (r) { return r.status === 'pending'; })[0];
      if (pending) {
        note.textContent = '승인 대기 중 · ' + profileChangeLines(pending).join(', ')
          + '. 다시 저장하면 이 요청이 바뀝니다.';
      } else if (mineReq.length && mineReq[0].status === 'rejected') {
        note.textContent = '마지막 변경 요청이 거절되었어요. 내용을 다시 확인해 저장해 보세요.';
      } else {
        note.textContent = '저장하면 신상정보 변경 요청으로 올라가고, 사장님 승인 뒤에 반영돼요.';
      }
    }
  }

  function saveMyInfo() {
    var mine = S.role === 'staff' ? me() : null;
    if (!mine) { toast('알바생으로 입장한 뒤에 저장할 수 있어요'); return; }
    var nameInput = $('storeMeNameInput');
    var name = String(nameInput ? nameInput.value : mine.name).trim().slice(0, 12);
    var input = $('storeMeTel');
    var tel = normTel(input ? input.value : '');
    if (input) input.value = tel;
    if (!name) { toast('이름을 넣어 주세요'); return; }
    if (tel && !telLooksValid(tel)) { toast('휴대폰 번호를 다시 확인해 주세요 (예: 010-1234-5678)'); return; }
    var nameSame = name === mine.name;
    var telSame = tel === telOf(mine);
    if (nameSame && telSame) { toast('저장된 정보와 같아요'); return; }
    if (!nameSame && S.staff.some(function (x) { return x.id !== mine.id && x.name === name; })) {
      toast('같은 이름이 이미 있어요');
      return;
    }
    var btn = $('storeMeSaveBtn');
    if (btn) btn.disabled = true;
    StoreCloud.submitProfileRequest({ staffId: mine.id, staffName: mine.name, name: name, tel: tel }).then(function () {
      lsSet('family-calendar.store.mytel.v1', tel);
      toast('변경 요청을 보냈어요 · 사장님 승인을 기다려 주세요');
      renderMyCard();
    }).catch(function (err) {
      window.alert('요청을 보내지 못했어요 · ' + profileErrorHint(err));
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function openApprovalModal() {
    if (!isOwner()) return;
    renderApprovalCards();
    var m = $('storeApproveModal');
    if (m) m.hidden = false;
  }

  function renderApprovalCards() {
    var wrap = $('storeApprovalCards');
    if (!wrap) return;
    var pending = S.joins.filter(function (r) { return r.status === 'pending'; });
    var pendingProf = pendingProfileRequests();
    var pendingReq = (S.shiftRequests || []).filter(function (r) { return r.status === 'pending'; });
    var count = $('storeApproveModalCount');
    if (count) count.textContent = String(pending.length + pendingProf.length + pendingReq.length);
    wrap.innerHTML = '';
    if (!pending.length && !pendingProf.length && !pendingReq.length) {
      wrap.innerHTML = '<p class="empty">지금은 승인을 기다리는 요청이 없어요.</p>';
      return;
    }
    pending.forEach(function (r) {
      var card = document.createElement('div');
      card.className = 'req-card req-card--pending';
      var tel = telOf(r);
      var isRevoked = (r.uid && (S.revokedUids || []).indexOf(r.uid) >= 0)
        || (r.deviceId && (S.revokedDevices || []).indexOf(r.deviceId) >= 0);
      card.innerHTML =
        '<div class="req-card__top"><strong>' + esc(r.name) + '</strong><span class="req-status req-status--pending">대기 중</span></div>' +
        '<div class="req-card__meta">' + (r.requestedAt ? new Date(r.requestedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '') + ' 입장 요청</div>' +
        (isRevoked ? '<div class="req-card__meta req-card__warn">⚠️ 퇴사 처리된 기기·계정에서 온 요청이에요. 다시 일하게 하려면 [알바생 관리]에서 그 직원을 [복직]시켜 주세요.</div>' : '') +
        '<div class="req-card__tel">' + (tel ? '📞 <a href="' + esc(telHref(tel)) + '">' + esc(tel) + '</a>' : '📞 연락처 미입력') + '</div>' +
        '<div class="approve-row"><label>기본 시급(원)<input type="number" class="approve-wage" min="0" step="100" inputmode="numeric" value="' + (r.hourly || suggestedWage()) + '" /></label></div>' +
        '<div class="req-card__actions"><button type="button" class="btn-ghost btn-small btn-danger" data-act="reject">거절</button><button type="button" class="btn-primary btn-small" data-act="approve">승인</button></div>';
      var wageInput = card.querySelector('.approve-wage');
      var approveBtn = card.querySelector('[data-act="approve"]');
      var rejectBtn = card.querySelector('[data-act="reject"]');
      approveBtn.addEventListener('click', function () {
        approveJoin(r, wageInput ? wageInput.value : '', approveBtn);
      });
      rejectBtn.addEventListener('click', function () { rejectJoin(r, rejectBtn); });
      wrap.appendChild(card);
    });

    /* 신상정보(이름·번호) 변경 요청 */
    pendingProf.forEach(function (r) {
      var card = document.createElement('div');
      card.className = 'req-card req-card--pending';
      var who = r.requesterName || '알바생';
      var lines = profileChangeLines(r).map(function (line) { return '<div class="req-card__meta">' + esc(line) + '</div>'; }).join('');
      card.innerHTML =
        '<div class="req-card__top"><strong>🙋 신상정보 변경 요청</strong><span class="req-status req-status--pending">대기 중</span></div>' +
        '<div class="req-card__meta">👤 ' + esc(who) + ' 님</div>' +
        lines +
        '<div class="req-card__actions"><button type="button" class="btn-ghost btn-small btn-danger" data-act="reject">거절</button><button type="button" class="btn-primary btn-small" data-act="approve">승인</button></div>';
      var approveBtn = card.querySelector('[data-act="approve"]');
      var rejectBtn = card.querySelector('[data-act="reject"]');
      approveBtn.addEventListener('click', function () { decideProfileChange(r, true, approveBtn); });
      rejectBtn.addEventListener('click', function () { decideProfileChange(r, false, rejectBtn); });
      wrap.appendChild(card);
    });

    /* 🙋 근무 변경·대타 요청 */
    pendingReq.forEach(function (r) {
      wrap.appendChild(buildShiftReqCard(r));
    });
  }

  function buildShiftReqCard(r) {
    var card = document.createElement('div');
    card.className = 'req-card req-card--pending';
    var d = parseISO(r.date);
    var shift = null;
    S.shifts.forEach(function (s) { if (s.id === r.shiftId) shift = s; });
    var rows = [];
    rows.push('<div class="req-card__top"><strong>🙋 근무 변경 · 대타 요청</strong><span class="req-status req-status--pending">대기 중</span></div>');
    rows.push('<div class="req-card__meta">👤 ' + esc(r.staffName || '알바생') + ' · ' + (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAYS[d.getDay()] + ') 근무</div>');
    rows.push('<div class="req-card__meta">지금: ' + (shift ? esc((shift.start || '--:--') + '~' + (shift.end || '--:--')) : '근무를 찾지 못했어요') + '</div>');
    if (r.reqStart || r.reqEnd) {
      rows.push('<div class="req-card__meta">희망 시간: <b>' + esc((r.reqStart || '?') + '~' + (r.reqEnd || '?')) + '</b></div>');
    }
    if (r.wantStaffName) {
      rows.push('<div class="req-card__meta">희망 대타: <b>' + esc(r.wantStaffName) + '</b></div>');
    }
    if (r.reason) rows.push('<div class="req-card__memo">' + esc(r.reason) + '</div>');
    rows.push('<div class="req-card__actions"><button type="button" class="btn-ghost btn-small btn-danger" data-act="reject">거절</button><button type="button" class="btn-primary btn-small" data-act="approve">승인</button></div>');
    card.innerHTML = rows.join('');
    var approveBtn = card.querySelector('[data-act="approve"]');
    var rejectBtn = card.querySelector('[data-act="reject"]');
    approveBtn.addEventListener('click', function () { approveShiftReq(r, approveBtn); });
    rejectBtn.addEventListener('click', function () { rejectShiftReq(r, rejectBtn); });
    return card;
  }

  function approveShiftReq(r, btn) {
    if (!isOwner()) return;
    var shift = null;
    S.shifts.forEach(function (s) { if (s.id === r.shiftId) shift = s; });
    if (!shift) {
      window.alert('그 근무를 찾지 못했어요. 이미 지워졌을 수 있어요.');
      return;
    }
    var patch = {};
    var bits = [];
    if (r.reqStart || r.reqEnd) {
      patch.start = r.reqStart || shift.start;
      patch.end = r.reqEnd || shift.end;
      bits.push('시간 ' + patch.start + '~' + patch.end);
    }
    var target = r.wantStaffId ? staffById(r.wantStaffId) : null;
    if (target) {
      patch.staffId = target.id;
      patch.staffName = target.name;
      if (target.hourly) patch.wage = target.hourly;
      bits.push('대타 ' + target.name);
    }
    if (!bits.length) bits.push('바꿀 내용 없음');
    if (!window.confirm(r.staffName + ' 님 요청을 승인할까요?\n' + bits.join(' · ') + '\n\n승인하면 근무가 바로 바뀝니다.')) return;
    if (btn) btn.disabled = true;
    StoreCloud.decideShiftRequest(r, true, { ownerName: '사장님', shiftPatch: patch }).then(function () {
      toast('승인했어요 · 근무를 바꿨어요');
      renderApprovalCards();
      renderAll();
    }).catch(function (err) {
      window.alert('승인하지 못했어요 · ' + errorHint(err));
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function rejectShiftReq(r, btn) {
    if (!isOwner()) return;
    if (!window.confirm(r.staffName + ' 님의 변경 요청을 거절할까요?\n기존 근무는 그대로 유지돼요.')) return;
    if (btn) btn.disabled = true;
    StoreCloud.decideShiftRequest(r, false, { ownerName: '사장님' }).then(function () {
      toast('거절했어요 · 기존 근무는 그대로예요');
      renderApprovalCards();
      renderAll();
    }).catch(function (err) {
      window.alert('처리하지 못했어요 · ' + errorHint(err));
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function profileErrorHint(err) {
    var msg = (err && err.message) || '';
    if (msg === 'already-decided') return '이미 처리된 요청이에요. 화면을 새로 고쳐 확인해 주세요.';
    if (msg === 'member-missing') return '그 알바생을 찾을 수 없어요.';
    if (msg === 'name-taken') return '같은 이름의 알바생이 이미 있어요.';
    if (msg === 'request-missing') return '요청을 찾을 수 없어요. 화면을 새로 고쳐 확인해 주세요.';
    return errorHint(err);
  }

  function decideProfileChange(r, approve, btn) {
    if (!isOwner()) return;
    var who = r.requesterName || '알바생';
    if (!approve && !window.confirm(who + ' 님의 신상정보 변경 요청을 거절할까요?\n알바생 정보는 바뀌지 않아요.')) return;
    if (btn) btn.disabled = true;
    var run = approve ? StoreCloud.approveProfileRequest : StoreCloud.rejectProfileRequest;
    run(r, '사장님').then(function () {
      toast(approve ? who + ' 님 신상정보를 바꿨어요' : '거절했어요 · 알바생 정보는 그대로예요');
      renderApprovalCards();
      renderAll();
    }).catch(function (err) {
      window.alert('처리하지 못했어요 · ' + profileErrorHint(err));
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function suggestedWage() {
    for (var i = 0; i < S.staff.length; i++) if (S.staff[i].hourly) return S.staff[i].hourly;
    return DEFAULT_WAGE;
  }

  function approveJoin(req, wageValue, btn) {
    if (!isOwner()) return;
    var isRevoked = (req.uid && (S.revokedUids || []).indexOf(req.uid) >= 0)
      || (req.deviceId && (S.revokedDevices || []).indexOf(req.deviceId) >= 0);
    if (isRevoked) {
      window.alert('이 요청은 퇴사(탈퇴) 처리된 기기·계정에서 왔어요.\n\n그래도 다시 일하게 하려면 [알바생 관리] 목록에서 그 직원을 [복직]시켜 주세요.\n(복직하면 차단이 풀려 바로 들어올 수 있어요.)');
      return;
    }
    var hourly = Math.max(0, Math.round(Number(wageValue) || 0));
    var staffId = 'st' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    var palette = STAFF_COLORS[S.staff.length % STAFF_COLORS.length];
    var next = S.staff.map(function (m) {
      return staffPlain(m);
    });
    var added = { id: staffId, name: req.name, color: palette.c, bg: palette.bg, hourly: hourly, joinedAt: new Date(), active: true };
    var tel = telOf(req);
    if (tel) added.tel = tel;
    /* 나중에 퇴사시킬 때 이 직원의 폰을 찾을 수 있게 계정(uid)·기기(deviceId)를 함께 저장 */
    if (req.uid) added.uid = String(req.uid).slice(0, 128);
    if (req.deviceId) added.deviceId = String(req.deviceId).slice(0, 60);
    next.push(added);
    if (btn) btn.disabled = true;
    var patch = { staff: next };
    patch['joinRequests.' + req.id + '.status'] = 'approved';
    patch['joinRequests.' + req.id + '.staffId'] = staffId;
    patch['joinRequests.' + req.id + '.hourly'] = hourly;
    patch['joinRequests.' + req.id + '.decidedAt'] = new Date();
    StoreCloud.updateRoom(patch).then(function () {
      toast(req.name + ' 님 입장을 승인했어요 · 그 폰에 매장 달력이 열려요');
      renderApprovalCards();
      renderAll();
    }).catch(function (err) {
      window.alert('승인하지 못했어요 · ' + errorHint(err));
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  function rejectJoin(req, btn) {
    if (!isOwner()) return;
    if (!window.confirm(req.name + ' 님의 입장 요청을 거절할까요?')) return;
    if (btn) btn.disabled = true;
    StoreCloud.decideJoinRequest(req.id, { status: 'rejected', decidedAt: new Date() }).then(function () {
      toast('입장 요청을 거절했어요');
      renderApprovalCards();
    }).catch(function (err) {
      window.alert('처리하지 못했어요 · ' + errorHint(err));
    }).then(function () {
      if (btn) btn.disabled = false;
    });
  }

  /* ---------------- 매장 설정 ---------------- */
  function renderGuide() {
    var card = $('storeGuideCard');
    if (!card) return;
    card.hidden = !isOwner();
    if (!isOwner()) return;
    var codeEl = $('storeCodeNow');
    if (codeEl) codeEl.textContent = S.code || '-';
    var nameLine = $('storeNameNow');
    if (nameLine) nameLine.textContent = S.storeName || '우리 매장';
  }

  function inviteLink() {
    var base = location.origin + location.pathname;
    return base + '?store=' + encodeURIComponent(S.code);
  }

  function openSettings() {
    if (!isOwner()) return;
    var nameInput = $('storeNameInput');
    if (nameInput) nameInput.value = S.storeName || '';
    var taxWrap = $('settingsTax');
    if (taxWrap) {
      Array.prototype.forEach.call(taxWrap.children, function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-tax') === S.settings.taxMode);
      });
    }
    var rate = $('settingsTaxRate');
    if (rate) {
      rate.value = String(S.settings.taxRate || 3.3);
      rate.disabled = S.settings.taxMode !== 'custom';
    }
    var weekly = $('settingsWeekly');
    if (weekly) weekly.checked = !!S.settings.weeklyAllowance;
    var payDay = $('settingsPayDay');
    if (payDay) payDay.value = String(S.settings.payDay || 10);
    var pin1 = $('storeNewPin'), pin2 = $('storeNewPin2');
    if (pin1) pin1.value = '';
    if (pin2) pin2.value = '';
    var msg = $('storePinMsg');
    if (msg) msg.hidden = true;
    var unlock = $('storeUnlockBtn');
    if (unlock) unlock.hidden = !isLocked();
    var note = $('settingsPinNote');
    if (note) {
      note.textContent = (S.pins && S.pins.owner)
        ? 'PIN을 바꾼 뒤에는 새 PIN만 열려요.'
        : '아직 PIN을 바꾸지 않았어요. 처음 PIN(2026)에서 꼭 바꿔 주세요.';
    }
    var m = $('storeSettingsModal');
    if (m) m.hidden = false;
  }

  function saveStoreName() {
    if (!isOwner()) return;
    var input = $('storeNameInput');
    var name = (input ? input.value : '').trim().slice(0, 30);
    StoreCloud.saveRoom({ storeName: name }).then(function () {
      toast(name ? '매장 이름을 저장했어요' : '매장 이름을 지웠어요');
    }).catch(function (err) {
      window.alert('저장하지 못했어요 · ' + errorHint(err));
    });
  }

  function savePayrollSettings() {
    if (!isOwner()) return;
    var taxWrap = $('settingsTax');
    var taxMode = 'none';
    if (taxWrap) {
      var on = taxWrap.querySelector('button.is-active');
      if (on) taxMode = on.getAttribute('data-tax');
    }
    var rateInput = $('settingsTaxRate');
    var rate = Math.max(0, Math.min(30, Number(rateInput ? rateInput.value : 3.3) || 0));
    var weekly = $('settingsWeekly');
    var payDayInput = $('settingsPayDay');
    var payDay = Math.min(31, Math.max(1, Math.round(Number(payDayInput ? payDayInput.value : 10) || 10)));
    StoreCloud.saveRoom({
      payrollSettings: {
        taxMode: taxMode,
        taxRate: taxMode === 'custom' ? rate : 3.3,
        weeklyAllowance: !!(weekly && weekly.checked),
        payDay: payDay,
        weeklyHours: S.settings.weeklyHours || 15
      }
    }).then(function () {
      toast('급여 설정을 저장했어요');
    }).catch(function (err) {
      window.alert('저장하지 못했어요 · ' + errorHint(err));
    });
  }

  function changeOwnerPin() {
    if (!isOwner()) return;
    var p1 = $('storeNewPin'), p2 = $('storeNewPin2'), msg = $('storePinMsg');
    var pin1 = (p1 ? p1.value : '').replace(/\D/g, '');
    var pin2 = (p2 ? p2.value : '').replace(/\D/g, '');
    if (pin1.length !== 4) { showPinMsg('4자리 숫자를 넣어 주세요.'); return; }
    if (pin1 !== pin2) { showPinMsg('두 번 넣은 PIN이 달라요.'); return; }
    StoreCloud.saveRoom({ storePins: { owner: StoreCloud.pinHash(pin1) } }).then(function () {
      if (msg) msg.hidden = true;
      if (p1) p1.value = '';
      if (p2) p2.value = '';
      toast('사장님 PIN을 바꿨어요');
    }).catch(function (err) {
      showPinMsg('저장하지 못했어요 · ' + errorHint(err));
    });
  }

  function showPinMsg(text) {
    var msg = $('storePinMsg');
    if (msg) { msg.textContent = text; msg.hidden = false; }
  }

  /* 이 기기에서만 매장 연결 해제 (기기 교체·알바생 그만둔 때) */
  function leaveStoreDevice() {
    if (!window.confirm('이 기기에서 매장 캘린더 연결을 끊을까요?\n\n매장 근무·시급·급여명세서는 서버에 그대로 남아 있고,\n다시 매장 코드를 넣으면 들어올 수 있어요.')) return;
    StoreCloud.stop();
    lsSet(OWNER_KEY, '');
    lsSet(LOCK_KEY, '');
    lsSet(STAFF_KEY, '');
    lsSet(MODE_KEY, '');
    StoreCloud.forgetCode();
    location.reload();
  }

  /* ---------------- 외부 공개 ---------------- */
  /* 첫 화면이 뜨기 전에 매장 초대 링크(?store=)를 먼저 처리합니다.
     그래야 알바생 기기에서 가족 방이 열리지 않습니다. */
  function preflight() {
    try {
      var q = new URLSearchParams(location.search);
      var storeParam = q.get('store');
      if (storeParam) StoreCloud.rememberCode(storeParam);
      var familyCode = (window.FamilyCloud && FamilyCloud.storedCode()) || '';
      if (storeParam && !familyCode && ls(OWNER_KEY) !== '1') lsSet(LOCK_KEY, '1');
      if (StoreCloud.storedCode()) S.code = StoreCloud.storedCode();
    } catch (e) { /* 무시 */ }
  }
  preflight();

  window.StoreMode = {
    isStoreActive: function () { return S.active; },
    shouldSkipFamily: function () { return isLocked(); },
    open: function () { activate('api'); },
    render: function () { renderAll(); },
    applyVoice: function (text) { applyVoiceShift(text); },
    /* 읽기 전용 상태 (검증·디버깅용) */
    role: function () { return S.role; },
    code: function () { return S.code; },
    staff: function () { return S.staff; },
    shifts: function () { return S.shifts; },
    handovers: function () { return S.handovers; },
    shiftRequests: function () { return S.shiftRequests; },
    summary: function (scope) { return buildStoreKakaoText(scope); }
  };

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.StoreCloud) return;
    S.year = new Date().getFullYear();
    S.month = new Date().getMonth();
    S.selected = todayISO();
    S.payY = S.year;
    S.payM = S.month;
    boot();
  });

  /* 다른 모듈이 먼저 탭을 누를 수 있도록 */
  window.addEventListener('load', function () {
    if (S.active) {
      renderModeChrome();
      paintStoreStatus();
    }
  });
})();
