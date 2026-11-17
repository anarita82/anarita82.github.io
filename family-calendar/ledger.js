/* 💰 금전출납부 — 사장님(본인)만 보는 비공개 장부
   - 가족 달력(우리집2026)·매장 달력(store-dfxh2)과 다른 비공개 방을 씁니다.
   - 이 기기에서 '사장님 모드'를 켠 뒤 PIN(처음 2026)을 넣어야 열립니다.
   - 문자·카톡 붙여넣기 자동입력과, APK v1.5의 알림 자동 수집을 함께 지원합니다.
*/
(function () {
  'use strict';

  var LS_OWNER = 'family-calendar.ledger.owner.v1';
  var LS_AUTO = 'family-calendar.ledger.auto.v1';
  var DEFAULT_PIN = '2026';
  var PIN_MAX_TRY = 5;
  var PIN_WAIT_MS = 60000;

  var CATS = [
    { id: 'sales', label: '매장매출', emoji: '🏪' },
    { id: 'ingredient', label: '식자재', emoji: '🥬' },
    { id: 'labor', label: '인건비', emoji: '👥' },
    { id: 'utility', label: '임대/공과금', emoji: '🏠' },
    { id: 'card', label: '카드', emoji: '💳' },
    { id: 'living', label: '생활비', emoji: '🛒' },
    { id: 'etc', label: '기타', emoji: '📌' }
  ];
  var CAT_LABEL = {};
  CATS.forEach(function (c) { CAT_LABEL[c.id] = c.label; });
  var METHOD_LABEL = { card: '카드', account: '계좌', cash: '현금' };
  var AREA_LABEL = { store: '매장', personal: '개인' };

  var S = {
    y: 0,
    m: 0,
    day: '',
    filter: 'all',
    active: false,
    unlocked: false,
    owner: false,
    autoImmediate: false,
    entries: [],
    pending: [],
    editing: null,
    draft: null,
    parsed: [],
    pinTries: 0,
    pinBlockedUntil: 0,
    cloudStarted: false,
    toastTimer: null,
    applying: false
  };

  var el = {};

  /* ---------------- 작은 도구 ---------------- */
  function $(id) { return document.getElementById(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function iso(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function todayISO() {
    var d = new Date();
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  function parseISO(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }
  function won(n) {
    var v = Math.round(Number(n) || 0);
    try { return v.toLocaleString('ko-KR'); } catch (e) { return String(v); }
  }
  function shortWon(n) {
    var v = Math.round(Number(n) || 0);
    if (v < 10000) return won(v);
    if (v < 100000000) {
      var man = v / 10000;
      var txt = man >= 100 ? String(Math.round(man)) : (Math.round(man * 10) / 10).toString().replace(/\.0$/, '');
      return txt + '만';
    }
    return (Math.round(v / 1000000) / 100) + '억';
  }
  function digits(v) { return String(v == null ? '' : v).replace(/[^0-9]/g, ''); }
  function lsGet(k) { try { return window.localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* 무시 */ } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* 무시 */ } }

  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    if (S.toastTimer) clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
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
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast(okMsg);
    } catch (e) {
      window.prompt('아래 내용을 복사해 주세요.', text);
    }
  }

  function catLabel(id) { return CAT_LABEL[id] || '기타'; }
  function catEmoji(id) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i].emoji;
    return '📌';
  }
  function entryTitle(e) {
    return e.memo || catLabel(e.category);
  }

  /* ---------------- 반복(매월) 계산 ---------------- */
  function monthOccurrences(y, m) {
    var out = [];
    S.entries.forEach(function (e) {
      var d = parseISO(e.date);
      if (!d) return;
      if (!e.repeatMonthly) {
        if (d.y === y && d.m === m + 1) out.push({ e: e, date: e.date, occ: false });
        return;
      }
      var startIdx = d.y * 12 + (d.m - 1);
      var targetIdx = y * 12 + m;
      if (targetIdx < startIdx) return;
      var lastDay = new Date(y, m + 1, 0).getDate();
      var day = Math.min(d.d, lastDay);
      out.push({ e: e, date: iso(y, m + 1, day), occ: targetIdx !== startIdx });
    });
    out.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.e.type !== b.e.type) return a.e.type === 'income' ? -1 : 1;
      return b.e.amount - a.e.amount;
    });
    return out;
  }

  function totals(list, ignoreFilter) {
    var t = { income: 0, expense: 0 };
    list.forEach(function (item) {
      var e = item.e || item;
      var hit = ignoreFilter || S.filter === 'all' || e.area === S.filter;
      if (!hit) return;
      if (e.type === 'income') t.income += e.amount;
      else t.expense += e.amount;
    });
    t.net = t.income - t.expense;
    return t;
  }

  /* ---------------- 탭 · 화면 전환 ---------------- */
  function renderTab() {
    var tab = $('tabLedger');
    if (!tab) return;
    var locked = false;
    try { locked = !!(window.StoreMode && window.StoreMode.shouldSkipFamily && window.StoreMode.shouldSkipFamily()); } catch (e) { locked = false; }
    tab.hidden = !S.owner || locked;
    if (S.owner && S.pending.length) {
      tab.innerHTML = '💰 출납부<span class="mode-tab__badge">' + S.pending.length + '</span>';
    } else {
      tab.textContent = '💰 출납부';
    }
    tab.classList.toggle('is-active', S.active);
    var tabs = $('modeTabs');
    if (tabs && S.owner && !locked) tabs.hidden = false;
  }

  function hideOthers() {
    var fv = $('familyView');
    var sv = $('storeView');
    var fs = $('familySubRow');
    var ss = $('storeSubRow');
    if (fv) fv.hidden = true;
    if (sv) sv.hidden = true;
    if (fs) fs.hidden = true;
    if (ss) ss.hidden = true;
    var add = $('addBtn');
    if (add) add.hidden = true;
    var storeAdd = $('storeAddBtn');
    if (storeAdd) storeAdd.hidden = true;
    document.body.classList.remove('store-mode');
  }

  function enterLedger() {
    /* 추가 캘린더(➕) 화면이 떠 있으면 먼저 닫습니다 — 두 화면이 겹치지 않게 */
    if (window.ExtraMode && typeof window.ExtraMode.isActive === 'function' && window.ExtraMode.isActive()) {
      try { window.ExtraMode.leave(); } catch (e) { /* 무시 */ }
    }
    S.active = true;
    document.body.classList.add('ledger-mode');
    closeOtherModals();
    hideOthers();
    var note = $('appBarNote');
    if (note) note.textContent = '사장님 전용 장부 · 가족·매장과 분리 저장';
    if (el.view) el.view.hidden = false;
    if (el.title) el.title.textContent = '💰 금전출납부';
    document.querySelectorAll('#tabFamily, #tabStore').forEach(function (b) { b.classList.remove('is-active'); });
    renderTab();
    if (!S.owner) { showLock(true); ensureCloud(); return; }
    if (!S.unlocked) { showLock(false); ensureCloud(); return; }
    showMain();
    ensureCloud().then(function () { collectPending(); });
  }

  /* 가족·매장 쪽 모달이 열린 채로 출납부에 들어오면 화면을 가리므로 함께 닫습니다. */
  function closeOtherModals() {
    ['profileModal', 'adminModal', 'roomModal', 'entryModal', 'detailModal', 'approveModal', 'daySheetModal',
      'familyBlockedModal', 'storeSettingsModal', 'storePinModal', 'shiftModal', 'shiftReqModal',
      'storeApproveModal', 'payrollModal', 'storeDaySheetModal'].forEach(function (id) {
      var m = $(id);
      if (m) m.hidden = true;
    });
  }

  function leaveLedger() {
    if (!S.active) return;
    S.active = false;
    S.unlocked = false;
    document.body.classList.remove('ledger-mode');
    if (el.view) el.view.hidden = true;
    if (el.fab) el.fab.hidden = true;
    closeModals();
    renderTab();
    var add = $('addBtn');
    var fv = $('familyView');
    var fs = $('familySubRow');
    var sv = $('storeView');
    var ss = $('storeSubRow');
    var storeActive = !!(window.StoreMode && window.StoreMode.isStoreActive && window.StoreMode.isStoreActive());
    if (storeActive) {
      if (sv) sv.hidden = false;
      if (ss) ss.hidden = false;
      if (fv) fv.hidden = true;
      if (fs) fs.hidden = true;
      document.body.classList.add('store-mode');
      if (el.title) el.title.textContent = '🏪 매장 달력';
      if (window.StoreMode && window.StoreMode.render) {
        try { window.StoreMode.render(); } catch (e) { /* 무시 */ }
      }
    } else {
      if (fv) fv.hidden = false;
      if (fs) fs.hidden = false;
      if (sv) sv.hidden = true;
      if (ss) ss.hidden = true;
      if (add) add.hidden = false;
      if (el.title) el.title.textContent = '📅 우리 가족 달력';
      if (window.FamilyCalendar && typeof window.FamilyCalendar.paintStatus === 'function') {
        try { window.FamilyCalendar.paintStatus(); } catch (e) { /* 무시 */ }
      }
    }
  }

  function showLock(notOwner) {
    if (el.lockCard) el.lockCard.hidden = false;
    if (el.main) el.main.hidden = true;
    if (el.fab) el.fab.hidden = true;
    if (el.lockError) el.lockError.hidden = true;
    if (el.lockPin) el.lockPin.value = '';
    if (el.lockOff) el.lockOff.hidden = notOwner;
    if (el.lockHint) {
      el.lockHint.innerHTML = notOwner
        ? '아직 <b>사장님 모드</b>가 꺼진 기기예요.<br>가족·매장 설정의 <b>💰 금전출납부</b>에서 PIN을 넣어 켜 주세요.'
        : '처음 PIN은 <b>2026</b>이에요. 들어간 뒤 <b>⚙️ 설정</b>에서 바꿔 주세요.';
    }
  }

  function showMain() {
    if (el.lockCard) el.lockCard.hidden = true;
    if (el.main) el.main.hidden = false;
    if (el.fab) el.fab.hidden = false;
    renderMain();
  }

  /* ---------------- 연결 ---------------- */
  function ensureCloud() {
    if (!window.LedgerCloud) return Promise.resolve(false);
    if (S.cloudStarted) return Promise.resolve(true);
    S.cloudStarted = true;
    return window.LedgerCloud.start({
      onEntries: function (list) {
        S.entries = list || [];
        if (S.active && S.unlocked) renderMain();
        if (S.owner) renderTab();
      },
      onRoom: function () { /* PIN 해시는 필요할 때 직접 읽습니다 */ },
      onStatus: function () { /* 상태는 화면 하단 안내로만 씁니다 */ }
    }).then(function () { return true; }).catch(function () { S.cloudStarted = false; return false; });
  }

  function checkPin(pin) {
    return ensureCloud().then(function () {
      return window.LedgerCloud.fetchPinHash();
    }).then(function (hash) {
      if (!hash) return String(pin) === DEFAULT_PIN;
      return window.LedgerCloud.verifyPin(pin);
    });
  }

  /* ---------------- 요약 · 달력 ---------------- */
  function renderMain() {
    var occ = monthOccurrences(S.y, S.m);
    var t = totals(occ);
    if (el.monthHint) el.monthHint.textContent = S.y + '년 ' + (S.m + 1) + '월';
    if (el.sumIn) el.sumIn.textContent = '+' + won(t.income);
    if (el.sumOut) el.sumOut.textContent = '-' + won(t.expense);
    if (el.sumNet) {
      el.sumNet.textContent = (t.net >= 0 ? '+' : '-') + won(Math.abs(t.net));
      el.sumNet.className = 'lg-sum__v ' + (t.net >= 0 ? 'lg-sum__v--net' : 'lg-sum__v--neg');
    }
    if (el.calTitle) el.calTitle.textContent = S.y + '년 ' + (S.m + 1) + '월';
    if (el.calSub) el.calSub.textContent = '수입 ' + shortWon(t.income) + ' · 지출 ' + shortWon(t.expense);

    Array.prototype.forEach.call(document.querySelectorAll('#lgFilter .lg-filter__btn'), function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-filter') === S.filter);
    });

    renderGrid(occ);
    renderPending();
    if (S.day) renderDaySheet();
  }

  function renderGrid(occ) {
    if (!el.grid) return;
    var byDate = {};
    occ.forEach(function (item) {
      var e = item.e;
      if (S.filter !== 'all' && e.area !== S.filter) return;
      var b = byDate[item.date] || (byDate[item.date] = { income: 0, expense: 0, count: 0 });
      if (e.type === 'income') b.income += e.amount;
      else b.expense += e.amount;
      b.count++;
    });

    var first = new Date(S.y, S.m, 1);
    var startPad = first.getDay();
    var daysInMonth = new Date(S.y, S.m + 1, 0).getDate();
    var totalCells = Math.ceil((startPad + daysInMonth) / 7) * 7;
    var today = todayISO();
    var html = '';
    for (var i = 0; i < totalCells; i++) {
      var dayNum = i - startPad + 1;
      var out = dayNum < 1 || dayNum > daysInMonth;
      var dt = new Date(S.y, S.m, dayNum);
      var dateISO = iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
      var cls = 'lg-day' + (out ? ' lg-day--out' : '');
      var col = i % 7;
      if (!out && col === 0) cls += ' lg-day--sun';
      if (!out && col === 6) cls += ' lg-day--sat';
      if (dateISO === today && !out) cls += ' lg-day--today';
      if (S.day === dateISO && !out) cls += ' lg-day--sel';
      var b = byDate[dateISO];
      html += '<button type="button" class="' + cls + '" data-date="' + dateISO + '"' + (out ? ' data-out="1"' : '') + '>';
      html += '<span class="lg-day__n">' + (out ? dt.getDate() : dayNum) + '</span>';
      if (b) {
        if (b.income > 0) html += '<span class="lg-amt lg-amt--in">+' + shortWon(b.income) + '</span>';
        if (b.expense > 0) html += '<span class="lg-amt lg-amt--out">-' + shortWon(b.expense) + '</span>';
        if (b.count > 2) html += '<span class="lg-amt lg-amt--more">' + (b.count - 2) + '건 더</span>';
      }
      html += '</button>';
    }
    el.grid.innerHTML = html;
  }

  /* ---------------- 날짜 바텀시트 ---------------- */
  function openDaySheet(dateISO) {
    S.day = dateISO;
    renderGrid(monthOccurrences(S.y, S.m));
    renderDaySheet();
    if (el.dayModal) el.dayModal.hidden = false;
  }

  function renderDaySheet() {
    var d = parseISO(S.day);
    if (!d) return;
    var wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(d.y, d.m - 1, d.d).getDay()];
    if (el.dayTitle) el.dayTitle.textContent = d.m + '월 ' + d.d + '일 (' + wd + ')';
    var list = monthOccurrences(S.y, S.m).filter(function (item) {
      if (item.date !== S.day) return false;
      return S.filter === 'all' || item.e.area === S.filter;
    });
    var t = totals(list);
    if (el.daySum) {
      el.daySum.innerHTML = (t.income ? '<span class="in">수입 +' + won(t.income) + '</span>' : '') +
        (t.expense ? '<span class="out">지출 −' + won(t.expense) + '</span>' : '') +
        (!t.income && !t.expense ? '<span style="color:var(--ink-faint)">내역 없음</span>' : '');
    }
    if (el.dayList) {
      el.dayList.innerHTML = list.map(function (item) {
        var e = item.e;
        var tags = '<span class="lg-tag ' + (e.area === 'store' ? 'lg-tag--store' : '') + '">' + AREA_LABEL[e.area] + '</span>';
        if (e.repeatMonthly) tags += '<span class="lg-tag lg-tag--repeat">매월</span>';
        if (e.source === 'auto') tags += '<span class="lg-tag lg-tag--auto">자동</span>';
        return '<li><button type="button" class="lg-row lg-row--' + (e.type === 'income' ? 'in' : 'out') + '" data-id="' + e.id + '">' +
          '<span class="lg-row__main">' +
          '<span class="lg-row__title">' + escapeHtml(catEmoji(e.category) + ' ' + entryTitle(e)) + '</span>' +
          '<span class="lg-row__meta">' + tags + ' · ' + catLabel(e.category) + ' · ' + METHOD_LABEL[e.method] + '</span>' +
          '</span>' +
          '<span class="lg-row__amt lg-row__amt--' + (e.type === 'income' ? 'in' : 'out') + '">' +
          (e.type === 'income' ? '+' : '−') + won(e.amount) + '</span>' +
          '</button></li>';
      }).join('');
    }
    if (el.dayEmpty) el.dayEmpty.hidden = list.length > 0;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- 내역 등록/수정 ---------------- */
  function openEntry(entry, dateISO) {
    S.editing = entry ? entry.id : null;
    S.draft = entry ? {
      type: entry.type, area: entry.area, category: entry.category, amount: entry.amount,
      date: entry.date, method: entry.method, memo: entry.memo, repeatMonthly: entry.repeatMonthly
    } : {
      type: 'expense', area: 'personal', category: 'living', amount: 0,
      date: dateISO || S.day || todayISO(), method: 'card', memo: '', repeatMonthly: false
    };
    S.formFresh = true;
    renderEntryForm();
    if (el.entryModal) el.entryModal.hidden = false;
    setTimeout(function () { try { el.amountInput.focus(); } catch (e) { /* 무시 */ } }, 60);
  }

  /* 입력 중인 금액·날짜·메모를 잃지 않도록, 다시 그리기 전에 초안에 옮겨 담습니다. */
  function syncDraftInputs() {
    if (!S.draft) return;
    if (el.amountInput) S.draft.amount = Number(digits(el.amountInput.value)) || 0;
    if (el.dateInput && /^\d{4}-\d{2}-\d{2}$/.test(el.dateInput.value || '')) S.draft.date = el.dateInput.value;
    if (el.memoInput) S.draft.memo = el.memoInput.value;
    if (el.repeatCheck) S.draft.repeatMonthly = !!el.repeatCheck.checked;
  }

  function renderEntryForm() {
    var d = S.draft;
    if (!d) return;
    if (!S.formFresh) syncDraftInputs();
    S.formFresh = false;
    if (el.entryTitle) el.entryTitle.textContent = S.editing ? '내역 수정' : '내역 등록';
    Array.prototype.forEach.call(document.querySelectorAll('#lgType .lg-seg__btn'), function (b) {
      var on = b.getAttribute('data-type') === d.type;
      b.classList.toggle('is-on', on);
      b.classList.toggle('lg-seg__btn--in', on && d.type === 'income');
      b.classList.toggle('lg-seg__btn--out', on && d.type === 'expense');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#lgArea .lg-seg__btn'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-area') === d.area);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#lgMethod .lg-seg__btn'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-method') === d.method);
    });
    if (el.amountInput) el.amountInput.value = d.amount ? won(d.amount) : '';
    if (el.dateInput) el.dateInput.value = d.date;
    if (el.memoInput) el.memoInput.value = d.memo || '';
    if (el.repeatCheck) el.repeatCheck.checked = !!d.repeatMonthly;
    if (el.catWrap) {
      el.catWrap.innerHTML = CATS.map(function (c) {
        return '<button type="button" class="lg-cat' + (c.id === d.category ? ' is-on' : '') + '" data-cat="' + c.id + '">' + c.emoji + ' ' + c.label + '</button>';
      }).join('');
    }
    if (el.entryDelete) el.entryDelete.hidden = !S.editing;
    if (el.entryError) el.entryError.hidden = true;
    if (el.repeatHint) el.repeatHint.hidden = true;
  }
  function saveEntry() {
    var d = S.draft;
    if (!d) return;
    var amount = Number(digits(el.amountInput && el.amountInput.value)) || 0;
    var date = el.dateInput ? String(el.dateInput.value || '').trim() : '';
    if (!amount) { showEntryError('금액을 넣어 주세요.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showEntryError('날짜를 골라 주세요.'); return; }
    d.amount = amount;
    d.date = date;
    d.memo = String((el.memoInput && el.memoInput.value) || '').trim().slice(0, 120);
    d.repeatMonthly = !!(el.repeatCheck && el.repeatCheck.checked);
    if (el.entrySave) el.entrySave.disabled = true;
    var p = S.editing
      ? window.LedgerCloud.updateEntry(S.editing, d)
      : window.LedgerCloud.addEntry(d);
    p.then(function () {
      if (el.entrySave) el.entrySave.disabled = false;
      el.entryModal.hidden = true;
      toast(S.editing ? '내역을 고쳤어요' : '내역을 저장했어요');
      S.editing = null;
      renderMain();
    }).catch(function (err) {
      if (el.entrySave) el.entrySave.disabled = false;
      showEntryError('저장하지 못했어요 · ' + (err && (err.code || err.message) || '오류'));
    });
  }

  function showEntryError(msg) {
    if (!el.entryError) return;
    el.entryError.textContent = msg;
    el.entryError.hidden = false;
  }

  function deleteEntry() {
    if (!S.editing) return;
    var target = null;
    S.entries.forEach(function (e) { if (e.id === S.editing) target = e; });
    var msg = target && target.repeatMonthly
      ? '매월 반복하는 고정 내역이에요.\n반복을 그만두고 이 내역을 지울까요?'
      : '이 내역을 지울까요?\n금전출납부에서 사라져요.';
    if (!window.confirm(msg)) return;
    window.LedgerCloud.deleteEntry(S.editing).then(function () {
      S.editing = null;
      el.entryModal.hidden = true;
      toast('내역을 지웠어요');
      renderMain();
    }).catch(function () { showEntryError('지우지 못했어요. 인터넷 연결을 확인해 주세요.'); });
  }

  /* ---------------- 문자·카톡 자동 입력(파싱) ---------------- */
  var ISSUERS = [
    { re: /(KB\s*국민카드|국민카드)/i, name: 'KB국민카드', method: 'card' },
    { re: /(KB\s*국민은행|국민은행)/i, name: 'KB국민은행', method: 'account' },
    { re: /(현대카드|현대카드M|현대)/i, name: '현대카드', method: 'card' },
    { re: /(삼성카드|삼성)/i, name: '삼성카드', method: 'card' },
    { re: /(신한카드|신한)/i, name: '신한카드', method: 'card' },
    { re: /(롯데카드|롯데)/i, name: '롯데카드', method: 'card' },
    { re: /(하나카드)/i, name: '하나카드', method: 'card' },
    { re: /(하나은행)/i, name: '하나은행', method: 'account' },
    { re: /(우리카드)/i, name: '우리카드', method: 'card' },
    { re: /(우리은행)/i, name: '우리은행', method: 'account' },
    { re: /(BC카드|BC\b)/i, name: 'BC카드', method: 'card' },
    { re: /(NH농협카드|농협카드)/i, name: 'NH농협카드', method: 'card' },
    { re: /(NH농협|농협|NH)/i, name: 'NH농협', method: 'account' },
    { re: /(SC제일은행|SC제일|SC은행|SC\b)/i, name: 'SC제일은행', method: 'account' },
    { re: /(IBK기업은행|기업은행|IBK)/i, name: 'IBK기업은행', method: 'account' },
    { re: /(카카오뱅크)/i, name: '카카오뱅크', method: 'account' },
    { re: /(케이뱅크)/i, name: '케이뱅크', method: 'account' },
    { re: /(토스뱅크)/i, name: '토스뱅크', method: 'account' },
    { re: /(카카오페이)/i, name: '카카오페이', method: 'card' },
    { re: /(네이버페이)/i, name: '네이버페이', method: 'card' },
    { re: /(토스페이|토스)/i, name: '토스페이', method: 'card' },
    { re: /(삼성페이)/i, name: '삼성페이', method: 'card' },
    { re: /(애플페이)/i, name: '애플페이', method: 'card' },
    { re: /(페이코)/i, name: '페이코', method: 'card' },
    { re: /(우체국|우체국은행)/i, name: '우체국', method: 'account' },
    { re: /(수협|신협|새마을금고)/i, name: '수협', method: 'account' }
  ];

  var STORE_WORDS = /(식자재|도매|삼마|멍게|청과|농산|수산|축산|PC방|피시방|옥스|정육|반찬|유통)/;
  var CAT_WORDS = [
    { cat: 'ingredient', re: /(식자재|도매|삼마|멍게|청과|농산|수산|축산|정육|채소|과일|마트\s*도매|식봄|푸드)/ },
    { cat: 'labor', re: /(급여|시급|인건비|알바|일당|주휴|상여)/ },
    { cat: 'utility', re: /(월세|임대|관리비|전기|수도|가스|도시가스|통신|인터넷|KT|SKT|SK브로드|LG유플러스|LGU|한국전력|상하수도|공과금)/ },
    { cat: 'card', re: /(카드대금|결제대금|카드값|이용대금|청구금액|자동이체.*카드)/ },
    { cat: 'sales', re: /(매출|정산|판매|POS|입금.*매장|매장.*입금)/ },
    { cat: 'living', re: /(마트|편의점|GS25|CU|이마트|홈플러스|롯데마트|코스트코|배달|쿠팡|식당|커피|스타벅스|약국|병원|주유|택시|버스|지하철)/ }
  ];

  var EXCLUDE_AMOUNT = /(누적|잔액|한도|포인트|마일리지|개월|할부\s*개월|이자율|수수료율|잔여)/;

  function parseAmounts(text) {
    var re = /(\d[\d,]{2,13})\s*원|원\s*(\d[\d,]{2,13})/g;
    var list = [];
    var m;
    while ((m = re.exec(text))) {
      var raw = m[1] || m[2];
      var idx = m.index;
      var prefix = text.slice(Math.max(0, idx - 12), idx);
      var value = Number(String(raw).replace(/[^0-9]/g, '')) || 0;
      if (!value) continue;
      list.push({ value: value, index: idx, excluded: EXCLUDE_AMOUNT.test(prefix) });
    }
    return list;
  }

  function parseLine(line) {
    var raw = String(line || '').trim();
    if (!raw) return null;
    var text = raw.replace(/\s+/g, ' ');
    var amounts = parseAmounts(text);
    var usable = amounts.filter(function (a) { return !a.excluded && a.value >= 10; });
    if (!usable.length) return null;

    /* 날짜 */
    var date = '';
    var dmy = /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/.exec(text);
    if (dmy) {
      date = iso(Number(dmy[1]), Number(dmy[2]), Number(dmy[3]));
    } else {
      var md = /(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?!\d)/.exec(text);
      var kmd = /(\d{1,2})월\s*(\d{1,2})일/.exec(text);
      if (md) {
        date = safeMD(Number(md[1]), Number(md[2]));
      } else if (kmd) {
        date = safeMD(Number(kmd[1]), Number(kmd[2]));
      } else if (/그제|그저께/.test(text)) {
        date = shiftISO(-2);
      } else if (/어제/.test(text)) {
        date = shiftISO(-1);
      } else if (/(\d{1,2})\s*일\s*전/.test(text)) {
        var dd = Number(/(\d{1,2})\s*일\s*전/.exec(text)[1]);
        date = shiftISO(-dd);
      }
    }
    if (!date) date = todayISO();

    /* 수입/지출 */
    var type = 'expense';
    if (/(승인\s*취소|취소\s*승인|환불|입금|매출|정산|충전|받았|받음|캐시백|적립|이자)/.test(text)) type = 'income';
    if (/(승인\s*취소|취소\s*승인)/.test(text) && !/입금/.test(text)) type = 'income';

    /* 카드사/은행 */
    var issuer = '';
    var method = '';
    for (var i = 0; i < ISSUERS.length; i++) {
      if (ISSUERS[i].re.test(text)) { issuer = ISSUERS[i].name; method = ISSUERS[i].method; break; }
    }
    if (!method) {
      if (/현금/.test(text)) method = 'cash';
      else if (/(은행|계좌|ATM)/.test(text)) method = 'account';
      else method = 'card';
    }

    /* 금액: 승인/결제/입금/출금 글자와 가까운 것 → 첫 번째 */
    var amount = usable[0].value;
    for (var k = 0; k < usable.length; k++) {
      var near = text.slice(Math.max(0, usable[k].index - 14), usable[k].index);
      if (/(승인|결제|입금|출금|이체|사용|청구)/.test(near)) { amount = usable[k].value; break; }
    }

    /* 내용(가맹점·적요) */
    var memo = text
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\(주\)/g, ' ')
      .replace(/\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}/g, ' ')
      .replace(/\d{1,2}\s*[\/.\-]\s*\d{1,2}/g, ' ')
      .replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ')
      .replace(/[\d,]+\s*원/g, ' ')
      .replace(/(승인\s*취소|취소\s*승인|승인번호|승인|결제|입금|출금|이체|자동이체|누적|잔액|사용|환불|취소|정상|일시불|할부|가맹점|포인트|적립|Web발신|web발신|안내|알림|님|건)/g, ' ')
      .replace(/\b\d{5,}\b/g, ' ')
      .replace(/[|:·•\-–—>]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    memo = memo.replace(/^[,\s]+|[,\s]+$/g, '').slice(0, 30);
    if (!memo) memo = issuer || (type === 'income' ? '입금' : '결제');

    /* 영역·분류 */
    var area = 'personal';
    if (STORE_WORDS.test(text) || (type === 'income' && /(매출|정산|POS)/.test(text))) area = 'store';
    var cat = '';
    for (var c = 0; c < CAT_WORDS.length; c++) {
      if (CAT_WORDS[c].re.test(text)) { cat = CAT_WORDS[c].cat; break; }
    }
    if (!cat) {
      if (type === 'income') cat = area === 'store' ? 'sales' : 'etc';
      else cat = 'etc';
    }
    if (type === 'income' && area === 'store') cat = 'sales';

    return {
      date: date,
      type: type,
      area: area,
      category: cat,
      amount: amount,
      method: method,
      memo: memo,
      issuer: issuer,
      raw: raw,
      include: true
    };
  }

  function safeMD(month, day) {
    if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return todayISO();
    var now = new Date();
    var y = now.getFullYear();
    var candidate = new Date(y, month - 1, day);
    if (candidate.getTime() > now.getTime() + 2 * 86400000) candidate = new Date(y - 1, month - 1, day);
    return iso(candidate.getFullYear(), candidate.getMonth() + 1, candidate.getDate());
  }

  function shiftISO(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  function parseMessages(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n');
    var out = [];
    var seen = {};
    lines.forEach(function (line) {
      var item = parseLine(line);
      if (!item) return;
      var key = item.date + '|' + item.amount + '|' + item.memo;
      if (seen[key]) return;
      seen[key] = true;
      out.push(item);
    });
    if (!out.length) {
      var single = parseLine(String(text || '').replace(/\n/g, ' '));
      if (single) out.push(single);
    }
    return out;
  }

  /* 이미 있는 내역과 같은지(중복) */
  function isDuplicate(item) {
    return S.entries.some(function (e) {
      return e.date === item.date && Math.round(e.amount) === Math.round(item.amount) && (e.memo || '') === (item.memo || '');
    });
  }

  function openPaste() {
    S.parsed = [];
    if (el.pasteArea) el.pasteArea.value = '';
    renderParsed();
    if (el.pasteModal) el.pasteModal.hidden = false;
    setTimeout(function () { try { el.pasteArea.focus(); } catch (e) { /* 무시 */ } }, 80);
  }

  function runParse() {
    var text = el.pasteArea ? el.pasteArea.value : '';
    S.parsed = parseMessages(text);
    S.parsed.forEach(function (p) { p.dup = isDuplicate(p); p.include = !p.dup; });
    renderParsed();
    if (!S.parsed.length && text.trim()) toast('금액이 들어간 줄을 찾지 못했어요. 문자를 그대로 붙여넣어 주세요');
  }

  function renderParsed() {
    if (el.parsedWrap) {
      if (!S.parsed.length) {
        el.parsedWrap.innerHTML = '<p class="lg-set-note" style="text-align:center;margin-top:14px">' +
          '카드 결제 문자·은행 입출금 문자·카톡 알림을 <b>그대로 붙여넣고</b> [자동으로 나누기]를 눌러 주세요.<br>여러 건을 한 번에 넣을 수 있어요.</p>';
      } else {
        el.parsedWrap.innerHTML = '<ul class="lg-parsed">' + S.parsed.map(function (p, idx) {
          return '<li class="lg-card' + (p.dup ? ' lg-card--dup' : '') + '" data-idx="' + idx + '">' +
            '<div class="lg-card__top">' +
            '<div class="lg-seg" data-seg="type">' +
            '<button type="button" class="lg-seg__btn' + (p.type === 'income' ? ' is-on lg-seg__btn--in' : '') + '" data-v="income">수입</button>' +
            '<button type="button" class="lg-seg__btn' + (p.type === 'expense' ? ' is-on lg-seg__btn--out' : '') + '" data-v="expense">지출</button>' +
            '</div>' +
            '<div class="lg-seg" data-seg="area">' +
            '<button type="button" class="lg-seg__btn' + (p.area === 'personal' ? ' is-on' : '') + '" data-v="personal">개인</button>' +
            '<button type="button" class="lg-seg__btn' + (p.area === 'store' ? ' is-on' : '') + '" data-v="store">매장</button>' +
            '</div>' +
            (p.dup ? '<span class="lg-dup-note">이미 있는 내역</span>' : '') +
            '</div>' +
            '<div class="lg-card__grid">' +
            '<label class="lg-mini">금액<input type="text" inputmode="numeric" data-f="amount" value="' + won(p.amount) + '" /></label>' +
            '<label class="lg-mini">날짜<input type="date" data-f="date" value="' + p.date + '" /></label>' +
            '<label class="lg-mini">분류<select data-f="category">' + CATS.map(function (c) {
              return '<option value="' + c.id + '"' + (c.id === p.category ? ' selected' : '') + '>' + c.label + '</option>';
            }).join('') + '</select></label>' +
            '<label class="lg-mini">결제수단<select data-f="method">' +
            ['card', 'account', 'cash'].map(function (m) {
              return '<option value="' + m + '"' + (m === p.method ? ' selected' : '') + '>' + METHOD_LABEL[m] + '</option>';
            }).join('') + '</select></label>' +
            '<label class="lg-mini" style="grid-column:1 / -1">내용<input type="text" data-f="memo" value="' + escapeHtml(p.memo) + '" maxlength="40" /></label>' +
            '</div>' +
            '<p class="lg-card__raw">' + escapeHtml(p.raw.slice(0, 120)) + '</p>' +
            '</li>';
        }).join('') + '</ul>';
      }
    }
    if (el.pasteCount) {
      var n = S.parsed.filter(function (p) { return p.include; }).length;
      el.pasteCount.textContent = S.parsed.length ? (S.parsed.length + '건 찾음 · ' + n + '건 등록') : '';
    }
    if (el.pasteSave) el.pasteSave.disabled = !S.parsed.some(function (p) { return p.include; });
  }

  function registerParsed() {
    var list = S.parsed.filter(function (p) { return p.include; });
    if (!list.length) return;
    if (el.pasteSave) el.pasteSave.disabled = true;
    var chain = Promise.resolve();
    var saved = 0;
    list.forEach(function (p) {
      chain = chain.then(function () {
        return window.LedgerCloud.addEntry({
          type: p.type, area: p.area, category: p.category, amount: p.amount,
          date: p.date, method: p.method, memo: p.memo, repeatMonthly: false, source: 'paste'
        }).then(function () { saved++; }).catch(function () { /* 한 건 실패는 넘어감 */ });
      });
    });
    chain.then(function () {
      if (el.pasteSave) el.pasteSave.disabled = false;
      el.pasteModal.hidden = true;
      toast(saved + '건을 출납부에 넣었어요');
      S.parsed = [];
      renderMain();
    });
  }

  /* ---------------- APK 알림 자동 수집 ---------------- */
  function hasBridge() {
    return !!(window.AndroidApp && typeof window.AndroidApp.getPendingAutoEntries === 'function');
  }

  function notificationAccess() {
    try {
      return !!(window.AndroidApp && typeof window.AndroidApp.hasNotificationAccess === 'function' && window.AndroidApp.hasNotificationAccess());
    } catch (e) { return false; }
  }

  function collectPending() {
    if (!hasBridge()) { S.pending = []; renderPending(); renderTab(); return; }
    var raw = '';
    try { raw = window.AndroidApp.getPendingAutoEntries() || '[]'; } catch (e) { raw = '[]'; }
    var items = [];
    try { items = JSON.parse(raw) || []; } catch (e) { items = []; }
    var parsed = [];
    items.forEach(function (it) {
      var body = (it && it.text ? String(it.text) : '').trim();
      var title = (it && it.title ? String(it.title) : '').trim();
      /* 알림 본문에 금액이 있으면 제목(보통 카드사·보낸 사람 이름)은 빼고 본문만 읽습니다. */
      var text = /[\d,]+\s*원/.test(body) ? body : (title + ' ' + body).trim();
      if (!text) return;
      var p = parseLine(text);
      if (!p) return;
      p.raw = text;
      p.app = (it && it.app) || '';
      p.when = (it && it.time) || '';
      p.dup = isDuplicate(p);
      p.include = !p.dup;
      parsed.push(p);
    });
    S.pending = parsed;
    renderPending();
    renderTab();
    if (S.autoImmediate && parsed.length) applyPending(true);
  }

  function renderPending() {
    if (!el.pendingCard) return;
    var list = S.pending || [];
    el.pendingCard.hidden = !list.length || !S.unlocked;
    if (!list.length) return;
    if (el.pendingCount) el.pendingCount.textContent = list.length + '건';
    if (el.pendingList) {
      el.pendingList.innerHTML = list.map(function (p) {
        return '<li class="lg-pending__row"><b>' + (p.type === 'income' ? '+' : '−') + won(p.amount) + '원</b>' +
          '<span>' + p.date.slice(5).replace('-', '/') + ' · ' + escapeHtml(p.memo) + '</span></li>';
      }).join('');
    }
    if (el.pendingReady) el.pendingReady.textContent = '대기 ' + list.length + '건';
  }

  function applyPending(silent) {
    var list = (S.pending || []).filter(function (p) { return p.include; });
    if (!list.length) { toast('반영할 내역이 없어요'); return; }
    if (!silent && !window.confirm(list.length + '건을 출납부에 넣을까요?\n넣은 뒤에도 날짜별로 고칠 수 있어요.')) return;
    S.applying = true;
    var chain = Promise.resolve();
    var saved = 0;
    list.forEach(function (p) {
      chain = chain.then(function () {
        return window.LedgerCloud.addEntry({
          type: p.type, area: p.area, category: p.category, amount: p.amount,
          date: p.date, method: p.method, memo: p.memo, repeatMonthly: false, source: 'auto'
        }).then(function () { saved++; }).catch(function () { /* 무시 */ });
      });
    });
    chain.then(function () {
      S.applying = false;
      try { if (window.AndroidApp && window.AndroidApp.clearPendingAutoEntries) window.AndroidApp.clearPendingAutoEntries(); } catch (e) { /* 무시 */ }
      S.pending = [];
      renderPending();
      renderTab();
      renderMain();
      toast(saved + '건을 자동으로 넣었어요');
    });
  }

  function clearPending() {
    if (!window.confirm('자동 수집한 대기 내역을 지울까요?\n출납부에는 들어가지 않아요.')) return;
    try { if (window.AndroidApp && window.AndroidApp.clearPendingAutoEntries) window.AndroidApp.clearPendingAutoEntries(); } catch (e) { /* 무시 */ }
    S.pending = [];
    renderPending();
    renderTab();
  }

  /* ---------------- 요약 복사 · CSV ---------------- */
  function buildKakao() {
    var occ = monthOccurrences(S.y, S.m);
    var all = totals(occ, true);
    var store = totals(occ.filter(function (i) { return i.e.area === 'store'; }), true);
    var personal = totals(occ.filter(function (i) { return i.e.area === 'personal'; }), true);
    var byCat = {};
    occ.forEach(function (item) {
      var e = item.e;
      if (e.type !== 'expense') return;
      byCat[e.category] = (byCat[e.category] || 0) + e.amount;
    });
    var catRows = Object.keys(byCat).map(function (k) { return { label: catLabel(k), amount: byCat[k] }; })
      .sort(function (a, b) { return b.amount - a.amount; });
    var lines = [];
    lines.push('💰 ' + S.y + '년 ' + (S.m + 1) + '월 금전출납부');
    lines.push('총수입 ' + won(all.income) + '원 · 총지출 ' + won(all.expense) + '원');
    lines.push('순수익 ' + (all.net >= 0 ? '+' : '-') + won(Math.abs(all.net)) + '원');
    lines.push('');
    lines.push('· 매장: 수입 ' + won(store.income) + ' / 지출 ' + won(store.expense) + ' (순 ' + (store.net >= 0 ? '+' : '-') + won(Math.abs(store.net)) + ')');
    lines.push('· 개인: 수입 ' + won(personal.income) + ' / 지출 ' + won(personal.expense) + ' (순 ' + (personal.net >= 0 ? '+' : '-') + won(Math.abs(personal.net)) + ')');
    if (catRows.length) {
      lines.push('');
      lines.push('[지출 많은 순]');
      catRows.forEach(function (r) { lines.push('· ' + r.label + ' ' + won(r.amount) + '원'); });
    }
    var recent = occ.filter(function (i) { return i.e.type === 'expense'; }).slice(-6).reverse();
    if (recent.length) {
      lines.push('');
      lines.push('[최근 지출]');
      recent.forEach(function (i) {
        lines.push('· ' + Number(i.date.slice(5, 7)) + '/' + Number(i.date.slice(8, 10)) + ' ' + entryTitle(i.e) + ' −' + won(i.e.amount) + '원');
      });
    }
    return lines.join('\n');
  }

  function csvText() {
    var rows = [['날짜', '구분', '영역', '분류', '금액', '결제수단', '내용', '매월반복']];
    S.entries.slice().sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); }).forEach(function (e) {
      rows.push([
        e.date,
        e.type === 'income' ? '수입' : '지출',
        AREA_LABEL[e.area] || '',
        catLabel(e.category),
        String(e.amount),
        METHOD_LABEL[e.method] || '',
        e.memo || '',
        e.repeatMonthly ? 'Y' : ''
      ]);
    });
    return '\ufeff' + rows.map(function (r) {
      return r.map(function (v) {
        var s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  function exportCsv() {
    if (!S.entries.length) { toast('내보낼 내역이 없어요'); return; }
    var name = '금전출납부-' + S.y + pad2(S.m + 1) + '.csv';
    var text = csvText();
    if (window.AndroidApp && typeof window.AndroidApp.saveTextFile === 'function') {
      try {
        var saved = window.AndroidApp.saveTextFile(name, text);
        if (saved) { toast('CSV를 폰에 저장했어요 · ' + saved); return; }
      } catch (e) { /* 아래 복사로 */ }
    }
    try {
      var blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('CSV 파일을 내려받았어요 (엑셀에서 열면 됩니다)');
    } catch (e) {
      copyText(text, 'CSV 내용을 복사했어요. 엑셀에 붙여넣으세요');
    }
  }

  /* ---------------- PIN ---------------- */
  function unlockWithPin(pin) {
    if (Date.now() < S.pinBlockedUntil) {
      showLockError('너무 여러 번 틀렸어요. 잠시 뒤에 다시 넣어 주세요.');
      return;
    }
    if (!/^\d{4}$/.test(pin)) { showLockError('4자리 숫자를 넣어 주세요.'); return; }
    checkPin(pin).then(function (ok) {
      if (!ok) {
        S.pinTries++;
        if (S.pinTries >= PIN_MAX_TRY) {
          S.pinTries = 0;
          S.pinBlockedUntil = Date.now() + PIN_WAIT_MS;
          showLockError('5번 틀렸어요. 1분 뒤에 다시 넣어 주세요.');
        } else {
          showLockError('PIN이 맞지 않아요. (' + S.pinTries + '/' + PIN_MAX_TRY + ')');
        }
        if (el.lockPin) el.lockPin.value = '';
        return;
      }
      S.pinTries = 0;
      S.unlocked = true;
      if (el.lockPin) el.lockPin.value = '';
      if (el.lockError) el.lockError.hidden = true;
      showMain();
      collectPending();
    });
  }

  function showLockError(msg) {
    if (!el.lockError) return;
    el.lockError.textContent = msg;
    el.lockError.hidden = false;
  }

  function grantDevice(pin) {
    if (!/^\d{4}$/.test(pin)) { showGrantError('4자리 숫자를 넣어 주세요.'); return; }
    checkPin(pin).then(function (ok) {
      if (!ok) { showGrantError('PIN이 맞지 않아요.'); return; }
      S.owner = true;
      S.unlocked = true;
      lsSet(LS_OWNER, '1');
      if (el.grantModal) el.grantModal.hidden = true;
      if (el.grantPin) el.grantPin.value = '';
      renderTab();
      if (!S.active) enterLedger(); else showMain();
      ensureCloud().then(function () { collectPending(); });
      toast('이 기기에서 출납부를 켰어요 · PIN으로 잠겨 있어요');
    });
  }

  function showGrantError(msg) {
    if (!el.grantError) return;
    el.grantError.textContent = msg;
    el.grantError.hidden = false;
  }

  function changePin() {
    var cur = el.pinCur ? digits(el.pinCur.value) : '';
    var n1 = el.pinNew ? digits(el.pinNew.value) : '';
    var n2 = el.pinNew2 ? digits(el.pinNew2.value) : '';
    if (!/^\d{4}$/.test(n1)) { showPinError('새 PIN은 4자리 숫자로 넣어 주세요.'); return; }
    if (n1 !== n2) { showPinError('새 PIN을 두 번 똑같이 넣어 주세요.'); return; }
    checkPin(cur).then(function (ok) {
      if (!ok) { showPinError('지금 PIN이 맞지 않아요.'); return; }
      return window.LedgerCloud.savePin(n1).then(function () {
        if (el.pinCur) el.pinCur.value = '';
        if (el.pinNew) el.pinNew.value = '';
        if (el.pinNew2) el.pinNew2.value = '';
        if (el.pinError) el.pinError.hidden = true;
        toast('출납부 PIN을 바꿨어요');
      });
    }).catch(function () { showPinError('PIN을 바꾸지 못했어요. 인터넷 연결을 확인해 주세요.'); });
  }

  function showPinError(msg) {
    if (!el.pinError) return;
    el.pinError.textContent = msg;
    el.pinError.hidden = false;
  }

  /* ---------------- 설정 · 권한 ---------------- */
  function renderSettings() {
    if (el.autoCheck) el.autoCheck.checked = !!S.autoImmediate;
    if (el.notifyState) {
      if (!hasBridge()) {
        el.notifyState.innerHTML = '<span class="lg-badge">웹 버전</span> 폰 앱(APK 1.5)에서 켤 수 있어요';
      } else if (notificationAccess()) {
        el.notifyState.innerHTML = '<span class="lg-badge lg-badge--on">켜짐</span> 카드·은행·카톡 입출금 알림을 모으는 중';
      } else {
        el.notifyState.innerHTML = '<span class="lg-badge lg-badge--off">꺼짐</span> 알림 접근 권한을 한 번 켜 주세요';
      }
    }
    if (el.notifyOpen) el.notifyOpen.hidden = !hasBridge();
    if (el.setTotal) el.setTotal.textContent = '저장된 내역 ' + S.entries.length + '건 · 비공개 출납부 방(가족·매장과 분리)';
  }

  function openSettings() {
    renderSettings();
    if (el.settingsModal) el.settingsModal.hidden = false;
  }

  function toggleAuto(on) {
    S.autoImmediate = !!on;
    lsSet(LS_AUTO, S.autoImmediate ? '1' : '');
    toast(S.autoImmediate ? '새 알림을 받으면 바로 출납부에 넣어요' : '자동 반영을 껐어요 · 대기함에서 직접 넣을 수 있어요');
  }

  function turnOffDevice() {
    if (!window.confirm('이 기기에서 출납부를 숨길까요?\n\n장부 내용은 서버에 그대로 남고, 다시 PIN을 넣으면 또 열 수 있어요.')) return;
    S.owner = false;
    S.unlocked = false;
    lsDel(LS_OWNER);
    if (el.settingsModal) el.settingsModal.hidden = true;
    leaveLedger();
    renderTab();
    toast('이 기기에서 출납부를 숨겼어요');
  }

  /* ---------------- 이벤트 연결 ---------------- */
  function bind() {
    el.view = $('ledgerView');
    el.entryModal = $('lgEntryModal');
    el.dayModal = $('lgDayModal');
    el.pasteModal = $('lgPasteModal');
    el.settingsModal = $('lgSettingsModal');
    el.grantModal = $('lgGrantModal');
    el.dayTitle = $('lgDayTitle');
    el.daySum = $('lgDaySum');
    el.dayList = $('lgDayList');
    el.dayEmpty = $('lgDayEmpty');
    el.pendingCard = $('lgPendingCard');
    el.pendingList = $('lgPendingList');
    el.pendingReady = $('lgPendingReady');
    el.pendingCount = $('lgPendingReady');
    el.lockCard = $('lgLockCard');
    el.lockError = $('lgLockError');
    el.lockPin = $('lgLockPin');
    el.lockHint = $('lgLockHint');
    el.lockOff = $('lgLockOffBtn');
    el.main = $('lgMain');
    el.fab = $('lgAddFab');
    el.title = $('appTitle');
    el.grid = $('lgGrid');
    el.calTitle = $('lgCalTitle');
    el.calSub = $('lgCalSub');
    el.monthHint = $('lgMonthHint');
    el.sumIn = $('lgSumIn');
    el.sumOut = $('lgSumOut');
    el.sumNet = $('lgSumNet');

    var tabLedger = $('tabLedger');
    if (tabLedger) tabLedger.addEventListener('click', function () { enterLedger(); });
    var tabFamily = $('tabFamily');
    if (tabFamily) tabFamily.addEventListener('click', leaveLedger);
    var tabStore = $('tabStore');
    if (tabStore) tabStore.addEventListener('click', leaveLedger);

    var unlockBtn = $('lgUnlockBtn');
    if (unlockBtn) unlockBtn.addEventListener('click', function () { unlockWithPin(digits(el.lockPin && el.lockPin.value)); });
    if (el.lockPin) {
      el.lockPin.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); unlockWithPin(digits(el.lockPin.value)); }
      });
      el.lockPin.addEventListener('input', function () { if (el.lockError) el.lockError.hidden = true; });
    }
    if (el.lockOff) el.lockOff.addEventListener('click', turnOffDevice);

    var prev = $('lgPrev'); if (prev) prev.addEventListener('click', function () { shiftMonth(-1); });
    var next = $('lgNext'); if (next) next.addEventListener('click', function () { shiftMonth(1); });
    if (el.fab) el.fab.addEventListener('click', function () { openEntry(null, S.day); });
    if (el.grid) {
      el.grid.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.lg-day');
        if (!btn) return;
        var dateISO = btn.getAttribute('data-date');
        if (!dateISO) return;
        if (btn.getAttribute('data-out')) {
          var d = parseISO(dateISO);
          S.y = d.y; S.m = d.m - 1;
          renderMain();
        }
        openDaySheet(dateISO);
      });
    }

    var filter = $('lgFilter');
    if (filter) {
      filter.addEventListener('click', function (ev) {
        var b = ev.target.closest('.lg-filter__btn');
        if (!b) return;
        S.filter = b.getAttribute('data-filter') || 'all';
        renderMain();
      });
    }

    var pasteBtn = $('lgPasteBtn'); if (pasteBtn) pasteBtn.addEventListener('click', openPaste);
    var kakaoBtn = $('lgKakaoBtn'); if (kakaoBtn) kakaoBtn.addEventListener('click', function () { copyText(buildKakao(), '이번 달 요약을 복사했어요\n카톡에 붙여넣으세요'); });
    var settingsBtn = $('lgSettingsBtn'); if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
    var notifyBtn = $('lgNotifySetupBtn');
    if (notifyBtn) notifyBtn.addEventListener('click', function () {
      if (!hasBridge()) {
        openSettings();
        toast('웹에서는 [📋 문자·카톡 자동입력]을 써 주세요');
        return;
      }
      openNotificationSettings();
    });

    /* 날짜 바텀시트 */
    var dayClose = $('lgDayClose'); if (dayClose) dayClose.addEventListener('click', closeDaySheet);
    var dayModal = $('lgDayModal');
    if (dayModal) {
      var back = dayModal.querySelector('[data-close]');
      if (back) back.addEventListener('click', closeDaySheet);
    }
    var dayAdd = $('lgDayAdd');
    if (dayAdd) dayAdd.addEventListener('click', function () { closeDaySheet(); openEntry(null, S.day); });
    if (el.dayList) {
      el.dayList.addEventListener('click', function (ev) {
        var row = ev.target.closest('.lg-row');
        if (!row) return;
        var id = row.getAttribute('data-id');
        var hit = null;
        S.entries.forEach(function (e) { if (e.id === id) hit = e; });
        if (!hit) return;
        closeDaySheet();
        if (hit.repeatMonthly && hit.date !== S.day) toast('매월 반복하는 내역이라 원래 날짜(' + hit.date + ')로 열었어요');
        openEntry(hit);
      });
    }

    /* 내역 모달 */
    var entryClose = $('lgEntryClose');
    if (entryClose) entryClose.addEventListener('click', function () { el.entryModal.hidden = true; });
    var entryModal = $('lgEntryModal');
    if (entryModal) {
      var eb = entryModal.querySelector('[data-close]');
      if (eb) eb.addEventListener('click', function () { el.entryModal.hidden = true; });
    }
    var typeWrap = $('lgType');
    if (typeWrap) typeWrap.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-type]');
      if (!b) return;
      S.draft.type = b.getAttribute('data-type');
      renderEntryForm();
    });
    var areaWrap = $('lgArea');
    if (areaWrap) areaWrap.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-area]');
      if (!b) return;
      S.draft.area = b.getAttribute('data-area');
      renderEntryForm();
    });
    var methodWrap = $('lgMethod');
    if (methodWrap) methodWrap.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-method]');
      if (!b) return;
      S.draft.method = b.getAttribute('data-method');
      renderEntryForm();
    });
    el.amountInput = $('lgAmount');
    el.dateInput = $('lgDate');
    el.memoInput = $('lgMemo');
    el.repeatCheck = $('lgRepeat');
    el.catWrap = $('lgCatWrap');
    el.entryTitle = $('lgEntryTitle');
    el.entryError = $('lgEntryError');
    el.entrySave = $('lgEntrySave');
    el.entryDelete = $('lgEntryDelete');
    el.repeatHint = $('lgRepeatHint');
    if (el.amountInput) {
      el.amountInput.addEventListener('input', function () {
        var raw = digits(el.amountInput.value);
        el.amountInput.value = raw ? won(Number(raw)) : '';
      });
    }
    if (el.catWrap) el.catWrap.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-cat]');
      if (!b) return;
      S.draft.category = b.getAttribute('data-cat');
      renderEntryForm();
    });
    if (el.entrySave) el.entrySave.addEventListener('click', saveEntry);
    if (el.entryDelete) el.entryDelete.addEventListener('click', deleteEntry);
    var quick = $('lgQuick');
    if (quick) quick.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-add]');
      if (!b) return;
      var cur = Number(digits(el.amountInput.value)) || 0;
      var v = cur + Number(b.getAttribute('data-add'));
      el.amountInput.value = won(v);
    });

    /* 자동입력 모달 */
    var pasteClose = $('lgPasteClose'); if (pasteClose) pasteClose.addEventListener('click', function () { el.pasteModal.hidden = true; });
    var pasteModal = $('lgPasteModal');
    if (pasteModal) {
      var pb = pasteModal.querySelector('[data-close]');
      if (pb) pb.addEventListener('click', function () { el.pasteModal.hidden = true; });
    }
    el.pasteArea = $('lgPasteArea');
    el.parsedWrap = $('lgParsedWrap');
    el.pasteCount = $('lgPasteCount');
    el.pasteSave = $('lgPasteSave');
    var parseBtn = $('lgParseBtn');
    if (parseBtn) parseBtn.addEventListener('click', runParse);
    if (el.pasteSave) el.pasteSave.addEventListener('click', registerParsed);
    var pasteSample = $('lgPasteSample');
    if (pasteSample) pasteSample.addEventListener('click', function () {
      el.pasteArea.value = '[KB국민카드] 11/17 09:12 12,300원 승인 홈플러스 강동점 누적 1,234,567원\n' +
        '[현대카드] 승인 45,000원 11/16 19:20 교촌치킨 잠실\n' +
        '[NH농협] 11/17 08:00 입금 150,000원 박성희\n' +
        '[삼성카드] 11/15 14:05 320,000원 승인 삼마몰 식자재';
      runParse();
    });
    if (el.parsedWrap) {
      el.parsedWrap.addEventListener('click', function (ev) {
        var seg = ev.target.closest('.lg-seg__btn');
        if (seg) {
          var card = seg.closest('.lg-card');
          var idx = Number(card.getAttribute('data-idx'));
          var grp = seg.parentNode.getAttribute('data-seg');
          var v = seg.getAttribute('data-v');
          if (S.parsed[idx]) {
            S.parsed[idx][grp] = v;
            if (grp === 'area' && v === 'store' && S.parsed[idx].type === 'income') S.parsed[idx].category = 'sales';
            renderParsed();
          }
          return;
        }
      });
      el.parsedWrap.addEventListener('change', function (ev) {
        var f = ev.target.getAttribute && ev.target.getAttribute('data-f');
        if (!f) return;
        var card = ev.target.closest('.lg-card');
        var idx = Number(card.getAttribute('data-idx'));
        if (!S.parsed[idx]) return;
        if (f === 'amount') S.parsed[idx].amount = Number(digits(ev.target.value)) || 0;
        else if (f === 'date') S.parsed[idx].date = ev.target.value;
        else S.parsed[idx][f] = ev.target.value;
      });
      el.parsedWrap.addEventListener('input', function (ev) {
        var f = ev.target.getAttribute && ev.target.getAttribute('data-f');
        if (f !== 'amount') return;
        var card = ev.target.closest('.lg-card');
        var idx = Number(card.getAttribute('data-idx'));
        if (!S.parsed[idx]) return;
        var raw = digits(ev.target.value);
        S.parsed[idx].amount = Number(raw) || 0;
        ev.target.value = raw ? won(Number(raw)) : '';
      });
    }

    /* 설정 모달 */
    var setClose = $('lgSettingsClose'); if (setClose) setClose.addEventListener('click', function () { el.settingsModal.hidden = true; });
    var setModal = $('lgSettingsModal');
    if (setModal) {
      var sb = setModal.querySelector('[data-close]');
      if (sb) sb.addEventListener('click', function () { el.settingsModal.hidden = true; });
    }
    el.autoCheck = $('lgAutoImmediate');
    if (el.autoCheck) el.autoCheck.addEventListener('change', function () { toggleAuto(el.autoCheck.checked); });
    el.notifyState = $('lgNotifyState');
    el.notifyOpen = $('lgNotifyOpen');
    if (el.notifyOpen) el.notifyOpen.addEventListener('click', openNotificationSettings);
    el.setTotal = $('lgSetTotal');
    el.pinCur = $('lgPinCur');
    el.pinNew = $('lgPinNew');
    el.pinNew2 = $('lgPinNew2');
    el.pinError = $('lgPinError');
    var pinSave = $('lgPinSave');
    if (pinSave) pinSave.addEventListener('click', changePin);
    var csvBtn = $('lgCsvBtn'); if (csvBtn) csvBtn.addEventListener('click', exportCsv);
    var csvCopy = $('lgCsvCopyBtn'); if (csvCopy) csvCopy.addEventListener('click', function () { copyText(csvText(), 'CSV 내용을 복사했어요 · 엑셀에 붙여넣으세요'); });
    var kakao2 = $('lgKakaoBtn2'); if (kakao2) kakao2.addEventListener('click', function () { copyText(buildKakao(), '이번 달 요약을 복사했어요'); });
    var refresh = $('lgRefreshBtn');
    if (refresh) refresh.addEventListener('click', function () {
      S.cloudStarted = false;
      if (window.LedgerCloud) window.LedgerCloud.stop();
      ensureCloud().then(function () { collectPending(); renderSettings(); toast('출납부를 새로 불러왔어요'); });
    });
    var ownerOff = $('lgOwnerOffBtn'); if (ownerOff) ownerOff.addEventListener('click', turnOffDevice);

    /* 가족 관리자 설정·매장 설정에서 출납부로 들어오는 길 */
    var fromFamily = $('openLedgerBtn');
    if (fromFamily) fromFamily.addEventListener('click', function () {
      var m = $('adminModal');
      if (m) m.hidden = true;
      requestOpen();
    });
    var fromStore = $('storeOpenLedgerBtn');
    if (fromStore) fromStore.addEventListener('click', function () {
      var m = $('storeSettingsModal');
      if (m) m.hidden = true;
      requestOpen();
    });

    /* 대기함 */
    var pApply = $('lgPendingApply'); if (pApply) pApply.addEventListener('click', function () { applyPending(false); });
    var pClear = $('lgPendingClear'); if (pClear) pClear.addEventListener('click', clearPending);

    /* 이 기기에서 켜기(설정에서 진입) */
    var grantBtn = $('lgGrantBtn');
    if (grantBtn) grantBtn.addEventListener('click', function () { grantDevice(digits(el.grantPin && el.grantPin.value)); });
    el.grantModal = $('lgGrantModal');
    el.grantPin = $('lgGrantPin');
    el.grantError = $('lgGrantError');
    if (el.grantPin) {
      el.grantPin.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); grantDevice(digits(el.grantPin.value)); }
      });
    }
    var grantClose = $('lgGrantClose'); if (grantClose) grantClose.addEventListener('click', function () { el.grantModal.hidden = true; });
    if (el.grantModal) {
      var gb = el.grantModal.querySelector('[data-close]');
      if (gb) gb.addEventListener('click', function () { el.grantModal.hidden = true; });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      ['lgEntryModal', 'lgPasteModal', 'lgSettingsModal', 'lgDayModal', 'lgGrantModal'].forEach(function (id) {
        var m = $(id);
        if (m && !m.hidden) m.hidden = true;
      });
    });

    if (window.AndroidApp && typeof window.AndroidApp.hasNotificationAccess === 'function') {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) return;
        if (S.active && S.unlocked) collectPending();
      });
    }
  }

  function shiftMonth(delta) {
    var idx = S.y * 12 + S.m + delta;
    S.y = Math.floor(idx / 12);
    S.m = idx % 12;
    if (S.m < 0) { S.m += 12; S.y -= 1; }
    renderMain();
  }

  function closeDaySheet() {
    if (el.dayModal) el.dayModal.hidden = true;
  }

  function closeModals() {
    ['lgEntryModal', 'lgPasteModal', 'lgSettingsModal', 'lgDayModal', 'lgGrantModal'].forEach(function (id) {
      var m = $(id);
      if (m) m.hidden = true;
    });
  }

  function openNotificationSettings() {
    try {
      if (window.AndroidApp && typeof window.AndroidApp.openNotificationAccessSettings === 'function') {
        window.AndroidApp.openNotificationAccessSettings();
        toast('알림 접근 권한에서 [우리 가족 달력]을 켜 주세요');
      } else {
        toast('폰 설정 → 알림 → 알림 접근 권한에서 [우리 가족 달력]을 켜 주세요');
      }
    } catch (e) {
      toast('폰 설정에서 알림 접근 권한을 켜 주세요');
    }
  }

  function requestOpen() {
    if (S.owner) { enterLedger(); return; }
    if (el.grantModal) {
      if (el.grantError) el.grantError.hidden = true;
      if (el.grantPin) el.grantPin.value = '';
      el.grantModal.hidden = false;
      setTimeout(function () { try { el.grantPin.focus(); } catch (e) { /* 무시 */ } }, 80);
    }
  }

  /* ---------------- 시작 ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    S.owner = lsGet(LS_OWNER) === '1';
    S.autoImmediate = lsGet(LS_AUTO) === '1';
    var now = new Date();
    S.y = now.getFullYear();
    S.m = now.getMonth();
    S.day = todayISO();
    bind();
    renderTab();
    if (S.owner) {
      ensureCloud().then(function () { collectPending(); });
    }
  });

  window.LedgerMode = {
    requestOpen: requestOpen,
    open: enterLedger,
    leave: leaveLedger,
    isActive: function () { return S.active; },
    isOwnerDevice: function () { return S.owner; },
    isUnlocked: function () { return S.unlocked; },
    entries: function () { return S.entries.slice(); },
    parse: parseMessages,
    summary: buildKakao,
    csv: csvText
  };
})();
